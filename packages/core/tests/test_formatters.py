"""Tests for model-aware formatters."""

import pytest

from dataforge_core.formatters import (
    format_for_model,
    convert_format,
    DatasetFormat,
)


class TestFormatForModel:
    """Tests for format_for_model function."""

    def test_format_llama3_messages(self):
        """Should format for Llama 3 chat template."""
        messages = [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there!"},
        ]

        result = format_for_model(messages, "llama-3")

        assert "<|begin_of_text|>" in result
        assert "<|start_header_id|>system<|end_header_id|>" in result
        assert "<|start_header_id|>user<|end_header_id|>" in result
        assert "<|start_header_id|>assistant<|end_header_id|>" in result
        assert "You are helpful." in result
        assert "Hello" in result
        assert "Hi there!" in result

    def test_format_chatml_messages(self):
        """Should format for ChatML template."""
        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi!"},
        ]

        result = format_for_model(messages, "chatml")

        assert "<|im_start|>user" in result
        assert "<|im_end|>" in result
        assert "<|im_start|>assistant" in result

    def test_format_qwen_messages(self):
        """Should format for Qwen template."""
        messages = [
            {"role": "system", "content": "Be concise."},
            {"role": "user", "content": "What is AI?"},
        ]

        result = format_for_model(messages, "qwen")

        assert "<|im_start|>system" in result
        assert "Be concise." in result

    def test_format_without_system(self):
        """Should handle messages without system prompt."""
        messages = [
            {"role": "user", "content": "Hi"},
            {"role": "assistant", "content": "Hello"},
        ]

        result = format_for_model(messages, "llama-3")

        assert "user" in result.lower()
        assert "assistant" in result.lower()

    def test_format_multi_turn(self):
        """Should format multi-turn conversation."""
        messages = [
            {"role": "user", "content": "Hi"},
            {"role": "assistant", "content": "Hello!"},
            {"role": "user", "content": "How are you?"},
            {"role": "assistant", "content": "I'm good!"},
        ]

        result = format_for_model(messages, "llama-3")

        assert result.count("user") >= 2
        assert result.count("assistant") >= 2


class TestConvertFormat:
    """Tests for format conversion."""

    def test_convert_alpaca_to_chatml(self):
        """Should convert Alpaca to ChatML format."""
        examples = [
            {
                "instruction": "Translate to French",
                "input": "Hello",
                "output": "Bonjour",
            }
        ]

        result = convert_format(examples, DatasetFormat.ALPACA, DatasetFormat.CHATML)

        assert len(result) == 1
        assert "messages" in result[0]
        messages = result[0]["messages"]
        assert any(m["role"] == "user" for m in messages)
        assert any(m["role"] == "assistant" for m in messages)

    def test_convert_sharegpt_to_chatml(self):
        """Should convert ShareGPT to ChatML format."""
        examples = [
            {
                "conversations": [
                    {"from": "human", "value": "Hello"},
                    {"from": "gpt", "value": "Hi!"},
                ]
            }
        ]

        result = convert_format(examples, DatasetFormat.SHAREGPT, DatasetFormat.CHATML)

        assert len(result) == 1
        assert "messages" in result[0]
        messages = result[0]["messages"]
        assert messages[0]["role"] == "user"
        assert messages[1]["role"] == "assistant"

    def test_convert_chatml_to_alpaca(self):
        """Should convert ChatML to Alpaca format."""
        examples = [
            {
                "messages": [
                    {"role": "system", "content": "Be helpful"},
                    {"role": "user", "content": "Translate: Hello"},
                    {"role": "assistant", "content": "Bonjour"},
                ]
            }
        ]

        result = convert_format(examples, DatasetFormat.CHATML, DatasetFormat.ALPACA)

        assert len(result) == 1
        assert "instruction" in result[0]
        assert "output" in result[0]
        assert result[0]["output"] == "Bonjour"

    def test_convert_preserves_system(self):
        """Should preserve system message when converting."""
        examples = [
            {
                "messages": [
                    {"role": "system", "content": "Be concise"},
                    {"role": "user", "content": "Hi"},
                    {"role": "assistant", "content": "Hello"},
                ]
            }
        ]

        result = convert_format(examples, DatasetFormat.CHATML, DatasetFormat.ALPACA)

        assert result[0].get("system") == "Be concise"

    def test_convert_same_format(self):
        """Should return unchanged for same format."""
        examples = [
            {
                "messages": [
                    {"role": "user", "content": "Hi"},
                    {"role": "assistant", "content": "Hello"},
                ]
            }
        ]

        result = convert_format(examples, DatasetFormat.CHATML, DatasetFormat.CHATML)

        assert result == examples

    def test_convert_empty_list(self):
        """Should handle empty list."""
        result = convert_format([], DatasetFormat.ALPACA, DatasetFormat.CHATML)
        assert result == []
