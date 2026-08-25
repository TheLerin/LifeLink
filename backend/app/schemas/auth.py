"""Pydantic contracts for LifeLink authentication and user identity."""

import re
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field, SecretStr, field_validator

USERNAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{2,79}$")


def normalize_username(value: str) -> str:
    """Normalize and validate the database username domain."""

    normalized = value.strip().lower()
    if not USERNAME_PATTERN.fullmatch(normalized):
        raise ValueError("Username format is invalid")
    return normalized


def validate_bcrypt_password(value: SecretStr) -> SecretStr:
    """Reject values bcrypt cannot represent without truncation."""

    if len(value.get_secret_value().encode("utf-8")) > 72:
        raise ValueError("Password must be at most 72 UTF-8 bytes")
    return value


class UserRole(StrEnum):
    ADMIN = "ADMIN"
    DOCTOR = "DOCTOR"
    BLOOD_BANK_STAFF = "BLOOD_BANK_STAFF"
    ORGAN_BANK_STAFF = "ORGAN_BANK_STAFF"
    DONOR = "DONOR"
    RECIPIENT = "RECIPIENT"


class UserStatus(StrEnum):
    ACTIVE = "ACTIVE"
    DISABLED = "DISABLED"
    LOCKED = "LOCKED"


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    password: SecretStr = Field(min_length=1)

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        return normalize_username(value)

    @field_validator("password")
    @classmethod
    def validate_bcrypt_length(cls, value: SecretStr) -> SecretStr:
        return validate_bcrypt_password(value)


class UserResponse(BaseModel):
    user_id: int
    username: str
    role: UserRole
    status: UserStatus
    person_id: int | None = None
    full_name: str | None = None
    blood_bank_id: int | None = None
    blood_bank_name: str | None = None
    organ_bank_id: int | None = None
    organ_bank_name: str | None = None
    created_at: datetime
    last_login_at: datetime | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int = Field(description="Access-token lifetime in seconds")
    user: UserResponse
