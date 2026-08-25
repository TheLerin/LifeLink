"""Request and response contracts for ADMIN account management."""

from pydantic import BaseModel, Field, SecretStr, field_validator, model_validator

from app.schemas.auth import (
    UserResponse,
    UserRole,
    UserStatus,
    normalize_username,
    validate_bcrypt_password,
)


class UserCreateRequest(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    password: SecretStr = Field(min_length=8)
    role: UserRole
    status: UserStatus = UserStatus.ACTIVE
    person_id: int | None = Field(default=None, gt=0)
    blood_bank_id: int | None = Field(default=None, gt=0)
    organ_bank_id: int | None = Field(default=None, gt=0)

    @field_validator("username")
    @classmethod
    def normalize_create_username(cls, value: str) -> str:
        return normalize_username(value)

    @field_validator("password")
    @classmethod
    def validate_create_password(cls, value: SecretStr) -> SecretStr:
        return validate_bcrypt_password(value)


class UserUpdateRequest(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=80)
    new_password: SecretStr | None = Field(default=None, min_length=8)
    role: UserRole | None = None
    person_id: int | None = Field(default=None, gt=0)
    blood_bank_id: int | None = Field(default=None, gt=0)
    organ_bank_id: int | None = Field(default=None, gt=0)

    @field_validator("username")
    @classmethod
    def normalize_update_username(cls, value: str | None) -> str | None:
        return normalize_username(value) if value is not None else None

    @field_validator("new_password")
    @classmethod
    def validate_update_password(
        cls,
        value: SecretStr | None,
    ) -> SecretStr | None:
        return validate_bcrypt_password(value) if value is not None else None

    @model_validator(mode="after")
    def require_at_least_one_update(self) -> "UserUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("At least one user field must be supplied")
        for required_field in ("username", "role"):
            if (
                required_field in self.model_fields_set
                and getattr(self, required_field) is None
            ):
                raise ValueError(f"{required_field} cannot be null")
        if "new_password" in self.model_fields_set and self.new_password is None:
            raise ValueError("new_password cannot be null")
        return self


class UserStatusUpdateRequest(BaseModel):
    status: UserStatus


class UserListResponse(BaseModel):
    items: list[UserResponse]
    page: int
    page_size: int
    total: int
    total_pages: int
