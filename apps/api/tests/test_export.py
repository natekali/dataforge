"""Tests for export API endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
class TestExportAPI:
    """Tests for /api/v1/export endpoints."""

    async def test_list_export_formats(self, client: AsyncClient):
        """Should list available export formats."""
        response = await client.get("/api/v1/export/formats")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # Should include common formats
        format_ids = [f.get("id") or f.get("name") for f in data]
        assert any("jsonl" in str(f).lower() for f in format_ids)

    async def test_export_dataset_jsonl(
        self, client: AsyncClient, sample_project: dict, sample_examples: list
    ):
        """Should export dataset as JSONL."""
        project_id = sample_project["id"]

        # Add examples
        await client.post(
            f"/api/v1/datasets/{project_id}/examples",
            json={"examples": sample_examples},
        )

        # Export
        response = await client.post(
            f"/api/v1/export/{project_id}",
            json={"format": "jsonl", "target_model": "llama-3"},
        )

        assert response.status_code == 200
        # Should return a ZIP file
        assert response.headers.get("content-type") in [
            "application/zip",
            "application/octet-stream",
        ]

    async def test_export_preview(
        self, client: AsyncClient, sample_project: dict, sample_examples: list
    ):
        """Should preview export without downloading."""
        project_id = sample_project["id"]

        # Add examples
        await client.post(
            f"/api/v1/datasets/{project_id}/examples",
            json={"examples": sample_examples},
        )

        # Preview export
        response = await client.post(
            f"/api/v1/export/{project_id}/preview",
            json={"format": "jsonl", "target_model": "llama-3"},
            params={"num_examples": 2},
        )

        assert response.status_code == 200
        data = response.json()
        assert "examples" in data


@pytest.mark.asyncio
class TestExportFormats:
    """Tests for different export formats."""

    async def test_export_axolotl(
        self, client: AsyncClient, sample_project: dict, sample_examples: list
    ):
        """Should export in Axolotl format."""
        project_id = sample_project["id"]

        await client.post(
            f"/api/v1/datasets/{project_id}/examples",
            json={"examples": sample_examples},
        )

        response = await client.post(
            f"/api/v1/export/{project_id}",
            json={"format": "axolotl", "target_model": "llama-3", "generate_config": True},
        )

        assert response.status_code == 200

    async def test_export_sharegpt(
        self, client: AsyncClient, sample_project: dict, sample_examples: list
    ):
        """Should export in ShareGPT format."""
        project_id = sample_project["id"]

        await client.post(
            f"/api/v1/datasets/{project_id}/examples",
            json={"examples": sample_examples},
        )

        response = await client.post(
            f"/api/v1/export/{project_id}",
            json={"format": "sharegpt", "target_model": "llama-3"},
        )

        assert response.status_code == 200
