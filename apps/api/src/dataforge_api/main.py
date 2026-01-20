"""FastAPI application entry point."""

import time
from collections.abc import AsyncGenerator, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from dataforge_api.config import settings
from dataforge_api.logging_config import configure_logging, get_logger, log_request_event
from dataforge_api.middleware import validate_path_traversal, validate_request_size
from dataforge_api.routers import (
    analytics,
    datasets,
    enhance,
    export,
    health,
    huggingface,
    logs,
    models,
    progress,
    projects,
    providers,
    quality,
    splits,
)

# Configure structured logging
configure_logging()
logger = get_logger(__name__)

# Rate limiting
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[f"{settings.rate_limit_per_minute}/minute"],
    enabled=settings.rate_limit_enabled,
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan handler."""
    # Startup
    logger.info(
        "starting",
        version=settings.version,
        debug=settings.debug,
    )

    # Initialize database
    from dataforge_api.database import init_db

    await init_db()
    logger.info("database_initialized")

    yield

    # Shutdown
    logger.info("shutting_down")


app = FastAPI(
    title="DataForge Studio API",
    description="The Ultimate Fine-Tuning Dataset Builder",
    version=settings.version,
    lifespan=lifespan,
)

# Rate limiting exception handler
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.state.limiter = limiter

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security validation middleware (using decorator pattern)
@app.middleware("http")
async def security_validate_request_size(request: Request, call_next: Callable) -> Response:
    """Validate request size before processing."""
    return await validate_request_size(request, call_next)


@app.middleware("http")
async def security_validate_path_traversal(request: Request, call_next: Callable) -> Response:
    """Validate paths to prevent directory traversal attacks."""
    return await validate_path_traversal(request, call_next)


# Request logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next: Callable) -> Response:
    """Log all HTTP requests with timing."""
    from dataforge_api.routers.logs import log_api_request

    start_time = time.time()
    client_host = request.client.host if request.client else None

    # Log request start
    logger.info(
        "request_started",
        method=request.method,
        path=request.url.path,
        client=client_host,
    )

    try:
        response = await call_next(request)
        duration_ms = (time.time() - start_time) * 1000

        # Log request completion
        log_request_event(
            event_type="request_completed",
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=duration_ms,
        )

        # Log to in-memory buffer (skip /logs endpoint to avoid recursion)
        if not request.url.path.startswith("/api/v1/logs"):
            log_api_request(
                method=request.method,
                path=request.url.path,
                status_code=response.status_code,
                duration_ms=duration_ms,
                client=client_host,
            )

        # Add timing header
        response.headers["X-Process-Time"] = str(duration_ms)

        return response
    except Exception as e:
        duration_ms = (time.time() - start_time) * 1000

        # Log request error
        log_request_event(
            event_type="request_failed",
            method=request.method,
            path=request.url.path,
            duration_ms=duration_ms,
            error=str(e),
            error_type=type(e).__name__,
        )

        # Log error to in-memory buffer
        log_api_request(
            method=request.method,
            path=request.url.path,
            status_code=500,
            duration_ms=duration_ms,
            client=client_host,
            error=str(e),
        )

        raise


# Include routers
app.include_router(health.router, tags=["Health"])
app.include_router(projects.router, prefix="/api/v1/projects", tags=["Projects"])
app.include_router(datasets.router, prefix="/api/v1/datasets", tags=["Datasets"])
app.include_router(models.router, prefix="/api/v1/models", tags=["Models"])
app.include_router(providers.router, prefix="/api/v1/providers", tags=["Providers"])
app.include_router(export.router, prefix="/api/v1/export", tags=["Export"])
app.include_router(quality.router, prefix="/api/v1/quality", tags=["Quality"])
app.include_router(enhance.router, prefix="/api/v1/enhance", tags=["Enhancement"])
app.include_router(huggingface.router, prefix="/api/v1/huggingface", tags=["HuggingFace"])
app.include_router(analytics.router, prefix="/api/v1/analytics", tags=["Analytics"])
app.include_router(progress.router, prefix="/api/v1/progress", tags=["Progress"])
app.include_router(logs.router, prefix="/api/v1/logs", tags=["Logs"])
app.include_router(splits.router, prefix="/api/v1/datasets", tags=["Splits"])


def run() -> None:
    """Run the application with uvicorn."""
    import uvicorn

    uvicorn.run(
        "dataforge_api.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )


if __name__ == "__main__":
    run()
