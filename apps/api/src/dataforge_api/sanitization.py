"""Input sanitization to prevent prompt injection and other security issues."""

import html
import re
from typing import Any


def sanitize_for_llm(input_text: str, max_length: int = 100_000) -> str:
    """
    Sanitize text for safe use in LLM prompts.

    Args:
        input_text: User-provided text to sanitize
        max_length: Maximum allowed length

    Returns:
        Sanitized text safe for LLM use
    """
    if not input_text or not isinstance(input_text, str):
        return ""

    # Remove null bytes and other control characters
    sanitized = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]", "", input_text)

    # Limit length
    if len(sanitized) > max_length:
        sanitized = sanitized[:max_length]

    return sanitized.strip()


def sanitize_json_input(input_text: str) -> str:
    """Sanitize text that will be parsed as JSON."""
    if not input_text:
        return ""

    # Remove control characters that can break JSON parsing
    sanitized = re.sub(r"[\x00-\x1f\x7f-\x9f]", "", input_text)

    return sanitized.strip()


def detect_prompt_injection(input_text: str) -> bool:
    """
    Detect potential prompt injection attempts.

    Args:
        input_text: User-provided text to check

    Returns:
        True if potential injection detected
    """
    if not input_text or not isinstance(input_text, str):
        return False

    text_lower = input_text.lower()

    # Check for common injection patterns
    injection_patterns = [
        r"ignore\s+(all\s+)?(previous\s+)?(commands?|instructions?)",
        r"(forget|override)\s+(all\s+)?(previous\s+)?(commands?|instructions?|prompts?)",
        r"new\s+(page|session)",
        r"system\s*:\s*",
        r"(escape|bypass|skip)\s+(the\s+)?(prompt|instruction)",
        r"act\s+as\s+(a\s+)?(different|new)",
        r"pretend\s+to\s+be",
        r"roleplay\s+as",
        r"jailbreak",
        r"(dan|developer|assistant)\s+mode",
        r"<\|.*?\|>",  # Special token patterns
        r"<<.*?>>",  # Nested brackets
    ]

    for pattern in injection_patterns:
        if re.search(pattern, text_lower, re.IGNORECASE):
            return True

    # Check for excessive special characters (might be obfuscation)
    special_char_ratio = len(re.findall(r"[^a-zA-Z0-9\s.,!?]", text_lower)) / max(
        len(text_lower), 1
    )
    if special_char_ratio > 0.5:
        return True

    # Check for repeated patterns (flooding)
    return bool(re.search(r"(.)\1{20,}", input_text))


def sanitize_dataset_message(message: dict[str, Any]) -> dict[str, Any]:
    """Sanitize a single message object in a dataset."""
    if not isinstance(message, dict):
        return message

    sanitized = message.copy()

    # Sanitize role
    if "role" in sanitized:
        role = str(sanitized["role"]).lower().strip()
        # Only allow standard roles
        allowed_roles = {"system", "user", "assistant", "function", "tool"}
        if role not in allowed_roles:
            sanitized["role"] = "user"

    # Sanitize content
    if "content" in sanitized:
        if isinstance(sanitized["content"], str):
            sanitized["content"] = sanitize_for_llm(sanitized["content"])
        else:
            # Convert non-string content to string
            sanitized["content"] = sanitize_for_llm(str(sanitized["content"]))

    # Remove dangerous fields
    dangerous_fields = ["system", "prompt", "instruction", "ignore"]
    for field in dangerous_fields:
        if field in sanitized and field not in ("role", "content"):
            del sanitized[field]

    return sanitized


def sanitize_dataset_examples(examples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sanitize a list of dataset examples."""
    if not examples:
        return []

    sanitized_examples = []
    for ex in examples:
        if not isinstance(ex, dict):
            continue

        sanitized = ex.copy()

        # Sanitize messages
        if "messages" in sanitized and isinstance(sanitized["messages"], list):
            sanitized["messages"] = [sanitize_dataset_message(msg) for msg in sanitized["messages"]]

        # Sanitize common dataset fields
        for field in ["instruction", "input", "output", "prompt", "response", "question", "answer"]:
            if field in sanitized and isinstance(sanitized[field], str):
                sanitized[field] = sanitize_for_llm(sanitized[field])

        # Remove metadata fields that could be malicious
        if "metadata" in sanitized and isinstance(sanitized["metadata"], dict):
            safe_metadata = {}
            for key, value in sanitized["metadata"].items():
                # Only allow alphanumeric, underscore, hyphen keys
                if re.match(r"^[a-zA-Z0-9_-]+$", key):
                    if isinstance(value, str):
                        safe_metadata[key] = sanitize_for_llm(value, max_length=1000)
                    elif isinstance(value, (int, float, bool)):
                        safe_metadata[key] = value
            sanitized["metadata"] = safe_metadata

        sanitized_examples.append(sanitized)

    return sanitized_examples


def validate_user_input(input_text: str, field_name: str) -> tuple[bool, str | None]:
    """
    Validate user input and return (is_valid, error_message).

    Args:
        input_text: User input to validate
        field_name: Name of the field (for error messages)

    Returns:
        Tuple of (is_valid, error_message)
    """
    if not isinstance(input_text, str):
        return False, f"{field_name} must be a string"

    if len(input_text) > 100_000:
        return False, f"{field_name} is too long (max 100,000 characters)"

    if len(input_text) < 1:
        return False, f"{field_name} cannot be empty"

    # Check for prompt injection
    if detect_prompt_injection(input_text):
        return False, f"{field_name} contains potentially malicious content"

    return True, None


def escape_html_content(content: str) -> str:
    """Escape HTML content to prevent XSS."""
    return html.escape(content, quote=True)


def sanitize_filename(filename: str) -> str:
    """Sanitize filename to prevent directory traversal."""
    if not isinstance(filename, str):
        return "file.txt"

    # Remove path separators
    sanitized = filename.replace("/", "").replace("\\", "").replace("..", "")

    # Remove dangerous characters
    sanitized = re.sub(r'["<>|:*?]', "", sanitized)

    # Limit length
    sanitized = sanitized[:255]

    # Ensure it has a name
    if not sanitized.strip():
        sanitized = "file.txt"

    return sanitized.strip()
