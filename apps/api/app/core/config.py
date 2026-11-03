from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, PostgresDsn, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=API_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
    )

    # testing api
    database_url: PostgresDsn | None = None
    app_env: Literal["development", "production"] = "development"
    # optional
    web_dist_dir: Path | None = None
    allowed_origins: list[str] = [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
    ]
    session_ttl_seconds: int = Field(default=8 * 60 * 60, ge=60, le=7 * 24 * 60 * 60)
    guest_session_ttl_seconds: int = Field(default=8 * 60 * 60, ge=60, le=24 * 60 * 60)

    @field_validator("allowed_origins")
    @classmethod
    def validate_origins(cls, origins: list[str]) -> list[str]:
        if not origins:
            raise ValueError("ALLOWED_ORIGINS is empty.")
        for origin in origins:
            parsed = urlsplit(origin)
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path
                or parsed.query
                or parsed.fragment
                or "*" in origin
                or origin != origin.strip()
            ):
                raise ValueError(
                    "ALLOWED_ORIGINS needs HTTP/s origins without paths or wildcards."
                )

            _ = parsed.port
        return origins

    @model_validator(mode="after")
    def require_https_in_production(self):
        if self.app_env == "production" and any(
            not origin.startswith("https://") for origin in self.allowed_origins
        ):
            raise ValueError("ALLOWED_ORIGINS needs https in production.")
        return self

    @property
    def cookie_secure(self) -> bool:
        return self.app_env == "production"

    @property
    def session_cookie_name(self) -> str:
        return "__Host-voting_session" if self.cookie_secure else "voting_session"

    @property
    def guest_cookie_name(self) -> str:
        return "__Host-voting_guest" if self.cookie_secure else "voting_guest"

    def require_database_url(self) -> str:
        if self.database_url is None:
            raise RuntimeError("DATABASE_URL not set")
        url = self.database_url.unicode_string()
        if not url.startswith("postgresql+asyncpg://"):
            raise RuntimeError("Expected postgresql+asyncpg:// URL in DATABASE_URL")
        return url
