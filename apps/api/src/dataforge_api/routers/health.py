"""Health check endpoints."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health_check() -> dict:
    """Check API health status."""
    return {"status": "healthy", "service": "dataforge-api"}


@router.get("/ready")
async def readiness_check() -> dict:
    """Check if API is ready to serve requests."""
    return {"status": "ready"}
