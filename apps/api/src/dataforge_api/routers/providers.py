"""AI provider management endpoints."""


from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class ProviderConfig(BaseModel):
    """Configuration for an AI provider."""

    id: str
    name: str
    type: str  # ollama, openai, anthropic
    enabled: bool
    base_url: str | None = None
    models: list[str] = []


class ProviderStatus(BaseModel):
    """Status of an AI provider."""

    id: str
    connected: bool
    available_models: list[str]
    error: str | None = None


class ProviderTestResult(BaseModel):
    """Result of testing a provider connection."""

    success: bool
    latency_ms: float | None = None
    error: str | None = None


@router.get("", response_model=list[ProviderConfig])
async def list_providers() -> list[ProviderConfig]:
    """List all configured AI providers."""
    from dataforge_api.config import settings

    providers = []

    # Ollama (local)
    providers.append(
        ProviderConfig(
            id="ollama",
            name="Ollama",
            type="ollama",
            enabled=True,
            base_url=settings.ollama_base_url,
            models=[],
        )
    )

    # OpenAI
    providers.append(
        ProviderConfig(
            id="openai",
            name="OpenAI",
            type="openai",
            enabled=settings.openai_api_key is not None,
            models=["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
        )
    )

    # Anthropic
    providers.append(
        ProviderConfig(
            id="anthropic",
            name="Anthropic",
            type="anthropic",
            enabled=settings.anthropic_api_key is not None,
            models=["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
        )
    )

    return providers


@router.get("/{provider_id}/status", response_model=ProviderStatus)
async def get_provider_status(provider_id: str) -> ProviderStatus:
    """Get the status of a specific provider."""
    import httpx

    from dataforge_api.config import settings

    if provider_id == "ollama":
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{settings.ollama_base_url}/api/tags",
                    timeout=5.0,
                )
                if response.status_code == 200:
                    data = response.json()
                    models = [m["name"] for m in data.get("models", [])]
                    return ProviderStatus(
                        id="ollama",
                        connected=True,
                        available_models=models,
                    )
        except Exception as e:
            return ProviderStatus(
                id="ollama",
                connected=False,
                available_models=[],
                error=str(e),
            )

    elif provider_id == "openai":
        if settings.openai_api_key:
            return ProviderStatus(
                id="openai",
                connected=True,
                available_models=["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
            )
        return ProviderStatus(
            id="openai",
            connected=False,
            available_models=[],
            error="API key not configured",
        )

    elif provider_id == "anthropic":
        if settings.anthropic_api_key:
            return ProviderStatus(
                id="anthropic",
                connected=True,
                available_models=["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
            )
        return ProviderStatus(
            id="anthropic",
            connected=False,
            available_models=[],
            error="API key not configured",
        )

    raise HTTPException(status_code=404, detail=f"Provider {provider_id} not found")


@router.post("/{provider_id}/test", response_model=ProviderTestResult)
async def test_provider(provider_id: str) -> ProviderTestResult:
    """Test connection to a provider."""
    import time

    import httpx

    from dataforge_api.config import settings

    start_time = time.time()

    if provider_id == "ollama":
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{settings.ollama_base_url}/api/tags",
                    timeout=10.0,
                )
                latency = (time.time() - start_time) * 1000
                if response.status_code == 200:
                    return ProviderTestResult(success=True, latency_ms=latency)
                return ProviderTestResult(
                    success=False,
                    latency_ms=latency,
                    error=f"HTTP {response.status_code}",
                )
        except Exception as e:
            return ProviderTestResult(success=False, error=str(e))

    elif provider_id == "openai":
        if not settings.openai_api_key:
            return ProviderTestResult(success=False, error="API key not configured")

        try:
            from litellm import acompletion

            await acompletion(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": "Hi"}],
                max_tokens=1,
            )
            latency = (time.time() - start_time) * 1000
            return ProviderTestResult(success=True, latency_ms=latency)
        except Exception as e:
            return ProviderTestResult(success=False, error=str(e))

    elif provider_id == "anthropic":
        if not settings.anthropic_api_key:
            return ProviderTestResult(success=False, error="API key not configured")

        try:
            from litellm import acompletion

            await acompletion(
                model="claude-3-5-haiku-20241022",
                messages=[{"role": "user", "content": "Hi"}],
                max_tokens=1,
            )
            latency = (time.time() - start_time) * 1000
            return ProviderTestResult(success=True, latency_ms=latency)
        except Exception as e:
            return ProviderTestResult(success=False, error=str(e))

    raise HTTPException(status_code=404, detail=f"Provider {provider_id} not found")


@router.get("/ollama/models", response_model=list[str])
async def list_ollama_models() -> list[str]:
    """List available Ollama models."""
    import httpx

    from dataforge_api.config import settings

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{settings.ollama_base_url}/api/tags",
                timeout=5.0,
            )
            if response.status_code == 200:
                data = response.json()
                return [m["name"] for m in data.get("models", [])]
    except Exception:
        pass

    return []
