"""Model registry and chat templates for 2025 models."""

from typing import Any

# =============================================================================
# MODEL REGISTRY - 2025 Models
# =============================================================================

MODEL_REGISTRY: dict[str, dict[str, Any]] = {
    # =========================================================================
    # META LLAMA FAMILY
    # =========================================================================
    "llama-4": {
        "name": "Llama 4",
        "provider": "Meta",
        "variants": ["scout", "maverick"],
        "context_length": 10_000_000,  # 10M context
        "chat_template": "llama-4",
        "special_tokens": {
            "bos": "<|begin_of_text|>",
            "eos": "<|eot_id|>",
            "header_start": "<|header_start|>",
            "header_end": "<|header_end|>",
        },
        "supports_system": True,
        "supports_tools": True,
        "supports_vision": True,
        "license": "Llama 4 Community License",
    },
    "llama-3.3": {
        "name": "Llama 3.3",
        "provider": "Meta",
        "variants": ["70b"],
        "context_length": 128_000,
        "chat_template": "llama-3",
        "special_tokens": {
            "bos": "<|begin_of_text|>",
            "eos": "<|eot_id|>",
            "start_header": "<|start_header_id|>",
            "end_header": "<|end_header_id|>",
        },
        "supports_system": True,
        "supports_tools": True,
        "license": "Llama 3.3 Community License",
        "recommended_for": ["fine-tuning", "production"],
    },
    "llama-3.2": {
        "name": "Llama 3.2",
        "provider": "Meta",
        "variants": ["1b", "3b", "11b-vision", "90b-vision"],
        "context_length": 128_000,
        "chat_template": "llama-3",
        "supports_system": True,
        "supports_vision": ["11b-vision", "90b-vision"],
        "recommended_for": ["edge-deployment", "vision"],
    },
    "llama-3.1": {
        "name": "Llama 3.1",
        "provider": "Meta",
        "variants": ["8b", "70b", "405b"],
        "context_length": 128_000,
        "chat_template": "llama-3",
        "supports_system": True,
        "supports_tools": True,
        "recommended_for": ["fine-tuning", "production"],
    },
    # =========================================================================
    # ALIBABA QWEN FAMILY
    # =========================================================================
    "qwen3": {
        "name": "Qwen 3",
        "provider": "Alibaba",
        "variants": ["0.6b", "1.7b", "4b", "8b", "14b", "32b", "30b-a3b", "235b-a22b"],
        "context_length": 32_768,
        "chat_template": "qwen",
        "special_tokens": {
            "im_start": "<|im_start|>",
            "im_end": "<|im_end|>",
        },
        "supports_system": True,
        "supports_tools": True,
        "supports_thinking": True,
        "license": "Apache-2.0",
        "recommended_for": ["fine-tuning", "multilingual"],
    },
    "qwen2.5": {
        "name": "Qwen 2.5",
        "provider": "Alibaba",
        "variants": ["0.5b", "1.5b", "3b", "7b", "14b", "32b", "72b"],
        "context_length": 32_768,
        "chat_template": "qwen",
        "supports_system": True,
        "supports_tools": True,
        "license": "Apache-2.0",
        "recommended_for": ["fine-tuning", "production"],
    },
    "qwen2.5-coder": {
        "name": "Qwen 2.5 Coder",
        "provider": "Alibaba",
        "variants": ["1.5b", "7b", "14b", "32b"],
        "context_length": 32_768,
        "chat_template": "qwen",
        "supports_system": True,
        "license": "Apache-2.0",
        "recommended_for": ["coding"],
    },
    # =========================================================================
    # GOOGLE GEMMA FAMILY
    # =========================================================================
    "gemma-3": {
        "name": "Gemma 3",
        "provider": "Google",
        "variants": ["1b", "4b", "12b", "27b"],
        "context_length": 128_000,
        "chat_template": "gemma",
        "special_tokens": {
            "start_turn": "<start_of_turn>",
            "end_turn": "<end_of_turn>",
        },
        "supports_system": True,
        "supports_vision": ["4b", "12b", "27b"],
        "license": "Gemma License",
        "recommended_for": ["fine-tuning", "vision"],
    },
    "gemma-2": {
        "name": "Gemma 2",
        "provider": "Google",
        "variants": ["2b", "9b", "27b"],
        "context_length": 8_192,
        "chat_template": "gemma",
        "supports_system": True,
        "license": "Gemma License",
    },
    # =========================================================================
    # MISTRAL FAMILY
    # =========================================================================
    "mistral-large": {
        "name": "Mistral Large",
        "provider": "Mistral",
        "variants": ["2411"],
        "context_length": 128_000,
        "chat_template": "mistral",
        "supports_system": True,
        "supports_tools": True,
        "license": "Mistral Research License",
    },
    "mistral-small": {
        "name": "Mistral Small",
        "provider": "Mistral",
        "variants": ["2501"],
        "context_length": 32_000,
        "chat_template": "mistral",
        "supports_system": True,
        "license": "Apache-2.0",
        "recommended_for": ["fine-tuning"],
    },
    "mistral-nemo": {
        "name": "Mistral Nemo",
        "provider": "Mistral",
        "variants": ["12b"],
        "context_length": 128_000,
        "chat_template": "mistral",
        "supports_system": True,
        "supports_tools": True,
        "license": "Apache-2.0",
        "recommended_for": ["fine-tuning"],
    },
    # =========================================================================
    # MICROSOFT PHI FAMILY
    # =========================================================================
    "phi-4": {
        "name": "Phi-4",
        "provider": "Microsoft",
        "variants": ["14b"],
        "context_length": 16_384,
        "chat_template": "phi",
        "special_tokens": {
            "start": "<|",
            "end": "|>",
        },
        "supports_system": True,
        "license": "MIT",
        "recommended_for": ["fine-tuning", "edge-deployment"],
    },
    "phi-3.5": {
        "name": "Phi-3.5",
        "provider": "Microsoft",
        "variants": ["mini", "moe"],
        "context_length": 128_000,
        "chat_template": "phi",
        "supports_system": True,
        "supports_vision": ["mini"],
        "license": "MIT",
    },
    # =========================================================================
    # DEEPSEEK FAMILY
    # =========================================================================
    "deepseek-v3": {
        "name": "DeepSeek V3",
        "provider": "DeepSeek",
        "variants": ["671b"],
        "context_length": 128_000,
        "chat_template": "deepseek",
        "supports_system": True,
        "supports_tools": True,
        "license": "DeepSeek License",
    },
    "deepseek-r1": {
        "name": "DeepSeek R1",
        "provider": "DeepSeek",
        "variants": ["671b", "70b", "32b", "14b", "8b", "7b", "1.5b"],
        "context_length": 64_000,
        "chat_template": "deepseek-r1",
        "supports_system": True,
        "supports_thinking": True,
        "license": "MIT",
        "recommended_for": ["reasoning", "fine-tuning"],
    },
    # =========================================================================
    # COHERE FAMILY
    # =========================================================================
    "command-r": {
        "name": "Command R",
        "provider": "Cohere",
        "variants": ["35b", "plus"],
        "context_length": 128_000,
        "chat_template": "cohere",
        "supports_system": True,
        "supports_tools": True,
        "license": "CC-BY-NC-4.0",
    },
    # =========================================================================
    # OTHER NOTABLE MODELS
    # =========================================================================
    "olmo-2": {
        "name": "OLMo 2",
        "provider": "AI2",
        "variants": ["7b", "13b"],
        "context_length": 4_096,
        "chat_template": "chatml",
        "supports_system": True,
        "license": "Apache-2.0",
        "recommended_for": ["research", "fine-tuning"],
    },
    "smollm2": {
        "name": "SmolLM2",
        "provider": "HuggingFace",
        "variants": ["135m", "360m", "1.7b"],
        "context_length": 8_192,
        "chat_template": "chatml",
        "supports_system": True,
        "license": "Apache-2.0",
        "recommended_for": ["edge-deployment", "fine-tuning"],
    },
}

# =============================================================================
# CHAT TEMPLATES
# =============================================================================

CHAT_TEMPLATES: dict[str, dict[str, Any]] = {
    "llama-3": {
        "template": """<|begin_of_text|>{% for message in messages %}{% if message.role == 'system' %}<|start_header_id|>system<|end_header_id|>

{{ message.content }}<|eot_id|>{% elif message.role == 'user' %}<|start_header_id|>user<|end_header_id|>

{{ message.content }}<|eot_id|>{% elif message.role == 'assistant' %}<|start_header_id|>assistant<|end_header_id|>

{{ message.content }}<|eot_id|>{% endif %}{% endfor %}<|start_header_id|>assistant<|end_header_id|>

""",
        "special_tokens": {
            "bos": "<|begin_of_text|>",
            "eos": "<|eot_id|>",
            "start_header": "<|start_header_id|>",
            "end_header": "<|end_header_id|>",
        },
        "example": """<|begin_of_text|><|start_header_id|>system<|end_header_id|>

You are a helpful assistant.<|eot_id|><|start_header_id|>user<|end_header_id|>

Hello!<|eot_id|><|start_header_id|>assistant<|end_header_id|>

Hi there! How can I help you today?<|eot_id|>""",
    },
    "llama-4": {
        "template": """<|begin_of_text|>{% for message in messages %}{% if message.role == 'system' %}<|header_start|>system<|header_end|>

{{ message.content }}<|eot_id|>{% elif message.role == 'user' %}<|header_start|>user<|header_end|>

{{ message.content }}<|eot_id|>{% elif message.role == 'assistant' %}<|header_start|>assistant<|header_end|>

{{ message.content }}<|eot_id|>{% endif %}{% endfor %}<|header_start|>assistant<|header_end|>

""",
        "special_tokens": {
            "bos": "<|begin_of_text|>",
            "eos": "<|eot_id|>",
            "header_start": "<|header_start|>",
            "header_end": "<|header_end|>",
        },
        "example": "",
    },
    "qwen": {
        "template": """{% for message in messages %}<|im_start|>{{ message.role }}
{{ message.content }}<|im_end|>
{% endfor %}<|im_start|>assistant
""",
        "special_tokens": {
            "im_start": "<|im_start|>",
            "im_end": "<|im_end|>",
        },
        "example": """<|im_start|>system
You are a helpful assistant.<|im_end|>
<|im_start|>user
Hello!<|im_end|>
<|im_start|>assistant
Hi there! How can I help you today?<|im_end|>
""",
    },
    "chatml": {
        "template": """{% for message in messages %}<|im_start|>{{ message.role }}
{{ message.content }}<|im_end|>
{% endfor %}<|im_start|>assistant
""",
        "special_tokens": {
            "im_start": "<|im_start|>",
            "im_end": "<|im_end|>",
        },
        "example": """<|im_start|>system
You are a helpful assistant.<|im_end|>
<|im_start|>user
Hello!<|im_end|>
<|im_start|>assistant
Hi there! How can I help you today?<|im_end|>
""",
    },
    "gemma": {
        "template": """{% for message in messages %}<start_of_turn>{{ message.role }}
{{ message.content }}<end_of_turn>
{% endfor %}<start_of_turn>model
""",
        "special_tokens": {
            "start_turn": "<start_of_turn>",
            "end_turn": "<end_of_turn>",
        },
        "example": """<start_of_turn>user
Hello!<end_of_turn>
<start_of_turn>model
Hi there! How can I help you today?<end_of_turn>
""",
    },
    "mistral": {
        "template": """<s>{% for message in messages %}{% if message.role == 'user' %}[INST] {{ message.content }} [/INST]{% elif message.role == 'assistant' %}{{ message.content }}</s>{% endif %}{% endfor %}""",
        "special_tokens": {
            "bos": "<s>",
            "eos": "</s>",
            "inst_start": "[INST]",
            "inst_end": "[/INST]",
        },
        "example": """<s>[INST] Hello! [/INST]Hi there! How can I help you today?</s>""",
    },
    "phi": {
        "template": """{% for message in messages %}<|{{ message.role }}|>
{{ message.content }}<|end|>
{% endfor %}<|assistant|>
""",
        "special_tokens": {
            "end": "<|end|>",
        },
        "example": """<|system|>
You are a helpful assistant.<|end|>
<|user|>
Hello!<|end|>
<|assistant|>
Hi there! How can I help you today?<|end|>
""",
    },
    "deepseek": {
        "template": """{% for message in messages %}{% if message.role == 'user' %}User: {{ message.content }}

{% elif message.role == 'assistant' %}Assistant: {{ message.content }}

{% endif %}{% endfor %}Assistant: """,
        "special_tokens": {},
        "example": "User: Hello!\nAssistant: Hi there!",
    },
    "deepseek-r1": {
        "template": "",
        "special_tokens": {},
        "example": "",
    },
    "cohere": {
        "template": "",
        "special_tokens": {},
        "example": "",
    },
}


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


def get_model_info(model_name: str) -> dict[str, Any] | None:
    """Get model information by name.

    Supports partial matching (e.g., "llama-3" matches "llama-3.1", "llama-3.2", etc.)
    Returns the first exact match, or None if not found.
    """
    # Try exact match first
    if model_name in MODEL_REGISTRY:
        return MODEL_REGISTRY[model_name]

    # Try partial match (e.g., "llama-3" -> "llama-3.1")
    for name, info in MODEL_REGISTRY.items():
        if name.startswith(model_name):
            return info

    return None


def get_chat_template(model_name: str) -> str | None:
    """Get the chat template for a model.

    Returns the Jinja2 template string for the model's chat format.
    """
    model_info = get_model_info(model_name)
    if not model_info:
        return None

    template_name = model_info.get("chat_template")
    if template_name and template_name in CHAT_TEMPLATES:
        return CHAT_TEMPLATES[template_name].get("template")

    return None


def list_models() -> list[str]:
    """List all available model names."""
    return list(MODEL_REGISTRY.keys())


def get_models_by_family(family: str) -> list[str]:
    """Get models that belong to a specific family.

    Args:
        family: Family name prefix (e.g., "llama", "qwen", "gemma")

    Returns:
        List of model names matching the family.
    """
    family_lower = family.lower()
    return [
        name for name in MODEL_REGISTRY.keys()
        if family_lower in name.lower()
    ]


def get_models_by_provider(provider: str) -> list[str]:
    """Get models from a specific provider.

    Args:
        provider: Provider name (e.g., "Meta", "Alibaba", "Google")

    Returns:
        List of model names from the provider.
    """
    provider_lower = provider.lower()
    return [
        name for name, info in MODEL_REGISTRY.items()
        if info.get("provider", "").lower() == provider_lower
    ]
