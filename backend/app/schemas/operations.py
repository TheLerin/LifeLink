"""Pydantic contracts for the remaining LifeLink operational API modules."""

from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Generic, TypeVar

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.donors import (
    AddressCreate,
    AddressResponse,
    AddressUpdate,
    BloodGroup,
    Gender,
)

T = TypeVar("T")


def _required_text(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("Value cannot be blank")
    return value


def _birth_date(value: date) -> date:
    today = date.today()
    if value > today:
        raise ValueError("Date of birth cannot be in the future")
    years = (
        today.year - value.year - ((today.month, today.day) < (value.month, value.day))
    )
    if years > 120:
        raise ValueError("Date of birth exceeds the supported age range")
    return value


class PageResponse(BaseModel, Generic[T]):
    items: list[T]
    page: int
    page_size: int
    total: int


class FacilityStatus(StrEnum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"


class RecipientStatus(StrEnum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"


class DonationType(StrEnum):
    BLOOD = "BLOOD"
    ORGAN = "ORGAN"


class DonationRecordStatus(StrEnum):
    ACTIVE = "ACTIVE"
    VOIDED = "VOIDED"


class BloodUnitStatus(StrEnum):
    COLLECTED = "COLLECTED"
    TESTING = "TESTING"
    AVAILABLE = "AVAILABLE"
    RESERVED = "RESERVED"
    ISSUED = "ISSUED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"


class OrganUnitStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    MATCHING = "MATCHING"
    ALLOCATED = "ALLOCATED"
    UNAVAILABLE = "UNAVAILABLE"


class TestResult(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"
    PENDING = "PENDING"


class RequestType(StrEnum):
    BLOOD = "BLOOD"
    ORGAN = "ORGAN"


class RequestPriority(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class RequestStatus(StrEnum):
    PENDING = "PENDING"
    PARTIALLY_RESERVED = "PARTIALLY_RESERVED"
    RESERVED = "RESERVED"
    MATCHED = "MATCHED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class ReservationStatus(StrEnum):
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    EXPIRED = "EXPIRED"


class OrganMatchStatus(StrEnum):
    CANDIDATE = "CANDIDATE"
    SELECTED = "SELECTED"
    REJECTED = "REJECTED"
    COMPLETED = "COMPLETED"


class CampStatus(StrEnum):
    SCHEDULED = "SCHEDULED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class RegistrationStatus(StrEnum):
    REGISTERED = "REGISTERED"
    ATTENDED = "ATTENDED"
    CANCELLED = "CANCELLED"
    NO_SHOW = "NO_SHOW"


class RecipientCreateRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    date_of_birth: date
    gender: Gender
    address: AddressCreate
    blood_group: BloodGroup
    status: RecipientStatus = RecipientStatus.ACTIVE

    @field_validator("full_name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return _required_text(value)

    @field_validator("date_of_birth")
    @classmethod
    def validate_birth_date(cls, value: date) -> date:
        return _birth_date(value)


class RecipientUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    date_of_birth: date | None = None
    gender: Gender | None = None
    address: AddressUpdate | None = None
    blood_group: BloodGroup | None = None
    status: RecipientStatus | None = None

    @field_validator("full_name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        return _required_text(value) if value is not None else None

    @field_validator("date_of_birth")
    @classmethod
    def validate_birth_date(cls, value: date | None) -> date | None:
        return _birth_date(value) if value is not None else None

    @model_validator(mode="after")
    def validate_patch(self) -> "RecipientUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("At least one recipient field must be supplied")
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class RecipientSummaryResponse(BaseModel):
    recipient_id: int
    full_name: str
    date_of_birth: date
    age_years: int
    gender: Gender
    blood_group: BloodGroup
    status: RecipientStatus
    city: str
    district: str


class RecipientDetailResponse(RecipientSummaryResponse):
    address: AddressResponse
    created_at: datetime
    updated_at: datetime


class DoctorCreateRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    date_of_birth: date
    gender: Gender
    address: AddressCreate
    hospital_id: int = Field(gt=0)
    specialization: str = Field(min_length=1, max_length=100)
    license_no: str = Field(min_length=1, max_length=60)

    @field_validator("full_name", "specialization", "license_no")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return _required_text(value)

    @field_validator("date_of_birth")
    @classmethod
    def validate_birth_date(cls, value: date) -> date:
        return _birth_date(value)


class DoctorUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    date_of_birth: date | None = None
    gender: Gender | None = None
    address: AddressUpdate | None = None
    hospital_id: int | None = Field(default=None, gt=0)
    specialization: str | None = Field(default=None, min_length=1, max_length=100)
    license_no: str | None = Field(default=None, min_length=1, max_length=60)

    @field_validator("full_name", "specialization", "license_no")
    @classmethod
    def normalize_text(cls, value: str | None) -> str | None:
        return _required_text(value) if value is not None else None

    @field_validator("date_of_birth")
    @classmethod
    def validate_birth_date(cls, value: date | None) -> date | None:
        return _birth_date(value) if value is not None else None

    @model_validator(mode="after")
    def validate_patch(self) -> "DoctorUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("At least one doctor field must be supplied")
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class DoctorSummaryResponse(BaseModel):
    doctor_id: int
    full_name: str
    specialization: str
    license_no: str
    hospital_id: int
    hospital_name: str


class DoctorDetailResponse(DoctorSummaryResponse):
    date_of_birth: date
    age_years: int
    gender: Gender
    address: AddressResponse
    created_at: datetime
    updated_at: datetime


class FacilityCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    address: AddressCreate
    contact_phone: str = Field(min_length=7, max_length=20, pattern=r"^[0-9+() -]+$")
    email: str | None = Field(default=None, max_length=254)
    status: FacilityStatus = FacilityStatus.ACTIVE

    @field_validator("name", "contact_phone")
    @classmethod
    def normalize_required(cls, value: str) -> str:
        return _required_text(value)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().lower()
        if not value or "@" not in value or value.startswith("@"):
            raise ValueError("Email format is invalid")
        return value


class FacilityBaseResponse(BaseModel):
    name: str
    contact_phone: str
    email: str | None = None
    status: FacilityStatus
    address: AddressResponse
    created_at: datetime


class HospitalResponse(FacilityBaseResponse):
    hospital_id: int


class BloodBankResponse(FacilityBaseResponse):
    blood_bank_id: int


class OrganBankResponse(FacilityBaseResponse):
    organ_bank_id: int


class BloodDonationCreateRequest(BaseModel):
    donor_id: int = Field(gt=0)
    collection_bank_id: int = Field(gt=0)
    donation_date: date = Field(default_factory=date.today)
    camp_id: int | None = Field(default=None, gt=0)
    quantity_collected_ml: int = Field(gt=0, le=1000)
    expiry_date: date
    notes: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_dates(self) -> "BloodDonationCreateRequest":
        if self.donation_date > date.today():
            raise ValueError("Donation date cannot be in the future")
        if self.expiry_date <= self.donation_date:
            raise ValueError("Expiry date must be after donation date")
        return self


class OrganDonationCreateRequest(BaseModel):
    donor_id: int = Field(gt=0)
    collection_organ_bank_id: int = Field(gt=0)
    donation_date: date = Field(default_factory=date.today)
    camp_id: int | None = Field(default=None, gt=0)
    organ_type: str = Field(min_length=1, max_length=50)
    notes: str | None = Field(default=None, max_length=1000)

    @field_validator("organ_type")
    @classmethod
    def normalize_organ(cls, value: str) -> str:
        return _required_text(value).upper()

    @field_validator("donation_date")
    @classmethod
    def validate_date(cls, value: date) -> date:
        if value > date.today():
            raise ValueError("Donation date cannot be in the future")
        return value


class DonationRegistrationResponse(BaseModel):
    donation_id: int
    blood_unit_id: int | None = None
    organ_unit_id: int | None = None
    unit_status: str


class DonationResponse(BaseModel):
    donation_id: int
    donor_id: int
    donor_name: str
    donation_date: date
    donation_type: DonationType
    record_status: DonationRecordStatus
    camp_id: int | None = None
    camp_organizer: str | None = None
    collection_bank_id: int
    collection_bank_name: str
    quantity_collected_ml: int | None = None
    unit_id: int
    unit_type: str
    unit_status: str
    expiry_date: date | None = None
    notes: str | None = None
    created_at: datetime


class BloodUnitResponse(BaseModel):
    blood_unit_id: int
    donation_id: int
    donor_id: int
    donor_name: str
    blood_group: BloodGroup
    collection_bank_id: int
    collection_bank_name: str
    current_blood_bank_id: int
    current_blood_bank_name: str
    collection_date: date
    expiry_date: date
    days_to_expiry: int
    status: BloodUnitStatus
    screening_test_count: int
    all_tests_passed: bool | None = None
    created_at: datetime
    updated_at: datetime


class BloodUnitStatusUpdateRequest(BaseModel):
    status: BloodUnitStatus

    @model_validator(mode="after")
    def prevent_direct_reservation(self) -> "BloodUnitStatusUpdateRequest":
        if self.status is BloodUnitStatus.RESERVED:
            raise ValueError("Use the emergency reservation endpoint to reserve blood")
        return self


class TimelineEventResponse(BaseModel):
    audit_id: int
    action: str
    old_status: str | None = None
    new_status: str | None = None
    action_time: datetime
    user_id: int | None = None
    username: str | None = None
    details: str | None = None


class BloodUnitTimelineResponse(BaseModel):
    blood_unit_id: int
    current_status: BloodUnitStatus
    events: list[TimelineEventResponse]


class MedicalTestCreateRequest(BaseModel):
    test_no: int = Field(gt=0, le=32767)
    test_name: str = Field(min_length=1, max_length=120)
    result: TestResult
    test_date: date = Field(default_factory=date.today)
    remarks: str | None = Field(default=None, max_length=1000)

    @field_validator("test_name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return _required_text(value)

    @field_validator("test_date")
    @classmethod
    def validate_date(cls, value: date) -> date:
        if value > date.today():
            raise ValueError("Test date cannot be in the future")
        return value


class MedicalTestResponse(BaseModel):
    donation_id: int
    test_no: int
    test_name: str
    result: TestResult
    test_date: date
    remarks: str | None = None


class EmergencyRequestCreateRequest(BaseModel):
    recipient_id: int = Field(gt=0)
    requested_by: int | None = Field(default=None, gt=0)
    request_type: RequestType
    blood_group: BloodGroup | None = None
    organ_type: str | None = Field(default=None, max_length=50)
    units_required: int | None = Field(default=None, gt=0, le=20)
    priority: RequestPriority
    notes: str | None = Field(default=None, max_length=1000)

    @field_validator("organ_type")
    @classmethod
    def normalize_organ(cls, value: str | None) -> str | None:
        return _required_text(value).upper() if value is not None else None

    @model_validator(mode="after")
    def validate_type_fields(self) -> "EmergencyRequestCreateRequest":
        if self.request_type is RequestType.BLOOD:
            if self.blood_group is None or self.units_required is None:
                raise ValueError(
                    "Blood requests require blood_group and units_required"
                )
            if self.organ_type is not None:
                raise ValueError("Blood requests cannot specify organ_type")
        else:
            if self.organ_type is None:
                raise ValueError("Organ requests require organ_type")
            if self.blood_group is not None or self.units_required is not None:
                raise ValueError("Organ requests cannot specify blood fields")
        return self


class EmergencyRequestUpdateRequest(BaseModel):
    priority: RequestPriority | None = None
    notes: str | None = Field(default=None, max_length=1000)
    status: RequestStatus | None = None

    @model_validator(mode="after")
    def validate_patch(self) -> "EmergencyRequestUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("At least one request field must be supplied")
        if "priority" in self.model_fields_set and self.priority is None:
            raise ValueError("priority cannot be null")
        if "status" in self.model_fields_set and self.status is None:
            raise ValueError("status cannot be null")
        return self


class EmergencyRequestResponse(BaseModel):
    request_id: int
    hospital_id: int
    hospital_name: str
    recipient_id: int
    recipient_name: str
    recipient_blood_group: BloodGroup
    doctor_id: int
    doctor_name: str
    request_type: RequestType
    requested_blood_group: BloodGroup | None = None
    requested_organ_type: str | None = None
    units_required: int | None = None
    priority: RequestPriority
    requested_at: datetime
    status: RequestStatus
    allocated_units: int | None = None
    units_remaining: int | None = None
    first_reserved_at: datetime | None = None
    selected_organ_unit_id: int | None = None
    notes: str | None = None


class ReserveBloodRequest(BaseModel):
    hold_minutes: int = Field(default=120, ge=5, le=1440)


class ReservationResponse(BaseModel):
    reservation_id: int
    request_id: int
    blood_unit_id: int
    blood_group: BloodGroup
    blood_bank_id: int
    blood_bank_name: str | None = None
    hospital_id: int
    hospital_name: str
    recipient_id: int
    recipient_name: str
    reserved_at: datetime
    expires_at: datetime | None = None
    status: ReservationStatus
    created_by: int
    created_by_username: str | None = None


class OrganUnitResponse(BaseModel):
    organ_unit_id: int
    donation_id: int
    donor_id: int
    donor_name: str
    organ_type: str
    current_organ_bank_id: int
    current_organ_bank_name: str
    status: OrganUnitStatus
    donation_date: date
    created_at: datetime


class OrganMatchCandidateInput(BaseModel):
    request_id: int = Field(gt=0)
    compatibility_score: Decimal = Field(ge=0, le=100, decimal_places=2)


class OrganMatchCalculateRequest(BaseModel):
    candidates: list[OrganMatchCandidateInput] = Field(min_length=1, max_length=100)

    @field_validator("candidates")
    @classmethod
    def unique_requests(
        cls,
        value: list[OrganMatchCandidateInput],
    ) -> list[OrganMatchCandidateInput]:
        ids = [candidate.request_id for candidate in value]
        if len(ids) != len(set(ids)):
            raise ValueError("Each request may appear only once")
        return value


class OrganMatchResponse(BaseModel):
    match_id: int
    request_id: int
    organ_unit_id: int
    organ_type: str | None = None
    recipient_id: int | None = None
    recipient_name: str | None = None
    hospital_id: int | None = None
    hospital_name: str | None = None
    priority: RequestPriority | None = None
    compatibility_score: Decimal
    urgency_score: Decimal
    waiting_time_score: Decimal
    academic_priority_score: Decimal
    candidate_rank: int
    match_status: OrganMatchStatus
    calculated_at: datetime
    academic_note: str = "Academic Priority Score; not clinical transplant guidance"


class OrganMatchStatusUpdateRequest(BaseModel):
    status: OrganMatchStatus


class CampCreateRequest(BaseModel):
    address: AddressCreate
    camp_date: date
    organizer: str = Field(min_length=1, max_length=150)
    contact_phone: str | None = Field(
        default=None,
        min_length=7,
        max_length=20,
        pattern=r"^[0-9+() -]+$",
    )
    status: CampStatus = CampStatus.SCHEDULED

    @field_validator("organizer")
    @classmethod
    def normalize_organizer(cls, value: str) -> str:
        return _required_text(value)


class CampResponse(BaseModel):
    camp_id: int
    camp_date: date
    organizer: str
    contact_phone: str | None = None
    status: CampStatus
    address: AddressResponse
    registration_count: int


class CampRegistrationRequest(BaseModel):
    donor_id: int | None = Field(default=None, gt=0)


class CampRegistrationResponse(BaseModel):
    registration_id: int
    camp_id: int
    donor_id: int
    registration_status: RegistrationStatus
    registered_at: datetime


class BloodInventoryReportRow(BaseModel):
    blood_bank_id: int
    blood_bank_name: str
    bank_status: FacilityStatus
    blood_group: BloodGroup
    unit_status: BloodUnitStatus
    unit_count: int
    usable_available_count: int
    active_reservation_count: int
    earliest_expiry_date: date
    latest_expiry_date: date
    expiring_within_7_days: int


class EmergencySummaryRow(BaseModel):
    hospital_id: int
    hospital_name: str
    request_type: RequestType
    priority: RequestPriority
    status: RequestStatus
    request_count: int


class DonationTrendRow(BaseModel):
    month: date
    donation_type: DonationType
    donation_count: int


class ReservationSummaryRow(BaseModel):
    blood_bank_id: int
    blood_bank_name: str
    status: ReservationStatus
    reservation_count: int


class HospitalResponseTimeRow(BaseModel):
    hospital_id: int
    hospital_name: str
    reserved_request_count: int
    average_response_minutes: Decimal | None = None


class AuditLogResponse(BaseModel):
    audit_id: int
    user_id: int | None = None
    username: str | None = None
    table_name: str
    record_id: str
    action: str
    old_status: str | None = None
    new_status: str | None = None
    action_time: datetime
    details: str | None = None
