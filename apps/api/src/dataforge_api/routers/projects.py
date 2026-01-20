"""Project management endpoints."""


from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from dataforge_api import database as db

router = APIRouter()


class ProjectCreate(BaseModel):
    """Request model for creating a project."""

    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    target_model: str | None = None


class ProjectResponse(BaseModel):
    """Response model for a project."""

    id: str
    name: str
    description: str | None
    target_model: str | None
    source_format: str | None = None
    example_count: int = 0
    created_at: str
    updated_at: str


class ProjectUpdate(BaseModel):
    """Request model for updating a project."""

    name: str | None = None
    description: str | None = None
    target_model: str | None = None


class ProjectStats(BaseModel):
    """Statistics for a project's dataset."""

    total_examples: int
    total_messages: int
    avg_user_length: float
    avg_assistant_length: float
    avg_tokens: float | None
    avg_quality: float | None


@router.post("", response_model=ProjectResponse)
async def create_project(data: ProjectCreate) -> ProjectResponse:
    """Create a new dataset project."""
    project = await db.create_project(
        name=data.name,
        description=data.description,
        target_model=data.target_model,
    )

    return ProjectResponse(
        id=project["id"],
        name=project["name"],
        description=project["description"],
        target_model=project["target_model"],
        source_format=project.get("source_format"),
        example_count=0,
        created_at=project["created_at"],
        updated_at=project["updated_at"],
    )


@router.get("", response_model=list[ProjectResponse])
async def list_projects() -> list[ProjectResponse]:
    """List all projects."""
    projects = await db.list_projects()

    return [
        ProjectResponse(
            id=p["id"],
            name=p["name"],
            description=p["description"],
            target_model=p["target_model"],
            source_format=p.get("source_format"),
            example_count=p.get("example_count", 0),
            created_at=p["created_at"],
            updated_at=p["updated_at"],
        )
        for p in projects
    ]


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str) -> ProjectResponse:
    """Get a specific project by ID."""
    project = await db.get_project(project_id)

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    example_count = await db.count_examples(project_id)

    return ProjectResponse(
        id=project["id"],
        name=project["name"],
        description=project["description"],
        target_model=project["target_model"],
        source_format=project.get("source_format"),
        example_count=example_count,
        created_at=project["created_at"],
        updated_at=project["updated_at"],
    )


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(project_id: str, data: ProjectUpdate) -> ProjectResponse:
    """Update a project."""
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    updates = {k: v for k, v in data.model_dump().items() if v is not None}

    if updates:
        project = await db.update_project(project_id, **updates)

    example_count = await db.count_examples(project_id)

    return ProjectResponse(
        id=project["id"],
        name=project["name"],
        description=project["description"],
        target_model=project["target_model"],
        source_format=project.get("source_format"),
        example_count=example_count,
        created_at=project["created_at"],
        updated_at=project["updated_at"],
    )


@router.delete("/{project_id}")
async def delete_project(project_id: str) -> dict:
    """Delete a project."""
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    await db.delete_project(project_id)
    return {"status": "deleted", "id": project_id}


@router.get("/{project_id}/stats", response_model=ProjectStats)
async def get_project_stats(project_id: str) -> ProjectStats:
    """Get statistics for a project's dataset."""
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    stats = await db.get_project_stats(project_id)

    return ProjectStats(
        total_examples=stats.get("total_examples", 0) or 0,
        total_messages=stats.get("total_messages", 0) or 0,
        avg_user_length=stats.get("avg_user_length", 0) or 0,
        avg_assistant_length=stats.get("avg_assistant_length", 0) or 0,
        avg_tokens=stats.get("avg_tokens"),
        avg_quality=stats.get("avg_quality"),
    )
