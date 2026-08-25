"""All remaining role-protected LifeLink operational API endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import require_roles
from app.dependencies.database import get_db_session
from app.schemas.auth import UserResponse, UserRole
from app.schemas.donors import BloodGroup
from app.schemas.operations import (
    AuditLogResponse,
    BloodBankResponse,
    BloodDonationCreateRequest,
    BloodInventoryReportRow,
    BloodUnitResponse,
    BloodUnitStatus,
    BloodUnitStatusUpdateRequest,
    BloodUnitTimelineResponse,
    CampCreateRequest,
    CampRegistrationRequest,
    CampRegistrationResponse,
    CampResponse,
    CampStatus,
    DoctorCreateRequest,
    DoctorDetailResponse,
    DoctorSummaryResponse,
    DoctorUpdateRequest,
    DonationRecordStatus,
    DonationRegistrationResponse,
    DonationResponse,
    DonationTrendRow,
    DonationType,
    EmergencyRequestCreateRequest,
    EmergencyRequestResponse,
    EmergencyRequestUpdateRequest,
    EmergencySummaryRow,
    FacilityCreateRequest,
    FacilityStatus,
    HospitalResponse,
    HospitalResponseTimeRow,
    MedicalTestCreateRequest,
    MedicalTestResponse,
    OrganBankResponse,
    OrganDonationCreateRequest,
    OrganMatchCalculateRequest,
    OrganMatchResponse,
    OrganMatchStatusUpdateRequest,
    OrganUnitResponse,
    OrganUnitStatus,
    PageResponse,
    RecipientCreateRequest,
    RecipientDetailResponse,
    RecipientStatus,
    RecipientSummaryResponse,
    RecipientUpdateRequest,
    RequestPriority,
    RequestStatus,
    RequestType,
    ReservationResponse,
    ReservationStatus,
    ReservationSummaryRow,
    ReserveBloodRequest,
)
from app.services import operations_service as service
from app.utils.errors import ForbiddenError

Session = Annotated[AsyncSession, Depends(get_db_session)]

admin = require_roles(UserRole.ADMIN)
admin_or_doctor = require_roles(UserRole.ADMIN, UserRole.DOCTOR)
admin_blood = require_roles(UserRole.ADMIN, UserRole.BLOOD_BANK_STAFF)
admin_organ = require_roles(UserRole.ADMIN, UserRole.ORGAN_BANK_STAFF)
recipient_read = require_roles(
    UserRole.ADMIN,
    UserRole.DOCTOR,
    UserRole.BLOOD_BANK_STAFF,
    UserRole.ORGAN_BANK_STAFF,
    UserRole.RECIPIENT,
)
donation_read = require_roles(
    UserRole.ADMIN,
    UserRole.BLOOD_BANK_STAFF,
    UserRole.ORGAN_BANK_STAFF,
    UserRole.DONOR,
)
request_read = require_roles(
    UserRole.ADMIN,
    UserRole.DOCTOR,
    UserRole.BLOOD_BANK_STAFF,
    UserRole.ORGAN_BANK_STAFF,
    UserRole.RECIPIENT,
)
reservation_read = require_roles(
    UserRole.ADMIN,
    UserRole.DOCTOR,
    UserRole.BLOOD_BANK_STAFF,
    UserRole.RECIPIENT,
)
blood_read = require_roles(UserRole.ADMIN, UserRole.BLOOD_BANK_STAFF)
organ_read = require_roles(UserRole.ADMIN, UserRole.ORGAN_BANK_STAFF)
screening = require_roles(
    UserRole.ADMIN,
    UserRole.BLOOD_BANK_STAFF,
    UserRole.ORGAN_BANK_STAFF,
)
authenticated = require_roles(*tuple(UserRole))
camp_registration = require_roles(
    UserRole.ADMIN, UserRole.BLOOD_BANK_STAFF, UserRole.DONOR
)


def _owner(caller: UserResponse, person_id: int, role: UserRole, code: str) -> None:
    if caller.role is role and caller.person_id != person_id:
        raise ForbiddenError(
            code=code,
            message=f"A {role.value.lower()} account can access only its own record.",
        )


# Recipients -----------------------------------------------------------------

recipients_router = APIRouter(prefix="/recipients", tags=["recipients"])


@recipients_router.get("", response_model=PageResponse[RecipientSummaryResponse])
async def get_recipients(
    session: Session,
    caller: Annotated[
        UserResponse,
        Depends(
            require_roles(
                UserRole.ADMIN,
                UserRole.DOCTOR,
                UserRole.BLOOD_BANK_STAFF,
                UserRole.ORGAN_BANK_STAFF,
            )
        ),
    ],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    blood_group: BloodGroup | None = None,
    recipient_status: Annotated[RecipientStatus | None, Query(alias="status")] = None,
    search: Annotated[str | None, Query(min_length=1, max_length=120)] = None,
) -> PageResponse[RecipientSummaryResponse]:
    del caller
    return await service.list_recipients(
        session,
        page=page,
        page_size=page_size,
        blood_group=blood_group.value if blood_group else None,
        status=recipient_status.value if recipient_status else None,
        search=search,
    )


@recipients_router.post("", response_model=RecipientDetailResponse, status_code=201)
async def post_recipient(
    payload: RecipientCreateRequest,
    session: Session,
    caller: Annotated[UserResponse, Depends(admin)],
) -> RecipientDetailResponse:
    return await service.create_recipient(session, actor=caller, payload=payload)


@recipients_router.get("/{recipient_id}", response_model=RecipientDetailResponse)
async def get_recipient_by_id(
    recipient_id: Annotated[int, Path(gt=0)],
    session: Session,
    caller: Annotated[UserResponse, Depends(recipient_read)],
) -> RecipientDetailResponse:
    _owner(caller, recipient_id, UserRole.RECIPIENT, "recipient_record_forbidden")
    return await service.get_recipient(session, recipient_id)


@recipients_router.patch("/{recipient_id}", response_model=RecipientDetailResponse)
async def patch_recipient(
    recipient_id: Annotated[int, Path(gt=0)],
    payload: RecipientUpdateRequest,
    session: Session,
    caller: Annotated[UserResponse, Depends(admin)],
) -> RecipientDetailResponse:
    return await service.update_recipient(
        session, actor=caller, recipient_id=recipient_id, payload=payload
    )


@recipients_router.get(
    "/{recipient_id}/requests",
    response_model=PageResponse[EmergencyRequestResponse],
)
async def get_recipient_requests(
    recipient_id: Annotated[int, Path(gt=0)],
    session: Session,
    caller: Annotated[UserResponse, Depends(request_read)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> PageResponse[EmergencyRequestResponse]:
    _owner(caller, recipient_id, UserRole.RECIPIENT, "recipient_record_forbidden")
    return await service.list_emergency_requests(
        session,
        caller=caller,
        page=page,
        page_size=page_size,
        recipient_id=recipient_id,
    )


# Doctors --------------------------------------------------------------------

doctors_router = APIRouter(prefix="/doctors", tags=["doctors"])


@doctors_router.get("", response_model=PageResponse[DoctorSummaryResponse])
async def get_doctors(
    session: Session,
    caller: Annotated[UserResponse, Depends(admin)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    hospital_id: Annotated[int | None, Query(gt=0)] = None,
    search: Annotated[str | None, Query(min_length=1, max_length=120)] = None,
) -> PageResponse[DoctorSummaryResponse]:
    del caller
    return await service.list_doctors(
        session,
        page=page,
        page_size=page_size,
        hospital_id=hospital_id,
        search=search,
    )


@doctors_router.post("", response_model=DoctorDetailResponse, status_code=201)
async def post_doctor(
    payload: DoctorCreateRequest,
    session: Session,
    caller: Annotated[UserResponse, Depends(admin)],
) -> DoctorDetailResponse:
    return await service.create_doctor(session, actor=caller, payload=payload)


@doctors_router.get("/{doctor_id}", response_model=DoctorDetailResponse)
async def get_doctor_by_id(
    doctor_id: Annotated[int, Path(gt=0)],
    session: Session,
    caller: Annotated[UserResponse, Depends(admin_or_doctor)],
) -> DoctorDetailResponse:
    _owner(caller, doctor_id, UserRole.DOCTOR, "doctor_record_forbidden")
    return await service.get_doctor(session, doctor_id)


@doctors_router.patch("/{doctor_id}", response_model=DoctorDetailResponse)
async def patch_doctor(
    doctor_id: Annotated[int, Path(gt=0)],
    payload: DoctorUpdateRequest,
    session: Session,
    caller: Annotated[UserResponse, Depends(admin)],
) -> DoctorDetailResponse:
    return await service.update_doctor(
        session, actor=caller, doctor_id=doctor_id, payload=payload
    )


# Facilities -----------------------------------------------------------------

hospitals_router = APIRouter(prefix="/hospitals", tags=["hospitals"])
blood_banks_router = APIRouter(prefix="/blood-banks", tags=["blood-banks"])
organ_banks_router = APIRouter(prefix="/organ-banks", tags=["organ-banks"])


@hospitals_router.get("", response_model=list[HospitalResponse])
async def get_hospitals(
    session: Session,
    caller: Annotated[UserResponse, Depends(authenticated)],
    facility_status: Annotated[FacilityStatus | None, Query(alias="status")] = None,
) -> list[HospitalResponse]:
    del caller
    return await service.list_facilities(
        session,
        kind="hospital",
        status=facility_status.value if facility_status else None,
    )


@hospitals_router.post("", response_model=HospitalResponse, status_code=201)
async def post_hospital(
    payload: FacilityCreateRequest,
    session: Session,
    caller: Annotated[UserResponse, Depends(admin)],
) -> HospitalResponse:
    return await service.create_facility(
        session, actor=caller, kind="hospital", payload=payload
    )


@hospitals_router.get("/{hospital_id}", response_model=HospitalResponse)
async def get_hospital(
    hospital_id: Annotated[int, Path(gt=0)],
    session: Session,
    caller: Annotated[UserResponse, Depends(authenticated)],
) -> HospitalResponse:
    del caller
    return await service.get_facility(session, kind="hospital", facility_id=hospital_id)


@blood_banks_router.get("", response_model=list[BloodBankResponse])
async def get_blood_banks(
    session: Session,
    caller: Annotated[UserResponse, Depends(authenticated)],
    facility_status: Annotated[FacilityStatus | None, Query(alias="status")] = None,
) -> list[BloodBankResponse]:
    del caller
    return await service.list_facilities(
        session,
        kind="blood_bank",
        status=facility_status.value if facility_status else None,
    )


@blood_banks_router.post("", response_model=BloodBankResponse, status_code=201)
async def post_blood_bank(
    payload: FacilityCreateRequest,
    session: Session,
    caller: Annotated[UserResponse, Depends(admin)],
) -> BloodBankResponse:
    return await service.create_facility(
        session, actor=caller, kind="blood_bank", payload=payload
    )


@blood_banks_router.get("/{blood_bank_id}", response_model=BloodBankResponse)
async def get_blood_bank(
    blood_bank_id: Annotated[int, Path(gt=0)],
    session: Session,
    caller: Annotated[UserResponse, Depends(authenticated)],
) -> BloodBankResponse:
    del caller
    return await service.get_facility(
        session, kind="blood_bank", facility_id=blood_bank_id
    )


@organ_banks_router.get("", response_model=list[OrganBankResponse])
async def get_organ_banks(
    session: Session,
    caller: Annotated[UserResponse, Depends(authenticated)],
    facility_status: Annotated[FacilityStatus | None, Query(alias="status")] = None,
) -> list[OrganBankResponse]:
    del caller
    return await service.list_facilities(
        session,
        kind="organ_bank",
        status=facility_status.value if facility_status else None,
    )


@organ_banks_router.post("", response_model=OrganBankResponse, status_code=201)
async def post_organ_bank(
    payload: FacilityCreateRequest,
    session: Session,
    caller: Annotated[UserResponse, Depends(admin)],
) -> OrganBankResponse:
    return await service.create_facility(
        session, actor=caller, kind="organ_bank", payload=payload
    )


@organ_banks_router.get("/{organ_bank_id}", response_model=OrganBankResponse)
async def get_organ_bank(
    organ_bank_id: Annotated[int, Path(gt=0)],
    session: Session,
    caller: Annotated[UserResponse, Depends(authenticated)],
) -> OrganBankResponse:
    del caller
    return await service.get_facility(
        session, kind="organ_bank", facility_id=organ_bank_id
    )


# Donations, units, tests ----------------------------------------------------

donations_router = APIRouter(prefix="/donations", tags=["donations"])
blood_units_router = APIRouter(prefix="/blood-units", tags=["blood-units"])
medical_tests_router = APIRouter(prefix="/donations", tags=["medical-tests"])


@donations_router.post(
    "/blood", response_model=DonationRegistrationResponse, status_code=201
)
async def post_blood_donation(
    payload: BloodDonationCreateRequest,
    session: Session,
    caller: Annotated[UserResponse, Depends(admin_blood)],
) -> DonationRegistrationResponse:
    return await service.register_blood_donation(session, actor=caller, payload=payload)


@donations_router.post(
    "/organ", response_model=DonationRegistrationResponse, status_code=201
)
async def post_organ_donation(
    payload: OrganDonationCreateRequest,
    session: Session,
    caller: Annotated[UserResponse, Depends(admin_organ)],
) -> DonationRegistrationResponse:
    return await service.register_organ_donation(session, actor=caller, payload=payload)


@donations_router.get("", response_model=PageResponse[DonationResponse])
async def get_donations(
    session: Session,
    caller: Annotated[UserResponse, Depends(donation_read)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    donation_type: DonationType | None = None,
    record_status: DonationRecordStatus | None = None,
) -> PageResponse[DonationResponse]:
    return await service.list_donations(
        session,
        caller=caller,
        page=page,
        page_size=page_size,
        donation_type=donation_type.value if donation_type else None,
        record_status=record_status.value if record_status else None,
    )


@donations_router.get("/{donation_id}", response_model=DonationResponse)
async def get_donation(
    donation_id: Annotated[int, Path(gt=0)],
    session: Session,
    caller: Annotated[UserResponse, Depends(donation_read)],
) -> DonationResponse:
    return await service.get_donation(session, caller=caller, donation_id=donation_id)


@blood_units_router.get("", response_model=PageResponse[BloodUnitResponse])
async def get_blood_units(
    session: Session,
    caller: Annotated[UserResponse, Depends(blood_read)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    blood_group: BloodGroup | None = None,
    unit_status: Annotated[BloodUnitStatus | None, Query(alias="status")] = None,
    blood_bank_id: Annotated[int | None, Query(gt=0)] = None,
) -> PageResponse[BloodUnitResponse]:
    return await service.list_blood_units(
        session,
        caller=caller,
        page=page,
        page_size=page_size,
        blood_group=blood_group.value if blood_group else None,
        status=unit_status.value if unit_status else None,
        blood_bank_id=blood_bank_id,
    )


@blood_units_router.get("/{blood_unit_id}", response_model=BloodUnitResponse)
async def get_blood_unit(
    blood_unit_id: Annotated[int, Path(gt=0)],
    session: Session,
    caller: Annotated[UserResponse, Depends(blood_read)],
) -> BloodUnitResponse:
    return await service.get_blood_unit(
        session, caller=caller, blood_unit_id=blood_unit_id
    )


@blood_units_router.patch("/{blood_unit_id}/status", response_model=BloodUnitResponse)
async def patch_blood_unit_status(
    blood_unit_id: Annotated[int, Path(gt=0)],
    payload: BloodUnitStatusUpdateRequest,
    session: Session,
    caller: Annotated[UserResponse, Depends(admin_blood)],
) -> BloodUnitResponse:
    return await service.update_blood_unit_status(
        session,
        actor=caller,
        blood_unit_id=blood_unit_id,
        new_status=payload.status,
    )


@blood_units_router.get(
    "/{blood_unit_id}/timeline", response_model=BloodUnitTimelineResponse
)
async def get_blood_unit_timeline(
    blood_unit_id: Annotated[int, Path(gt=0)],
    session: Session,
    caller: Annotated[UserResponse, Depends(blood_read)],
) -> BloodUnitTimelineResponse:
    return await service.get_blood_unit_timeline(
        session, caller=caller, blood_unit_id=blood_unit_id
    )


@medical_tests_router.post(
    "/{donation_id}/tests", response_model=MedicalTestResponse, status_code=201
)
async def post_medical_test(
    donation_id: Annotated[int, Path(gt=0)],
    payload: MedicalTestCreateRequest,
    session: Session,
    caller: Annotated[UserResponse, Depends(screening)],
) -> MedicalTestResponse:
    return await service.add_medical_test(
        session, actor=caller, donation_id=donation_id, payload=payload
    )


@medical_tests_router.get(
    "/{donation_id}/tests", response_model=list[MedicalTestResponse]
)
async def get_medical_tests(
    donation_id: Annotated[int, Path(gt=0)],
    session: Session,
    caller: Annotated[UserResponse, Depends(screening)],
) -> list[MedicalTestResponse]:
    return await service.list_medical_tests(
        session, actor=caller, donation_id=donation_id
    )


# Emergency requests and reservations ---------------------------------------

emergency_router = APIRouter(prefix="/emergency-requests", tags=["emergency-requests"])
reservations_router = APIRouter(prefix="/reservations", tags=["reservations"])


@emergency_router.get("", response_model=PageResponse[EmergencyRequestResponse])
async def get_emergency_requests(
    session: Session,
    caller: Annotated[UserResponse, Depends(request_read)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    request_type: RequestType | None = None,
    priority: RequestPriority | None = None,
    request_status: Annotated[RequestStatus | None, Query(alias="status")] = None,
) -> PageResponse[EmergencyRequestResponse]:
    return await service.list_emergency_requests(
        session,
        caller=caller,
        page=page,
        page_size=page_size,
        request_type=request_type.value if request_type else None,
        priority=priority.value if priority else None,
        status=request_status.value if request_status else None,
    )


@emergency_router.post("", response_model=EmergencyRequestResponse, status_code=201)
async def post_emergency_request(
    payload: EmergencyRequestCreateRequest,
    session: Session,
    caller: Annotated[UserResponse, Depends(admin_or_doctor)],
) -> EmergencyRequestResponse:
    return await service.create_emergency_request(
        session, actor=caller, payload=payload
    )


@emergency_router.get("/{request_id}", response_model=EmergencyRequestResponse)
async def get_emergency_request(
    request_id: Annotated[int, Path(gt=0)],
    session: Session,
    caller: Annotated[UserResponse, Depends(request_read)],
) -> EmergencyRequestResponse:
    return await service.get_emergency_request(
        session, caller=caller, request_id=request_id
    )


@emergency_router.patch("/{request_id}", response_model=EmergencyRequestResponse)
async def patch_emergency_request(
    request_id: Annotated[int, Path(gt=0)],
    payload: EmergencyRequestUpdateRequest,
    session: Session,
    caller: Annotated[UserResponse, Depends(admin_or_doctor)],
) -> EmergencyRequestResponse:
    return await service.update_emergency_request(
        session, actor=caller, request_id=request_id, payload=payload
    )


@emergency_router.post(
    "/{request_id}/reserve", response_model=ReservationResponse, status_code=201
)
async def post_emergency_reservation(
    request_id: Annotated[int, Path(gt=0)],
    payload: ReserveBloodRequest,
    session: Session,
    caller: Annotated[UserResponse, Depends(admin_blood)],
) -> ReservationResponse:
    return await service.reserve_emergency_blood(
        session,
        actor=caller,
        request_id=request_id,
        hold_minutes=payload.hold_minutes,
    )


@reservations_router.get("", response_model=PageResponse[ReservationResponse])
async def get_reservations(
    session: Session,
    caller: Annotated[UserResponse, Depends(reservation_read)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    reservation_status: Annotated[
        ReservationStatus | None, Query(alias="status")
    ] = None,
) -> PageResponse[ReservationResponse]:
    return await service.list_reservations(
        session,
        caller=caller,
        page=page,
        page_size=page_size,
        status=reservation_status.value if reservation_status else None,
    )


@reservations_router.get("/{reservation_id}", response_model=ReservationResponse)
async def get_reservation(
    reservation_id: Annotated[int, Path(gt=0)],
    session: Session,
    caller: Annotated[UserResponse, Depends(reservation_read)],
) -> ReservationResponse:
    return await service.get_reservation(
        session, caller=caller, reservation_id=reservation_id
    )


@reservations_router.post(
    "/{reservation_id}/cancel", response_model=ReservationResponse
)
async def post_cancel_reservation(
    reservation_id: Annotated[int, Path(gt=0)],
    session: Session,
    caller: Annotated[UserResponse, Depends(admin_blood)],
) -> ReservationResponse:
    return await service.cancel_reservation(
        session, actor=caller, reservation_id=reservation_id
    )


@reservations_router.post("/{reservation_id}/issue", response_model=ReservationResponse)
async def post_issue_reservation(
    reservation_id: Annotated[int, Path(gt=0)],
    session: Session,
    caller: Annotated[UserResponse, Depends(admin_blood)],
) -> ReservationResponse:
    return await service.issue_reservation(
        session, actor=caller, reservation_id=reservation_id
    )


# Organs and academic matching ----------------------------------------------

organs_router = APIRouter(prefix="/organs", tags=["organs"])
organ_matches_router = APIRouter(prefix="/organ-matches", tags=["organ-matches"])


@organs_router.get("", response_model=PageResponse[OrganUnitResponse])
async def get_organs(
    session: Session,
    caller: Annotated[UserResponse, Depends(organ_read)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    organ_type: Annotated[str | None, Query(min_length=1, max_length=50)] = None,
    unit_status: Annotated[OrganUnitStatus | None, Query(alias="status")] = None,
) -> PageResponse[OrganUnitResponse]:
    return await service.list_organs(
        session,
        caller=caller,
        page=page,
        page_size=page_size,
        organ_type=organ_type,
        status=unit_status.value if unit_status else None,
    )


@organs_router.post("", response_model=DonationRegistrationResponse, status_code=201)
async def post_organ(
    payload: OrganDonationCreateRequest,
    session: Session,
    caller: Annotated[UserResponse, Depends(admin_organ)],
) -> DonationRegistrationResponse:
    return await service.register_organ_donation(session, actor=caller, payload=payload)


@organs_router.get("/{organ_unit_id}", response_model=OrganUnitResponse)
async def get_organ(
    organ_unit_id: Annotated[int, Path(gt=0)],
    session: Session,
    caller: Annotated[UserResponse, Depends(organ_read)],
) -> OrganUnitResponse:
    return await service.get_organ(session, caller=caller, organ_unit_id=organ_unit_id)


@organs_router.post(
    "/{organ_unit_id}/calculate-matches",
    response_model=list[OrganMatchResponse],
)
async def post_calculate_organ_matches(
    organ_unit_id: Annotated[int, Path(gt=0)],
    payload: OrganMatchCalculateRequest,
    session: Session,
    caller: Annotated[UserResponse, Depends(admin_organ)],
) -> list[OrganMatchResponse]:
    return await service.calculate_organ_matches(
        session,
        actor=caller,
        organ_unit_id=organ_unit_id,
        payload=payload,
    )


@organs_router.get("/{organ_unit_id}/matches", response_model=list[OrganMatchResponse])
async def get_organ_matches(
    organ_unit_id: Annotated[int, Path(gt=0)],
    session: Session,
    caller: Annotated[UserResponse, Depends(organ_read)],
) -> list[OrganMatchResponse]:
    return await service.list_organ_matches(
        session, actor=caller, organ_unit_id=organ_unit_id
    )


@organ_matches_router.patch("/{match_id}/status", response_model=OrganMatchResponse)
async def patch_organ_match_status(
    match_id: Annotated[int, Path(gt=0)],
    payload: OrganMatchStatusUpdateRequest,
    session: Session,
    caller: Annotated[UserResponse, Depends(admin_organ)],
) -> OrganMatchResponse:
    return await service.update_organ_match_status(
        session, actor=caller, match_id=match_id, new_status=payload.status
    )


# Camps, reports, and audit --------------------------------------------------

camps_router = APIRouter(prefix="/camps", tags=["camps"])
reports_router = APIRouter(prefix="/reports", tags=["reports"])
audit_router = APIRouter(prefix="/audit", tags=["audit"])


@camps_router.get("", response_model=list[CampResponse])
async def get_camps(
    session: Session,
    caller: Annotated[UserResponse, Depends(authenticated)],
    camp_status: Annotated[CampStatus | None, Query(alias="status")] = None,
) -> list[CampResponse]:
    del caller
    return await service.list_camps(
        session, status=camp_status.value if camp_status else None
    )


@camps_router.post("", response_model=CampResponse, status_code=201)
async def post_camp(
    payload: CampCreateRequest,
    session: Session,
    caller: Annotated[UserResponse, Depends(admin)],
) -> CampResponse:
    return await service.create_camp(session, actor=caller, payload=payload)


@camps_router.get("/{camp_id}", response_model=CampResponse)
async def get_camp(
    camp_id: Annotated[int, Path(gt=0)],
    session: Session,
    caller: Annotated[UserResponse, Depends(authenticated)],
) -> CampResponse:
    del caller
    return await service.get_camp(session, camp_id)


@camps_router.post(
    "/{camp_id}/register",
    response_model=CampRegistrationResponse,
    status_code=201,
)
async def post_camp_registration(
    camp_id: Annotated[int, Path(gt=0)],
    payload: CampRegistrationRequest,
    session: Session,
    caller: Annotated[UserResponse, Depends(camp_registration)],
) -> CampRegistrationResponse:
    return await service.register_for_camp(
        session,
        actor=caller,
        camp_id=camp_id,
        donor_id=payload.donor_id,
    )


@reports_router.get("/blood-inventory", response_model=list[BloodInventoryReportRow])
async def get_blood_inventory_report(
    session: Session,
    caller: Annotated[UserResponse, Depends(admin_blood)],
    blood_bank_id: Annotated[int | None, Query(gt=0)] = None,
    blood_group: BloodGroup | None = None,
    unit_status: Annotated[BloodUnitStatus | None, Query(alias="status")] = None,
) -> list[BloodInventoryReportRow]:
    return await service.blood_inventory_report(
        session,
        actor=caller,
        blood_bank_id=blood_bank_id,
        blood_group=blood_group.value if blood_group else None,
        status=unit_status.value if unit_status else None,
    )


@reports_router.get("/expiring-units", response_model=list[BloodUnitResponse])
async def get_expiring_units_report(
    session: Session,
    caller: Annotated[UserResponse, Depends(admin_blood)],
) -> list[BloodUnitResponse]:
    return await service.expiring_units_report(session, actor=caller)


@reports_router.get("/emergency-summary", response_model=list[EmergencySummaryRow])
async def get_emergency_summary_report(
    session: Session,
    caller: Annotated[UserResponse, Depends(admin)],
) -> list[EmergencySummaryRow]:
    del caller
    return await service.emergency_summary_report(session)


@reports_router.get("/donation-trends", response_model=list[DonationTrendRow])
async def get_donation_trends_report(
    session: Session,
    caller: Annotated[UserResponse, Depends(admin)],
) -> list[DonationTrendRow]:
    del caller
    return await service.donation_trends_report(session)


@reports_router.get("/reservations", response_model=list[ReservationSummaryRow])
async def get_reservations_report(
    session: Session,
    caller: Annotated[UserResponse, Depends(admin_blood)],
) -> list[ReservationSummaryRow]:
    return await service.reservation_summary_report(session, actor=caller)


@reports_router.get("/organ-matches", response_model=list[OrganMatchResponse])
async def get_organ_matches_report(
    session: Session,
    caller: Annotated[UserResponse, Depends(admin_organ)],
) -> list[OrganMatchResponse]:
    del caller
    return await service.organ_matches_report(session)


@reports_router.get(
    "/hospital-response-time", response_model=list[HospitalResponseTimeRow]
)
async def get_hospital_response_time_report(
    session: Session,
    caller: Annotated[UserResponse, Depends(admin)],
) -> list[HospitalResponseTimeRow]:
    del caller
    return await service.hospital_response_time_report(session)


@audit_router.get("", response_model=PageResponse[AuditLogResponse])
async def get_audit_log(
    session: Session,
    caller: Annotated[UserResponse, Depends(admin)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    table_name: Annotated[str | None, Query(min_length=1, max_length=80)] = None,
    record_id: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
    action: Annotated[str | None, Query(min_length=1, max_length=40)] = None,
    user_id: Annotated[int | None, Query(gt=0)] = None,
) -> PageResponse[AuditLogResponse]:
    del caller
    return await service.list_audit_logs(
        session,
        page=page,
        page_size=page_size,
        table_name=table_name,
        record_id=record_id,
        action=action,
        user_id=user_id,
    )


ALL_OPERATION_ROUTERS = (
    recipients_router,
    doctors_router,
    hospitals_router,
    blood_banks_router,
    organ_banks_router,
    donations_router,
    blood_units_router,
    medical_tests_router,
    emergency_router,
    reservations_router,
    organs_router,
    organ_matches_router,
    camps_router,
    reports_router,
    audit_router,
)
