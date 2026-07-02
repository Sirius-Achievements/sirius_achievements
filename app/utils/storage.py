"""
MinIO / S3-compatible object storage client.

File paths stored in the DB use the prefix ``s3:`` to distinguish
MinIO-stored objects from legacy files that live on the local filesystem.

  MinIO key  : ``achievements/abc123.pdf``
  DB value   : ``s3:achievements/abc123.pdf``

Legacy files (no prefix) continue to be served from disk unchanged.
"""
from __future__ import annotations

import asyncio
import io
import mimetypes
import uuid
from typing import AsyncIterator

import boto3
import structlog
from botocore.exceptions import ClientError

from app.config import settings

logger = structlog.get_logger()

# ── MIME type map for common upload types ──────────────────────────────────────
_CONTENT_TYPES: dict[str, str] = {
    "pdf":  "application/pdf",
    "jpg":  "image/jpeg",
    "jpeg": "image/jpeg",
    "png":  "image/png",
    "webp": "image/webp",
    "gif":  "image/gif",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "doc":  "application/msword",
}


def _client() -> "boto3.client":
    return boto3.client(
        "s3",
        endpoint_url=settings.MINIO_ENDPOINT,
        aws_access_key_id=settings.MINIO_ACCESS_KEY,
        aws_secret_access_key=settings.MINIO_SECRET_KEY,
        region_name="us-east-1",
    )


# ── Startup ────────────────────────────────────────────────────────────────────

async def ensure_bucket() -> None:
    """Create the bucket if it does not yet exist (idempotent)."""
    def _create() -> None:
        client = _client()
        try:
            client.head_bucket(Bucket=settings.MINIO_BUCKET)
        except ClientError:
            client.create_bucket(Bucket=settings.MINIO_BUCKET)
            logger.info("minio_bucket_created", bucket=settings.MINIO_BUCKET)

    try:
        await asyncio.to_thread(_create)
    except Exception as exc:
        logger.warning("minio_ensure_bucket_failed", error=str(exc))


async def ping() -> None:
    """Readiness probe — raises if MinIO or the bucket is unreachable."""
    await asyncio.to_thread(lambda: _client().head_bucket(Bucket=settings.MINIO_BUCKET))


# ── Write ──────────────────────────────────────────────────────────────────────

async def upload(data: bytes, key: str, content_type: str | None = None) -> str:
    """Upload *data* to MinIO under *key*. Returns ``s3:<key>``."""
    if not content_type:
        ext = key.rsplit(".", 1)[-1].lower() if "." in key else ""
        content_type = _CONTENT_TYPES.get(ext, "application/octet-stream")

    def _put() -> None:
        _client().put_object(
            Bucket=settings.MINIO_BUCKET,
            Key=key,
            Body=data,
            ContentType=content_type,
            ContentLength=len(data),
        )

    await asyncio.to_thread(_put)
    logger.info("minio_upload_ok", key=key, size=len(data))
    return f"s3:{key}"


# ── Read ───────────────────────────────────────────────────────────────────────

async def download(key: str) -> bytes:
    """Download and return the full object bytes."""
    def _get() -> bytes:
        resp = _client().get_object(Bucket=settings.MINIO_BUCKET, Key=key)
        return resp["Body"].read()

    return await asyncio.to_thread(_get)


async def stream(key: str) -> tuple[AsyncIterator[bytes], str, int | None]:
    """
    Returns ``(async_iterator, content_type, content_length_or_None)``.
    The caller is responsible for consuming the iterator.
    """
    def _head() -> tuple[str, int | None]:
        resp = _client().head_object(Bucket=settings.MINIO_BUCKET, Key=key)
        ct = resp.get("ContentType", "application/octet-stream")
        cl = resp.get("ContentLength")
        return ct, cl

    content_type, content_length = await asyncio.to_thread(_head)

    async def _iter() -> AsyncIterator[bytes]:
        data = await download(key)
        yield data

    return _iter(), content_type, content_length


# ── Delete ─────────────────────────────────────────────────────────────────────

async def delete(key: str) -> None:
    """Delete an object from MinIO (silently ignores missing keys)."""
    def _del() -> None:
        try:
            _client().delete_object(Bucket=settings.MINIO_BUCKET, Key=key)
        except ClientError as exc:
            logger.warning("minio_delete_failed", key=key, error=str(exc))

    await asyncio.to_thread(_del)


# ── Helpers ────────────────────────────────────────────────────────────────────

def is_minio_path(file_path: str) -> bool:
    return isinstance(file_path, str) and file_path.startswith("s3:")


def extract_key(file_path: str) -> str:
    """Strip the ``s3:`` prefix and return the raw MinIO key."""
    return file_path[3:]


def make_key(subdir: str, filename: str) -> str:
    """Build a MinIO key: ``<subdir>/<filename>``."""
    subdir = subdir.strip("/")
    return f"{subdir}/{filename}" if subdir else filename
