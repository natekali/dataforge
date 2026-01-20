"""Tests for model registry."""

import pytest

from dataforge_core.models import (
    MODEL_REGISTRY,
    get_model_info,
    get_chat_template,
    list_models,
    get_models_by_family,
)


class TestModelRegistry:
    """Tests for model registry functions."""

    def test_registry_has_2025_models(self):
        """Should include 2025 frontier models."""
        assert "llama-4" in MODEL_REGISTRY
        assert "qwen3" in MODEL_REGISTRY
        assert "gemma-3" in MODEL_REGISTRY
        assert "deepseek-r1" in MODEL_REGISTRY

    def test_get_model_info(self):
        """Should return model info."""
        info = get_model_info("llama-3")

        assert info is not None
        assert "context_length" in info
        assert "chat_template" in info
        assert info["context_length"] > 0

    def test_get_model_info_unknown(self):
        """Should return None for unknown model."""
        info = get_model_info("unknown-model-xyz")

        assert info is None

    def test_get_chat_template(self):
        """Should return chat template."""
        template = get_chat_template("llama-3")

        assert template is not None
        assert "user" in str(template) or callable(template)

    def test_list_models(self):
        """Should list all models."""
        models = list_models()

        assert len(models) > 0
        # llama-3.x variants exist, not "llama-3" exactly
        assert any("llama-3" in m for m in models)
        assert "llama-4" in models

    def test_get_models_by_family(self):
        """Should filter models by family."""
        llama_models = get_models_by_family("llama")

        assert len(llama_models) > 0
        assert all("llama" in m.lower() for m in llama_models)

    def test_model_has_required_fields(self):
        """All models should have required fields."""
        required_fields = ["context_length", "chat_template"]

        for model_name, info in MODEL_REGISTRY.items():
            for field in required_fields:
                assert field in info, f"{model_name} missing {field}"

    def test_context_lengths_are_positive(self):
        """All context lengths should be positive."""
        for model_name, info in MODEL_REGISTRY.items():
            assert info["context_length"] > 0, f"{model_name} has invalid context length"

    def test_llama4_has_extended_context(self):
        """Llama 4 should have very long context."""
        info = get_model_info("llama-4")

        # Llama 4 is known for 10M+ context
        assert info["context_length"] >= 1_000_000

    def test_deepseek_r1_has_reasoning_flag(self):
        """DeepSeek R1 should indicate reasoning capability."""
        info = get_model_info("deepseek-r1")

        # Should have some indicator of reasoning capability
        assert info is not None
        # Either through supports_thinking flag or recommended_for contains "reasoning"
        assert (
            info.get("supports_thinking")
            or "reasoning" in info.get("recommended_for", [])
            or info.get("chat_template") == "deepseek-r1"
        )
