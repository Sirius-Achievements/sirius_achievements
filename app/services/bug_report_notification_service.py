from __future__ import annotations

import html
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import structlog

from app.config import settings

logger = structlog.get_logger()


def get_bug_report_notification_recipients(raw_value: str | None = None) -> list[str]:
    raw = settings.BUG_REPORT_NOTIFICATION_EMAILS if raw_value is None else raw_value
    recipients: list[str] = []
    seen: set[str] = set()
    for candidate in raw.split(","):
        email = candidate.strip().lower()
        if not email or email in seen:
            continue
        if any(character in email for character in ("\r", "\n", "\0")) or "@" not in email:
            logger.warning("Ignored invalid bug-report notification email")
            continue
        seen.add(email)
        recipients.append(email)
    return recipients


def build_bug_report_notification(
    *,
    report_id: int,
    description: str | None,
    page_url: str,
    session_id: str | None,
    app_version: str | None,
    reporter: str | None,
) -> tuple[str, str, str]:
    subject = f"Новый баг-репорт #{report_id}"
    description_text = description or "Описание не указано"
    reporter_text = reporter or "Неавторизованный пользователь"
    session_text = session_id or "Не указана"
    version_text = app_version or "Не указана"
    dashboard_url = settings.BUG_REPORT_DASHBOARD_URL

    body_text = (
        f"Получен новый баг-репорт #{report_id}.\n\n"
        f"Описание: {description_text}\n"
        f"Страница: {page_url}\n"
        f"Отправитель: {reporter_text}\n"
        f"Версия приложения: {version_text}\n"
        f"ID сессии: {session_text}\n\n"
        f"Открыть баг-репорты: {dashboard_url}\n"
    )
    body_html = f"""
    <html>
      <body>
        <h2>Новый баг-репорт #{report_id}</h2>
        <p><strong>Описание:</strong> {html.escape(description_text)}</p>
        <p><strong>Страница:</strong> {html.escape(page_url)}</p>
        <p><strong>Отправитель:</strong> {html.escape(reporter_text)}</p>
        <p><strong>Версия приложения:</strong> {html.escape(version_text)}</p>
        <p><strong>ID сессии:</strong> {html.escape(session_text)}</p>
        <p><a href="{html.escape(dashboard_url, quote=True)}">Открыть список баг-репортов</a></p>
      </body>
    </html>
    """.strip()
    return subject, body_text, body_html


def send_bug_report_notification(
    *,
    report_id: int,
    description: str | None,
    page_url: str,
    session_id: str | None,
    app_version: str | None,
    reporter: str | None,
) -> None:
    recipients = get_bug_report_notification_recipients()
    if not recipients:
        logger.info(
            "Bug-report email notification skipped: no recipients configured",
            report_id=report_id,
        )
        return

    subject, body_text, body_html = build_bug_report_notification(
        report_id=report_id,
        description=description,
        page_url=page_url,
        session_id=session_id,
        app_version=app_version,
        reporter=reporter,
    )
    mail_from = settings.MAIL_FROM or settings.MAIL_USERNAME
    if not settings.MAIL_USERNAME or not settings.MAIL_PASSWORD or not mail_from:
        logger.error(
            "Bug-report email notification failed: SMTP credentials are not configured",
            report_id=report_id,
        )
        return

    for recipient in recipients:
        message = MIMEMultipart("alternative")
        message["Subject"] = subject
        message["From"] = mail_from
        message["To"] = recipient
        message.attach(MIMEText(body_text, "plain", "utf-8"))
        message.attach(MIMEText(body_html, "html", "utf-8"))

        server = None
        try:
            if settings.MAIL_USE_SSL:
                server = smtplib.SMTP_SSL(
                    settings.MAIL_HOST,
                    settings.MAIL_PORT,
                    timeout=settings.MAIL_TIMEOUT,
                    context=ssl.create_default_context(),
                )
            else:
                server = smtplib.SMTP(
                    settings.MAIL_HOST,
                    settings.MAIL_PORT,
                    timeout=settings.MAIL_TIMEOUT,
                )
                if settings.MAIL_USE_STARTTLS:
                    server.starttls(context=ssl.create_default_context())
            server.login(settings.MAIL_USERNAME, settings.MAIL_PASSWORD)
            server.sendmail(mail_from, recipient, message.as_string())
            logger.info("Bug-report email notification sent", report_id=report_id, recipient=recipient)
        except Exception as exc:
            logger.error(
                "Bug-report email notification failed",
                report_id=report_id,
                recipient=recipient,
                error=str(exc),
            )
        finally:
            if server is not None:
                try:
                    server.quit()
                except Exception:
                    pass
