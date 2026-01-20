"""Document-to-dataset generation using LLM."""

import json
import re
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Callable, List, Optional


@dataclass
class GenerationConfig:
    """Configuration for Q&A generation from documents."""

    questions_per_chunk: int = 3
    style: str = "qa"  # qa, instruction, summary
    temperature: float = 0.7
    max_tokens: int = 2048
    include_source_reference: bool = True
    question_types: List[str] = field(default_factory=lambda: ["what", "how", "why", "explain"])


@dataclass
class GeneratedExample:
    """A generated Q&A example."""

    question: str
    answer: str
    source_chunk: str
    confidence: float = 1.0
    metadata: dict = field(default_factory=dict)


# Generation prompts for different styles
GENERATION_PROMPTS = {
    "qa": """Based on the following document excerpt, generate {n} question-answer pairs.

Document:
{chunk}

Requirements:
- Questions should be specific and answerable from the text
- Answers should be comprehensive but concise (2-4 sentences)
- Vary question types: what, how, why, explain, compare
- Do not ask questions that cannot be answered from the text
- Make questions clear and unambiguous

Output your response as a JSON array with this format:
[
  {{"question": "...", "answer": "...", "confidence": 0.0-1.0}},
  ...
]

Generate exactly {n} Q&A pairs:""",

    "instruction": """Based on the following document excerpt, generate {n} instruction-response pairs suitable for fine-tuning an AI assistant.

Document:
{chunk}

Requirements:
- Instructions should be tasks that a user might ask an AI assistant
- Responses should be helpful, accurate, and well-formatted
- Vary the instruction types: explain, summarize, analyze, list, compare
- Make instructions natural, as a real user would phrase them

Output your response as a JSON array with this format:
[
  {{"question": "...", "answer": "...", "confidence": 0.0-1.0}},
  ...
]

Generate exactly {n} instruction-response pairs:""",

    "summary": """Based on the following document excerpt, generate {n} summary-focused examples.

Document:
{chunk}

Requirements:
- Create varied summarization tasks: brief summary, key points, main ideas
- Summaries should capture the essential information
- Include different granularities: one-sentence, paragraph, bullet points

Output your response as a JSON array with this format:
[
  {{"question": "...", "answer": "...", "confidence": 0.0-1.0}},
  ...
]

Generate exactly {n} summary examples:""",
}


def get_generation_prompt(style: str, chunk: str, n: int) -> str:
    """Get the prompt template for a generation style."""
    template = GENERATION_PROMPTS.get(style, GENERATION_PROMPTS["qa"])
    return template.format(chunk=chunk, n=n)


def chunk_document(
    text: str,
    max_chunk_size: int = 2000,
    overlap: int = 200,
    respect_boundaries: bool = True,
) -> List[str]:
    """
    Split document text into chunks suitable for Q&A generation.

    Args:
        text: The document text
        max_chunk_size: Maximum characters per chunk
        overlap: Character overlap between chunks
        respect_boundaries: Try to break at paragraph/sentence boundaries

    Returns:
        List of text chunks
    """
    if len(text) <= max_chunk_size:
        return [text.strip()]

    chunks = []
    start = 0

    while start < len(text):
        end = start + max_chunk_size

        if end >= len(text):
            chunks.append(text[start:].strip())
            break

        if respect_boundaries:
            # Try to find a good break point
            # Priority: paragraph break > sentence break > word break

            # Look for paragraph break
            para_break = text.rfind("\n\n", start + max_chunk_size // 2, end)
            if para_break > start:
                end = para_break

            # Look for sentence break
            elif (sentence_break := text.rfind(". ", start + max_chunk_size // 2, end)) > start:
                end = sentence_break + 1

            # Look for word break
            elif (word_break := text.rfind(" ", start + max_chunk_size // 2, end)) > start:
                end = word_break

        chunks.append(text[start:end].strip())
        start = end - overlap if overlap > 0 else end

    return [c for c in chunks if c.strip()]


def parse_llm_response(response: str) -> List[dict]:
    """
    Parse LLM response to extract Q&A pairs.

    Handles various response formats including:
    - JSON array
    - Markdown code blocks with JSON
    - Plain text with Q&A patterns
    """
    response = response.strip()

    # Try to extract JSON from markdown code block
    code_block_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', response, re.DOTALL)
    if code_block_match:
        response = code_block_match.group(1).strip()

    # Try parsing as JSON array
    try:
        data = json.loads(response)
        if isinstance(data, list):
            return data
        elif isinstance(data, dict) and "questions" in data:
            return data["questions"]
        elif isinstance(data, dict) and "pairs" in data:
            return data["pairs"]
    except json.JSONDecodeError:
        pass

    # Try to find JSON array in the response
    array_match = re.search(r'\[\s*\{.*?\}\s*\]', response, re.DOTALL)
    if array_match:
        try:
            return json.loads(array_match.group())
        except json.JSONDecodeError:
            pass

    # Fall back to pattern matching for Q&A pairs
    pairs = []
    qa_pattern = re.compile(
        r'(?:Q(?:uestion)?|^\d+)[:\.]?\s*(.+?)\s*'
        r'(?:A(?:nswer)?)[:\.]?\s*(.+?)(?=(?:Q(?:uestion)?|^\d+)[:\.]|\Z)',
        re.MULTILINE | re.DOTALL | re.IGNORECASE
    )

    for match in qa_pattern.finditer(response):
        question = match.group(1).strip()
        answer = match.group(2).strip()
        if question and answer:
            pairs.append({
                "question": question,
                "answer": answer,
                "confidence": 0.7,  # Lower confidence for pattern-matched
            })

    return pairs


async def generate_from_chunks(
    chunks: List[str],
    llm_call: Callable[[str], Any],
    config: GenerationConfig,
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> AsyncGenerator[GeneratedExample, None]:
    """
    Generate Q&A pairs from document chunks using an LLM.

    Args:
        chunks: List of text chunks from the document
        llm_call: Async function to call the LLM with a prompt
        config: Generation configuration
        progress_callback: Optional callback for progress updates (current, total)

    Yields:
        GeneratedExample objects as they are created
    """
    total_chunks = len(chunks)

    for i, chunk in enumerate(chunks):
        if progress_callback:
            progress_callback(i, total_chunks)

        # Skip very short chunks
        if len(chunk.strip()) < 100:
            continue

        # Build prompt
        prompt = get_generation_prompt(
            config.style,
            chunk,
            config.questions_per_chunk,
        )

        try:
            # Call LLM
            response = await llm_call(prompt)

            # Parse response
            pairs = parse_llm_response(response)

            for pair in pairs:
                question = pair.get("question", "").strip()
                answer = pair.get("answer", "").strip()
                confidence = float(pair.get("confidence", 0.8))

                if not question or not answer:
                    continue

                metadata = {"chunk_index": i}
                if config.include_source_reference:
                    metadata["source_chunk"] = chunk[:500]  # Truncate for storage

                yield GeneratedExample(
                    question=question,
                    answer=answer,
                    source_chunk=chunk if config.include_source_reference else "",
                    confidence=confidence,
                    metadata=metadata,
                )

        except Exception as e:
            # Log error but continue with other chunks
            yield GeneratedExample(
                question="",
                answer="",
                source_chunk=chunk,
                confidence=0.0,
                metadata={"error": str(e), "chunk_index": i},
            )

    if progress_callback:
        progress_callback(total_chunks, total_chunks)


def examples_to_messages(examples: List[GeneratedExample]) -> List[dict]:
    """
    Convert generated examples to standard message format.

    Args:
        examples: List of GeneratedExample objects

    Returns:
        List of examples in messages format for dataset storage
    """
    results = []

    for ex in examples:
        if not ex.question or not ex.answer:
            continue

        messages = [
            {"role": "user", "content": ex.question},
            {"role": "assistant", "content": ex.answer},
        ]

        metadata = ex.metadata.copy()
        metadata["confidence"] = ex.confidence
        metadata["generated"] = True

        results.append({
            "messages": messages,
            "metadata": metadata,
        })

    return results


def estimate_generation_count(
    text_length: int,
    chunk_size: int = 2000,
    questions_per_chunk: int = 3,
) -> int:
    """
    Estimate the number of Q&A pairs that will be generated.

    Args:
        text_length: Total document text length in characters
        chunk_size: Size of each chunk
        questions_per_chunk: Number of questions generated per chunk

    Returns:
        Estimated number of Q&A pairs
    """
    num_chunks = max(1, text_length // chunk_size)
    return num_chunks * questions_per_chunk
