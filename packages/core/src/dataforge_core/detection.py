"""Dataset structure detection engine."""

from typing import Any, List, Set

from dataforge_core.types import DatasetFormat, DetectedSchema


# Known field patterns for each format
ALPACA_FIELDS = {"instruction", "output"}
ALPACA_OPTIONAL = {"input", "system", "history"}
SHAREGPT_FIELDS = {"conversations"}
SHAREGPT_CONV_FIELDS = {"from", "value"}
CHATML_FIELDS = {"messages"}
CHATML_MSG_FIELDS = {"role", "content"}

# Common alternative field names
FIELD_ALIASES = {
    "instruction": ["prompt", "question", "query", "input_text", "user"],
    "output": ["response", "answer", "completion", "assistant", "output_text"],
    "input": ["context", "input", "additional_context"],
    "system": ["system_prompt", "system_message"],
}


def detect_schema(data: List[dict]) -> DetectedSchema:
    """
    Analyze dataset structure and detect format.

    Returns DetectedSchema with format, confidence, and suggested mappings.
    """
    if not data:
        return DetectedSchema(
            format=DatasetFormat.CUSTOM,
            confidence=0.0,
            fields=[],
            warnings=["Empty dataset"],
            example_count=0,
        )

    # Analyze field distribution across samples
    sample_size = min(100, len(data))
    samples = data[:sample_size]

    field_counts: dict[str, int] = {}
    nested_structure: dict[str, Set[str]] = {}

    for item in samples:
        if not isinstance(item, dict):
            continue

        for key in item.keys():
            field_counts[key] = field_counts.get(key, 0) + 1

            # Check nested structures
            value = item[key]
            if isinstance(value, list) and value:
                if isinstance(value[0], dict):
                    nested_structure[key] = nested_structure.get(key, set())
                    nested_structure[key].update(value[0].keys())

    # Calculate field presence ratio
    total_samples = len(samples)
    field_presence = {k: v / total_samples for k, v in field_counts.items()}

    # Get all fields present in >50% of samples
    common_fields = set(k for k, v in field_presence.items() if v > 0.5)
    all_fields = list(field_counts.keys())

    # Try to detect format
    format_scores: dict[DatasetFormat, float] = {}

    # Check for ChatML/OpenAI format
    if "messages" in common_fields:
        msg_fields = nested_structure.get("messages", set())
        if CHATML_MSG_FIELDS.issubset(msg_fields):
            format_scores[DatasetFormat.CHATML] = 0.95
        elif msg_fields:
            format_scores[DatasetFormat.CHATML] = 0.7

    # Check for ShareGPT format
    if "conversations" in common_fields:
        conv_fields = nested_structure.get("conversations", set())
        if SHAREGPT_CONV_FIELDS.issubset(conv_fields):
            format_scores[DatasetFormat.SHAREGPT] = 0.95
        elif conv_fields:
            format_scores[DatasetFormat.SHAREGPT] = 0.7

    # Check for Alpaca format
    alpaca_score = 0.0
    if ALPACA_FIELDS.issubset(common_fields):
        alpaca_score = 0.9
        if common_fields.intersection(ALPACA_OPTIONAL):
            alpaca_score = 0.95
    elif "instruction" in common_fields or "output" in common_fields:
        alpaca_score = 0.6

    # Check for aliased Alpaca fields
    aliased_fields = {}
    for target, aliases in FIELD_ALIASES.items():
        for alias in aliases:
            if alias in common_fields:
                aliased_fields[alias] = target
                if alpaca_score < 0.8:
                    alpaca_score = 0.7

    if alpaca_score > 0:
        format_scores[DatasetFormat.ALPACA] = alpaca_score

    # Determine best format
    if format_scores:
        best_format = max(format_scores, key=lambda k: format_scores[k])
        confidence = format_scores[best_format]
    else:
        best_format = DatasetFormat.CUSTOM
        confidence = 0.3

    # Generate warnings
    warnings = []

    # Check for empty fields
    for item in samples[:10]:
        for key, value in item.items():
            if value is None or (isinstance(value, str) and not value.strip()):
                warnings.append(f"Found empty '{key}' field in some examples")
                break

    # Check for inconsistent structure
    if any(v < 0.9 for v in field_presence.values() if v > 0.1):
        warnings.append("Some fields are not present in all examples")

    # Build suggested mapping
    suggested_mapping = None
    if best_format == DatasetFormat.CUSTOM and aliased_fields:
        suggested_mapping = aliased_fields

    # Build field mapping based on detected format
    field_mapping = {}
    if best_format == DatasetFormat.CHATML:
        field_mapping = {"messages": "messages"}
    elif best_format == DatasetFormat.SHAREGPT:
        field_mapping = {"conversations": "conversations"}
    elif best_format == DatasetFormat.ALPACA:
        field_mapping = {"instruction": "instruction", "output": "output"}
        if "input" in common_fields:
            field_mapping["input"] = "input"
    elif aliased_fields:
        field_mapping = aliased_fields

    # Detect system messages
    has_system = False
    total_turns = 0
    turn_count = 0

    for item in samples:
        if "messages" in item:
            messages = item.get("messages", [])
            if any(m.get("role") == "system" for m in messages):
                has_system = True
            # Count turns (user + assistant pairs)
            user_msgs = sum(1 for m in messages if m.get("role") == "user")
            total_turns += user_msgs
            turn_count += 1
        elif "conversations" in item:
            convs = item.get("conversations", [])
            if any(c.get("from") == "system" for c in convs):
                has_system = True
            human_msgs = sum(1 for c in convs if c.get("from") == "human")
            total_turns += human_msgs
            turn_count += 1
        elif "system" in item and item.get("system"):
            has_system = True
            total_turns += 1
            turn_count += 1
        else:
            total_turns += 1
            turn_count += 1

    avg_turns = total_turns / turn_count if turn_count > 0 else 1.0

    return DetectedSchema(
        format=best_format,
        confidence=confidence,
        fields=all_fields,
        warnings=list(set(warnings))[:5],  # Dedupe and limit
        suggested_mapping=suggested_mapping,
        sample_data=samples[:3],
        field_mapping=field_mapping,
        has_system_messages=has_system,
        avg_turns=avg_turns,
        example_count=len(data),
    )


def validate_example(item: dict, format: DatasetFormat) -> List[str]:
    """
    Validate a single example against expected format.

    Returns list of validation errors.
    """
    errors = []

    if format == DatasetFormat.ALPACA:
        if "instruction" not in item:
            errors.append("Missing 'instruction' field")
        elif not item["instruction"].strip():
            errors.append("Empty 'instruction' field")

        if "output" not in item:
            errors.append("Missing 'output' field")
        elif not item["output"].strip():
            errors.append("Empty 'output' field")

    elif format == DatasetFormat.SHAREGPT:
        if "conversations" not in item:
            errors.append("Missing 'conversations' field")
        elif not isinstance(item["conversations"], list):
            errors.append("'conversations' must be an array")
        elif len(item["conversations"]) == 0:
            errors.append("Empty 'conversations' array")
        else:
            for i, conv in enumerate(item["conversations"]):
                if "from" not in conv:
                    errors.append(f"Conversation {i}: missing 'from' field")
                if "value" not in conv:
                    errors.append(f"Conversation {i}: missing 'value' field")

    elif format in (DatasetFormat.CHATML, DatasetFormat.OPENAI):
        if "messages" not in item:
            errors.append("Missing 'messages' field")
        elif not isinstance(item["messages"], list):
            errors.append("'messages' must be an array")
        elif len(item["messages"]) == 0:
            errors.append("Empty 'messages' array")
        else:
            for i, msg in enumerate(item["messages"]):
                if "role" not in msg:
                    errors.append(f"Message {i}: missing 'role' field")
                if "content" not in msg:
                    errors.append(f"Message {i}: missing 'content' field")

    return errors


def suggest_format_conversion(
    source_format: DatasetFormat, target_format: DatasetFormat
) -> dict[str, str]:
    """
    Suggest field mappings for format conversion.
    """
    if source_format == target_format:
        return {}

    if source_format == DatasetFormat.ALPACA:
        if target_format == DatasetFormat.SHAREGPT:
            return {
                "instruction": "conversations[0].value (from: human)",
                "output": "conversations[1].value (from: gpt)",
                "system": "conversations[0].value (from: system, prepend)",
            }
        elif target_format == DatasetFormat.CHATML:
            return {
                "instruction": "messages[0].content (role: user)",
                "output": "messages[1].content (role: assistant)",
                "system": "messages[0].content (role: system, prepend)",
            }

    elif source_format == DatasetFormat.SHAREGPT:
        if target_format == DatasetFormat.ALPACA:
            return {
                "conversations[human]": "instruction",
                "conversations[gpt]": "output",
                "conversations[system]": "system",
            }
        elif target_format == DatasetFormat.CHATML:
            return {
                "conversations[*].from": "messages[*].role (human→user, gpt→assistant)",
                "conversations[*].value": "messages[*].content",
            }

    elif source_format == DatasetFormat.CHATML:
        if target_format == DatasetFormat.ALPACA:
            return {
                "messages[user]": "instruction",
                "messages[assistant]": "output",
                "messages[system]": "system",
            }
        elif target_format == DatasetFormat.SHAREGPT:
            return {
                "messages[*].role": "conversations[*].from (user→human, assistant→gpt)",
                "messages[*].content": "conversations[*].value",
            }

    return {}
