"""Tests for projects API endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
class TestProjectsAPI:
    """Tests for /api/v1/projects endpoints."""

    async def test_create_project(self, client: AsyncClient):
        """Should create a new project."""
        response = await client.post(
            "/api/v1/projects",
            json={
                "name": "My Dataset",
                "description": "A fine-tuning dataset",
                "target_model": "llama-3",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "My Dataset"
        assert data["description"] == "A fine-tuning dataset"
        assert "id" in data
        assert "created_at" in data

    async def test_create_project_minimal(self, client: AsyncClient):
        """Should create project with just name."""
        response = await client.post(
            "/api/v1/projects",
            json={"name": "Minimal Project"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Minimal Project"

    async def test_list_projects(self, client: AsyncClient, sample_project: dict):
        """Should list all projects."""
        response = await client.get("/api/v1/projects")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 1

    async def test_get_project(self, client: AsyncClient, sample_project: dict):
        """Should get a specific project."""
        project_id = sample_project["id"]
        response = await client.get(f"/api/v1/projects/{project_id}")

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == project_id
        assert data["name"] == "Test Project"

    async def test_get_project_not_found(self, client: AsyncClient):
        """Should return 404 for unknown project."""
        response = await client.get("/api/v1/projects/nonexistent-id")

        assert response.status_code == 404

    async def test_update_project(self, client: AsyncClient, sample_project: dict):
        """Should update project details."""
        project_id = sample_project["id"]
        response = await client.patch(
            f"/api/v1/projects/{project_id}",
            json={
                "name": "Updated Name",
                "target_model": "qwen3",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Name"
        assert data["target_model"] == "qwen3"

    async def test_delete_project(self, client: AsyncClient, sample_project: dict):
        """Should delete a project."""
        project_id = sample_project["id"]

        # Delete
        response = await client.delete(f"/api/v1/projects/{project_id}")
        assert response.status_code == 200

        # Verify deleted
        response = await client.get(f"/api/v1/projects/{project_id}")
        assert response.status_code == 404
