"""Server-Sent Events (SSE) for real-time progress updates."""

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import Request
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse

from dataforge_api.logging_config import get_logger

logger = get_logger(__name__)


class ProgressEvent:
    """A progress update event."""

    def __init__(
        self,
        event_type: str,
        data: dict[str, Any],
        event_id: str | None = None,
        retry: int | None = None,
    ):
        self.id = event_id
        self.event = event_type
        self.data = data
        self.retry = retry


class ProgressTracker:
    """Track and broadcast progress for long-running operations."""

    def __init__(self, job_id: str):
        self.job_id = job_id
        self._queue: asyncio.Queue[ProgressEvent] = asyncio.Queue()
        self._listeners: list[asyncio.Queue[ProgressEvent]] = []
        self._total_items = 0
        self._completed_items = 0
        self._current_step = ""
        self._error: str | None = None
        self._finished = False

    async def _broadcast(self, event: ProgressEvent) -> None:
        """Broadcast event to all listeners."""
        logger.debug("progress_broadcast", job_id=self.job_id, event_type=event.event_type)
        for listener in self._listeners:
            await listener.put(event)

    async def update_progress(
        self,
        completed: int,
        total: int,
        step: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        """Update progress."""
        self._completed_items = completed
        self._total_items = total
        self._current_step = step
        self._error = None

        progress_percent = (completed / total * 100) if total > 0 else 0

        event = ProgressEvent(
            event_type="progress",
            data={
                "job_id": self.job_id,
                "completed": completed,
                "total": total,
                "percent": round(progress_percent, 2),
                "step": step,
                "details": details or {},
            },
        )

        await self._broadcast(event)

    async def complete(self, result: dict[str, Any]) -> None:
        """Mark job as complete."""
        self._finished = True

        event = ProgressEvent(
            event_type="complete",
            data={
                "job_id": self.job_id,
                "result": result,
                "completed": self._completed_items,
                "total": self._total_items,
            },
        )

        await self._broadcast(event)

    async def error(self, error: str, details: dict[str, Any] | None = None) -> None:
        """Mark job as failed."""
        self._error = error
        self._finished = True

        event = ProgressEvent(
            event_type="error",
            data={
                "job_id": self.job_id,
                "error": error,
                "details": details or {},
            },
        )

        await self._broadcast(event)

    async def add_listener(self, queue: asyncio.Queue[ProgressEvent]) -> None:
        """Add a new listener for events."""
        self._listeners.append(queue)

        # Send current state
        if self._finished and self._error:
            await queue.put(
                ProgressEvent(
                    event_type="error",
                    data={
                        "job_id": self.job_id,
                        "error": self._error,
                    },
                )
            )
        elif self._finished:
            await queue.put(
                ProgressEvent(
                    event_type="complete",
                    data={
                        "job_id": self.job_id,
                        "completed": self._completed_items,
                        "total": self._total_items,
                    },
                )
            )
        else:
            progress_percent = (
                (self._completed_items / self._total_items * 100) if self._total_items > 0 else 0
            )
            await queue.put(
                ProgressEvent(
                    event_type="progress",
                    data={
                        "job_id": self.job_id,
                        "completed": self._completed_items,
                        "total": self._total_items,
                        "percent": round(progress_percent, 2),
                        "step": self._current_step,
                    },
                )
            )

    def remove_listener(self, queue: asyncio.Queue[ProgressEvent]) -> None:
        """Remove a listener."""
        if queue in self._listeners:
            self._listeners.remove(queue)


# Global registry of active jobs
_active_jobs: dict[str, ProgressTracker] = {}


def get_tracker(job_id: str) -> ProgressTracker:
    """Get or create a progress tracker for a job."""
    if job_id not in _active_jobs:
        _active_jobs[job_id] = ProgressTracker(job_id)
    return _active_jobs[job_id]


def remove_tracker(job_id: str) -> None:
    """Remove a completed job tracker."""
    if job_id in _active_jobs:
        del _active_jobs[job_id]


async def progress_event_generator(
    tracker: ProgressTracker,
) -> AsyncIterator[dict[str, Any]]:
    """Generate SSE events for progress updates."""
    queue: asyncio.Queue[ProgressEvent] = asyncio.Queue()
    await tracker.add_listener(queue)

    try:
        while not tracker._finished or not queue.empty():
            try:
                event = await asyncio.wait_for(queue.get(), timeout=2.0)
                yield {
                    "event": event.event,
                    "data": json.dumps(event.data),
                    "id": event.id,
                    "retry": event.retry,
                }
            except TimeoutError:
                # Send keepalive
                yield {"event": "keepalive", "data": "{}"}
                continue
    finally:
        tracker.remove_listener(queue)


def create_progress_response(tracker: ProgressTracker, request: Request) -> StreamingResponse:
    """Create an SSE response for progress updates."""
    return EventSourceResponse(
        progress_event_generator(tracker),
        media_type="text/event-stream",
    )
