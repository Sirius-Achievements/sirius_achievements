from app.services.bug_report_notification_service import (
    build_bug_report_notification,
    get_bug_report_notification_recipients,
)


def test_notification_recipients_are_normalized_and_deduplicated():
    assert get_bug_report_notification_recipients(
        " Admin@Example.com,admin@example.com, second@example.com,invalid "
    ) == ["admin@example.com", "second@example.com"]


def test_notification_html_escapes_user_controlled_values():
    subject, body_text, body_html = build_bug_report_notification(
        report_id=42,
        description='<script>alert("x")</script>',
        page_url='https://example.com/?q=<bad>',
        session_id="session-1",
        app_version="1.0",
        reporter="Иван <ivan@example.com>",
    )

    assert subject == "Новый баг-репорт #42"
    assert '<script>alert("x")</script>' in body_text
    assert "<script>" not in body_html
    assert "&lt;script&gt;" in body_html
    assert "Иван &lt;ivan@example.com&gt;" in body_html
