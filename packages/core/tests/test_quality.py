"""Tests for quality validation and scoring."""

import pytest

from dataforge_core.quality import (
    validate_example,
    score_example,
    clean_example,
    ValidationResult,
)


class TestValidateExample:
    """Tests for example validation."""

    def test_valid_example(self):
        """Should pass valid example."""
        example = {
            "messages": [
                {"role": "user", "content": "What is Python?"},
                {"role": "assistant", "content": "Python is a programming language."},
            ]
        }

        result = validate_example(example)

        assert result.is_valid == True
        assert len(result.errors) == 0

    def test_empty_messages(self):
        """Should fail for empty messages."""
        example = {"messages": []}

        result = validate_example(example)

        assert result.is_valid == False
        assert any("empty" in e.lower() for e in result.errors)

    def test_missing_messages_key(self):
        """Should fail for missing messages key."""
        example = {"data": []}

        result = validate_example(example)

        assert result.is_valid == False

    def test_empty_content(self):
        """Should warn for empty content."""
        example = {
            "messages": [
                {"role": "user", "content": ""},
                {"role": "assistant", "content": "Response"},
            ]
        }

        result = validate_example(example)

        assert len(result.warnings) > 0 or result.is_valid == False

    def test_missing_assistant(self):
        """Should warn for missing assistant response."""
        example = {
            "messages": [
                {"role": "user", "content": "Hello"},
            ]
        }

        result = validate_example(example)

        assert len(result.warnings) > 0

    def test_invalid_role(self):
        """Should warn for invalid roles."""
        example = {
            "messages": [
                {"role": "human", "content": "Hello"},  # Should be 'user'
                {"role": "assistant", "content": "Hi"},
            ]
        }

        result = validate_example(example)

        # Should either fix or warn
        assert result.is_valid or len(result.warnings) > 0


class TestScoreExample:
    """Tests for quality scoring."""

    def test_high_quality_example(self):
        """Should score high for good example."""
        example = {
            "messages": [
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "Explain how machine learning works in simple terms."},
                {"role": "assistant", "content": "Machine learning is a type of artificial intelligence that allows computers to learn from data without being explicitly programmed. Instead of writing specific rules, we show the computer many examples, and it finds patterns. For instance, to recognize cats in photos, we'd show thousands of cat pictures, and the computer learns the common features. There are three main types: supervised learning (with labeled examples), unsupervised learning (finding patterns without labels), and reinforcement learning (learning through trial and error with rewards)."},
            ]
        }

        score = score_example(example)

        assert score.overall >= 0.7
        assert score.completeness >= 0.8

    def test_low_quality_short_response(self):
        """Should score lower for very short responses."""
        example = {
            "messages": [
                {"role": "user", "content": "Explain quantum computing in detail."},
                {"role": "assistant", "content": "It's fast."},
            ]
        }

        score = score_example(example)

        assert score.overall < 0.7
        assert score.length_balance < 0.5

    def test_empty_example_low_score(self):
        """Should score very low for empty/minimal content."""
        example = {
            "messages": [
                {"role": "user", "content": "Hi"},
                {"role": "assistant", "content": "Hello"},
            ]
        }

        score = score_example(example)

        # Very short exchanges should score lower
        assert score.overall < 0.9

    def test_score_components(self):
        """Should provide component scores."""
        example = {
            "messages": [
                {"role": "user", "content": "What is 2+2?"},
                {"role": "assistant", "content": "2+2 equals 4."},
            ]
        }

        score = score_example(example)

        # All component scores should be between 0 and 1
        assert 0 <= score.completeness <= 1
        assert 0 <= score.formatting <= 1
        assert 0 <= score.length_balance <= 1
        assert 0 <= score.content_quality <= 1
        assert 0 <= score.overall <= 1


class TestCleanExample:
    """Tests for example cleaning."""

    def test_trim_whitespace(self):
        """Should trim excessive whitespace."""
        example = {
            "messages": [
                {"role": "user", "content": "  Hello   world  "},
                {"role": "assistant", "content": "Hi\n\n\n\nthere"},
            ]
        }

        cleaned = clean_example(example)

        assert cleaned["messages"][0]["content"] == "Hello   world"
        assert "\n\n\n\n" not in cleaned["messages"][1]["content"]

    def test_normalize_roles(self):
        """Should normalize role names."""
        example = {
            "messages": [
                {"role": "human", "content": "Hello"},
                {"role": "gpt", "content": "Hi"},
            ]
        }

        cleaned = clean_example(example)

        assert cleaned["messages"][0]["role"] == "user"
        assert cleaned["messages"][1]["role"] == "assistant"

    def test_remove_empty_messages(self):
        """Should optionally remove empty messages."""
        example = {
            "messages": [
                {"role": "user", "content": "Hello"},
                {"role": "assistant", "content": ""},
                {"role": "user", "content": "Anyone there?"},
                {"role": "assistant", "content": "Yes!"},
            ]
        }

        cleaned = clean_example(example, remove_empty=True)

        assert len(cleaned["messages"]) < 4

    def test_preserve_valid_content(self):
        """Should preserve valid content unchanged."""
        example = {
            "messages": [
                {"role": "user", "content": "What is the capital of France?"},
                {"role": "assistant", "content": "The capital of France is Paris."},
            ]
        }

        cleaned = clean_example(example)

        assert cleaned["messages"][0]["content"] == example["messages"][0]["content"]
        assert cleaned["messages"][1]["content"] == example["messages"][1]["content"]

    def test_clean_special_characters(self):
        """Should handle special characters appropriately."""
        example = {
            "messages": [
                {"role": "user", "content": "Test\x00null\x00chars"},
                {"role": "assistant", "content": "Response"},
            ]
        }

        cleaned = clean_example(example)

        # Should remove null characters
        assert "\x00" not in cleaned["messages"][0]["content"]
