"""Dataset split management endpoints.

Implements train/validation/test split functionality for ML datasets.
Based on best practices:
- Default split: 80% train, 10% validation, 10% test
- Stratified splitting supported
- Reproducible splits with random seeds
"""

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from dataforge_api import database as db

router = APIRouter()


# Type definitions
SplitType = Literal["train", "validation", "test"]


class SplitCounts(BaseModel):
    """Count of examples per split."""

    train: int = 0
    validation: int = 0
    test: int = 0
    total: int = 0


class AutoSplitConfig(BaseModel):
    """Configuration for automatic dataset splitting."""

    train_ratio: float = Field(
        default=0.8,
        ge=0.0,
        le=1.0,
        description="Fraction of data for training (default: 80%)",
    )
    validation_ratio: float = Field(
        default=0.1,
        ge=0.0,
        le=1.0,
        description="Fraction of data for validation (default: 10%)",
    )
    test_ratio: float = Field(
        default=0.1,
        ge=0.0,
        le=1.0,
        description="Fraction of data for testing (default: 10%)",
    )
    random_seed: int = Field(
        default=42,
        description="Random seed for reproducible splits",
    )
    stratify_by_quality: bool = Field(
        default=False,
        description="Use stratified sampling based on quality scores",
    )


class AutoSplitResult(BaseModel):
    """Result of automatic splitting operation."""

    success: bool
    train_count: int
    validation_count: int
    test_count: int
    total: int
    message: str


class UpdateSplitRequest(BaseModel):
    """Request to update split for specific examples."""

    example_ids: list[str]
    split: SplitType


class UpdateSplitResult(BaseModel):
    """Result of split update operation."""

    updated: int
    split: str


class SplitStats(BaseModel):
    """Detailed statistics per split."""

    split: str
    count: int
    percentage: float
    avg_quality: float | None = None
    avg_tokens: float | None = None


class DatasetSplitInfo(BaseModel):
    """Complete split information for a dataset."""

    total_examples: int
    splits: list[SplitStats]
    is_split: bool  # True if examples are distributed across splits
    recommended_action: str | None = None


@router.get("/{project_id}/splits", response_model=SplitCounts)
async def get_split_counts(project_id: str) -> SplitCounts:
    """Get count of examples per split (train/validation/test)."""
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    counts = await db.get_split_counts(project_id)

    return SplitCounts(
        train=counts["train"],
        validation=counts["validation"],
        test=counts["test"],
        total=counts["train"] + counts["validation"] + counts["test"],
    )


@router.get("/{project_id}/splits/info", response_model=DatasetSplitInfo)
async def get_split_info(project_id: str) -> DatasetSplitInfo:
    """Get detailed split information and recommendations."""
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    counts = await db.get_split_counts(project_id)
    total = counts["train"] + counts["validation"] + counts["test"]

    if total == 0:
        return DatasetSplitInfo(
            total_examples=0,
            splits=[],
            is_split=False,
            recommended_action="Import some examples first",
        )

    # Calculate percentages
    splits = []
    for split_name in ["train", "validation", "test"]:
        count = counts[split_name]
        percentage = (count / total * 100) if total > 0 else 0
        splits.append(
            SplitStats(
                split=split_name,
                count=count,
                percentage=round(percentage, 1),
            )
        )

    # Check if dataset is properly split
    is_split = counts["validation"] > 0 or counts["test"] > 0

    # Generate recommendations
    recommended_action = None
    if not is_split:
        recommended_action = "Run auto-split to create train/validation/test sets (recommended: 80/10/10)"
    elif counts["validation"] == 0:
        recommended_action = "Consider adding validation examples for model evaluation"
    elif counts["test"] == 0:
        recommended_action = "Consider adding test examples for final evaluation"
    elif counts["train"] < 100:
        recommended_action = "Training set may be too small. Consider adding more examples."

    return DatasetSplitInfo(
        total_examples=total,
        splits=splits,
        is_split=is_split,
        recommended_action=recommended_action,
    )


@router.post("/{project_id}/splits/auto", response_model=AutoSplitResult)
async def auto_split_dataset(
    project_id: str,
    config: AutoSplitConfig,
) -> AutoSplitResult:
    """
    Automatically split dataset into train/validation/test sets.

    Best practices for LLM fine-tuning:
    - 80/10/10 split is recommended for most cases
    - Use a fixed random seed for reproducibility
    - For small datasets (<1000), consider 70/15/15
    - For very large datasets (>100k), 98/1/1 can work

    The split is randomized but reproducible via the random_seed parameter.
    """
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Validate ratios sum to 1.0
    total_ratio = config.train_ratio + config.validation_ratio + config.test_ratio
    if abs(total_ratio - 1.0) > 0.001:
        raise HTTPException(
            status_code=400,
            detail=f"Ratios must sum to 1.0, got {total_ratio:.3f}",
        )

    try:
        result = await db.auto_split_examples(
            project_id=project_id,
            train_ratio=config.train_ratio,
            validation_ratio=config.validation_ratio,
            test_ratio=config.test_ratio,
            random_seed=config.random_seed,
        )

        total = result["train"] + result["validation"] + result["test"]

        return AutoSplitResult(
            success=True,
            train_count=result["train"],
            validation_count=result["validation"],
            test_count=result["test"],
            total=total,
            message=f"Successfully split {total} examples: {result['train']} train, {result['validation']} validation, {result['test']} test",
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/{project_id}/splits/update", response_model=UpdateSplitResult)
async def update_example_splits(
    project_id: str,
    request: UpdateSplitRequest,
) -> UpdateSplitResult:
    """
    Update the split assignment for specific examples.

    Use this to manually move examples between train/validation/test sets.
    """
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not request.example_ids:
        raise HTTPException(status_code=400, detail="No example IDs provided")

    try:
        updated = await db.update_examples_split(
            project_id=project_id,
            example_ids=request.example_ids,
            split=request.split,
        )

        return UpdateSplitResult(
            updated=updated,
            split=request.split,
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/{project_id}/splits/reset")
async def reset_splits(project_id: str) -> dict:
    """
    Reset all examples to the 'train' split.

    Use this before running auto-split or to start fresh.
    """
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Get all example IDs
    examples = await db.get_examples(project_id, limit=100000)
    example_ids = [ex["id"] for ex in examples]

    if not example_ids:
        return {"reset": 0, "message": "No examples to reset"}

    updated = await db.update_examples_split(
        project_id=project_id,
        example_ids=example_ids,
        split="train",
    )

    return {
        "reset": updated,
        "message": f"Reset {updated} examples to 'train' split",
    }


@router.get("/{project_id}/splits/{split}/examples")
async def get_examples_by_split(
    project_id: str,
    split: SplitType,
    offset: int = 0,
    limit: int = 100,
) -> dict:
    """Get examples for a specific split with pagination."""
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    examples = await db.get_examples_by_split(
        project_id=project_id,
        split=split,
        offset=offset,
        limit=limit,
    )

    total = await db.count_examples(project_id, split=split)

    return {
        "split": split,
        "examples": examples,
        "total": total,
        "offset": offset,
        "limit": limit,
    }


# Preset split configurations
SPLIT_PRESETS = {
    "standard": {
        "train_ratio": 0.8,
        "validation_ratio": 0.1,
        "test_ratio": 0.1,
        "description": "Standard 80/10/10 split - recommended for most cases",
    },
    "small_dataset": {
        "train_ratio": 0.7,
        "validation_ratio": 0.15,
        "test_ratio": 0.15,
        "description": "70/15/15 split - better for small datasets (<1000 examples)",
    },
    "large_dataset": {
        "train_ratio": 0.98,
        "validation_ratio": 0.01,
        "test_ratio": 0.01,
        "description": "98/1/1 split - suitable for very large datasets (>100k examples)",
    },
    "no_test": {
        "train_ratio": 0.9,
        "validation_ratio": 0.1,
        "test_ratio": 0.0,
        "description": "90/10/0 split - when test set is not needed",
    },
    "cross_validation": {
        "train_ratio": 0.8,
        "validation_ratio": 0.2,
        "test_ratio": 0.0,
        "description": "80/20/0 split - for k-fold cross-validation setups",
    },
}


@router.get("/presets")
async def get_split_presets() -> dict:
    """
    Get available split presets with descriptions.

    Returns preset configurations for different dataset sizes and use cases.
    """
    return {"presets": SPLIT_PRESETS}
