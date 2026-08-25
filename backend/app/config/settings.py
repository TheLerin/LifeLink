"""Validated environment configuration for the LifeLink API."""

from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    """Application settings loaded from environment variables or `lifelink/.env`."""

    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        frozen=True,
        validate_default=True,
    )

    app_name: str = "LifeLink API"
    app_version: str = "1.0.0"
    app_environment: Literal["development", "test", "staging", "production"] = (
        "development"
    )
    debug: bool = False
    log_level: Literal["CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"] = "INFO"
    api_prefix: str = "/api"

    database_url: SecretStr = SecretStr(
        "postgresql+psycopg://lifelink_user:password@localhost:5432/lifelink"
    )
    db_pool_size: int = Field(default=5, ge=1, le=50)
    db_max_overflow: int = Field(default=10, ge=0, le=100)
    db_pool_timeout_seconds: float = Field(default=30.0, gt=0, le=120)
    db_pool_recycle_seconds: int = Field(default=1800, ge=60, le=86400)
    db_connect_timeout_seconds: int = Field(default=5, ge=1, le=30)
    db_health_timeout_seconds: float = Field(default=3.0, gt=0, le=30)

    frontend_origin: str = "http://localhost:5173"
    request_id_header: str = "X-Request-ID"

    jwt_secret: SecretStr = SecretStr("development-only-change-this-jwt-secret")
    jwt_algorithm: Literal["HS256"] = "HS256"
    jwt_issuer: str = "lifelink-api"
    jwt_audience: str = "lifelink-api"
    access_token_expire_minutes: int = Field(default=120, ge=1, le=1440)

    @field_validator("api_prefix")
    @classmethod
    def validate_api_prefix(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized.startswith("/"):
            raise ValueError("API_PREFIX must start with '/'")
        normalized = normalized.rstrip("/")
        if not normalized:
            raise ValueError("API_PREFIX cannot be the root path")
        return normalized

    @field_validator("database_url", mode="before")
    @classmethod
    def validate_database_url(cls, value: object) -> object:
        raw_value = (
            value.get_secret_value() if isinstance(value, SecretStr) else str(value)
        )
        if not raw_value.startswith("postgresql+psycopg://"):
            raise ValueError(
                "DATABASE_URL must use the postgresql+psycopg SQLAlchemy driver"
            )
        return raw_value

    @field_validator("frontend_origin")
    @classmethod
    def validate_frontend_origin(cls, value: str) -> str:
        normalized = value.strip().rstrip("/")
        parsed = urlsplit(normalized)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("FRONTEND_ORIGIN must be an absolute HTTP(S) origin")
        if parsed.path or parsed.query or parsed.fragment:
            raise ValueError(
                "FRONTEND_ORIGIN must not contain a path, query, or fragment"
            )
        return normalized

    @model_validator(mode="after")
    def reject_weak_deployment_secret(self) -> "Settings":
        if self.app_environment not in {"staging", "production"}:
            return self

        secret = self.jwt_secret.get_secret_value()
        known_placeholder = secret.startswith(
            ("development-only", "replace-with", "change-me")
        )
        if len(secret.encode("utf-8")) < 32 or known_placeholder:
            raise ValueError(
                "JWT_SECRET must be a unique 32-byte-or-longer value outside "
                "development and test"
            )
        return self

    @property
    def cors_origins(self) -> list[str]:
        """Return the single explicitly approved browser origin."""

        return [self.frontend_origin]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return one immutable settings object per process."""

    return Settings()
