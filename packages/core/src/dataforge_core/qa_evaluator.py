"""Q&A quality evaluation using LLM."""

import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable, List, Optional


@dataclass
class DimensionScore:
    """Score for a single evaluation dimension."""

    score: float  # 0.0 to 1.0
    explanation: str
    suggestions: List[str] = field(default_factory=list)


@dataclass
class EvaluationResult:
    """Complete evaluation result for a Q&A pair."""

    example_id: str
    overall_score: float  # 0.0 to 1.0
    dimensions: dict[str, DimensionScore]  # coherence, accuracy, relevance, etc.
    errors: List[str] = field(default_factory=list)
    needs_review: bool = False
    raw_response: str = ""


@dataclass
class EvaluationConfig:
    """Configuration for Q&A evaluation."""

    dimensions: List[str] = field(default_factory=lambda: [
        "coherence",
        "accuracy",
        "relevance",
        "completeness",
        "clarity",
        "helpfulness",
    ])
    threshold_needs_review: float = 0.6  # Flag for human review if below
    temperature: float = 0.3  # Lower for consistent evaluation
    max_tokens: int = 1024


# Evaluation prompts
EVALUATION_PROMPT = """You are an expert evaluator of AI assistant responses. Evaluate the following question-answer pair.

Question: {question}

Answer: {answer}

Evaluate on these dimensions (score 0.0 to 1.0):

1. **Coherence**: Is the answer logically structured and easy to follow?
2. **Accuracy**: Is the information factually correct? (If unable to verify, score based on plausibility)
3. **Relevance**: Does the answer directly address the question?
4. **Completeness**: Does the answer fully address all aspects of the question?
5. **Clarity**: Is the language clear and easy to understand?
6. **Helpfulness**: Would this answer be useful to someone asking this question?

Also identify any errors or issues:
- Factual errors
- Logical inconsistencies
- Missing important information
- Confusing explanations

Output your evaluation as JSON:
{{
  "coherence": {{"score": 0.0-1.0, "explanation": "...", "suggestions": []}},
  "accuracy": {{"score": 0.0-1.0, "explanation": "...", "suggestions": []}},
  "relevance": {{"score": 0.0-1.0, "explanation": "...", "suggestions": []}},
  "completeness": {{"score": 0.0-1.0, "explanation": "...", "suggestions": []}},
  "clarity": {{"score": 0.0-1.0, "explanation": "...", "suggestions": []}},
  "helpfulness": {{"score": 0.0-1.0, "explanation": "...", "suggestions": []}},
  "errors": ["list of specific errors found"],
  "overall_assessment": "brief overall assessment"
}}

Evaluate now:"""


QUICK_EVALUATION_PROMPT = """Rate this Q&A pair on a scale of 0.0 to 1.0 for quality.

Q: {question}
A: {answer}

Consider: coherence, accuracy, relevance, completeness, clarity, helpfulness.

Output only JSON: {{"score": 0.0-1.0, "issues": ["list of issues"], "is_good": true/false}}"""


def get_evaluation_prompt(question: str, answer: str, detailed: bool = True) -> str:
    """Get the evaluation prompt for a Q&A pair."""
    if detailed:
        return EVALUATION_PROMPT.format(question=question, answer=answer)
    return QUICK_EVALUATION_PROMPT.format(question=question, answer=answer)


def parse_evaluation_response(response: str, example_id: str, config: EvaluationConfig) -> EvaluationResult:
    """
    Parse LLM evaluation response into structured result.

    Handles various response formats and extracts scores.
    """
    response = response.strip()

    # Try to extract JSON from markdown code block
    code_block_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', response, re.DOTALL)
    if code_block_match:
        response = code_block_match.group(1).strip()

    # Try to find JSON object in response
    json_match = re.search(r'\{.*\}', response, re.DOTALL)
    if json_match:
        try:
            data = json.loads(json_match.group())
        except json.JSONDecodeError:
            # Return error result
            return EvaluationResult(
                example_id=example_id,
                overall_score=0.0,
                dimensions={},
                errors=["Failed to parse evaluation response"],
                needs_review=True,
                raw_response=response,
            )
    else:
        return EvaluationResult(
            example_id=example_id,
            overall_score=0.0,
            dimensions={},
            errors=["No JSON found in evaluation response"],
            needs_review=True,
            raw_response=response,
        )

    # Parse dimensions
    dimensions = {}
    scores = []

    for dim_name in config.dimensions:
        if dim_name in data and isinstance(data[dim_name], dict):
            dim_data = data[dim_name]
            score = float(dim_data.get("score", 0.0))
            scores.append(score)
            dimensions[dim_name] = DimensionScore(
                score=score,
                explanation=dim_data.get("explanation", ""),
                suggestions=dim_data.get("suggestions", []),
            )
        elif dim_name in data and isinstance(data[dim_name], (int, float)):
            score = float(data[dim_name])
            scores.append(score)
            dimensions[dim_name] = DimensionScore(
                score=score,
                explanation="",
                suggestions=[],
            )

    # Handle quick evaluation format
    if "score" in data and not dimensions:
        overall = float(data["score"])
        dimensions["overall"] = DimensionScore(
            score=overall,
            explanation=data.get("overall_assessment", ""),
            suggestions=[],
        )
        scores = [overall]

    # Calculate overall score
    overall_score = sum(scores) / len(scores) if scores else 0.0

    # Extract errors
    errors = data.get("errors", [])
    if isinstance(errors, str):
        errors = [errors] if errors else []

    # Check if needs review
    needs_review = overall_score < config.threshold_needs_review or bool(errors)

    return EvaluationResult(
        example_id=example_id,
        overall_score=overall_score,
        dimensions=dimensions,
        errors=errors,
        needs_review=needs_review,
        raw_response=response,
    )


async def evaluate_single(
    example: dict,
    llm_call: Callable[[str], Any],
    config: Optional[EvaluationConfig] = None,
) -> EvaluationResult:
    """
    Evaluate a single Q&A example.

    Args:
        example: Dict with 'messages' key containing conversation
        llm_call: Async function to call LLM with prompt
        config: Optional evaluation configuration

    Returns:
        EvaluationResult with scores and feedback
    """
    if config is None:
        config = EvaluationConfig()

    example_id = example.get("id", "unknown")
    messages = example.get("messages", [])

    # Extract question and answer
    question = ""
    answer = ""

    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")

        if role == "user":
            question = content
        elif role == "assistant":
            answer = content

    if not question:
        return EvaluationResult(
            example_id=example_id,
            overall_score=0.0,
            dimensions={},
            errors=["No user question found"],
            needs_review=True,
        )

    if not answer:
        return EvaluationResult(
            example_id=example_id,
            overall_score=0.0,
            dimensions={},
            errors=["No assistant answer found"],
            needs_review=True,
        )

    # Get evaluation prompt
    prompt = get_evaluation_prompt(question, answer, detailed=True)

    try:
        # Call LLM
        response = await llm_call(prompt)

        # Parse response
        result = parse_evaluation_response(response, example_id, config)
        return result

    except Exception as e:
        return EvaluationResult(
            example_id=example_id,
            overall_score=0.0,
            dimensions={},
            errors=[f"Evaluation failed: {str(e)}"],
            needs_review=True,
        )


async def evaluate_batch(
    examples: List[dict],
    llm_call: Callable[[str], Any],
    config: Optional[EvaluationConfig] = None,
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> List[EvaluationResult]:
    """
    Evaluate a batch of Q&A examples.

    Args:
        examples: List of examples with 'messages' key
        llm_call: Async function to call LLM
        config: Optional evaluation configuration
        progress_callback: Optional callback for progress (current, total)

    Returns:
        List of EvaluationResult for each example
    """
    if config is None:
        config = EvaluationConfig()

    results = []
    total = len(examples)

    for i, example in enumerate(examples):
        if progress_callback:
            progress_callback(i, total)

        result = await evaluate_single(example, llm_call, config)
        results.append(result)

    if progress_callback:
        progress_callback(total, total)

    return results


def aggregate_results(results: List[EvaluationResult]) -> dict:
    """
    Aggregate evaluation results into a summary report.

    Args:
        results: List of evaluation results

    Returns:
        Dict with aggregated statistics
    """
    if not results:
        return {
            "total_evaluated": 0,
            "average_score": 0.0,
            "needs_review_count": 0,
            "error_count": 0,
            "dimension_averages": {},
            "score_distribution": {},
        }

    total = len(results)
    scores = [r.overall_score for r in results]
    avg_score = sum(scores) / total

    # Count needing review
    needs_review = sum(1 for r in results if r.needs_review)

    # Count with errors
    with_errors = sum(1 for r in results if r.errors)

    # Dimension averages
    dimension_scores = {}
    for result in results:
        for dim_name, dim_score in result.dimensions.items():
            if dim_name not in dimension_scores:
                dimension_scores[dim_name] = []
            dimension_scores[dim_name].append(dim_score.score)

    dimension_averages = {
        name: sum(scores) / len(scores)
        for name, scores in dimension_scores.items()
    }

    # Score distribution
    distribution = {
        "excellent": sum(1 for s in scores if s >= 0.9),
        "good": sum(1 for s in scores if 0.7 <= s < 0.9),
        "fair": sum(1 for s in scores if 0.5 <= s < 0.7),
        "poor": sum(1 for s in scores if s < 0.5),
    }

    return {
        "total_evaluated": total,
        "average_score": avg_score,
        "needs_review_count": needs_review,
        "error_count": with_errors,
        "dimension_averages": dimension_averages,
        "score_distribution": distribution,
    }


def results_to_dict(result: EvaluationResult) -> dict:
    """Convert EvaluationResult to serializable dict."""
    return {
        "example_id": result.example_id,
        "overall_score": result.overall_score,
        "dimensions": {
            name: {
                "score": dim.score,
                "explanation": dim.explanation,
                "suggestions": dim.suggestions,
            }
            for name, dim in result.dimensions.items()
        },
        "errors": result.errors,
        "needs_review": result.needs_review,
    }
