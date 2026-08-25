"""Stable API exceptions and JSON exception handlers."""

import logging
from collections.abc import Mapping
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException

logger = logging.getLogger(__name__)
UNPROCESSABLE_CONTENT_STATUS = 422


class AppError(Exception):
    """An expected application error safe to expose to API clients."""

    def __init__(
        self,
        *,
        status_code: int,
        code: str,
        message: str,
        details: Any | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details
        self.headers = dict(headers) if headers else None


class ServiceUnavailableError(AppError):
    """A dependency required to serve the request is unavailable."""

    def __init__(self, *, code: str, message: str) -> None:
        super().__init__(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code=code,
            message=message,
        )


class UnauthorizedError(AppError):
    """Authentication credentials are missing, invalid, or expired."""

    def __init__(self, *, code: str, message: str) -> None:
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code=code,
            message=message,
            headers={"WWW-Authenticate": "Bearer"},
        )


class ForbiddenError(AppError):
    """The authenticated account cannot perform the requested action."""

    def __init__(self, *, code: str, message: str) -> None:
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            code=code,
            message=message,
        )


class NotFoundError(AppError):
    """The requested LifeLink record does not exist."""

    def __init__(self, *, code: str, message: str) -> None:
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            code=code,
            message=message,
        )


class ConflictError(AppError):
    """The requested change conflicts with current or unique state."""

    def __init__(self, *, code: str, message: str) -> None:
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            code=code,
            message=message,
        )


class UnprocessableError(AppError):
    """Input is well-formed but violates the LifeLink data contract."""

    def __init__(self, *, code: str, message: str) -> None:
        super().__init__(
            status_code=UNPROCESSABLE_CONTENT_STATUS,
            code=code,
            message=message,
        )


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def _error_response(
    request: Request,
    *,
    status_code: int,
    code: str,
    message: str,
    details: Any | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        headers=headers,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": details,
                "request_id": _request_id(request),
            }
        },
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Register one consistent response contract for common API failures."""

    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        return _error_response(
            request,
            status_code=exc.status_code,
            code=exc.code,
            message=exc.message,
            details=exc.details,
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        details = [
            {
                "location": ".".join(str(part) for part in error["loc"]),
                "message": error["msg"],
                "type": error["type"],
            }
            for error in exc.errors()
        ]
        return _error_response(
            request,
            status_code=UNPROCESSABLE_CONTENT_STATUS,
            code="request_validation_error",
            message="The request did not pass validation.",
            details=details,
        )

    @app.exception_handler(HTTPException)
    async def handle_http_error(request: Request, exc: HTTPException) -> JSONResponse:
        phrase = HTTPStatus(exc.status_code).phrase
        message = exc.detail if isinstance(exc.detail, str) else phrase
        return _error_response(
            request,
            status_code=exc.status_code,
            code=phrase.lower().replace(" ", "_"),
            message=message,
            headers=exc.headers,
        )

    @app.exception_handler(SQLAlchemyError)
    async def handle_database_error(
        request: Request,
        exc: SQLAlchemyError,
    ) -> JSONResponse:
        logger.error(
            "database_request_error request_id=%s",
            _request_id(request),
            exc_info=(type(exc), exc, exc.__traceback__),
        )
        return _error_response(
            request,
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="database_operation_failed",
            message="The database operation could not be completed.",
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        logger.error(
            "unhandled_request_error request_id=%s",
            _request_id(request),
            exc_info=(type(exc), exc, exc.__traceback__),
        )
        return _error_response(
            request,
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="internal_server_error",
            message="An unexpected server error occurred.",
        )
