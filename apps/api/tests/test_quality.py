"""Tests for quality API endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
class TestQualityAPI:
    """Tests for /api/v1/quality endpoints."""

    async def test_validate_dataset(
        self, client: AsyncClient, sample_project: dict, sample_examples: list
    ):
        """Should validate dataset and return results."""
        project_id = sample_project["id"]

        # Add examples
        await client.post(
            f"/api/v1/datasets/{project_id}/examples",
            json={"examples": sample_examples},
        )

        # Validate - POST with config body
        response = await client.post(
            f"/api/v1/quality/{project_id}/validate",
            json={"model_family": "llama"},
        )

        assert response.status_code == 200
        data = response.json()
        assert "valid" in data
        assert "total_examples" in data
        assert "issues" in data

    async def test_score_dataset(
        self, client: AsyncClient, sample_project: dict, sample_examples: list
    ):
        """Should score dataset quality."""
        project_id = sample_project["id"]

        # Add examples
        await client.post(
            f"/api/v1/datasets/{project_id}/examples",
            json={"examples": sample_examples},
        )

        # Score - GET endpoint
        response = await client.get(f"/api/v1/quality/{project_id}/score")

        assert response.status_code == 200
        data = response.json()
        assert "overall" in data
        assert "scores_distribution" in data
        assert 0 <= data["overall"] <= 1

    async def test_clean_dataset(
        self, client: AsyncClient, sample_project: dict
    ):
        """Should clean dataset examples."""
        project_id = sample_project["id"]

        # Add examples with issues
        messy_examples = [
            {
                "messages": [
                    {"role": "user", "content": "  Hello   "},  # Extra whitespace
                    {"role": "assistant", "content": "Hi there!"},
                ]
            }
        ]

        await client.post(
            f"/api/v1/datasets/{project_id}/examples",
            json={"examples": messy_examples},
        )

        # Clean
        response = await client.post(
            f"/api/v1/quality/{project_id}/clean",
            json={"operations": ["normalize_whitespace"]},
        )

        assert response.status_code == 200
        data = response.json()
        assert "examples_modified" in data


@pytest.mark.asyncio
class TestDeduplication:
    """Tests for deduplication functionality."""

    async def test_deduplicate_exact(
        self, client: AsyncClient, sample_project: dict
    ):
        """Should find and remove exact duplicate examples."""
        project_id = sample_project["id"]

        # Add duplicate examples
        duplicate_examples = [
            {
                "messages": [
                    {"role": "user", "content": "What is Python?"},
                    {"role": "assistant", "content": "Python is a programming language."},
                ]
            },
            {
                "messages": [
                    {"role": "user", "content": "What is Python?"},
                    {"role": "assistant", "content": "Python is a programming language."},
                ]
            },
            {
                "messages": [
                    {"role": "user", "content": "What is Java?"},
                    {"role": "assistant", "content": "Java is a programming language."},
                ]
            },
        ]

        await client.post(
            f"/api/v1/datasets/{project_id}/examples",
            json={"examples": duplicate_examples},
        )

        # Deduplicate with exact method
        response = await client.post(
            f"/api/v1/quality/{project_id}/deduplicate",
            params={"method": "exact"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["duplicates_removed"] >= 1
        assert data["examples_remaining"] == 2

    async def test_deduplicate_fuzzy(
        self, client: AsyncClient, sample_project: dict
    ):
        """Should remove fuzzy duplicate examples."""
        project_id = sample_project["id"]

        # Add duplicates
        duplicate_examples = [
            {
                "messages": [
                    {"role": "user", "content": "Hello"},
                    {"role": "assistant", "content": "Hi!"},
                ]
            },
            {
                "messages": [
                    {"role": "user", "content": "Hello"},
                    {"role": "assistant", "content": "Hi!"},
                ]
            },
        ]

        await client.post(
            f"/api/v1/datasets/{project_id}/examples",
            json={"examples": duplicate_examples},
        )

        # Deduplicate
        response = await client.post(
            f"/api/v1/quality/{project_id}/deduplicate",
            params={"threshold": 0.9, "method": "fuzzy"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["duplicates_removed"] >= 1

        # Verify count reduced
        response = await client.get(f"/api/v1/datasets/{project_id}/examples")
        assert len(response.json()) == 1
