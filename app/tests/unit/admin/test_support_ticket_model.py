import sys
import types

sys.modules.setdefault("dotenv", types.SimpleNamespace(load_dotenv=lambda *args, **kwargs: None))

from app.models.support_ticket import SupportTicket


def test_support_ticket_status_enum_uses_lowercase_values():
    assert SupportTicket.__table__.c.status.type.enums == ["open", "in_progress", "closed", "archived"]
