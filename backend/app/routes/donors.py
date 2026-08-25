"""Role-protected database-backed donor endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import require_roles
from app.dependencies.database import get_db_session
from app.schemas.auth import UserResponse, UserRole
from app.schemas.donors import (
    BloodGroup,
    DonationRecordStatus,
    DonationType,
    DonorConditionListResponse,
    DonorConditionStatus,
    DonorCreateRequest,
    DonorDetailResponse,
    DonorDonationListResponse,
    DonorListResponse,
    DonorUpdateRequest,
)
from app.schemas.system import ErrorResponse
from app.services.donor_service import (
    create_donor,
    get_donor,
    list_donor_conditions,
    list_donor_donations,
    list_donors,
    update_donor,
)
from app.utils.errors import ForbiddenError

router = APIRouter(prefix="/donors", tags=["donors"])

donor_list_roles = require_roles(
    UserRole.ADMIN,
    UserRole.BLOOD_BANK_STAFF,
    UserRole.ORGAN_BANK_STAFF,
)
admin_only = require_roles(UserRole.ADMIN)
admin_or_donor = require_roles(UserRole.ADMIN, UserRole.DONOR)
donation_history_roles = require_roles(
    UserRole.ADMIN,
    UserRole.BLOOD_BANK_STAFF,
    UserRole.ORGAN_BANK_STAFF,
    UserRole.DONOR,
)
condition_history_roles = require_roles(
    UserRole.ADMIN,
    UserRole.BLOOD_BANK_STAFF,
    UserRole.DONOR,
)


def _enforce_donor_ownership(user: UserResponse, donor_id: int) -> None:
    if user.role is UserRole.DONOR and user.person_id != donor_id:
        raise ForbiddenError(
            code="donor_record_forbidden",
            message="A donor account can access only its own donor record.",
        )


@router.get(
    "",
    response_model=DonorListResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ErrorResponse},
    },
    summary="List operational donor summaries",
)
async def get_donors(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    caller: Annotated[UserResponse, Depends(donor_list_roles)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    blood_group: BloodGroup | None = None,
    is_active: bool | None = None,
    eligible_only: bool = False,
    search: Annotated[
        str | None,
        Query(min_length=1, max_length=120, pattern=r"^.*\S.*$"),
    ] = None,
) -> DonorListResponse:
    del caller
    return await list_donors(
        session,
        page=page,
        page_size=page_size,
        blood_group=blood_group.value if blood_group is not None else None,
        is_active=is_active,
        eligible_only=eligible_only,
        search=search,
    )


@router.post(
    "",
    response_model=DonorDetailResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
        status.HTTP_409_CONFLICT: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ErrorResponse},
    },
    summary="Create a normalized donor profile",
)
async def post_donor(
    payload: DonorCreateRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    admin: Annotated[UserResponse, Depends(admin_only)],
) -> DonorDetailResponse:
    return await create_donor(session, actor=admin, payload=payload)


@router.get(
    "/{donor_id}",
    response_model=DonorDetailResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
        status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ErrorResponse},
    },
    summary="Get a full donor profile",
)
async def get_donor_by_id(
    donor_id: Annotated[int, Path(gt=0)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    caller: Annotated[UserResponse, Depends(admin_or_donor)],
) -> DonorDetailResponse:
    _enforce_donor_ownership(caller, donor_id)
    return await get_donor(session, donor_id)


@router.patch(
    "/{donor_id}",
    response_model=DonorDetailResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
        status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
        status.HTTP_409_CONFLICT: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ErrorResponse},
    },
    summary="Update a normalized donor profile",
)
async def patch_donor(
    donor_id: Annotated[int, Path(gt=0)],
    payload: DonorUpdateRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    admin: Annotated[UserResponse, Depends(admin_only)],
) -> DonorDetailResponse:
    return await update_donor(
        session,
        actor=admin,
        donor_id=donor_id,
        payload=payload,
    )


@router.get(
    "/{donor_id}/donations",
    response_model=DonorDonationListResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
        status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ErrorResponse},
    },
    summary="List a donor's donation history",
)
async def get_donor_donations(
    donor_id: Annotated[int, Path(gt=0)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    caller: Annotated[UserResponse, Depends(donation_history_roles)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    donation_type: DonationType | None = None,
    record_status: DonationRecordStatus | None = None,
) -> DonorDonationListResponse:
    _enforce_donor_ownership(caller, donor_id)
    return await list_donor_donations(
        session,
        donor_id=donor_id,
        page=page,
        page_size=page_size,
        donation_type=donation_type,
        record_status=record_status,
    )


@router.get(
    "/{donor_id}/conditions",
    response_model=DonorConditionListResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
        status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ErrorResponse},
    },
    summary="List a donor's recorded conditions",
)
async def get_donor_conditions(
    donor_id: Annotated[int, Path(gt=0)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    caller: Annotated[UserResponse, Depends(condition_history_roles)],
    condition_status: DonorConditionStatus | None = None,
) -> DonorConditionListResponse:
    _enforce_donor_ownership(caller, donor_id)
    return await list_donor_conditions(
        session,
        donor_id=donor_id,
        condition_status=condition_status,
    )
