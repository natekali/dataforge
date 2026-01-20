"""Quality validation and cleaning endpoints."""


from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from dataforge_api import database as db

router = APIRouter()


class QualityIssue(BaseModel):
    """A quality issue in an example."""

    type: str
    severity: str
    message: str
    field: str | None = None
    suggestion: str | None = None
    auto_fixable: bool = False


class ExampleQualityScore(BaseModel):
    """Quality score for a single example."""

    example_id: str
    overall: float
    completeness: float
    formatting: float
    length_balance: float
    content_quality: float
    issues: list[QualityIssue]


class DatasetQualityReport(BaseModel):
    """Quality report for entire dataset."""

    overall: float
    total_examples: int
    scores_distribution: dict[str, int]
    issue_counts: dict[str, int]
    critical_issues: int
    avg_completeness: float
    avg_formatting: float
    avg_length_balance: float
    avg_content_quality: float
    examples_with_issues: int


class CleaningConfig(BaseModel):
    """Configuration for cleaning operations."""

    operations: list[str] = [
        "remove_empty_messages",
        "normalize_roles",
        "fix_encoding",
        "normalize_whitespace",
    ]
    preview_only: bool = False


class CleaningResult(BaseModel):
    """Result of cleaning operation."""

    total_examples: int
    examples_modified: int
    total_changes: int
    issues_fixed: int
    preview: list[dict] | None = None


class ValidationConfig(BaseModel):
    """Configuration for validation."""

    model_family: str = "llama"
    max_context_length: int = 128000
    min_message_length: int = 10
    max_message_length: int = 32000


class ModelValidationConfig(BaseModel):
    """Configuration for model-specific validation."""

    model_id: str


class ModelValidationIssue(BaseModel):
    """A validation issue for model compatibility."""

    example_id: str
    issue_type: str
    severity: str
    message: str
    auto_fixable: bool = False
    suggested_fix: str | None = None
    field: str | None = None


class ModelValidationResult(BaseModel):
    """Result of model-specific validation."""

    is_valid: bool
    total_examples: int
    valid_examples: int
    error_count: int
    warning_count: int
    issues: list[ModelValidationIssue]
    recommendations: list[str]


class FormatForModelResult(BaseModel):
    """Result of auto-fixing examples for model compatibility."""

    examples_modified: int
    changes_applied: list[str]


class EvaluationConfig(BaseModel):
    """Configuration for Q&A evaluation."""

    provider: str = "ollama"
    model: str = "llama3.2"
    sample_size: int | None = None  # None = evaluate all
    dimensions: list[str] = [
        "coherence", "accuracy", "relevance",
        "completeness", "clarity", "helpfulness"
    ]


class DimensionScore(BaseModel):
    """Score for a single dimension."""

    score: float
    explanation: str
    suggestions: list[str] = []


class SingleEvaluationResult(BaseModel):
    """Result of evaluating a single example."""

    example_id: str
    overall_score: float
    dimensions: dict[str, DimensionScore]
    errors: list[str] = []
    needs_review: bool = False


class BatchEvaluationResult(BaseModel):
    """Result of batch evaluation."""

    job_id: str
    status: str  # pending, running, completed, failed
    total_examples: int
    evaluated_count: int
    average_score: float | None = None
    needs_review_count: int = 0
    score_distribution: dict[str, int] | None = None
    results: list[SingleEvaluationResult] | None = None
    error: str | None = None


@router.get("/{project_id}/score", response_model=DatasetQualityReport)
async def get_quality_score(
    project_id: str,
    model_family: str = "llama",
) -> DatasetQualityReport:
    """Get quality score for entire dataset."""
    from dataforge_core.quality import score_dataset

    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    examples = await db.get_examples(project_id, offset=0, limit=100000)

    if not examples:
        return DatasetQualityReport(
            overall=0,
            total_examples=0,
            scores_distribution={"excellent": 0, "good": 0, "fair": 0, "poor": 0},
            issue_counts={},
            critical_issues=0,
            avg_completeness=0,
            avg_formatting=0,
            avg_length_balance=0,
            avg_content_quality=0,
            examples_with_issues=0,
        )

    # Convert to format expected by quality module
    examples_data = [{"messages": ex["messages"]} for ex in examples]
    report = score_dataset(examples_data, model_family)

    # Count examples with issues
    from dataforge_core.quality import score_example
    examples_with_issues = sum(
        1 for ex in examples_data
        if len(score_example(ex, model_family).issues) > 0
    )

    return DatasetQualityReport(
        overall=report["overall"],
        total_examples=report["total_examples"],
        scores_distribution=report["scores_distribution"],
        issue_counts=report["issue_counts"],
        critical_issues=report["critical_issues"],
        avg_completeness=report["avg_completeness"],
        avg_formatting=report["avg_formatting"],
        avg_length_balance=report["avg_length_balance"],
        avg_content_quality=report["avg_content_quality"],
        examples_with_issues=examples_with_issues,
    )


@router.get("/{project_id}/examples/{example_id}/score", response_model=ExampleQualityScore)
async def get_example_quality(
    project_id: str,
    example_id: str,
    model_family: str = "llama",
) -> ExampleQualityScore:
    """Get quality score for a single example."""
    from dataforge_core.quality import score_example

    example = await db.get_example(example_id)
    if not example or example.get("project_id") != project_id:
        raise HTTPException(status_code=404, detail="Example not found")

    score = score_example({"messages": example["messages"]}, model_family)

    return ExampleQualityScore(
        example_id=example_id,
        overall=score.overall,
        completeness=score.completeness,
        formatting=score.formatting,
        length_balance=score.length_balance,
        content_quality=score.content_quality,
        issues=[
            QualityIssue(
                type=i.type.value,
                severity=i.severity.value,
                message=i.message,
                field=i.field,
                suggestion=i.suggestion,
                auto_fixable=i.auto_fixable,
            )
            for i in score.issues
        ],
    )


@router.post("/{project_id}/clean", response_model=CleaningResult)
async def clean_dataset(
    project_id: str,
    config: CleaningConfig,
) -> CleaningResult:
    """
    Clean dataset by applying automatic fixes.

    Available operations:
    - remove_empty_messages
    - normalize_roles
    - fix_encoding
    - normalize_whitespace
    - remove_refusals
    - mask_pii
    - remove_special_tokens
    """
    from dataforge_core.quality import clean_dataset as do_clean

    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    examples = await db.get_examples(project_id, offset=0, limit=100000)

    if not examples:
        return CleaningResult(
            total_examples=0,
            examples_modified=0,
            total_changes=0,
            issues_fixed=0,
        )

    # Convert and clean
    examples_data = [{"messages": ex["messages"]} for ex in examples]
    cleaned_examples, summary = do_clean(examples_data, config.operations)

    if config.preview_only:
        # Return preview of first few changes
        preview = []
        for i, (orig, cleaned) in enumerate(zip(examples_data[:5], cleaned_examples[:5], strict=True)):
            if orig != cleaned:
                preview.append({
                    "example_id": examples[i]["id"],
                    "original": orig,
                    "cleaned": cleaned,
                })

        return CleaningResult(
            total_examples=summary["total_examples"],
            examples_modified=summary["examples_modified"],
            total_changes=summary["total_changes"],
            issues_fixed=summary["issues_fixed"],
            preview=preview,
        )

    # Apply changes to database
    for i, (orig, cleaned) in enumerate(zip(examples_data, cleaned_examples, strict=True)):
        if orig != cleaned:
            await db.update_example(examples[i]["id"], messages=cleaned["messages"])

    return CleaningResult(
        total_examples=summary["total_examples"],
        examples_modified=summary["examples_modified"],
        total_changes=summary["total_changes"],
        issues_fixed=summary["issues_fixed"],
    )


@router.post("/{project_id}/validate")
async def validate_dataset(
    project_id: str,
    config: ValidationConfig,
) -> dict:
    """
    Validate dataset against model requirements.

    Checks:
    - Context length limits
    - Special token conflicts
    - Format compatibility
    """
    from dataforge_core.formatters import estimate_tokens
    from dataforge_core.quality import check_special_tokens

    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    examples = await db.get_examples(project_id, offset=0, limit=100000)

    if not examples:
        return {
            "valid": True,
            "total_examples": 0,
            "issues": [],
        }

    issues = []
    context_violations = 0
    token_conflicts = 0

    for ex in examples:
        # Check context length
        total_text = " ".join(m.get("content", "") for m in ex["messages"])
        tokens = estimate_tokens(total_text)

        if tokens > config.max_context_length:
            context_violations += 1
            if len(issues) < 10:  # Limit issues reported
                issues.append({
                    "example_id": ex["id"],
                    "type": "context_overflow",
                    "message": f"Example has {tokens} tokens, exceeds limit of {config.max_context_length}",
                })

        # Check special tokens
        token_issues = check_special_tokens({"messages": ex["messages"]}, config.model_family)
        if token_issues:
            token_conflicts += 1
            if len(issues) < 10:
                issues.append({
                    "example_id": ex["id"],
                    "type": "special_token_conflict",
                    "message": token_issues[0].message,
                })

    return {
        "valid": len(issues) == 0,
        "total_examples": len(examples),
        "context_violations": context_violations,
        "token_conflicts": token_conflicts,
        "issues": issues,
    }


@router.post("/{project_id}/deduplicate")
async def deduplicate_dataset(
    project_id: str,
    threshold: float = 0.95,
    method: str = "exact",  # exact, fuzzy, semantic
) -> dict:
    """
    Remove duplicate examples from dataset.

    Methods:
    - exact: Remove exact duplicates
    - fuzzy: Remove near-duplicates using text similarity
    - semantic: Remove semantic duplicates using embeddings (slower)
    """
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    examples = await db.get_examples(project_id, offset=0, limit=100000)

    if not examples:
        return {
            "duplicates_removed": 0,
            "examples_remaining": 0,
        }

    seen_hashes = set()
    duplicates = []

    if method == "exact":
        # Exact duplicate detection using hash
        import hashlib

        for ex in examples:
            content_str = str(ex["messages"])
            content_hash = hashlib.md5(content_str.encode()).hexdigest()

            if content_hash in seen_hashes:
                duplicates.append(ex["id"])
            else:
                seen_hashes.add(content_hash)

    elif method == "fuzzy":
        # Fuzzy matching using normalized text comparison
        seen_texts = []

        for ex in examples:
            # Normalize text
            text = " ".join(
                m.get("content", "").lower().strip()
                for m in ex["messages"]
            )
            text = " ".join(text.split())  # Normalize whitespace

            # Check similarity with seen texts
            is_duplicate = False
            for seen in seen_texts:
                similarity = _text_similarity(text, seen)
                if similarity >= threshold:
                    is_duplicate = True
                    break

            if is_duplicate:
                duplicates.append(ex["id"])
            else:
                seen_texts.append(text)

    elif method == "semantic":
        # This would use embeddings - for now, fall back to fuzzy
        return await deduplicate_dataset(project_id, threshold, "fuzzy")

    # Remove duplicates
    if duplicates:
        await db.delete_examples(project_id, duplicates)

    return {
        "duplicates_removed": len(duplicates),
        "examples_remaining": len(examples) - len(duplicates),
    }


def _text_similarity(text1: str, text2: str) -> float:
    """Calculate simple text similarity using character overlap."""
    if not text1 or not text2:
        return 0.0

    # Use character n-grams for comparison
    def get_ngrams(text: str, n: int = 3) -> set:
        return {text[i : i + n] for i in range(len(text) - n + 1)}

    ngrams1 = get_ngrams(text1)
    ngrams2 = get_ngrams(text2)

    if not ngrams1 or not ngrams2:
        return 0.0

    intersection = len(ngrams1 & ngrams2)
    union = len(ngrams1 | ngrams2)

    return intersection / union if union > 0 else 0.0


@router.post("/{project_id}/validate-for-model", response_model=ModelValidationResult)
async def validate_for_model(
    project_id: str,
    config: ModelValidationConfig,
) -> ModelValidationResult:
    """
    Validate dataset against specific model constraints.

    Performs comprehensive validation including:
    - Context length limits (error if over, warning if near training budget)
    - System message support (warning if model doesn't support system role)
    - Special token conflicts (error if content contains model tokens)
    - Empty message detection
    - Required role validation (user/assistant)
    - Multi-turn support checks
    """
    from dataforge_core.model_validation import (
        get_model_constraints,
    )
    from dataforge_core.model_validation import (
        validate_for_model as do_validate,
    )

    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    examples = await db.get_examples(project_id, offset=0, limit=100000)

    if not examples:
        return ModelValidationResult(
            is_valid=True,
            total_examples=0,
            valid_examples=0,
            error_count=0,
            warning_count=0,
            issues=[],
            recommendations=["No examples to validate. Add some examples first."],
        )

    # Get constraints and validate
    constraints = get_model_constraints(config.model_id)
    examples_data = [{"id": ex["id"], "messages": ex["messages"]} for ex in examples]
    result = do_validate(examples_data, config.model_id, constraints)

    return ModelValidationResult(
        is_valid=result.is_valid,
        total_examples=result.total_examples,
        valid_examples=result.valid_examples,
        error_count=result.error_count,
        warning_count=result.warning_count,
        issues=[
            ModelValidationIssue(
                example_id=issue.example_id,
                issue_type=issue.issue_type.value,
                severity=issue.severity.value,
                message=issue.message,
                auto_fixable=issue.auto_fixable,
                suggested_fix=issue.suggested_fix,
                field=issue.field,
            )
            for issue in result.issues
        ],
        recommendations=result.recommendations,
    )


@router.post("/{project_id}/format-for-model", response_model=FormatForModelResult)
async def format_for_model(
    project_id: str,
    config: ModelValidationConfig,
) -> FormatForModelResult:
    """
    Auto-fix dataset issues for model compatibility.

    Applies automatic fixes for:
    - System messages (merged into first user message if unsupported)
    - Special token conflicts (removed from content)
    - Empty messages (removed)

    Returns the number of examples modified and list of changes applied.
    """
    from dataforge_core.model_validation import (
        auto_fix_for_model,
        get_model_constraints,
    )

    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    examples = await db.get_examples(project_id, offset=0, limit=100000)

    if not examples:
        return FormatForModelResult(
            examples_modified=0,
            changes_applied=[],
        )

    # Get constraints and fix
    constraints = get_model_constraints(config.model_id)
    examples_data = [{"id": ex["id"], "messages": ex["messages"]} for ex in examples]
    fixed_examples, changes = auto_fix_for_model(examples_data, constraints)

    # Apply fixes to database
    modified_count = 0
    for i, (orig, fixed) in enumerate(zip(examples_data, fixed_examples, strict=True)):
        if orig["messages"] != fixed["messages"]:
            await db.update_example(examples[i]["id"], messages=fixed["messages"])
            modified_count += 1

    return FormatForModelResult(
        examples_modified=modified_count,
        changes_applied=changes,
    )


@router.post("/{project_id}/evaluate", response_model=BatchEvaluationResult)
async def start_batch_evaluation(
    project_id: str,
    config: EvaluationConfig,
) -> BatchEvaluationResult:
    """
    Start batch Q&A quality evaluation.

    Evaluates dataset examples using an LLM to score:
    - Coherence: Logical structure
    - Accuracy: Factual correctness
    - Relevance: Addresses the question
    - Completeness: Covers all aspects
    - Clarity: Easy to understand
    - Helpfulness: Useful to the user

    Returns a job ID for tracking progress.
    """
    import uuid

    import litellm
    from litellm import acompletion

    from dataforge_api.config import settings
    from dataforge_core.qa_evaluator import (
        EvaluationConfig as CoreEvalConfig,
    )
    from dataforge_core.qa_evaluator import (
        aggregate_results,
        evaluate_batch,
        results_to_dict,
    )

    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    examples = await db.get_examples(project_id, offset=0, limit=100000)

    if not examples:
        return BatchEvaluationResult(
            job_id="",
            status="completed",
            total_examples=0,
            evaluated_count=0,
            average_score=None,
            results=[],
        )

    # Apply sample size if specified
    if config.sample_size and config.sample_size < len(examples):
        import random
        examples = random.sample(examples, config.sample_size)

    # Create job
    job_id = str(uuid.uuid4())
    await db.create_job(job_id, "evaluation", project_id, {
        "total": len(examples),
        "evaluated": 0,
        "status": "running",
    })

    # Create LLM caller
    async def call_llm(prompt: str) -> str:
        if config.provider == "ollama":
            litellm.api_base = settings.ollama_base_url
            model_name = f"ollama/{config.model}"
        else:
            model_name = f"{config.provider}/{config.model}" if config.provider != "openai" else config.model

        response = await acompletion(
            model=model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=1024,
        )
        return response.choices[0].message.content

    # Prepare examples
    examples_data = [{"id": ex["id"], "messages": ex["messages"]} for ex in examples]

    # Run evaluation
    try:
        eval_config = CoreEvalConfig(dimensions=config.dimensions)
        results = await evaluate_batch(examples_data, call_llm, eval_config)

        # Aggregate results
        summary = aggregate_results(results)

        # Update job
        await db.update_job(job_id, "completed", {
            "total": len(examples),
            "evaluated": len(results),
            "average_score": summary["average_score"],
            "results": [results_to_dict(r) for r in results],
        })

        # Convert results for response
        response_results = [
            SingleEvaluationResult(
                example_id=r.example_id,
                overall_score=r.overall_score,
                dimensions={
                    name: DimensionScore(
                        score=dim.score,
                        explanation=dim.explanation,
                        suggestions=dim.suggestions,
                    )
                    for name, dim in r.dimensions.items()
                },
                errors=r.errors,
                needs_review=r.needs_review,
            )
            for r in results
        ]

        return BatchEvaluationResult(
            job_id=job_id,
            status="completed",
            total_examples=len(examples),
            evaluated_count=len(results),
            average_score=summary["average_score"],
            needs_review_count=summary["needs_review_count"],
            score_distribution=summary["score_distribution"],
            results=response_results,
        )

    except Exception as e:
        await db.update_job(job_id, "failed", {"error": str(e)})
        return BatchEvaluationResult(
            job_id=job_id,
            status="failed",
            total_examples=len(examples),
            evaluated_count=0,
            error=str(e),
        )


@router.get("/{project_id}/evaluate/{job_id}", response_model=BatchEvaluationResult)
async def get_evaluation_status(
    project_id: str,
    job_id: str,
) -> BatchEvaluationResult:
    """Get the status and results of a batch evaluation job."""
    job = await db.get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Evaluation job not found")

    if job.get("project_id") != project_id:
        raise HTTPException(status_code=404, detail="Job not found for this project")

    data = job.get("data", {})
    status = job.get("status", "pending")

    results = None
    if status == "completed" and "results" in data:
        results = [
            SingleEvaluationResult(
                example_id=r["example_id"],
                overall_score=r["overall_score"],
                dimensions={
                    name: DimensionScore(**dim)
                    for name, dim in r.get("dimensions", {}).items()
                },
                errors=r.get("errors", []),
                needs_review=r.get("needs_review", False),
            )
            for r in data["results"]
        ]

    return BatchEvaluationResult(
        job_id=job_id,
        status=status,
        total_examples=data.get("total", 0),
        evaluated_count=data.get("evaluated", 0),
        average_score=data.get("average_score"),
        needs_review_count=data.get("needs_review_count", 0),
        score_distribution=data.get("score_distribution"),
        results=results,
        error=data.get("error"),
    )


@router.post("/{project_id}/evaluate/single", response_model=SingleEvaluationResult)
async def evaluate_single_example(
    project_id: str,
    example_id: str,
    config: EvaluationConfig,
) -> SingleEvaluationResult:
    """
    Evaluate a single example immediately.

    Returns detailed evaluation scores and feedback.
    """
    import litellm
    from litellm import acompletion

    from dataforge_api.config import settings
    from dataforge_core.qa_evaluator import (
        EvaluationConfig as CoreEvalConfig,
    )
    from dataforge_core.qa_evaluator import (
        evaluate_single,
    )

    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    example = await db.get_example(example_id)
    if not example or example.get("project_id") != project_id:
        raise HTTPException(status_code=404, detail="Example not found")

    # Create LLM caller
    async def call_llm(prompt: str) -> str:
        if config.provider == "ollama":
            litellm.api_base = settings.ollama_base_url
            model_name = f"ollama/{config.model}"
        else:
            model_name = f"{config.provider}/{config.model}" if config.provider != "openai" else config.model

        response = await acompletion(
            model=model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=1024,
        )
        return response.choices[0].message.content

    # Evaluate
    eval_config = CoreEvalConfig(dimensions=config.dimensions)
    result = await evaluate_single(
        {"id": example["id"], "messages": example["messages"]},
        call_llm,
        eval_config,
    )

    return SingleEvaluationResult(
        example_id=result.example_id,
        overall_score=result.overall_score,
        dimensions={
            name: DimensionScore(
                score=dim.score,
                explanation=dim.explanation,
                suggestions=dim.suggestions,
            )
            for name, dim in result.dimensions.items()
        },
        errors=result.errors,
        needs_review=result.needs_review,
    )
