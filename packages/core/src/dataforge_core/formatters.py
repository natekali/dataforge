"""Dataset formatting and conversion utilities."""

from typing import Any, List

from jinja2 import Template

from dataforge_core.models import CHAT_TEMPLATES, MODEL_REGISTRY
from dataforge_core.types import (
    DatasetFormat,
    Example,
    Message,
    MessageRole,
    ModelConfig,
)


def get_model_config(model_id: str) -> ModelConfig:
    """Get configuration for a model."""
    if model_id not in MODEL_REGISTRY:
        # Try to find by prefix
        for key in MODEL_REGISTRY:
            if model_id.startswith(key) or key.startswith(model_id):
                model_id = key
                break
        else:
            raise ValueError(f"Unknown model: {model_id}")

    model_data = MODEL_REGISTRY[model_id]

    return ModelConfig(
        id=model_id,
        name=model_data.get("name", model_id),
        family=model_id.split("-")[0],
        context_length=model_data.get("context_length", 4096),
        chat_template=model_data.get("chat_template", "chatml"),
        special_tokens=model_data.get("special_tokens", {}),
        supports_system=model_data.get("supports_system", True),
        supports_tools=model_data.get("supports_tools", False),
        supports_vision=model_data.get("supports_vision", False),
    )


def format_for_model(
    messages_or_examples: List[dict] | List[Example],
    model_id: str,
    apply_chat_template: bool = True,
) -> str | List[dict]:
    """
    Format messages or examples for a specific model.

    Args:
        messages_or_examples: Either a list of message dicts [{"role": ..., "content": ...}]
                             or a list of Example objects
        model_id: Target model identifier or template name
        apply_chat_template: If True, applies chat template to produce final text

    Returns:
        If input is messages (list of dicts with role/content): formatted string
        If input is Example objects: List of formatted dictionaries
    """
    # Handle direct messages input (for tests and simple usage)
    if messages_or_examples and isinstance(messages_or_examples[0], dict):
        if "role" in messages_or_examples[0] and "content" in messages_or_examples[0]:
            # This is a list of messages, apply template and return string
            return apply_chat_template_to_messages(messages_or_examples, model_id)

    # Handle Example objects
    examples: List[Example] = messages_or_examples  # type: ignore
    config = get_model_config(model_id)
    template_id = config.chat_template

    formatted = []
    for example in examples:
        # Convert to ChatML format first (internal standard)
        messages = []

        for msg in example.messages:
            # Skip system messages if model doesn't support them
            if msg.role == MessageRole.SYSTEM and not config.supports_system:
                # Prepend to first user message instead
                continue

            messages.append({"role": msg.role.value, "content": msg.content})

        # Handle system message for models that don't support it
        if not config.supports_system:
            system_msgs = [m for m in example.messages if m.role == MessageRole.SYSTEM]
            if system_msgs and messages:
                # Find first user message and prepend system content
                for i, msg in enumerate(messages):
                    if msg["role"] == "user":
                        system_content = "\n\n".join(m.content for m in system_msgs)
                        messages[i]["content"] = f"{system_content}\n\n{msg['content']}"
                        break

        result = {"messages": messages}

        # Apply chat template if requested
        if apply_chat_template and template_id in CHAT_TEMPLATES:
            template_data = CHAT_TEMPLATES[template_id]
            template = Template(template_data["template"])
            result["text"] = template.render(messages=messages)

        # Add metadata
        if example.metadata:
            result["metadata"] = example.metadata

        formatted.append(result)

    return formatted


def apply_chat_template_to_messages(
    messages: List[dict],
    model_or_template_id: str,
) -> str:
    """
    Apply a chat template to a list of messages.

    Args:
        messages: List of message dicts with role/content
        model_or_template_id: Model ID or template identifier

    Returns:
        Formatted string ready for the model
    """
    # Try to get template from model config first
    try:
        config = get_model_config(model_or_template_id)
        template_id = config.chat_template
    except ValueError:
        # Assume it's a direct template ID
        template_id = model_or_template_id

    if template_id not in CHAT_TEMPLATES:
        # Fall back to chatml
        template_id = "chatml"

    template_data = CHAT_TEMPLATES[template_id]
    template = Template(template_data["template"])

    return template.render(messages=messages)


def convert_format(
    examples: List[dict],
    source_format: DatasetFormat,
    target_format: DatasetFormat,
) -> List[dict]:
    """
    Convert examples between formats.

    Supports: Alpaca ↔ ShareGPT ↔ ChatML
    """
    if source_format == target_format:
        return examples

    converted = []

    for item in examples:
        if source_format == DatasetFormat.ALPACA:
            # Convert from Alpaca
            messages = []

            if "system" in item and item["system"]:
                messages.append({"role": "system", "content": item["system"]})

            user_content = item.get("instruction", "")
            if item.get("input"):
                user_content = f"{user_content}\n\n{item['input']}"

            messages.append({"role": "user", "content": user_content})

            if item.get("output"):
                messages.append({"role": "assistant", "content": item["output"]})

            if target_format == DatasetFormat.CHATML:
                converted.append({"messages": messages})
            elif target_format == DatasetFormat.SHAREGPT:
                conversations = []
                for msg in messages:
                    role_map = {"system": "system", "user": "human", "assistant": "gpt"}
                    conversations.append(
                        {"from": role_map[msg["role"]], "value": msg["content"]}
                    )
                converted.append({"conversations": conversations})

        elif source_format == DatasetFormat.SHAREGPT:
            # Convert from ShareGPT
            conversations = item.get("conversations", [])
            messages = []

            for conv in conversations:
                role_map = {"system": "system", "human": "user", "gpt": "assistant"}
                role = role_map.get(conv.get("from", "human"), "user")
                messages.append({"role": role, "content": conv.get("value", "")})

            if target_format == DatasetFormat.CHATML:
                converted.append({"messages": messages})
            elif target_format == DatasetFormat.ALPACA:
                result = _messages_to_alpaca(messages)
                converted.append(result)

        elif source_format == DatasetFormat.CHATML:
            # Convert from ChatML
            messages = item.get("messages", [])

            if target_format == DatasetFormat.ALPACA:
                result = _messages_to_alpaca(messages)
                converted.append(result)
            elif target_format == DatasetFormat.SHAREGPT:
                conversations = []
                for msg in messages:
                    role_map = {"system": "system", "user": "human", "assistant": "gpt"}
                    conversations.append(
                        {"from": role_map.get(msg["role"], "human"), "value": msg["content"]}
                    )
                converted.append({"conversations": conversations})

    return converted


def _messages_to_alpaca(messages: List[dict]) -> dict:
    """Convert messages array to Alpaca format."""
    result = {}

    system_content = []
    user_content = []
    assistant_content = []

    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")

        if role == "system":
            system_content.append(content)
        elif role == "user":
            user_content.append(content)
        elif role == "assistant":
            assistant_content.append(content)

    if system_content:
        result["system"] = "\n\n".join(system_content)

    if user_content:
        # First user message is instruction, rest is input
        result["instruction"] = user_content[0]
        if len(user_content) > 1:
            result["input"] = "\n\n".join(user_content[1:])

    if assistant_content:
        # Take last assistant response as output
        result["output"] = assistant_content[-1]

    return result


def apply_chat_template(
    messages: List[dict],
    template_id: str,
    add_generation_prompt: bool = True,
) -> str:
    """
    Apply a chat template to messages.

    Args:
        messages: List of message dicts with role/content
        template_id: Template identifier from CHAT_TEMPLATES
        add_generation_prompt: Whether to add the generation prompt at the end

    Returns:
        Formatted string ready for the model
    """
    if template_id not in CHAT_TEMPLATES:
        raise ValueError(f"Unknown template: {template_id}")

    template_data = CHAT_TEMPLATES[template_id]
    template = Template(template_data["template"])

    return template.render(messages=messages)


def estimate_tokens(text: str, model_id: str = "gpt-4") -> int:
    """
    Estimate token count for text.

    Uses tiktoken for accurate estimation.
    """
    try:
        import tiktoken

        # Use cl100k_base for most modern models
        encoding = tiktoken.get_encoding("cl100k_base")
        return len(encoding.encode(text))
    except Exception:
        # Fallback: rough estimate
        return len(text) // 4


def validate_context_length(
    examples: List[Example],
    model_id: str,
) -> List[tuple[int, int, int]]:
    """
    Validate examples against model's context length.

    Returns list of (example_index, token_count, max_tokens) for violations.
    """
    config = get_model_config(model_id)
    max_tokens = config.context_length
    violations = []

    for i, example in enumerate(examples):
        # Estimate total tokens
        total_text = " ".join(msg.content for msg in example.messages)
        tokens = estimate_tokens(total_text, model_id)

        if tokens > max_tokens:
            violations.append((i, tokens, max_tokens))

    return violations
