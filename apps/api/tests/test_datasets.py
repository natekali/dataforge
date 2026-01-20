"""Tests for datasets API endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
class TestDatasetsAPI:
    """Tests for /api/v1/datasets endpoints."""

    async def test_add_examples(
        self, client: AsyncClient, sample_project: dict, sample_examples: list
    ):
        """Should add examples to a project."""
        project_id = sample_project["id"]

        response = await client.post(
            f"/api/v1/datasets/{project_id}/examples",
            json={"examples": sample_examples},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["added"] == len(sample_examples)

    async def test_get_examples(
        self, client: AsyncClient, sample_project: dict, sample_examples: list
    ):
        """Should get examples from a project."""
        project_id = sample_project["id"]

        # Add examples first
        await client.post(
            f"/api/v1/datasets/{project_id}/examples",
            json={"examples": sample_examples},
        )

        # Get examples
        response = await client.get(f"/api/v1/datasets/{project_id}/examples")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == len(sample_examples)
        assert "messages" in data[0]

    async def test_get_examples_pagination(
        self, client: AsyncClient, sample_project: dict, sample_examples: list
    ):
        """Should support pagination."""
        project_id = sample_project["id"]

        # Add examples
        await client.post(
            f"/api/v1/datasets/{project_id}/examples",
            json={"examples": sample_examples},
        )

        # Get with limit
        response = await client.get(
            f"/api/v1/datasets/{project_id}/examples",
            params={"limit": 1, "offset": 0},
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1

    async def test_update_example(
        self, client: AsyncClient, sample_project: dict, sample_examples: list
    ):
        """Should update a specific example."""
        project_id = sample_project["id"]

        # Add examples
        await client.post(
            f"/api/v1/datasets/{project_id}/examples",
            json={"examples": sample_examples[:1]},
        )

        # Get example ID
        response = await client.get(f"/api/v1/datasets/{project_id}/examples")
        example_id = response.json()[0]["id"]

        # Update
        new_messages = [
            {"role": "user", "content": "Updated question"},
            {"role": "assistant", "content": "Updated answer"},
        ]

        response = await client.patch(
            f"/api/v1/datasets/{project_id}/examples/{example_id}",
            json={"messages": new_messages},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["messages"][0]["content"] == "Updated question"

    async def test_delete_examples(
        self, client: AsyncClient, sample_project: dict, sample_examples: list
    ):
        """Should delete specific examples."""
        project_id = sample_project["id"]

        # Add examples
        await client.post(
            f"/api/v1/datasets/{project_id}/examples",
            json={"examples": sample_examples},
        )

        # Get example IDs
        response = await client.get(f"/api/v1/datasets/{project_id}/examples")
        example_ids = [ex["id"] for ex in response.json()[:2]]

        # Delete
        response = await client.post(
            f"/api/v1/datasets/{project_id}/examples/delete",
            json={"example_ids": example_ids},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["deleted"] == 2

        # Verify count
        response = await client.get(f"/api/v1/datasets/{project_id}/examples")
        assert len(response.json()) == len(sample_examples) - 2


@pytest.mark.asyncio
class TestDatasetImport:
    """Tests for dataset import functionality."""

    async def test_import_jsonl(self, client: AsyncClient, sample_project: dict):
        """Should import JSONL data."""
        project_id = sample_project["id"]
        jsonl_content = (
            '{"messages": [{"role": "user", "content": "Hi"}]}\n'
            '{"messages": [{"role": "user", "content": "Hello"}]}'
        )

        response = await client.post(
            f"/api/v1/datasets/{project_id}/import",
            files={"file": ("data.jsonl", jsonl_content, "application/jsonl")},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["imported"] == 2

    async def test_import_json(self, client: AsyncClient, sample_project: dict):
        """Should import JSON array."""
        project_id = sample_project["id"]
        json_content = '[{"messages": [{"role": "user", "content": "Test"}]}]'

        response = await client.post(
            f"/api/v1/datasets/{project_id}/import",
            files={"file": ("data.json", json_content, "application/json")},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["imported"] == 1
