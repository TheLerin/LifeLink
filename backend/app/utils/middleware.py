"""Request ID propagation and concise request logging."""

import logging
import re
import time
from uuid import uuid4

from fastapi import FastAPI, Request, Response

logger = logging.getLogger("lifelink.request")
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,128}$")


def _resolve_request_id(candidate: str | None) -> str:
    if candidate and REQUEST_ID_PATTERN.fullmatch(candidate):
        return candidate
    return str(uuid4())


def register_request_context_middleware(app: FastAPI, header_name: str) -> None:
    """Attach/return a safe request ID and log one line per completed request."""

    @app.middleware("http")
    async def request_context(request: Request, call_next) -> Response:  # type: ignore[no-untyped-def]
        request_id = _resolve_request_id(request.headers.get(header_name))
        request.state.request_id = request_id
        started_at = time.perf_counter()

        response = await call_next(request)
        response.headers[header_name] = request_id

        duration_ms = (time.perf_counter() - started_at) * 1000
        logger.info(
            "request_completed method=%s path=%s status=%s "
            "duration_ms=%.2f request_id=%s",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            request_id,
        )
        return response
