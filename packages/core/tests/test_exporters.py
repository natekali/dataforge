"""Tests for dataset exporters."""

import json
import pytest

from dataforge_core.exporters import (
    export_jsonl,
    export_json,
    generate_training_config,
    TrainingFramework,
)


class TestExportJsonl:
    """Tests for JSONL export."""

    def test_export_basic_jsonl(self):
        """Should export to JSONL format."""
        examples = [
            {"messages": [{"role": "user", "content": "Hi"}]},
            {"messages": [{"role": "user", "content": "Hello"}]},
        ]

        result = export_jsonl(examples)

        lines = result.decode().strip().split("\n")
        assert len(lines) == 2
        assert json.loads(lines[0])["messages"][0]["content"] == "Hi"

    def test_export_empty_list(self):
        """Should handle empty list."""
        result = export_jsonl([])
        assert result == b""

    def test_export_preserves_structure(self):
        """Should preserve full example structure when include_metadata=True."""
        examples = [
            {
                "messages": [
                    {"role": "system", "content": "Be helpful"},
                    {"role": "user", "content": "Question"},
                    {"role": "assistant", "content": "Answer"},
                ],
                "metadata": {"source": "test"},
            }
        ]

        result = export_jsonl(examples, include_metadata=True)
        parsed = json.loads(result.decode().strip())

        assert len(parsed["messages"]) == 3
        assert parsed["metadata"]["source"] == "test"

    def test_export_excludes_metadata_by_default(self):
        """Should exclude metadata by default."""
        examples = [
            {
                "messages": [{"role": "user", "content": "Hi"}],
                "metadata": {"source": "test"},
            }
        ]

        result = export_jsonl(examples)
        parsed = json.loads(result.decode().strip())

        assert "messages" in parsed
        assert "metadata" not in parsed


class TestExportJson:
    """Tests for JSON export."""

    def test_export_basic_json(self):
        """Should export to JSON array."""
        examples = [
            {"messages": [{"role": "user", "content": "Hi"}]},
            {"messages": [{"role": "user", "content": "Hello"}]},
        ]

        result = export_json(examples)
        parsed = json.loads(result.decode())

        assert isinstance(parsed, list)
        assert len(parsed) == 2

    def test_export_pretty_print(self):
        """Should support pretty printing."""
        examples = [{"messages": [{"role": "user", "content": "Hi"}]}]

        result = export_json(examples, pretty=True)

        assert b"\n" in result  # Should have newlines


class TestGenerateTrainingConfig:
    """Tests for training configuration generation."""

    def test_generate_axolotl_config(self):
        """Should generate Axolotl config."""
        config = generate_training_config(
            TrainingFramework.AXOLOTL,
            model_name="llama-3",
            dataset_path="./data.jsonl",
        )

        assert "base_model" in config
        assert "datasets" in config
        assert config["chat_template"] == "llama3"

    def test_generate_unsloth_config(self):
        """Should generate Unsloth config."""
        config = generate_training_config(
            TrainingFramework.UNSLOTH,
            model_name="llama-3-8b",
            dataset_path="./data.jsonl",
        )

        assert "model_name" in config
        assert "dataset_path" in config
        assert "load_in_4bit" in config

    def test_generate_llamafactory_config(self):
        """Should generate LLaMA-Factory config."""
        config = generate_training_config(
            TrainingFramework.LLAMA_FACTORY,
            model_name="qwen3",
            dataset_path="./data.jsonl",
        )

        assert "model_name_or_path" in config
        assert "template" in config

    def test_generate_torchtune_config(self):
        """Should generate Torchtune config."""
        config = generate_training_config(
            TrainingFramework.TORCHTUNE,
            model_name="gemma-3",
            dataset_path="./data.jsonl",
        )

        assert "model" in config
        assert "dataset" in config

    def test_config_includes_hyperparameters(self):
        """Should include training hyperparameters."""
        config = generate_training_config(
            TrainingFramework.AXOLOTL,
            model_name="llama-3",
            dataset_path="./data.jsonl",
            learning_rate=2e-5,
            num_epochs=3,
            batch_size=4,
        )

        assert config.get("learning_rate") == 2e-5 or config.get("micro_batch_size") is not None

    def test_config_model_specific_settings(self):
        """Should include model-specific settings."""
        # Llama 4 has very long context
        config = generate_training_config(
            TrainingFramework.AXOLOTL,
            model_name="llama-4",
            dataset_path="./data.jsonl",
        )

        # Should reflect model capabilities
        assert "sequence_len" in config or "max_length" in config
