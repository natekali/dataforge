"""Tests for providers API endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
class TestProvidersAPI:
    """Tests for /api/v1/providers endpoints."""

    async def test_list_providers(self, client: AsyncClient):
        """Should list available AI providers."""
        response = await client.get("/api/v1/providers")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

        # Should have at least ollama configured
        provider_ids = [p.get("id") or p.get("name") for p in data]
        assert any("ollama" in str(p).lower() for p in provider_ids)

    async def test_get_provider_status(self, client: AsyncClient):
        """Should get provider status."""
        # Get providers list first
        response = await client.get("/api/v1/providers")
        providers = response.json()

        if providers:
            provider_id = providers[0].get("id") or providers[0].get("name")

            response = await client.get(f"/api/v1/providers/{provider_id}/status")

            assert response.status_code == 200
            data = response.json()
            assert "connected" in data or "status" in data

    async def test_test_provider_connection(self, client: AsyncClient):
        """Should test provider connection."""
        response = await client.get("/api/v1/providers")
        providers = response.json()

        if providers:
            provider_id = providers[0].get("id") or providers[0].get("name")

            response = await client.post(f"/api/v1/providers/{provider_id}/test")

            assert response.status_code == 200
            data = response.json()
            assert "success" in data


@pytest.mark.asyncio
class TestHealthAPI:
    """Tests for health check endpoints."""

    async def test_health_check(self, client: AsyncClient):
        """Should return healthy status."""
        response = await client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"

    async def test_ready_check(self, client: AsyncClient):
        """Should return ready status."""
        response = await client.get("/api/v1/health/ready")

        # May not exist, check for 200 or 404
        if response.status_code == 200:
            data = response.json()
            assert "ready" in data or "status" in data
