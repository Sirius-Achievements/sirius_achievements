import pytest
import os
import tempfile
import zipfile
from unittest.mock import AsyncMock, MagicMock, patch
from io import BytesIO
from app.utils.file_validator import FileValidator, DOC_SIGNATURES, IMAGE_SIGNATURES, SUPPORT_SIGNATURES


@pytest.fixture
def tmp_dir():
    with tempfile.TemporaryDirectory() as d:
        yield d


def make_upload_file(header: bytes, size: int = None, filename: str | None = None):
    """Create a mock UploadFile."""
    mock = AsyncMock()
    effective_size = size or len(header)
    content = header + b'\x00' * (effective_size - len(header))

    buffer = BytesIO(content)

    async def mock_read(n=-1):
        if n == -1:
            buffer.seek(0)
            return buffer.read()
        return buffer.read(n)

    async def mock_seek(pos):
        buffer.seek(pos)

    mock.read = mock_read
    mock.seek = mock_seek
    mock.file = BytesIO(content)
    mock.size = effective_size
    mock.filename = filename

    return mock


@pytest.mark.asyncio
async def test_detect_pdf(tmp_dir):
    validator = FileValidator(DOC_SIGNATURES, max_size=10 * 1024 * 1024, upload_dir=tmp_dir)
    file = make_upload_file(b'\x25\x50\x44\x46-1.4 test content here')
    path = await validator.validate_and_save(file)
    assert path.endswith('.pdf')


@pytest.mark.asyncio
async def test_detect_png(tmp_dir):
    validator = FileValidator(DOC_SIGNATURES, max_size=10 * 1024 * 1024, upload_dir=tmp_dir)
    file = make_upload_file(b'\x89\x50\x4E\x47\x0D\x0A\x1A\x0A' + b'\x00' * 100)
    path = await validator.validate_and_save(file)
    assert path.endswith('.png')


@pytest.mark.asyncio
async def test_detect_jpg(tmp_dir):
    validator = FileValidator(DOC_SIGNATURES, max_size=10 * 1024 * 1024, upload_dir=tmp_dir)
    file = make_upload_file(b'\xFF\xD8\xFF\xE0' + b'\x00' * 100)
    path = await validator.validate_and_save(file)
    assert path.endswith('.jpg')


@pytest.mark.asyncio
async def test_reject_invalid_format(tmp_dir):
    validator = FileValidator(DOC_SIGNATURES, max_size=10 * 1024 * 1024, upload_dir=tmp_dir)
    file = make_upload_file(b'\x00\x00\x00\x00\x00\x00\x00\x00')
    with pytest.raises(ValueError, match="Недопустимый формат"):
        await validator.validate_and_save(file)


@pytest.mark.asyncio
async def test_reject_oversized_file(tmp_dir):
    validator = FileValidator(DOC_SIGNATURES, max_size=100, upload_dir=tmp_dir)
    file = make_upload_file(b'\x25\x50\x44\x46' + b'\x00' * 200, size=204)
    with pytest.raises(ValueError, match="слишком большой"):
        await validator.validate_and_save(file)


@pytest.mark.asyncio
async def test_webp_image_signature(tmp_dir):
    validator = FileValidator(IMAGE_SIGNATURES, max_size=5 * 1024 * 1024, upload_dir=tmp_dir)
    file = make_upload_file(b'RIFF' + b'\x00' * 100)
    path = await validator.validate_and_save(file)
    assert path.endswith('.webp')


@pytest.mark.asyncio
async def test_support_accepts_valid_docx(tmp_dir):
    payload = BytesIO()
    with zipfile.ZipFile(payload, 'w') as archive:
        archive.writestr('[Content_Types].xml', '<Types/>')
        archive.writestr('word/document.xml', '<document/>')

    validator = FileValidator(SUPPORT_SIGNATURES, max_size=5 * 1024 * 1024, upload_dir=tmp_dir)
    file = make_upload_file(payload.getvalue(), filename='report.docx')
    path = await validator.validate_and_save(file)
    assert path.endswith('.docx')


@pytest.mark.asyncio
async def test_support_rejects_zip_renamed_to_docx(tmp_dir):
    payload = BytesIO()
    with zipfile.ZipFile(payload, 'w') as archive:
        archive.writestr('payload.txt', 'not a Word document')

    validator = FileValidator(SUPPORT_SIGNATURES, max_size=5 * 1024 * 1024, upload_dir=tmp_dir)
    file = make_upload_file(payload.getvalue(), filename='payload.docx')
    with pytest.raises(ValueError, match='Недопустимый формат'):
        await validator.validate_and_save(file)


@pytest.mark.asyncio
async def test_support_accepts_legacy_doc_signature(tmp_dir):
    validator = FileValidator(SUPPORT_SIGNATURES, max_size=5 * 1024 * 1024, upload_dir=tmp_dir)
    file = make_upload_file(b'\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1' + b'\x00' * 64, filename='report.doc')
    path = await validator.validate_and_save(file)
    assert path.endswith('.doc')
