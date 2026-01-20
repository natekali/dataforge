"""HuggingFace Hub integration endpoints."""


from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from dataforge_api import database as db

router = APIRouter()


class HFDatasetInfo(BaseModel):
    """Information about a HuggingFace dataset."""

    id: str
    author: str | None
    downloads: int
    likes: int
    tags: list[str]
    description: str | None


class HFImportConfig(BaseModel):
    """Configuration for importing from HuggingFace Hub."""

    dataset_id: str  # e.g., "tatsu-lab/alpaca"
    split: str = "train"
    max_examples: int = 10000
    config_name: str | None = None


class HFPushConfig(BaseModel):
    """Configuration for pushing to HuggingFace Hub."""

    repo_id: str  # e.g., "username/my-dataset"
    private: bool = False
    commit_message: str = "Upload dataset from DataForge Studio"


class HFSearchResult(BaseModel):
    """Search result from HuggingFace Hub."""

    datasets: list[HFDatasetInfo]
    total: int


@router.get("/search", response_model=HFSearchResult)
async def search_datasets(
    query: str,
    limit: int = 20,
    filter_task: str | None = None,
) -> HFSearchResult:
    """
    Search for datasets on HuggingFace Hub.
    """
    try:
        from huggingface_hub import HfApi
    except ImportError as e:
        raise HTTPException(
            status_code=501,
            detail="HuggingFace Hub integration requires huggingface_hub. Install with: pip install huggingface_hub",
        ) from e

    api = HfApi()

    try:
        datasets = api.list_datasets(
            search=query,
            limit=limit,
            filter=filter_task,
            sort="downloads",
            direction=-1,
        )

        results = []
        for ds in datasets:
            results.append(
                HFDatasetInfo(
                    id=ds.id,
                    author=ds.author,
                    downloads=ds.downloads or 0,
                    likes=ds.likes or 0,
                    tags=ds.tags or [],
                    description=ds.description,
                )
            )

        return HFSearchResult(datasets=results, total=len(results))

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}") from e


@router.get("/dataset/{dataset_id:path}", response_model=HFDatasetInfo)
async def get_dataset_info(dataset_id: str) -> HFDatasetInfo:
    """
    Get information about a specific HuggingFace dataset.
    """
    try:
        from huggingface_hub import HfApi
    except ImportError as e:
        raise HTTPException(
            status_code=501,
            detail="HuggingFace Hub integration requires huggingface_hub",
        ) from e

    api = HfApi()

    try:
        info = api.dataset_info(dataset_id)

        return HFDatasetInfo(
            id=info.id,
            author=info.author,
            downloads=info.downloads or 0,
            likes=info.likes or 0,
            tags=info.tags or [],
            description=info.description,
        )

    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Dataset not found: {str(e)}") from e


@router.post("/{project_id}/import")
async def import_from_hub(
    project_id: str,
    config: HFImportConfig,
) -> dict:
    """
    Import dataset from HuggingFace Hub into a project.
    """
    from dataforge_core.detection import detect_schema
    from dataforge_core.importers_advanced import import_huggingface_dataset

    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    try:
        # Import from HuggingFace
        raw_examples = import_huggingface_dataset(
            config.dataset_id,
            split=config.split,
            max_examples=config.max_examples,
        )

        if not raw_examples:
            raise HTTPException(status_code=400, detail="No examples found in dataset")

        # Detect schema
        schema = detect_schema(raw_examples)

        # Normalize to standard format
        from dataforge_api.routers.datasets import _normalize_examples
        examples = _normalize_examples(raw_examples, schema.format)

        # Store in database
        count = await db.add_examples(project_id, examples)

        # Update project
        await db.update_project(
            project_id,
            source_format=schema.format.value,
            description=f"Imported from HuggingFace: {config.dataset_id}",
        )

        return {
            "success": True,
            "imported": count,
            "source": config.dataset_id,
            "format": schema.format.value,
        }

    except ImportError as e:
        raise HTTPException(status_code=501, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}") from e


@router.post("/{project_id}/push")
async def push_to_hub(
    project_id: str,
    config: HFPushConfig,
    token: str | None = None,
) -> dict:
    """
    Push dataset to HuggingFace Hub.

    Requires HF_TOKEN environment variable or token parameter.
    """
    try:
        from datasets import Dataset
    except ImportError as e:
        raise HTTPException(
            status_code=501,
            detail="Pushing requires huggingface_hub and datasets. Install with: pip install huggingface_hub datasets",
        ) from e

    import os

    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Get token
    hf_token = token or os.environ.get("HF_TOKEN")
    if not hf_token:
        raise HTTPException(
            status_code=400,
            detail="HuggingFace token required. Set HF_TOKEN environment variable or provide token parameter.",
        )

    try:
        # Get all examples
        examples = await db.get_examples(project_id, offset=0, limit=100000)

        if not examples:
            raise HTTPException(status_code=400, detail="No examples to push")

        # Convert to HuggingFace Dataset format
        data = {
            "messages": [ex["messages"] for ex in examples],
        }

        # Add metadata if present
        if any(ex.get("metadata") for ex in examples):
            data["metadata"] = [ex.get("metadata", {}) for ex in examples]

        dataset = Dataset.from_dict(data)

        # Push to Hub
        dataset.push_to_hub(
            config.repo_id,
            private=config.private,
            token=hf_token,
            commit_message=config.commit_message,
        )

        return {
            "success": True,
            "repo_id": config.repo_id,
            "examples_pushed": len(examples),
            "url": f"https://huggingface.co/datasets/{config.repo_id}",
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Push failed: {str(e)}") from e


@router.get("/popular")
async def get_popular_datasets(
    task: str = "text-generation",
    limit: int = 10,
) -> list[HFDatasetInfo]:
    """
    Get popular datasets for fine-tuning.
    """
    try:
        from huggingface_hub import HfApi
    except ImportError:
        # Return curated list if huggingface_hub not available
        return [
            HFDatasetInfo(
                id="tatsu-lab/alpaca",
                author="tatsu-lab",
                downloads=100000,
                likes=1000,
                tags=["text-generation", "instruction-following"],
                description="Stanford Alpaca instruction-following dataset",
            ),
            HFDatasetInfo(
                id="Open-Orca/OpenOrca",
                author="Open-Orca",
                downloads=50000,
                likes=500,
                tags=["text-generation", "chat"],
                description="Large-scale instruction dataset",
            ),
            HFDatasetInfo(
                id="teknium/OpenHermes-2.5",
                author="teknium",
                downloads=30000,
                likes=300,
                tags=["text-generation", "chat"],
                description="High-quality instruction dataset",
            ),
        ]

    api = HfApi()

    try:
        datasets = api.list_datasets(
            filter=task,
            sort="downloads",
            direction=-1,
            limit=limit,
        )

        return [
            HFDatasetInfo(
                id=ds.id,
                author=ds.author,
                downloads=ds.downloads or 0,
                likes=ds.likes or 0,
                tags=ds.tags or [],
                description=ds.description,
            )
            for ds in datasets
        ]

    except Exception:
        return []
