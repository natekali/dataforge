"""Tests for dataset schema detection."""

import pytest

from dataforge_core.detection import detect_schema, DatasetFormat


class TestDetectSchema:
    """Tests for detect_schema function."""

    def test_detect_chatml_format(self):
        """Should detect ChatML/OpenAI format."""
        examples = [
            {
                "messages": [
                    {"role": "system", "content": "You are helpful."},
                    {"role": "user", "content": "Hello"},
                    {"role": "assistant", "content": "Hi there!"},
                ]
            },
            {
                "messages": [
                    {"role": "user", "content": "What is 2+2?"},
                    {"role": "assistant", "content": "4"},
                ]
            },
        ]

        schema = detect_schema(examples)

        assert schema.format == DatasetFormat.CHATML
        assert schema.has_system_messages == True
        assert "messages" in schema.field_mapping

    def test_detect_alpaca_format(self):
        """Should detect Alpaca format."""
        examples = [
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

        schema = detect_schema(examples)

        assert schema.format == DatasetFormat.ALPACA
        assert "instruction" in schema.field_mapping
        assert "output" in schema.field_mapping

    def test_detect_sharegpt_format(self):
        """Should detect ShareGPT format."""
        examples = [
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

        schema = detect_schema(examples)

        assert schema.format == DatasetFormat.SHAREGPT
        assert "conversations" in schema.field_mapping

    def test_detect_custom_format(self):
        """Should detect custom prompt/response format as Alpaca-compatible."""
        examples = [
            {"prompt": "What is AI?", "response": "Artificial Intelligence..."},
            {"prompt": "Explain ML", "response": "Machine Learning is..."},
        ]

        schema = detect_schema(examples)

        # prompt/response is detected as Alpaca-compatible (aliased fields)
        assert schema.format == DatasetFormat.ALPACA
        assert "prompt" in schema.fields
        assert "response" in schema.fields

    def test_detect_question_answer_format(self):
        """Should detect Q&A format as Alpaca-compatible."""
        examples = [
            {"question": "What is Python?", "answer": "A programming language"},
            {"question": "Who created Python?", "answer": "Guido van Rossum"},
        ]

        schema = detect_schema(examples)

        # question/answer is detected as Alpaca-compatible (aliased fields)
        assert schema.format == DatasetFormat.ALPACA
        assert "question" in schema.fields
        assert "answer" in schema.fields

    def test_empty_examples(self):
        """Should handle empty examples list."""
        schema = detect_schema([])

        assert schema.format == DatasetFormat.CUSTOM
        assert schema.example_count == 0

    def test_single_example(self):
        """Should handle single example."""
        examples = [
            {
                "messages": [
                    {"role": "user", "content": "Hello"},
                    {"role": "assistant", "content": "Hi"},
                ]
            }
        ]

        schema = detect_schema(examples)

        assert schema.format == DatasetFormat.CHATML
        assert schema.example_count == 1

    def test_mixed_format_fallback(self):
        """Should fall back to custom for mixed formats."""
        examples = [
            {"text": "Some text"},
            {"data": "Some data"},
            {"content": "Some content"},
        ]

        schema = detect_schema(examples)

        assert schema.format == DatasetFormat.CUSTOM

    def test_detects_multi_turn(self):
        """Should detect multi-turn conversations."""
        examples = [
            {
                "messages": [
                    {"role": "user", "content": "Hi"},
                    {"role": "assistant", "content": "Hello"},
                    {"role": "user", "content": "How are you?"},
                    {"role": "assistant", "content": "I'm good!"},
                ]
            }
        ]

        schema = detect_schema(examples)

        assert schema.avg_turns > 1
