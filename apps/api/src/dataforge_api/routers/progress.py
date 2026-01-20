"""Progress tracking endpoint for SSE updates."""

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from dataforge_api.progress import create_progress_response, get_tracker

router = APIRouter()


@router.get("/jobs/{job_id}/progress")
async def get_job_progress(job_id: str, request: Request) -> StreamingResponse:
    """
    Subscribe to real-time progress updates for a job via Server-Sent Events.

    The client will receive events as they happen:
    - progress: {completed, total, percent, step, details}
    - complete: {job_id, result, completed, total}
    - error: {job_id, error, details}
    - keepalive: keepalive message every 2 seconds

    Example client-side usage:
    ```javascript
    const eventSource = new EventSource('/api/v1/progress/jobs/{job_id}/progress');

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (event.type === 'progress') {
        console.log(`Progress: ${data.percent}% - ${data.step}`);
      } else if (event.type === 'complete') {
        console.log('Job complete:', data.result);
        eventSource.close();
      } else if (event.type === 'error') {
        console.error('Job failed:', data.error);
        eventSource.close();
      }
    };
    ```
    """
    tracker = get_tracker(job_id)
    return create_progress_response(tracker, request)
