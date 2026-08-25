"""Password hashing and signed JWT access-token primitives."""

from datetime import UTC, datetime, timedelta
from typing import NamedTuple
from uuid import uuid4

import bcrypt
import jwt
from jwt import ExpiredSignatureError, InvalidTokenError

from app.config.settings import Settings
from app.schemas.auth import UserRole

MAX_BCRYPT_PASSWORD_BYTES = 72

# Valid cost-12 fallback. Verifying this when a username is missing keeps the
# negative login path close to the normal bcrypt timing.
DUMMY_BCRYPT_HASH = "$2b$12$L/U6RlnuP6mcJ7TtM9bYn.I8JG/qVFU6it2PXkCcXJaV50SRY6SdW"


class DecodedAccessToken(NamedTuple):
    user_id: int
    role: UserRole


class AccessTokenExpiredError(Exception):
    """The token was validly formed but is past its expiration time."""


class AccessTokenInvalidError(Exception):
    """The token is malformed, unsigned, or has invalid required claims."""


def _password_bytes(password: str) -> bytes:
    encoded = password.encode("utf-8")
    if len(encoded) > MAX_BCRYPT_PASSWORD_BYTES:
        raise ValueError("Password must be at most 72 UTF-8 bytes for bcrypt")
    return encoded


def hash_password(password: str, *, rounds: int = 12) -> str:
    """Create a bcrypt hash suitable for `user_account.password_hash`."""

    if not 4 <= rounds <= 15:
        raise ValueError("bcrypt rounds must be between 4 and 15")
    return bcrypt.hashpw(_password_bytes(password), bcrypt.gensalt(rounds)).decode(
        "ascii"
    )


def verify_password(password: str, password_hash: str) -> bool:
    """Safely compare a plaintext candidate with a stored bcrypt hash."""

    try:
        return bcrypt.checkpw(
            _password_bytes(password),
            password_hash.encode("ascii"),
        )
    except (TypeError, ValueError, UnicodeError):
        return False


def create_access_token(
    *,
    user_id: int,
    role: UserRole,
    settings: Settings,
    issued_at: datetime | None = None,
) -> str:
    """Create one short-lived signed access token for the approved auth flow."""

    now = issued_at or datetime.now(UTC)
    expires_at = now + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {
        "sub": str(user_id),
        "role": role.value,
        "type": "access",
        "iat": now,
        "exp": expires_at,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "jti": str(uuid4()),
    }
    return jwt.encode(
        payload,
        settings.jwt_secret.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )


def decode_access_token(token: str, settings: Settings) -> DecodedAccessToken:
    """Verify token integrity and return only the trusted identity claims."""

    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
            options={
                "require": ["sub", "role", "type", "iat", "exp", "iss", "aud", "jti"]
            },
        )
        if payload["type"] != "access":
            raise AccessTokenInvalidError
        user_id = int(payload["sub"])
        if user_id <= 0:
            raise AccessTokenInvalidError
        role = UserRole(payload["role"])
    except ExpiredSignatureError as exc:
        raise AccessTokenExpiredError from exc
    except AccessTokenInvalidError:
        raise
    except (InvalidTokenError, KeyError, TypeError, ValueError) as exc:
        raise AccessTokenInvalidError from exc

    return DecodedAccessToken(user_id=user_id, role=role)
