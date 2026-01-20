"""Request size validation middleware."""

from collections.abc import Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse

from dataforge_api.logging_config import get_logger

logger = get_logger(__name__)


async def validate_request_size(request: Request, call_next: Callable) -> Response:
    """Validate request size before processing."""

    content_length = request.headers.get("content-length")
    if content_length:
        try:
            content_length_int = int(content_length)
            max_size = 500 * 1024 * 1024  # 500MB as configured in settings

            if content_length_int > max_size:
                logger.warning(
                    "request_too_large",
                    path=request.url.path,
                    content_length=content_length_int,
                    max_size=max_size,
                    client=request.client.host if request.client else None,
                )

                return JSONResponse(
                    status_code=413,
                    content={
                        "error": "PayloadTooLarge",
                        "message": f"Request body too large. Maximum size is {max_size // (1024 * 1024)}MB",
                    },
                )
        except ValueError:
            logger.warning(
                "invalid_content_length",
                path=request.url.path,
                content_length=content_length,
            )

    response = await call_next(request)
    return response


async def validate_path_traversal(request: Request, call_next: Callable) -> Response:
    """Validate paths to prevent directory traversal attacks."""

    path = request.url.path
    suspicious_patterns = [
        "..",  # Parent directory
        "%2e%2e",  # URL encoded parent directory
        "%00",  # Null byte
        "~",  # Home directory
        "//",  # Double slashes
    ]

    for pattern in suspicious_patterns:
        if pattern in path:
            logger.warning(
                "path_traversal_attempt",
                path=path,
                client=request.client.host if request.client else None,
            )

            return JSONResponse(
                status_code=400,
                content={
                    "error": "InvalidPath",
                    "message": "Invalid path requested",
                },
            )

    response = await call_next(request)
    return response
