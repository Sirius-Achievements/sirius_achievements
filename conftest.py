import asyncio
import inspect

# Force real imports before any test module runs.
# Some legacy tests conditionally stub these when absent, which leaves other tests
# with a bare ModuleType lacking APIRouter / sqlalchemy.ext / ALGORITHM etc.
import fastapi  # noqa: F401
import sqlalchemy  # noqa: F401
import sqlalchemy.ext.asyncio  # noqa: F401
import app.infrastructure.jwt_handler  # noqa: F401
import app.utils.rate_limiter  # noqa: F401
import app.schemas.admin.auth  # noqa: F401
import app.schemas.admin.user_tokens  # noqa: F401
import app.services.admin.user_token_service  # noqa: F401
import app.models.user  # noqa: F401


try:
    import pytest_asyncio  # noqa: F401
except ImportError:
    def pytest_pyfunc_call(pyfuncitem):
        test_function = pyfuncitem.obj
        if not inspect.iscoroutinefunction(test_function):
            return None

        kwargs = {
            arg: pyfuncitem.funcargs[arg]
            for arg in pyfuncitem._fixtureinfo.argnames
            if arg in pyfuncitem.funcargs
        }
        asyncio.run(test_function(**kwargs))
        return True
