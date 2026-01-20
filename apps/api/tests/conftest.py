"""Pytest fixtures for API tests."""

import asyncio
import os
import tempfile
from typing import AsyncGenerator, Generator

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

# Set test database path before importing app
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./test_dataforge.db"

from dataforge_api.main import app
from dataforge_api import database as db


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    """Create event loop for async tests."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """Create test client."""
    # Initialize database
    await db.init_db()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    # Cleanup - remove test database
    try:
        os.remove("./test_dataforge.db")
    except FileNotFoundError:
        pass


@pytest_asyncio.fixture
async def sample_project(client: AsyncClient) -> dict:
    """Create a sample project for testing."""
    response = await client.post(
        "/api/v1/projects",
        json={
            "name": "Test Project",
            "description": "A test project",
            "target_model": "llama-3",
        },
    )
    return response.json()


@pytest_asyncio.fixture
async def sample_examples() -> list[dict]:
    """Return sample examples for testing."""
    return [
        {
            "messages": [
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "What is Python?"},
                {"role": "assistant", "content": "Python is a high-level programming language."},
            ]
        },
        {
            "messages": [
                {"role": "user", "content": "Explain machine learning."},
                {"role": "assistant", "content": "Machine learning is a subset of AI that enables systems to learn from data."},
            ]
        },
        {
            "messages": [
                {"role": "user", "content": "What is 2+2?"},
                {"role": "assistant", "content": "2+2 equals 4."},
            ]
        },
    ]
