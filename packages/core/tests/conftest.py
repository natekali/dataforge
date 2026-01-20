"""Pytest configuration for core tests."""

import pytest


@pytest.fixture
def sample_chatml_examples():
    """Return sample ChatML format examples."""
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
                {"role": "assistant", "content": "Machine learning is a subset of AI."},
            ]
        },
    ]


@pytest.fixture
def sample_alpaca_examples():
    """Return sample Alpaca format examples."""
    return [
        {
            "instruction": "Translate to French",
            "input": "Hello world",
            "output": "Bonjour le monde",
        },
        {
            "instruction": "What is the capital of France?",
            "output": "Paris",
        },
    ]


@pytest.fixture
def sample_sharegpt_examples():
    """Return sample ShareGPT format examples."""
    return [
        {
            "conversations": [
                {"from": "human", "value": "Hello"},
                {"from": "gpt", "value": "Hi there!"},
            ]
        },
        {
            "conversations": [
                {"from": "system", "value": "Be helpful"},
                {"from": "human", "value": "Help me"},
                {"from": "gpt", "value": "Sure!"},
            ]
        },
    ]
