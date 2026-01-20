"""Dataset export endpoints."""

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from dataforge_api.logging_config import get_logger

logger = get_logger(__name__)
router = APIRouter()


class ExportFormat(BaseModel):
    """Available export format."""

    id: str
    name: str
    description: str
    file_extension: str
    supports_config: bool = False


class ExportConfig(BaseModel):
    """Configuration for export."""

    format: str  # jsonl, axolotl, unsloth, llamafactory, torchtune
    target_model: str
    include_system_prompt: bool = True
    generate_config: bool = True
    split_train_test: bool = False
    test_size: float = 0.1


class ExportResult(BaseModel):
    """Result of export operation."""

    success: bool
    files: list[str]
    warnings: list[str] = []


EXPORT_FORMATS = [
    ExportFormat(
        id="jsonl",
        name="JSONL",
        description="Plain JSONL format with ChatML messages",
        file_extension=".jsonl",
        supports_config=False,
    ),
    ExportFormat(
        id="axolotl",
        name="Axolotl",
        description="Axolotl-ready format with YAML config",
        file_extension=".jsonl",
        supports_config=True,
    ),
    ExportFormat(
        id="unsloth",
        name="Unsloth",
        description="Unsloth-optimized format with training script",
        file_extension=".jsonl",
        supports_config=True,
    ),
    ExportFormat(
        id="llamafactory",
        name="LLaMA-Factory",
        description="LLaMA-Factory format with dataset_info.json",
        file_extension=".json",
        supports_config=True,
    ),
    ExportFormat(
        id="torchtune",
        name="Torchtune",
        description="Torchtune format with YAML config",
        file_extension=".jsonl",
        supports_config=True,
    ),
    ExportFormat(
        id="sharegpt",
        name="ShareGPT",
        description="ShareGPT format (from/value style)",
        file_extension=".json",
        supports_config=False,
    ),
    ExportFormat(
        id="alpaca",
        name="Alpaca",
        description="Alpaca format (instruction/input/output)",
        file_extension=".json",
        supports_config=False,
    ),
]


@router.get("/formats", response_model=list[ExportFormat])
async def list_export_formats() -> list[ExportFormat]:
    """List available export formats."""
    return EXPORT_FORMATS


@router.post("/{project_id}")
async def export_dataset(project_id: str, config: ExportConfig) -> StreamingResponse:
    """
    Export dataset in the specified format.

    Returns a ZIP file containing:
    - Dataset file(s)
    - Training configuration (if applicable)
    - README with instructions
    """
    from dataforge_api.export_utils import create_export

    try:
        # Verify project exists
        from dataforge_api import database as db

        project = await db.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Generate export
        config_dict = config.model_dump()
        export_data = await create_export(project_id, config_dict)

        return StreamingResponse(
            iter([export_data]),
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename={project['name']}_{config.format}.zip",
                "Content-Type": "application/zip",
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}") from e


@router.get("/{project_id}/preview")
async def preview_export_get(
    project_id: str,
    target_model: str,
    format: str = "axolotl",
    num_examples: int = 3,
) -> dict[str, Any]:
    """Preview export via GET request (convenience endpoint)."""
    config = ExportConfig(
        format=format,
        target_model=target_model,
        include_system_prompt=True,
        generate_config=True,
    )
    return await preview_export(project_id, config, num_examples)


@router.post("/{project_id}/preview")
async def preview_export(
    project_id: str,
    config: ExportConfig,
    num_examples: int = 3,
) -> dict[str, Any]:
    """
    Preview export without downloading.

    Returns sample formatted examples and config preview.
    """
    from dataforge_api import database as db
    from dataforge_api.export_utils import _format_dataset

    try:
        project = await db.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        examples = await db.get_examples(project_id, offset=0, limit=num_examples)

        dataset_content, dataset_filename = _format_dataset(
            examples, config.format, config.model_dump()
        )

        # Generate config preview
        config_content = _format_examples_config(
            config.format,
            config.target_model,
            dataset_filename,
            len(examples),
            config.model_dump(),
        )

        return {
            "examples": examples[:num_examples],
            "config": config_content,
            "files": [dataset_filename],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/{project_id}/config/{format}")
async def generate_training_config(
    project_id: str,
    format: str,
    target_model: str,
) -> dict[str, Any]:
    """Generate training configuration for a specific framework."""
    from dataforge_api import database as db
    from dataforge_api.export_utils import _generate_training_config

    try:
        project = await db.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        examples = await db.get_examples(project_id, offset=0, limit=100000)

        config_content = _generate_training_config(
            format,
            target_model,
            "dataset.jsonl",
            len(examples),
            {},
        )

        return {"config": config_content, "format": format}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


def _format_examples_config(
    format_type: str,
    target_model: str,
    dataset_filename: str,
    num_examples: int,
    config: dict[str, Any],
) -> str:
    """Format training config for preview."""
    from dataforge_api.export_utils import _generate_training_config

    return _generate_training_config(
        format_type, target_model, dataset_filename, num_examples, config
    )
