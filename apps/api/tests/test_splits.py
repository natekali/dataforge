"""Tests for splits API endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
class TestSplitsAPI:
    """Tests for /api/v1/datasets/{id}/splits endpoints."""

    async def test_get_split_counts(
        self, client: AsyncClient, sample_project: dict, sample_examples: list
    ):
        """Should return split counts."""
        project_id = sample_project["id"]

        # Add examples
        await client.post(
            f"/api/v1/datasets/{project_id}/examples",
            json={"examples": sample_examples},
        )

        # Get split counts
        response = await client.get(f"/api/v1/datasets/{project_id}/splits")

        assert response.status_code == 200
        data = response.json()
        assert "train" in data
        assert "validation" in data
        assert "test" in data
        assert "total" in data
        assert data["total"] == len(sample_examples)

    async def test_get_split_info(
        self, client: AsyncClient, sample_project: dict, sample_examples: list
    ):
        """Should return detailed split info."""
        project_id = sample_project["id"]

        # Add examples
        await client.post(
            f"/api/v1/datasets/{project_id}/examples",
            json={"examples": sample_examples},
        )

        # Get split info
        response = await client.get(f"/api/v1/datasets/{project_id}/splits/info")

        assert response.status_code == 200
        data = response.json()
        assert "total_examples" in data
        assert "is_split" in data

    async def test_auto_split(
        self, client: AsyncClient, sample_project: dict, sample_examples: list
    ):
        """Should auto-split dataset."""
        project_id = sample_project["id"]

        # Add examples
        await client.post(
            f"/api/v1/datasets/{project_id}/examples",
            json={"examples": sample_examples},
        )

        # Auto split with 80/10/10
        response = await client.post(
            f"/api/v1/datasets/{project_id}/splits/auto",
            json={
                "train_ratio": 0.8,
                "validation_ratio": 0.1,
                "test_ratio": 0.1,
            },
        )

        assert response.status_code == 200
        data = response.json()
        # Check for either format of response
        assert ("train_count" in data or "train" in data)
        assert "success" in data or "total" in data

    async def test_update_example_splits(
        self, client: AsyncClient, sample_project: dict, sample_examples: list
    ):
        """Should move examples between splits."""
        project_id = sample_project["id"]

        # Add examples
        await client.post(
            f"/api/v1/datasets/{project_id}/examples",
            json={"examples": sample_examples},
        )

        # Get example IDs
        response = await client.get(f"/api/v1/datasets/{project_id}/examples")
        example_ids = [ex["id"] for ex in response.json()[:1]]

        # Move to validation split
        response = await client.post(
            f"/api/v1/datasets/{project_id}/splits/update",
            json={"example_ids": example_ids, "split": "validation"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["updated"] == 1
        assert data["split"] == "validation"

    async def test_reset_splits(
        self, client: AsyncClient, sample_project: dict, sample_examples: list
    ):
        """Should reset all splits to train."""
        project_id = sample_project["id"]

        # Add examples
        await client.post(
            f"/api/v1/datasets/{project_id}/examples",
            json={"examples": sample_examples},
        )

        # Auto split first
        await client.post(
            f"/api/v1/datasets/{project_id}/splits/auto",
            json={"train_ratio": 0.5, "validation_ratio": 0.3, "test_ratio": 0.2},
        )

        # Reset splits
        response = await client.post(f"/api/v1/datasets/{project_id}/splits/reset")

        assert response.status_code == 200
        data = response.json()
        assert "reset" in data

        # Verify all in train
        response = await client.get(f"/api/v1/datasets/{project_id}/splits")
        splits = response.json()
        assert splits["train"] == splits["total"]
