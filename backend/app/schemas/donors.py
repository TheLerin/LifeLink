"""Request and response contracts for normalized donor records."""

import re
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from pydantic import BaseModel, Field, field_validator, model_validator

PHONE_PATTERN = re.compile(r"^[0-9+() -]{7,20}$")
PINCODE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$")


def _strip_required(value: str) -> str:
    stripped = value.strip()
    if not stripped:
        raise ValueError("Value cannot be blank")
    return stripped


def _validate_birth_date(value: date) -> date:
    today = date.today()
    if value > today:
        raise ValueError("Date of birth cannot be in the future")
    age_years = (
        today.year - value.year - ((today.month, today.day) < (value.month, value.day))
    )
    if age_years > 120:
        raise ValueError("Date of birth exceeds the supported age range")
    return value


class Gender(StrEnum):
    MALE = "MALE"
    FEMALE = "FEMALE"
    OTHER = "OTHER"
    PREFER_NOT_TO_SAY = "PREFER_NOT_TO_SAY"


class BloodGroup(StrEnum):
    A_POSITIVE = "A+"
    A_NEGATIVE = "A-"
    B_POSITIVE = "B+"
    B_NEGATIVE = "B-"
    AB_POSITIVE = "AB+"
    AB_NEGATIVE = "AB-"
    O_POSITIVE = "O+"
    O_NEGATIVE = "O-"


class DonationType(StrEnum):
    BLOOD = "BLOOD"
    ORGAN = "ORGAN"


class DonationRecordStatus(StrEnum):
    ACTIVE = "ACTIVE"
    VOIDED = "VOIDED"


class DonorConditionStatus(StrEnum):
    ACTIVE = "ACTIVE"
    RESOLVED = "RESOLVED"
    MONITORED = "MONITORED"


class AddressCreate(BaseModel):
    line1: str = Field(min_length=1, max_length=150)
    line2: str | None = Field(default=None, max_length=150)
    city: str = Field(min_length=1, max_length=80)
    district: str = Field(min_length=1, max_length=80)
    state: str = Field(min_length=1, max_length=80)
    pincode: str = Field(min_length=3, max_length=10)

    @field_validator("line1", "city", "district", "state")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        return _strip_required(value)

    @field_validator("line2")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("pincode")
    @classmethod
    def validate_pincode(cls, value: str) -> str:
        normalized = value.strip()
        if not PINCODE_PATTERN.fullmatch(normalized):
            raise ValueError("Pincode format is invalid")
        return normalized


class AddressUpdate(BaseModel):
    line1: str | None = Field(default=None, min_length=1, max_length=150)
    line2: str | None = Field(default=None, max_length=150)
    city: str | None = Field(default=None, min_length=1, max_length=80)
    district: str | None = Field(default=None, min_length=1, max_length=80)
    state: str | None = Field(default=None, min_length=1, max_length=80)
    pincode: str | None = Field(default=None, min_length=3, max_length=10)

    @field_validator("line1", "city", "district", "state")
    @classmethod
    def strip_required_text(cls, value: str | None) -> str | None:
        return _strip_required(value) if value is not None else None

    @field_validator("line2")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("pincode")
    @classmethod
    def validate_pincode(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not PINCODE_PATTERN.fullmatch(normalized):
            raise ValueError("Pincode format is invalid")
        return normalized

    @model_validator(mode="after")
    def validate_patch(self) -> "AddressUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one address field must be supplied")
        for field_name in ("line1", "city", "district", "state", "pincode"):
            if (
                field_name in self.model_fields_set
                and getattr(self, field_name) is None
            ):
                raise ValueError(f"{field_name} cannot be null")
        return self


class DonorPhoneInput(BaseModel):
    phone_number: str = Field(min_length=7, max_length=20)
    is_primary: bool = False

    @field_validator("phone_number")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        normalized = value.strip()
        if not PHONE_PATTERN.fullmatch(normalized):
            raise ValueError("Phone number format is invalid")
        return normalized


def _validate_phones(phones: list[DonorPhoneInput]) -> list[DonorPhoneInput]:
    normalized_numbers = [phone.phone_number for phone in phones]
    if len(normalized_numbers) != len(set(normalized_numbers)):
        raise ValueError("Phone numbers must be unique within a donor")
    if sum(phone.is_primary for phone in phones) != 1:
        raise ValueError("Exactly one donor phone must be primary")
    return phones


class DonorCreateRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    date_of_birth: date
    gender: Gender
    address: AddressCreate
    weight_kg: Decimal = Field(gt=0, le=500, max_digits=5, decimal_places=2)
    blood_group: BloodGroup
    is_active: bool = True
    phones: list[DonorPhoneInput] = Field(min_length=1, max_length=5)

    @field_validator("full_name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        return _strip_required(value)

    @field_validator("date_of_birth")
    @classmethod
    def validate_birth_date(cls, value: date) -> date:
        return _validate_birth_date(value)

    @field_validator("phones")
    @classmethod
    def validate_phones(cls, value: list[DonorPhoneInput]) -> list[DonorPhoneInput]:
        return _validate_phones(value)


class DonorUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    date_of_birth: date | None = None
    gender: Gender | None = None
    address: AddressUpdate | None = None
    weight_kg: Decimal | None = Field(
        default=None,
        gt=0,
        le=500,
        max_digits=5,
        decimal_places=2,
    )
    blood_group: BloodGroup | None = None
    is_active: bool | None = None
    phones: list[DonorPhoneInput] | None = Field(
        default=None, min_length=1, max_length=5
    )

    @field_validator("full_name")
    @classmethod
    def strip_name(cls, value: str | None) -> str | None:
        return _strip_required(value) if value is not None else None

    @field_validator("date_of_birth")
    @classmethod
    def validate_birth_date(cls, value: date | None) -> date | None:
        return _validate_birth_date(value) if value is not None else None

    @field_validator("phones")
    @classmethod
    def validate_phones(
        cls,
        value: list[DonorPhoneInput] | None,
    ) -> list[DonorPhoneInput] | None:
        return _validate_phones(value) if value is not None else None

    @model_validator(mode="after")
    def validate_patch(self) -> "DonorUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("At least one donor field must be supplied")
        nullable_fields = {"address"}
        for field_name in self.model_fields_set - nullable_fields:
            if getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null")
        if "address" in self.model_fields_set and self.address is None:
            raise ValueError("address cannot be null")
        return self


class AddressResponse(BaseModel):
    address_id: int
    line1: str
    line2: str | None = None
    city: str
    district: str
    state: str
    pincode: str


class DonorPhoneResponse(BaseModel):
    phone_id: int
    phone_number: str
    is_primary: bool


class DonorSummaryResponse(BaseModel):
    donor_id: int
    full_name: str
    date_of_birth: date
    age_years: int
    gender: Gender
    blood_group: BloodGroup
    weight_kg: Decimal
    is_active: bool
    city: str
    district: str
    last_blood_donation_date: date | None = None
    active_condition_count: int
    is_eligible_demo: bool
    eligibility_note: str = "Simplified academic rule; not medical clearance"


class DonorDetailResponse(DonorSummaryResponse):
    address: AddressResponse
    phones: list[DonorPhoneResponse]
    created_at: datetime
    updated_at: datetime


class DonorListResponse(BaseModel):
    items: list[DonorSummaryResponse]
    page: int
    page_size: int
    total: int
    total_pages: int


class DonorDonationResponse(BaseModel):
    donation_id: int
    donation_date: date
    donation_type: DonationType
    record_status: DonationRecordStatus
    camp_id: int | None = None
    camp_organizer: str | None = None
    collection_bank_id: int | None = None
    collection_bank_name: str | None = None
    collection_organ_bank_id: int | None = None
    collection_organ_bank_name: str | None = None
    quantity_collected_ml: int | None = None
    unit_id: int | None = None
    unit_type: str | None = None
    unit_status: str | None = None
    expiry_date: date | None = None
    notes: str | None = None


class DonorDonationListResponse(BaseModel):
    items: list[DonorDonationResponse]
    page: int
    page_size: int
    total: int
    total_pages: int


class DonorConditionResponse(BaseModel):
    condition_id: int
    condition_name: str
    description: str | None = None
    diagnosed_date: date | None = None
    condition_status: DonorConditionStatus | None = None


class DonorConditionListResponse(BaseModel):
    items: list[DonorConditionResponse]
    total: int
