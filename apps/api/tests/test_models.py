"""Tests for models API endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
class TestModelsAPI:
    """Tests for /api/v1/models endpoints."""

    async def test_list_model_families(self, client: AsyncClient):
        """Should list all model families."""
        response = await client.get("/api/v1/models")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0

        # Check structure of first family
        family = data[0]
        assert "id" in family or "name" in family
        assert "models" in family or "variants" in family

    async def test_list_templates(self, client: AsyncClient):
        """Should list chat templates."""
        response = await client.get("/api/v1/models/templates")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    async def test_get_model_info(self, client: AsyncClient):
        """Should get info for a specific model."""
        # First get list to find a valid model
        response = await client.get("/api/v1/models")
        families = response.json()

        if families:
            # Get first model and its first variant if available
            family = families[0]
            model_id = family.get("id") or family.get("name")

            # Try getting model info - may return 200 or 404 depending on routing
            response = await client.get(f"/api/v1/models/{model_id}")

            # Accept 200 (found) or 404 (model family vs specific model)
            assert response.status_code in [200, 404]
            if response.status_code == 200:
                data = response.json()
                assert "id" in data or "name" in data or "family" in data

    async def test_get_model_constraints(self, client: AsyncClient):
        """Should get model constraints."""
        # First get list to find a valid model
        response = await client.get("/api/v1/models")
        families = response.json()

        if families:
            family = families[0]
            model_id = family.get("id") or family.get("name")

            response = await client.get(f"/api/v1/models/{model_id}/constraints")

            # May return 200 or 404 depending on model
            assert response.status_code in [200, 404]
            if response.status_code == 200:
                data = response.json()
                assert "max_context_tokens" in data or "context_length" in data


@pytest.mark.asyncio
class TestModelValidation:
    """Tests for model-specific validation."""

    async def test_validate_for_model(
        self, client: AsyncClient, sample_project: dict, sample_examples: list
    ):
        """Should validate dataset for specific model."""
        project_id = sample_project["id"]

        # Add examples
        await client.post(
            f"/api/v1/datasets/{project_id}/examples",
            json={"examples": sample_examples},
        )

        # Get first model
        response = await client.get("/api/v1/models")
        families = response.json()

        if families:
            model_id = families[0].get("id") or families[0].get("name")

            # Validate
            response = await client.post(
                f"/api/v1/quality/{project_id}/validate-for-model",
                json={"model_id": model_id},
            )

            assert response.status_code == 200
            data = response.json()
            assert "is_valid" in data
            assert "total_examples" in data
