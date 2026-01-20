"""File importers for various dataset formats."""

import csv
import io
import json
from pathlib import Path
from typing import Any, List
from uuid import uuid4

import orjson

from dataforge_core.types import DatasetFormat, Example, Message, MessageRole


def detect_format(filename: str, content: bytes) -> str:
    """
    Detect file format from filename and content.

    Returns: jsonl, json, csv, parquet, txt, md, pdf, docx, xlsx, html
    """
    ext = Path(filename).suffix.lower()

    if ext in (".jsonl", ".ndjson"):
        return "jsonl"
    elif ext == ".json":
        return "json"
    elif ext in (".csv", ".tsv"):
        return "csv"
    elif ext in (".parquet", ".pq"):
        return "parquet"
    elif ext == ".md":
        return "markdown"
    elif ext == ".txt":
        return "txt"
    elif ext == ".pdf":
        return "pdf"
    elif ext == ".docx":
        return "docx"
    elif ext in (".xlsx", ".xls"):
        return "xlsx"
    elif ext in (".html", ".htm"):
        return "html"

    # Check magic bytes for binary formats
    if content[:4] == b"%PDF":
        return "pdf"
    if content[:4] == b"PK\x03\x04":  # ZIP magic (DOCX/XLSX are ZIP files)
        # Check for DOCX or XLSX
        if b"word/" in content[:2000]:
            return "docx"
        if b"xl/" in content[:2000]:
            return "xlsx"

    # Try to detect from content
    try:
        text = content.decode("utf-8").strip()
        if text.startswith("{") or text.startswith("["):
            # Check if it's JSONL (multiple JSON objects per line)
            lines = text.split("\n")
            if len(lines) > 1 and all(
                line.strip().startswith("{") for line in lines[:5] if line.strip()
            ):
                return "jsonl"
            return "json"
        elif text.startswith("<!DOCTYPE") or text.startswith("<html"):
            return "html"
        elif "," in text.split("\n")[0]:
            return "csv"
    except Exception:
        pass

    return "txt"


def import_file(content: bytes, file_format: str) -> List[dict]:
    """
    Import file content and return list of examples.

    Returns raw dictionaries - schema detection happens later.
    """
    if file_format == "jsonl":
        return _import_jsonl(content)
    elif file_format == "json":
        return _import_json(content)
    elif file_format == "csv":
        return _import_csv(content)
    elif file_format == "parquet":
        return _import_parquet(content)
    elif file_format == "markdown":
        return _import_markdown(content)
    elif file_format == "txt":
        return _import_txt(content)
    elif file_format == "pdf":
        from dataforge_core.importers_advanced import import_pdf
        return import_pdf(content)
    elif file_format == "docx":
        from dataforge_core.importers_advanced import import_docx
        return import_docx(content)
    elif file_format == "xlsx":
        from dataforge_core.importers_advanced import import_xlsx
        return import_xlsx(content)
    elif file_format == "html":
        from dataforge_core.importers_advanced import import_html
        return import_html(content)
    else:
        raise ValueError(f"Unsupported format: {file_format}")


def _import_jsonl(content: bytes) -> List[dict]:
    """Import JSONL format."""
    examples = []
    text = content.decode("utf-8")

    for line in text.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            data = orjson.loads(line)
            examples.append(data)
        except Exception:
            continue

    return examples


def _import_json(content: bytes) -> List[dict]:
    """Import JSON format (array or single object)."""
    data = orjson.loads(content)

    if isinstance(data, list):
        return data
    elif isinstance(data, dict):
        # Check if it's a HuggingFace dataset format with 'data' key
        if "data" in data and isinstance(data["data"], list):
            return data["data"]
        # Single example
        return [data]

    raise ValueError("JSON must be an array or object")


def _import_csv(content: bytes) -> List[dict]:
    """Import CSV format."""
    # Detect encoding
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        import chardet

        detected = chardet.detect(content)
        text = content.decode(detected["encoding"] or "utf-8", errors="replace")

    # Detect delimiter
    sample = text[:1024]
    if "\t" in sample and sample.count("\t") > sample.count(","):
        delimiter = "\t"
    else:
        delimiter = ","

    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    return list(reader)


def _import_parquet(content: bytes) -> List[dict]:
    """Import Parquet format using Polars."""
    import polars as pl

    df = pl.read_parquet(io.BytesIO(content))
    return df.to_dicts()


def _import_markdown(content: bytes) -> List[dict]:
    """
    Import Markdown format.

    Attempts to extract Q&A pairs from markdown structure.
    Looks for patterns like:
    - ## Question / ## Answer sections
    - **Q:** / **A:** patterns
    - Numbered lists with responses
    """
    text = content.decode("utf-8")
    examples = []

    # Try to find Q&A sections
    lines = text.split("\n")
    current_question = None
    current_answer = []

    for line in lines:
        line_lower = line.lower().strip()

        # Check for question markers
        if line_lower.startswith(("## q", "**q:", "q:", "### question")):
            # Save previous Q&A if exists
            if current_question and current_answer:
                examples.append(
                    {
                        "instruction": current_question,
                        "output": "\n".join(current_answer).strip(),
                    }
                )
            current_question = line.split(":", 1)[-1].strip() if ":" in line else line.strip()
            current_answer = []

        elif line_lower.startswith(("## a", "**a:", "a:", "### answer")):
            # Start collecting answer
            answer_text = line.split(":", 1)[-1].strip() if ":" in line else ""
            if answer_text:
                current_answer.append(answer_text)

        elif current_question is not None:
            # Continue collecting answer
            current_answer.append(line)

    # Save last Q&A
    if current_question and current_answer:
        examples.append(
            {
                "instruction": current_question,
                "output": "\n".join(current_answer).strip(),
            }
        )

    # If no Q&A pattern found, treat as single document
    if not examples:
        examples.append(
            {
                "instruction": "Summarize the following document:",
                "input": text,
                "output": "",
            }
        )

    return examples


def _import_txt(content: bytes) -> List[dict]:
    """
    Import plain text format.

    Attempts to detect structure or treats as single document.
    """
    text = content.decode("utf-8")

    # Check for common separators
    if "\n---\n" in text:
        # Split by horizontal rules
        sections = text.split("\n---\n")
        return [{"text": section.strip()} for section in sections if section.strip()]

    elif "\n\n\n" in text:
        # Split by multiple blank lines
        sections = text.split("\n\n\n")
        return [{"text": section.strip()} for section in sections if section.strip()]

    # Single document
    return [{"text": text.strip()}]


def parse_to_examples(raw_data: List[dict], schema: "DetectedSchema") -> List[Example]:
    """
    Convert raw dictionaries to Example objects using detected schema.
    """
    from dataforge_core.types import DetectedSchema

    examples = []

    for item in raw_data:
        example_id = str(uuid4())
        messages = []

        if schema.format == DatasetFormat.ALPACA:
            # Alpaca format: instruction, input (optional), output
            if "system" in item:
                messages.append(Message(role=MessageRole.SYSTEM, content=item["system"]))

            instruction = item.get("instruction", "")
            input_text = item.get("input", "")

            user_content = instruction
            if input_text:
                user_content = f"{instruction}\n\n{input_text}"

            messages.append(Message(role=MessageRole.USER, content=user_content))

            if "output" in item:
                messages.append(Message(role=MessageRole.ASSISTANT, content=item["output"]))

        elif schema.format == DatasetFormat.SHAREGPT:
            # ShareGPT format: conversations array with from/value
            conversations = item.get("conversations", [])
            for conv in conversations:
                role_str = conv.get("from", "").lower()
                content = conv.get("value", "")

                if role_str in ("system",):
                    role = MessageRole.SYSTEM
                elif role_str in ("human", "user"):
                    role = MessageRole.USER
                elif role_str in ("gpt", "assistant", "model"):
                    role = MessageRole.ASSISTANT
                else:
                    role = MessageRole.USER

                messages.append(Message(role=role, content=content))

        elif schema.format in (DatasetFormat.CHATML, DatasetFormat.OPENAI):
            # ChatML/OpenAI format: messages array with role/content
            msg_list = item.get("messages", [])
            for msg in msg_list:
                role_str = msg.get("role", "").lower()
                content = msg.get("content", "")

                if role_str == "system":
                    role = MessageRole.SYSTEM
                elif role_str == "user":
                    role = MessageRole.USER
                elif role_str == "assistant":
                    role = MessageRole.ASSISTANT
                elif role_str == "tool":
                    role = MessageRole.TOOL
                else:
                    role = MessageRole.USER

                messages.append(Message(role=role, content=content))

        else:
            # Custom/unknown format - try common field names
            if "prompt" in item and "response" in item:
                messages.append(Message(role=MessageRole.USER, content=item["prompt"]))
                messages.append(Message(role=MessageRole.ASSISTANT, content=item["response"]))
            elif "question" in item and "answer" in item:
                messages.append(Message(role=MessageRole.USER, content=item["question"]))
                messages.append(Message(role=MessageRole.ASSISTANT, content=item["answer"]))
            elif "input" in item and "output" in item:
                messages.append(Message(role=MessageRole.USER, content=item["input"]))
                messages.append(Message(role=MessageRole.ASSISTANT, content=item["output"]))
            elif "text" in item:
                # Single text field - treat as user message
                messages.append(Message(role=MessageRole.USER, content=item["text"]))

        if messages:
            examples.append(Example(id=example_id, messages=messages, metadata={}))

    return examples
