"""Dataset import and manipulation endpoints."""

import json
import traceback
from typing import Annotated, Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from dataforge_api import database as db
from dataforge_api.config import settings
from dataforge_api.routers.logs import log_error

router = APIRouter()


class Message(BaseModel):
    """A single message in a conversation."""

    role: str
    content: str


class DatasetExample(BaseModel):
    """A single example in the dataset."""

    id: str
    messages: list[Message]
    metadata: dict[str, Any] | None = None
    split: str = "train"  # train, validation, test
    quality_score: float | None = None
    token_count: int | None = None


class DetectedSchema(BaseModel):
    """Detected dataset structure."""

    format: str  # alpaca, sharegpt, chatml, custom
    confidence: float
    fields: list[str]
    sample_count: int
    suggested_mapping: dict[str, str] | None = None


class ImportResult(BaseModel):
    """Result of importing a dataset."""

    success: bool
    imported: int  # Number of examples imported
    detected_schema: DetectedSchema
    warnings: list[str] = []
    errors: list[str] = []


class DatasetStats(BaseModel):
    """Statistics about a dataset."""

    total_examples: int
    avg_instruction_length: float
    avg_response_length: float
    format: str
    token_estimate: int


class ExampleCreate(BaseModel):
    """Request to create a new example."""

    messages: list[Message]
    metadata: dict[str, Any] | None = None


class ExampleUpdate(BaseModel):
    """Request to update an example."""

    messages: list[Message] | None = None
    metadata: dict[str, Any] | None = None


class BulkDeleteRequest(BaseModel):
    """Request to delete multiple examples."""

    example_ids: list[str]


class URLImportRequest(BaseModel):
    """Request to import from URL."""

    url: str
    max_examples: int | None = None  # Limit number of examples to import
    split: str = "train"  # Dataset split for HuggingFace


class URLPreviewResult(BaseModel):
    """Result of previewing a URL import."""

    url_type: str  # huggingface, generic_json, generic_jsonl
    dataset_id: str | None = None  # For HuggingFace
    detected_schema: DetectedSchema
    sample_examples: list[dict]
    total_count: int | None = None  # May be None if unknown
    error: str | None = None


class URLImportResult(BaseModel):
    """Result of URL import."""

    success: bool
    imported: int
    source_url: str
    detected_schema: DetectedSchema
    warnings: list[str] = []
    errors: list[str] = []


class DocumentGenerationConfig(BaseModel):
    """Configuration for document-to-dataset generation."""

    questions_per_chunk: int = 3
    style: str = "qa"  # qa, instruction, summary
    provider: str = "ollama"
    model: str = "llama3.2"
    temperature: float = 0.7


class DocumentGenerationResult(BaseModel):
    """Result of document generation."""

    success: bool
    examples_generated: int
    chunks_processed: int
    total_chunks: int
    errors: list[str] = []
    warnings: list[str] = []


@router.post("/{project_id}/import", response_model=ImportResult)
async def import_dataset(
    project_id: str,
    file: Annotated[UploadFile, File(...)],
    source_format: Annotated[str | None, Form()] = None,
) -> ImportResult:
    """
    Import a dataset file into a project.

    Supports: JSONL, JSON, CSV, Parquet
    Auto-detects format if not specified.
    """
    from dataforge_core.detection import detect_schema
    from dataforge_core.importers import detect_format, import_file

    # Verify project exists
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Read file content
    content = await file.read()
    filename = file.filename or "unknown"

    try:
        # Detect file format and import
        file_format = source_format or detect_format(filename, content)
        raw_examples = import_file(content, file_format)

        # Detect dataset schema
        schema = detect_schema(raw_examples)

        # Convert to standard format
        examples = _normalize_examples(raw_examples, schema.format)

        # Store in database
        count = await db.add_examples(project_id, examples)

        # Update project with detected format
        await db.update_project(project_id, source_format=schema.format.value)

        return ImportResult(
            success=True,
            imported=count,
            detected_schema=DetectedSchema(
                format=schema.format.value,
                confidence=schema.confidence,
                fields=schema.fields,
                sample_count=min(5, len(raw_examples)),
                suggested_mapping=schema.suggested_mapping,
            ),
            warnings=schema.warnings,
        )
    except Exception as e:
        log_error(
            source="import",
            error_type=type(e).__name__,
            error_message=f"File import failed: {str(e)}",
            details={"traceback": traceback.format_exc()},
        )
        return ImportResult(
            success=False,
            imported=0,
            detected_schema=DetectedSchema(
                format="unknown",
                confidence=0.0,
                fields=[],
                sample_count=0,
            ),
            errors=[f"{type(e).__name__}: {str(e)}"],
        )


@router.post("/{project_id}/import/paste", response_model=ImportResult)
async def import_from_paste(
    project_id: str,
    content: str = Form(...),
    source_format: str | None = Form(None),
) -> ImportResult:
    """Import dataset from pasted content."""
    from dataforge_core.detection import detect_schema
    from dataforge_core.importers import detect_format, import_file

    # Verify project exists
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    try:
        content_bytes = content.encode("utf-8")
        file_format = source_format or detect_format("paste.jsonl", content_bytes)
        raw_examples = import_file(content_bytes, file_format)
        schema = detect_schema(raw_examples)

        # Convert and store
        examples = _normalize_examples(raw_examples, schema.format)
        count = await db.add_examples(project_id, examples)

        await db.update_project(project_id, source_format=schema.format.value)

        return ImportResult(
            success=True,
            imported=count,
            detected_schema=DetectedSchema(
                format=schema.format.value,
                confidence=schema.confidence,
                fields=schema.fields,
                sample_count=min(5, len(raw_examples)),
                suggested_mapping=schema.suggested_mapping,
            ),
            warnings=schema.warnings,
        )
    except Exception as e:
        log_error(
            source="import",
            error_type=type(e).__name__,
            error_message=f"Paste import failed: {str(e)}",
            details={"traceback": traceback.format_exc()},
        )
        return ImportResult(
            success=False,
            imported=0,
            detected_schema=DetectedSchema(
                format="unknown",
                confidence=0.0,
                fields=[],
                sample_count=0,
            ),
            errors=[f"{type(e).__name__}: {str(e)}"],
        )


@router.post("/{project_id}/import/url/preview", response_model=URLPreviewResult)
async def preview_url_import(
    project_id: str,
    request: URLImportRequest,
) -> URLPreviewResult:
    """
    Preview importing from a URL.

    Fetches a small sample (5 examples) to preview the data
    without importing. Works with HuggingFace URLs and direct
    JSON/JSONL file URLs.
    """
    from dataforge_core.detection import detect_schema
    from dataforge_core.url_parser import parse_dataset_url

    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Parse the URL
    parsed = parse_dataset_url(request.url)

    if parsed.error:
        return URLPreviewResult(
            url_type="unknown",
            detected_schema=DetectedSchema(
                format="unknown",
                confidence=0.0,
                fields=[],
                sample_count=0,
            ),
            sample_examples=[],
            error=parsed.error,
        )

    try:
        if parsed.url_type == "huggingface":
            # Preview HuggingFace dataset
            samples, total_count = await _preview_huggingface(
                parsed.huggingface.dataset_id,
                parsed.huggingface.config,
                request.split or parsed.huggingface.split,
            )
            dataset_id = parsed.huggingface.dataset_id

        else:
            # Preview generic URL
            samples, total_count = await _preview_generic_url(
                parsed.generic.url,
                parsed.generic.format,
            )
            dataset_id = None

        # Detect schema from samples
        schema = detect_schema(samples)

        return URLPreviewResult(
            url_type=parsed.url_type,
            dataset_id=dataset_id,
            detected_schema=DetectedSchema(
                format=schema.format.value,
                confidence=schema.confidence,
                fields=schema.fields,
                sample_count=len(samples),
                suggested_mapping=schema.suggested_mapping,
            ),
            sample_examples=samples[:5],
            total_count=total_count,
        )

    except Exception as e:
        return URLPreviewResult(
            url_type=parsed.url_type,
            detected_schema=DetectedSchema(
                format="unknown",
                confidence=0.0,
                fields=[],
                sample_count=0,
            ),
            sample_examples=[],
            error=str(e),
        )


@router.post("/{project_id}/import/url", response_model=URLImportResult)
async def import_from_url(
    project_id: str,
    request: URLImportRequest,
) -> URLImportResult:
    """
    Import dataset from a URL.

    Supports:
    - HuggingFace dataset URLs (e.g., https://huggingface.co/datasets/tatsu-lab/alpaca)
    - Direct JSON/JSONL file URLs
    """
    from dataforge_core.detection import detect_schema
    from dataforge_core.url_parser import parse_dataset_url

    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Parse the URL
    parsed = parse_dataset_url(request.url)

    if parsed.error:
        return URLImportResult(
            success=False,
            imported=0,
            source_url=request.url,
            detected_schema=DetectedSchema(
                format="unknown",
                confidence=0.0,
                fields=[],
                sample_count=0,
            ),
            errors=[parsed.error],
        )

    warnings = []
    try:
        if parsed.url_type == "huggingface":
            # Import from HuggingFace
            raw_examples = await _import_huggingface(
                parsed.huggingface.dataset_id,
                parsed.huggingface.config,
                request.split or parsed.huggingface.split,
                request.max_examples,
            )

        else:
            # Import from generic URL
            raw_examples = await _import_generic_url(
                parsed.generic.url,
                parsed.generic.format,
                request.max_examples,
            )

        if not raw_examples:
            return URLImportResult(
                success=False,
                imported=0,
                source_url=request.url,
                detected_schema=DetectedSchema(
                    format="unknown",
                    confidence=0.0,
                    fields=[],
                    sample_count=0,
                ),
                errors=["No examples found at URL"],
            )

        # Detect schema
        schema = detect_schema(raw_examples[:100])  # Sample for detection

        # Normalize examples
        examples = _normalize_examples(raw_examples, schema.format)

        # Store in database
        count = await db.add_examples(project_id, examples)

        # Update project
        await db.update_project(
            project_id,
            source_format=schema.format.value,
            source_url=request.url,
        )

        return URLImportResult(
            success=True,
            imported=count,
            source_url=request.url,
            detected_schema=DetectedSchema(
                format=schema.format.value,
                confidence=schema.confidence,
                fields=schema.fields,
                sample_count=min(5, len(raw_examples)),
                suggested_mapping=schema.suggested_mapping,
            ),
            warnings=warnings + schema.warnings,
        )

    except Exception as e:
        # Log the full error with traceback
        error_details = {
            "url": request.url,
            "error_type": type(e).__name__,
            "traceback": traceback.format_exc(),
        }
        log_error(
            source="import",
            error_type=type(e).__name__,
            error_message=f"URL import failed: {str(e)}",
            details=error_details,
        )

        return URLImportResult(
            success=False,
            imported=0,
            source_url=request.url,
            detected_schema=DetectedSchema(
                format="unknown",
                confidence=0.0,
                fields=[],
                sample_count=0,
            ),
            errors=[f"{type(e).__name__}: {str(e)}"],
        )


async def _preview_huggingface(
    dataset_id: str,
    config: str | None,
    split: str,
) -> tuple[list[dict], int | None]:
    """Preview HuggingFace dataset (first 5 examples)."""
    from datasets import load_dataset

    # Load just a small sample
    try:
        ds = load_dataset(
            dataset_id,
            config,
            split=split,
            streaming=True,
            trust_remote_code=True,
        )

        samples = []
        for i, example in enumerate(ds):
            if i >= 5:
                break
            samples.append(dict(example))

        # Try to get total count (may not be available for streaming)
        total = None
        try:
            ds_info = load_dataset(
                dataset_id,
                config,
                split=split,
                trust_remote_code=True,
            )
            total = len(ds_info)
        except Exception:
            pass

        return samples, total

    except Exception as e:
        raise ValueError(f"Failed to load HuggingFace dataset: {e}") from e


async def _import_huggingface(
    dataset_id: str,
    config: str | None,
    split: str,
    max_examples: int | None,
) -> list[dict]:
    """Import examples from HuggingFace."""
    from datasets import load_dataset

    try:
        if max_examples:
            # Use streaming for limited import
            ds = load_dataset(
                dataset_id,
                config,
                split=split,
                streaming=True,
                trust_remote_code=True,
            )
            examples = []
            for i, example in enumerate(ds):
                if i >= max_examples:
                    break
                examples.append(dict(example))
            return examples
        else:
            # Load full dataset
            ds = load_dataset(
                dataset_id,
                config,
                split=split,
                trust_remote_code=True,
            )
            return [dict(example) for example in ds]

    except Exception as e:
        raise ValueError(f"Failed to load HuggingFace dataset: {e}") from e


async def _preview_generic_url(
    url: str,
    format_type: str,
) -> tuple[list[dict], int | None]:
    """Preview generic URL (first 5 examples)."""
    import httpx

    async with httpx.AsyncClient() as client:
        response = await client.get(url, follow_redirects=True, timeout=30.0)
        response.raise_for_status()
        content = response.text

    if format_type == "jsonl":
        lines = content.strip().split("\n")
        samples = [json.loads(line) for line in lines[:5] if line.strip()]
        total = len([line for line in lines if line.strip()])
    else:  # json
        data = json.loads(content)
        if isinstance(data, list):
            samples = data[:5]
            total = len(data)
        else:
            samples = [data]
            total = 1

    return samples, total


async def _import_generic_url(
    url: str,
    format_type: str,
    max_examples: int | None,
) -> list[dict]:
    """Import from generic JSON/JSONL URL."""
    import httpx

    async with httpx.AsyncClient() as client:
        response = await client.get(url, follow_redirects=True, timeout=60.0)
        response.raise_for_status()
        content = response.text

    if format_type == "jsonl":
        lines = content.strip().split("\n")
        examples = [json.loads(line) for line in lines if line.strip()]
    else:  # json
        data = json.loads(content)
        examples = data if isinstance(data, list) else [data]

    if max_examples:
        examples = examples[:max_examples]

    return examples


@router.post("/{project_id}/import/document/generate", response_model=DocumentGenerationResult)
async def generate_from_document(
    project_id: str,
    file: Annotated[UploadFile, File(...)],
    questions_per_chunk: Annotated[int, Form()] = 3,
    style: Annotated[str, Form()] = "qa",
    provider: Annotated[str, Form()] = "ollama",
    model: Annotated[str, Form()] = "llama3.2",
    temperature: Annotated[float, Form()] = 0.7,
) -> DocumentGenerationResult:
    """
    Import document and generate Q&A pairs using LLM.

    Supports: PDF, DOCX, PPTX, HTML, Markdown, TXT
    Uses the specified LLM provider (default: Ollama) to generate
    question-answer pairs from document content.

    Generation styles:
    - qa: Question and answer pairs
    - instruction: Instruction-response pairs for assistant training
    - summary: Summarization tasks
    """
    from litellm import acompletion

    from dataforge_core.document_generator import (
        GenerationConfig,
        chunk_document,
        examples_to_messages,
        generate_from_chunks,
    )

    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Read file content
    content = await file.read()
    filename = file.filename or "document"
    ext = filename.lower().split(".")[-1] if "." in filename else ""

    # Extract text from document
    try:
        if ext == "pdf":
            from dataforge_core.importers_advanced import import_pdf
            raw_examples = import_pdf(content)
            full_text = "\n\n".join(ex.get("input", "") for ex in raw_examples)

        elif ext in ("docx", "doc"):
            from dataforge_core.importers_advanced import import_docx
            raw_examples = import_docx(content)
            full_text = "\n\n".join(ex.get("input", "") for ex in raw_examples)

        elif ext in ("pptx", "ppt"):
            from dataforge_core.importers_advanced import import_pptx
            raw_examples = import_pptx(content)
            full_text = "\n\n".join(ex.get("input", "") for ex in raw_examples)

        elif ext == "html":
            from dataforge_core.importers_advanced import import_html
            raw_examples = import_html(content)
            full_text = "\n\n".join(ex.get("input", "") for ex in raw_examples)

        elif ext in ("xlsx", "xls"):
            from dataforge_core.importers_advanced import import_xlsx
            raw_examples = import_xlsx(content)
            full_text = "\n\n".join(ex.get("input", "") for ex in raw_examples)

        elif ext == "md" or ext == "txt":
            full_text = content.decode("utf-8", errors="replace")

        else:
            # Try as plain text
            full_text = content.decode("utf-8", errors="replace")

    except Exception as e:
        return DocumentGenerationResult(
            success=False,
            examples_generated=0,
            chunks_processed=0,
            total_chunks=0,
            errors=[f"Failed to extract text from document: {e}"],
        )

    if not full_text.strip():
        return DocumentGenerationResult(
            success=False,
            examples_generated=0,
            chunks_processed=0,
            total_chunks=0,
            errors=["Document appears to be empty or could not be read"],
        )

    # Chunk the document
    chunks = chunk_document(full_text, max_chunk_size=2000)
    total_chunks = len(chunks)

    # Create LLM caller
    async def call_llm(prompt: str) -> str:
        import litellm

        # Configure provider
        if provider == "ollama":
            litellm.api_base = settings.ollama_base_url
            model_name = f"ollama/{model}"
        elif provider == "openai":
            model_name = model
        else:
            model_name = f"{provider}/{model}"

        response = await acompletion(
            model=model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            max_tokens=2048,
        )
        return response.choices[0].message.content

    # Generate examples
    config = GenerationConfig(
        questions_per_chunk=questions_per_chunk,
        style=style,
        temperature=temperature,
    )

    generated_examples = []
    errors = []
    processed_chunks = 0

    async for example in generate_from_chunks(chunks, call_llm, config):
        processed_chunks += 1

        if example.metadata.get("error"):
            errors.append(f"Chunk {example.metadata.get('chunk_index', '?')}: {example.metadata['error']}")
            continue

        if example.question and example.answer:
            generated_examples.append(example)

    # Convert to message format and store
    examples_data = examples_to_messages(generated_examples)

    if examples_data:
        count = await db.add_examples(project_id, examples_data)
    else:
        count = 0

    return DocumentGenerationResult(
        success=count > 0,
        examples_generated=count,
        chunks_processed=processed_chunks,
        total_chunks=total_chunks,
        errors=errors[:10],  # Limit error list
        warnings=[f"Processed {processed_chunks}/{total_chunks} chunks"] if processed_chunks < total_chunks else [],
    )


@router.get("/{project_id}/examples", response_model=list[DatasetExample])
async def list_examples(
    project_id: str,
    offset: int = 0,
    limit: int = 100,
    split: str | None = None,
) -> list[DatasetExample]:
    """
    List examples in a project's dataset with pagination.

    Args:
        project_id: Project ID
        offset: Pagination offset
        limit: Max results to return
        split: Filter by split (train/validation/test)
    """
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    examples = await db.get_examples(project_id, offset=offset, limit=limit, split=split)

    return [
        DatasetExample(
            id=ex["id"],
            messages=[Message(**m) for m in ex["messages"]],
            metadata=ex.get("metadata"),
            split=ex.get("split", "train"),
            quality_score=ex.get("quality_score"),
            token_count=ex.get("token_count"),
        )
        for ex in examples
    ]


@router.get("/{project_id}/examples/{example_id}", response_model=DatasetExample)
async def get_example(project_id: str, example_id: str) -> DatasetExample:
    """Get a single example by ID."""
    example = await db.get_example(example_id)
    if not example or example.get("project_id") != project_id:
        raise HTTPException(status_code=404, detail="Example not found")

    return DatasetExample(
        id=example["id"],
        messages=[Message(**m) for m in example["messages"]],
        metadata=example.get("metadata"),
        split=example.get("split", "train"),
        quality_score=example.get("quality_score"),
        token_count=example.get("token_count"),
    )


class BulkAddRequest(BaseModel):
    """Request to add multiple examples."""

    examples: list[dict]


@router.post("/{project_id}/examples")
async def add_examples(project_id: str, data: BulkAddRequest) -> dict:
    """Add multiple examples to a project."""
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Normalize examples to standard format
    normalized = []
    for ex in data.examples:
        if "messages" in ex:
            normalized.append({
                "messages": ex["messages"],
                "metadata": ex.get("metadata", {}),
            })

    count = await db.add_examples(project_id, normalized)
    return {"added": count}


@router.patch("/{project_id}/examples/{example_id}", response_model=DatasetExample)
@router.put("/{project_id}/examples/{example_id}", response_model=DatasetExample)
async def update_example(
    project_id: str,
    example_id: str,
    data: ExampleUpdate,
) -> DatasetExample:
    """Update an example (supports both PATCH and PUT)."""
    example = await db.get_example(example_id)
    if not example or example.get("project_id") != project_id:
        raise HTTPException(status_code=404, detail="Example not found")

    updates = {}
    if data.messages is not None:
        updates["messages"] = [m.model_dump() for m in data.messages]
    if data.metadata is not None:
        updates["metadata"] = data.metadata

    if updates:
        example = await db.update_example(example_id, **updates)

    return DatasetExample(
        id=example["id"],
        messages=[Message(**m) for m in example["messages"]],
        metadata=example.get("metadata"),
        quality_score=example.get("quality_score"),
        token_count=example.get("token_count"),
    )


@router.delete("/{project_id}/examples/{example_id}")
async def delete_example(project_id: str, example_id: str) -> dict:
    """Delete an example."""
    example = await db.get_example(example_id)
    if not example or example.get("project_id") != project_id:
        raise HTTPException(status_code=404, detail="Example not found")

    await db.delete_example(example_id)
    return {"status": "deleted", "id": example_id}


@router.post("/{project_id}/examples/delete")
async def delete_examples(
    project_id: str,
    data: BulkDeleteRequest,
) -> dict:
    """Delete multiple examples at once."""
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    count = await db.delete_examples(project_id, data.example_ids)
    return {"deleted": count}


@router.get("/{project_id}/stats", response_model=DatasetStats)
async def get_dataset_stats(project_id: str) -> DatasetStats:
    """Get statistics about the dataset."""
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    stats = await db.get_project_stats(project_id)

    return DatasetStats(
        total_examples=stats.get("total_examples", 0) or 0,
        avg_instruction_length=stats.get("avg_user_length", 0) or 0,
        avg_response_length=stats.get("avg_assistant_length", 0) or 0,
        format=project.get("source_format", "unknown") or "unknown",
        token_estimate=int((stats.get("avg_tokens", 0) or 0) * (stats.get("total_examples", 0) or 0)),
    )


@router.post("/{project_id}/convert")
async def convert_format(
    project_id: str,
    target_format: str = Form(...),
) -> dict:
    """Convert dataset between formats (Alpaca ↔ ShareGPT ↔ ChatML)."""
    from dataforge_core.formatters import convert_format as do_convert
    from dataforge_core.types import DatasetFormat

    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Get all examples
    examples = await db.get_examples(project_id, offset=0, limit=100000)

    # Determine source format
    source_format = DatasetFormat(project.get("source_format", "chatml"))
    target = DatasetFormat(target_format)

    # Convert
    converted = do_convert(
        [{"messages": ex["messages"]} for ex in examples],
        source_format,
        target,
    )

    # Update examples in database
    for i, ex in enumerate(examples):
        if i < len(converted):
            await db.update_example(ex["id"], messages=converted[i].get("messages", []))

    # Update project format
    await db.update_project(project_id, source_format=target_format)

    return {"status": "converted", "target_format": target_format, "count": len(converted)}


def _normalize_examples(raw_examples: list[dict], format_type) -> list[dict]:
    """Convert raw imported data to standard message format."""
    from dataforge_core.types import DatasetFormat

    normalized = []

    for item in raw_examples:
        messages = []

        if format_type == DatasetFormat.CHATML or "messages" in item:
            # Already in ChatML format
            messages = item.get("messages", [])

        elif format_type == DatasetFormat.SHAREGPT or "conversations" in item:
            # ShareGPT format
            for conv in item.get("conversations", []):
                role_map = {"system": "system", "human": "user", "gpt": "assistant"}
                role = role_map.get(conv.get("from", "human"), "user")
                messages.append({"role": role, "content": conv.get("value", "")})

        elif format_type == DatasetFormat.ALPACA or "instruction" in item:
            # Alpaca format
            if item.get("system"):
                messages.append({"role": "system", "content": item["system"]})

            user_content = item.get("instruction", "")
            if item.get("input"):
                user_content = f"{user_content}\n\n{item['input']}"
            messages.append({"role": "user", "content": user_content})

            if item.get("output"):
                messages.append({"role": "assistant", "content": item["output"]})

        else:
            # Try common field patterns
            if "prompt" in item and "response" in item:
                messages.append({"role": "user", "content": item["prompt"]})
                messages.append({"role": "assistant", "content": item["response"]})
            elif "question" in item and "answer" in item:
                messages.append({"role": "user", "content": item["question"]})
                messages.append({"role": "assistant", "content": item["answer"]})
            elif "input" in item and "output" in item:
                messages.append({"role": "user", "content": item["input"]})
                messages.append({"role": "assistant", "content": item["output"]})
            elif "text" in item:
                messages.append({"role": "user", "content": item["text"]})

        if messages:
            normalized.append({"messages": messages, "metadata": {}})

    return normalized


@router.get("/{project_id}/analytics")
async def get_dataset_analytics(project_id: str) -> dict:
    """
    Get analytics for a dataset.

    This is a convenience endpoint that redirects to /api/v1/analytics/{project_id}.
    For full analytics, use the analytics router directly.
    """
    from dataforge_api.routers.analytics import get_project_analytics

    result = await get_project_analytics(project_id)
    # Convert Pydantic model to dict
    return result.model_dump() if hasattr(result, 'model_dump') else result
