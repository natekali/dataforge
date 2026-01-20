"""Logs router for exposing application logs to the frontend."""

from collections import deque
from datetime import UTC, datetime
from enum import Enum
from typing import Annotated, Any

from fastapi import APIRouter, Query
from pydantic import BaseModel

router = APIRouter(tags=["Logs"])

# In-memory log storage (ring buffer)
MAX_LOGS = 1000
_log_buffer: deque[dict[str, Any]] = deque(maxlen=MAX_LOGS)


class LogLevel(str, Enum):
    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


class LogEntry(BaseModel):
    timestamp: str
    level: LogLevel
    source: str
    message: str
    details: dict[str, Any] | None = None


class LogsResponse(BaseModel):
    logs: list[LogEntry]
    total: int
    has_more: bool


def add_log(
    level: LogLevel,
    source: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> None:
    """Add a log entry to the buffer."""
    entry = {
        "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "level": level.value,
        "source": source,
        "message": message,
        "details": details or {},
    }
    _log_buffer.append(entry)


def log_api_request(
    method: str,
    path: str,
    status_code: int,
    duration_ms: float,
    client: str | None = None,
    error: str | None = None,
) -> None:
    """Log an API request."""
    level = LogLevel.ERROR if status_code >= 400 else LogLevel.INFO
    message = f"{method} {path} -> {status_code} ({duration_ms:.1f}ms)"

    details = {
        "method": method,
        "path": path,
        "status_code": status_code,
        "duration_ms": round(duration_ms, 2),
    }
    if client:
        details["client"] = client
    if error:
        details["error"] = error

    add_log(level, "api", message, details)


def log_system_event(event: str, details: dict[str, Any] | None = None) -> None:
    """Log a system event."""
    add_log(LogLevel.INFO, "system", event, details)


def log_error(
    source: str,
    error_type: str,
    error_message: str,
    details: dict[str, Any] | None = None,
) -> None:
    """Log an error."""
    full_details = {"error_type": error_type, **(details or {})}
    add_log(LogLevel.ERROR, source, error_message, full_details)


def log_warning(source: str, message: str, details: dict[str, Any] | None = None) -> None:
    """Log a warning."""
    add_log(LogLevel.WARNING, source, message, details)


def log_import(
    project_id: str,
    filename: str,
    success: bool,
    imported_count: int,
    format_detected: str | None = None,
    errors: list[str] | None = None,
) -> None:
    """Log a dataset import operation."""
    if success:
        message = f"Imported {imported_count} examples from {filename}"
        level = LogLevel.INFO
    else:
        message = f"Import failed for {filename}"
        level = LogLevel.ERROR

    details = {
        "project_id": project_id,
        "filename": filename,
        "imported_count": imported_count,
        "format_detected": format_detected,
    }
    if errors:
        details["errors"] = errors

    add_log(level, "import", message, details)


def log_export(
    project_id: str,
    format: str,
    success: bool,
    example_count: int,
    error: str | None = None,
) -> None:
    """Log a dataset export operation."""
    if success:
        message = f"Exported {example_count} examples in {format} format"
        level = LogLevel.INFO
    else:
        message = f"Export failed: {error}"
        level = LogLevel.ERROR

    details = {
        "project_id": project_id,
        "format": format,
        "example_count": example_count,
    }
    if error:
        details["error"] = error

    add_log(level, "export", message, details)


def log_enhancement(
    project_id: str,
    operation: str,
    success: bool,
    count: int | None = None,
    error: str | None = None,
) -> None:
    """Log an enhancement operation."""
    if success:
        message = f"Enhancement '{operation}' completed"
        if count:
            message += f" ({count} examples)"
        level = LogLevel.INFO
    else:
        message = f"Enhancement '{operation}' failed: {error}"
        level = LogLevel.ERROR

    details = {
        "project_id": project_id,
        "operation": operation,
    }
    if count:
        details["count"] = count
    if error:
        details["error"] = error

    add_log(level, "enhancement", message, details)


@router.get("", response_model=LogsResponse)
async def get_logs(
    level: Annotated[LogLevel | None, Query(description="Filter by log level")] = None,
    source: Annotated[str | None, Query(description="Filter by source (api, system, import, export, enhancement)")] = None,
    limit: Annotated[int, Query(ge=1, le=500, description="Maximum number of logs to return")] = 100,
    offset: Annotated[int, Query(ge=0, description="Number of logs to skip")] = 0,
    search: Annotated[str | None, Query(description="Search in log messages")] = None,
) -> LogsResponse:
    """Get application logs with optional filtering."""
    # Convert to list for filtering (newest first)
    all_logs = list(reversed(_log_buffer))

    # Apply filters
    filtered_logs = all_logs

    if level:
        filtered_logs = [log for log in filtered_logs if log["level"] == level.value]

    if source:
        filtered_logs = [log for log in filtered_logs if log["source"] == source]

    if search:
        search_lower = search.lower()
        filtered_logs = [
            log for log in filtered_logs
            if search_lower in log["message"].lower()
            or (log.get("details") and search_lower in str(log["details"]).lower())
        ]

    total = len(filtered_logs)

    # Apply pagination
    paginated_logs = filtered_logs[offset:offset + limit]

    return LogsResponse(
        logs=[LogEntry(**log) for log in paginated_logs],
        total=total,
        has_more=offset + limit < total,
    )


@router.delete("")
async def clear_logs() -> dict[str, str]:
    """Clear all logs."""
    _log_buffer.clear()
    return {"status": "cleared"}


@router.get("/stats")
async def get_log_stats() -> dict[str, Any]:
    """Get log statistics."""
    all_logs = list(_log_buffer)

    level_counts = {"debug": 0, "info": 0, "warning": 0, "error": 0}
    source_counts: dict[str, int] = {}

    for log in all_logs:
        level_counts[log["level"]] = level_counts.get(log["level"], 0) + 1
        source_counts[log["source"]] = source_counts.get(log["source"], 0) + 1

    return {
        "total_logs": len(all_logs),
        "max_logs": MAX_LOGS,
        "by_level": level_counts,
        "by_source": source_counts,
    }


# Initialize with a startup log
log_system_event("Log system initialized", {"max_logs": MAX_LOGS})
