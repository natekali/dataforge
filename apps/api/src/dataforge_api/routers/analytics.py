"""Analytics and statistics endpoints."""

from collections import Counter
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from dataforge_api import database as db

router = APIRouter()


class DatasetStats(BaseModel):
    """Overall dataset statistics."""

    total_examples: int
    total_messages: int
    total_tokens_estimate: int
    avg_messages_per_example: float
    avg_tokens_per_example: float


class RoleDistribution(BaseModel):
    """Message role distribution."""

    system: int
    user: int
    assistant: int
    tool: int


class LengthDistribution(BaseModel):
    """Message length distribution buckets."""

    short: int  # < 100 chars
    medium: int  # 100-500 chars
    long: int  # 500-2000 chars
    very_long: int  # > 2000 chars


class QualityStats(BaseModel):
    """Quality score statistics."""

    avg_score: float
    min_score: float
    max_score: float
    excellent: int  # > 0.9
    good: int  # 0.7-0.9
    fair: int  # 0.5-0.7
    poor: int  # < 0.5


class ProjectAnalytics(BaseModel):
    """Complete analytics for a project."""

    dataset_stats: DatasetStats
    role_distribution: RoleDistribution
    length_distribution: LengthDistribution
    quality_stats: QualityStats | None
    top_topics: list[dict[str, Any]]
    format_info: dict[str, Any]
    recent_activity: list[dict[str, Any]]


@router.get("/{project_id}", response_model=ProjectAnalytics)
async def get_project_analytics(project_id: str) -> ProjectAnalytics:
    """
    Get comprehensive analytics for a project.
    """
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Get all examples
    examples = await db.get_examples(project_id, offset=0, limit=100000)

    if not examples:
        return ProjectAnalytics(
            dataset_stats=DatasetStats(
                total_examples=0,
                total_messages=0,
                total_tokens_estimate=0,
                avg_messages_per_example=0,
                avg_tokens_per_example=0,
            ),
            role_distribution=RoleDistribution(system=0, user=0, assistant=0, tool=0),
            length_distribution=LengthDistribution(short=0, medium=0, long=0, very_long=0),
            quality_stats=None,
            top_topics=[],
            format_info={"format": project.get("source_format", "unknown")},
            recent_activity=[],
        )

    # Calculate dataset stats
    total_messages = 0
    total_chars = 0
    role_counts = Counter()
    length_buckets = Counter()
    quality_scores = []

    for ex in examples:
        messages = ex.get("messages", [])
        total_messages += len(messages)

        for msg in messages:
            content = msg.get("content", "")
            char_count = len(content)
            total_chars += char_count

            # Role distribution
            role = msg.get("role", "user")
            role_counts[role] += 1

            # Length distribution
            if char_count < 100:
                length_buckets["short"] += 1
            elif char_count < 500:
                length_buckets["medium"] += 1
            elif char_count < 2000:
                length_buckets["long"] += 1
            else:
                length_buckets["very_long"] += 1

        # Quality score from metadata
        metadata = ex.get("metadata", {})
        if "quality_score" in metadata:
            quality_scores.append(metadata["quality_score"])

    # Estimate tokens (rough: ~4 chars per token)
    total_tokens = total_chars // 4
    avg_tokens = total_tokens / len(examples) if examples else 0
    avg_messages = total_messages / len(examples) if examples else 0

    # Quality stats
    quality_stats = None
    if quality_scores:
        quality_stats = QualityStats(
            avg_score=sum(quality_scores) / len(quality_scores),
            min_score=min(quality_scores),
            max_score=max(quality_scores),
            excellent=sum(1 for s in quality_scores if s > 0.9),
            good=sum(1 for s in quality_scores if 0.7 <= s <= 0.9),
            fair=sum(1 for s in quality_scores if 0.5 <= s < 0.7),
            poor=sum(1 for s in quality_scores if s < 0.5),
        )

    # Extract topics from user messages (simple word frequency)
    word_counts: Counter = Counter()
    stop_words = {
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "can", "to", "of", "in", "for", "on", "with",
        "at", "by", "from", "as", "into", "through", "during", "before", "after",
        "above", "below", "between", "under", "again", "further", "then", "once",
        "here", "there", "when", "where", "why", "how", "all", "each", "few",
        "more", "most", "other", "some", "such", "no", "nor", "not", "only",
        "own", "same", "so", "than", "too", "very", "just", "and", "but", "if",
        "or", "because", "until", "while", "this", "that", "these", "those",
        "what", "which", "who", "whom", "i", "me", "my", "we", "our", "you",
        "your", "he", "him", "his", "she", "her", "it", "its", "they", "them",
        "their", "am", "about", "any", "also",
    }

    for ex in examples[:100]:  # Sample first 100
        messages = ex.get("messages", [])
        for msg in messages:
            if msg.get("role") == "user":
                content = msg.get("content", "").lower()
                words = content.split()
                for word in words:
                    word = "".join(c for c in word if c.isalnum())
                    if word and len(word) > 3 and word not in stop_words:
                        word_counts[word] += 1

    top_topics = [
        {"word": word, "count": count}
        for word, count in word_counts.most_common(10)
    ]

    # Get recent jobs
    jobs = await db.get_project_jobs(project_id)
    recent_activity = [
        {
            "type": job.get("job_type", "unknown"),
            "status": job.get("status", "unknown"),
            "created_at": job.get("created_at"),
        }
        for job in (jobs or [])[:5]
    ]

    return ProjectAnalytics(
        dataset_stats=DatasetStats(
            total_examples=len(examples),
            total_messages=total_messages,
            total_tokens_estimate=total_tokens,
            avg_messages_per_example=round(avg_messages, 2),
            avg_tokens_per_example=round(avg_tokens, 2),
        ),
        role_distribution=RoleDistribution(
            system=role_counts.get("system", 0),
            user=role_counts.get("user", 0),
            assistant=role_counts.get("assistant", 0),
            tool=role_counts.get("tool", 0),
        ),
        length_distribution=LengthDistribution(
            short=length_buckets.get("short", 0),
            medium=length_buckets.get("medium", 0),
            long=length_buckets.get("long", 0),
            very_long=length_buckets.get("very_long", 0),
        ),
        quality_stats=quality_stats,
        top_topics=top_topics,
        format_info={
            "format": project.get("source_format", "unknown"),
            "name": project.get("name", "Untitled"),
            "description": project.get("description", ""),
        },
        recent_activity=recent_activity,
    )


@router.get("/{project_id}/summary")
async def get_quick_summary(project_id: str) -> dict[str, Any]:
    """
    Get a quick summary of project stats (faster than full analytics).
    """
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    example_count = await db.count_examples(project_id)

    return {
        "project_id": project_id,
        "name": project.get("name", "Untitled"),
        "format": project.get("source_format", "unknown"),
        "example_count": example_count,
        "created_at": project.get("created_at"),
        "updated_at": project.get("updated_at"),
    }


@router.get("/{project_id}/token-distribution")
async def get_token_distribution(project_id: str) -> dict[str, Any]:
    """
    Get detailed token distribution for histograms.
    """
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    examples = await db.get_examples(project_id, offset=0, limit=100000)

    # Calculate token counts per example
    token_counts = []
    for ex in examples:
        total_chars = sum(
            len(msg.get("content", ""))
            for msg in ex.get("messages", [])
        )
        token_counts.append(total_chars // 4)

    if not token_counts:
        return {"buckets": [], "min": 0, "max": 0, "avg": 0}

    # Create histogram buckets
    min_tokens = min(token_counts)
    max_tokens = max(token_counts)
    avg_tokens = sum(token_counts) / len(token_counts)

    # Define bucket boundaries
    bucket_size = max(1, (max_tokens - min_tokens) // 10)
    buckets = []

    for i in range(10):
        low = min_tokens + i * bucket_size
        high = low + bucket_size
        count = sum(1 for t in token_counts if low <= t < high)
        buckets.append({
            "range": f"{low}-{high}",
            "low": low,
            "high": high,
            "count": count,
        })

    return {
        "buckets": buckets,
        "min": min_tokens,
        "max": max_tokens,
        "avg": round(avg_tokens, 2),
        "total_examples": len(token_counts),
    }
