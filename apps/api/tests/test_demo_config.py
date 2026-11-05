import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.core.config import Settings
from app.main import create_app


@pytest.mark.parametrize("enabled", [False, True])
async def test_demo_credentials_are_only_shared_when_enabled(enabled):
    settings = Settings(
        _env_file=None,
        demo_admin_email="Tyrone@example.org" if enabled else None,
        demo_admin_password="purpleblue4112" if enabled else None,
    )
    app = create_app(settings)

    async with AsyncClient(transport=ASGITransport(app), base_url="http://testserver") as client:
        response = await client.get("/api/auth/demo")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == (
        {"email": "tyrone@example.org", "password": "purpleblue4112"} if enabled else None
    )


def test_demo_password_requires_a_protected_email():
    with pytest.raises(ValidationError, match="DEMO_ADMIN_EMAIL"):
        Settings(_env_file=None, demo_admin_email=None, demo_admin_password="purpleblue4112")


def test_demo_config_accepts_an_existing_shorter_login_password():
    settings = Settings(
        _env_file=None,
        demo_admin_email="tyrone@example.org",
        demo_admin_password="blue5827",
    )

    assert settings.demo_admin_password.get_secret_value() == "blue5827"


@pytest.mark.parametrize("password", ["", "b" * 129])
def test_demo_config_rejects_passwords_outside_login_limits(password):
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            demo_admin_email="tyrone@example.org",
            demo_admin_password=password,
        )
