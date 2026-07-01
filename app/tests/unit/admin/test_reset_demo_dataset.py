from app.seeders.reset_demo_dataset import (
    DEMO_EMAIL_DOMAIN,
    build_active_email,
    build_pending_email,
)


def test_build_active_email_uses_valid_demo_domain():
    email = build_active_email(course=1, group="1.1", index=1)
    assert email == f"specialist.c1.g11.001@{DEMO_EMAIL_DOMAIN}"


def test_build_active_email_falls_back_when_group_has_no_digits():
    email = build_active_email(course=2, group="alpha", index=7)
    assert email == f"specialist.c2.g200.007@{DEMO_EMAIL_DOMAIN}"


def test_build_pending_email_uses_valid_demo_domain():
    assert build_pending_email(1) == f"pending.student001@{DEMO_EMAIL_DOMAIN}"
    assert build_pending_email(12) == f"pending.student012@{DEMO_EMAIL_DOMAIN}"
