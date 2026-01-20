"""Model registry endpoints."""


from typing import Annotated

from fastapi import APIRouter, Path
from pydantic import BaseModel

router = APIRouter()


# Type alias for model_id path parameter
# Note: Route ordering handles /templates vs /{model_id} conflict (static routes defined first)
ModelIdPath = Annotated[str, Path(min_length=1)]


class ModelInfo(BaseModel):
    """Information about a supported model."""

    id: str
    name: str
    family: str
    variants: list[str]
    context_length: int
    supports_system: bool = True
    supports_tools: bool = False
    supports_vision: bool = False
    chat_template: str
    license: str | None = None
    recommended_for: list[str] = []


class ModelFamily(BaseModel):
    """A family of models."""

    id: str
    name: str
    provider: str
    models: list[ModelInfo]


class ChatTemplate(BaseModel):
    """A chat template definition."""

    id: str
    name: str
    template: str
    special_tokens: dict[str, str]
    example: str


class ModelConstraints(BaseModel):
    """Constraints for a model that affect dataset validity."""

    max_context_tokens: int
    max_output_tokens: int | None = None
    supports_system_message: bool = True
    supports_multi_turn: bool = True
    supports_tools: bool = False
    forbidden_tokens: list[str] = []
    required_format: str | None = None
    token_budget_for_training: int | None = None


@router.get("", response_model=list[ModelFamily])
async def list_model_families() -> list[ModelFamily]:
    """List all supported model families."""
    from dataforge_core.models import MODEL_REGISTRY

    families = {}
    for model_id, model_data in MODEL_REGISTRY.items():
        family_id = model_id.split("-")[0]
        if family_id not in families:
            families[family_id] = {
                "id": family_id,
                "name": family_id.title(),
                "provider": model_data.get("provider", "Unknown"),
                "models": [],
            }

        # Handle supports_vision which can be bool or list of variants
        supports_vision_raw = model_data.get("supports_vision", False)
        supports_vision = bool(supports_vision_raw) if not isinstance(supports_vision_raw, list) else len(supports_vision_raw) > 0

        families[family_id]["models"].append(
            ModelInfo(
                id=model_id,
                name=model_data.get("name", model_id),
                family=family_id,
                variants=model_data.get("variants", []),
                context_length=model_data.get("context_length", 4096),
                supports_system=model_data.get("supports_system", True),
                supports_tools=model_data.get("supports_tools", False),
                supports_vision=supports_vision,
                chat_template=model_data.get("chat_template", "chatml"),
                license=model_data.get("license"),
                recommended_for=model_data.get("recommended_for", []),
            )
        )

    return [ModelFamily(**f) for f in families.values()]


# NOTE: Static routes (/templates) must be defined BEFORE parameterized routes (/{model_id})
# to prevent FastAPI from matching "/templates" as a model_id parameter


@router.get("/templates", response_model=list[ChatTemplate])
async def list_chat_templates() -> list[ChatTemplate]:
    """List all available chat templates."""
    from dataforge_core.models import CHAT_TEMPLATES

    return [
        ChatTemplate(
            id=template_id,
            name=template_id.replace("-", " ").title(),
            template=template_data["template"],
            special_tokens=template_data.get("special_tokens", {}),
            example=template_data.get("example", ""),
        )
        for template_id, template_data in CHAT_TEMPLATES.items()
    ]


@router.get("/templates/{template_id}", response_model=ChatTemplate)
async def get_chat_template(template_id: str) -> ChatTemplate:
    """Get a specific chat template."""
    from fastapi import HTTPException

    from dataforge_core.models import CHAT_TEMPLATES

    if template_id not in CHAT_TEMPLATES:
        raise HTTPException(status_code=404, detail=f"Template {template_id} not found")

    template_data = CHAT_TEMPLATES[template_id]
    return ChatTemplate(
        id=template_id,
        name=template_id.replace("-", " ").title(),
        template=template_data["template"],
        special_tokens=template_data.get("special_tokens", {}),
        example=template_data.get("example", ""),
    )


@router.get("/{model_id}", response_model=ModelInfo)
async def get_model(model_id: ModelIdPath) -> ModelInfo:
    """Get details about a specific model."""
    from fastapi import HTTPException

    from dataforge_core.models import MODEL_REGISTRY

    if model_id not in MODEL_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    model_data = MODEL_REGISTRY[model_id]
    family_id = model_id.split("-")[0]

    # Handle supports_vision which can be bool or list of variants
    supports_vision_raw = model_data.get("supports_vision", False)
    supports_vision = bool(supports_vision_raw) if not isinstance(supports_vision_raw, list) else len(supports_vision_raw) > 0

    return ModelInfo(
        id=model_id,
        name=model_data.get("name", model_id),
        family=family_id,
        variants=model_data.get("variants", []),
        context_length=model_data.get("context_length", 4096),
        supports_system=model_data.get("supports_system", True),
        supports_tools=model_data.get("supports_tools", False),
        supports_vision=supports_vision,
        chat_template=model_data.get("chat_template", "chatml"),
        license=model_data.get("license"),
        recommended_for=model_data.get("recommended_for", []),
    )


@router.get("/{model_id}/constraints", response_model=ModelConstraints)
async def get_model_constraints(model_id: ModelIdPath) -> ModelConstraints:
    """Get validation constraints for a model.

    Returns the constraints that datasets must meet for this model:
    - max_context_tokens: Maximum tokens per example
    - forbidden_tokens: Special tokens that shouldn't appear in content
    - supports_system_message: Whether model handles system role
    - supports_multi_turn: Whether model handles multi-turn conversations
    """

    from dataforge_core.model_validation import get_model_constraints as get_constraints

    constraints = get_constraints(model_id)

    return ModelConstraints(
        max_context_tokens=constraints.max_context_tokens,
        max_output_tokens=constraints.max_output_tokens,
        supports_system_message=constraints.supports_system_message,
        supports_multi_turn=constraints.supports_multi_turn,
        supports_tools=constraints.supports_tools,
        forbidden_tokens=constraints.forbidden_tokens,
        required_format=constraints.required_format,
        token_budget_for_training=constraints.token_budget_for_training,
    )
