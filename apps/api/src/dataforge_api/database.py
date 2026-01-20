"""Database configuration and models."""

import contextlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

import aiosqlite

from dataforge_api.config import settings

# Split type definition
SplitType = Literal["train", "validation", "test"]
VALID_SPLITS = ("train", "validation", "test")


async def get_db() -> aiosqlite.Connection:
    """Get database connection."""
    db_path = settings.database_url.replace("sqlite+aiosqlite:///", "")
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)

    db = await aiosqlite.connect(db_path)
    db.row_factory = aiosqlite.Row
    return db


async def init_db() -> None:
    """Initialize database tables."""
    db = await get_db()

    # Create tables first (without indexes on columns that may need migration)
    await db.executescript("""
        -- Projects table
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            target_model TEXT,
            source_format TEXT,
            source_url TEXT,
            settings TEXT DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        -- Examples table (stores dataset examples)
        CREATE TABLE IF NOT EXISTS examples (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            messages TEXT NOT NULL,  -- JSON array of messages
            metadata TEXT DEFAULT '{}',
            split TEXT DEFAULT 'train',  -- train, validation, test
            quality_score REAL,
            token_count INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        -- Jobs table (for async processing)
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            job_type TEXT NOT NULL,  -- import, enhance, generate, export
            status TEXT NOT NULL,    -- pending, running, completed, failed
            progress REAL DEFAULT 0,
            result TEXT,
            error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        -- Create base indexes (columns that always exist)
        CREATE INDEX IF NOT EXISTS idx_examples_project_id ON examples(project_id);
        CREATE INDEX IF NOT EXISTS idx_examples_quality_score ON examples(quality_score);
        CREATE INDEX IF NOT EXISTS idx_jobs_project_id ON jobs(project_id);
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    """)

    # Run migrations for existing databases (adds missing columns)
    await _run_migrations(db)

    # Create indexes on columns that may have been added by migrations
    await db.execute("CREATE INDEX IF NOT EXISTS idx_examples_split ON examples(split)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_examples_project_split ON examples(project_id, split)")

    await db.commit()
    await db.close()


async def _run_migrations(db: aiosqlite.Connection) -> None:
    """Run database migrations for schema updates."""
    # Check examples table columns
    cursor = await db.execute("PRAGMA table_info(examples)")
    columns = await cursor.fetchall()
    example_column_names = [col[1] for col in columns]

    if "split" not in example_column_names:
        # Add split column with default value 'train'
        await db.execute("ALTER TABLE examples ADD COLUMN split TEXT DEFAULT 'train'")

    # Check projects table columns
    cursor = await db.execute("PRAGMA table_info(projects)")
    columns = await cursor.fetchall()
    project_column_names = [col[1] for col in columns]

    if "source_url" not in project_column_names:
        # Add source_url column
        await db.execute("ALTER TABLE projects ADD COLUMN source_url TEXT")


# =============================================================================
# Project CRUD
# =============================================================================


async def create_project(
    name: str,
    description: str | None = None,
    target_model: str | None = None,
) -> dict:
    """Create a new project."""
    db = await get_db()

    project_id = str(uuid4())
    now = datetime.now(UTC).isoformat()

    await db.execute(
        """
        INSERT INTO projects (id, name, description, target_model, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (project_id, name, description, target_model, now, now),
    )
    await db.commit()

    project = await get_project(project_id)
    await db.close()

    return project


async def get_project(project_id: str) -> dict | None:
    """Get a project by ID."""
    db = await get_db()

    cursor = await db.execute(
        "SELECT * FROM projects WHERE id = ?",
        (project_id,),
    )
    row = await cursor.fetchone()
    await db.close()

    if row:
        return dict(row)
    return None


async def list_projects() -> list[dict]:
    """List all projects."""
    db = await get_db()

    cursor = await db.execute(
        "SELECT p.*, COUNT(e.id) as example_count FROM projects p "
        "LEFT JOIN examples e ON e.project_id = p.id "
        "GROUP BY p.id ORDER BY p.updated_at DESC"
    )
    rows = await cursor.fetchall()
    await db.close()

    return [dict(row) for row in rows]


async def update_project(project_id: str, **updates) -> dict | None:
    """Update a project."""
    db = await get_db()

    updates["updated_at"] = datetime.now(UTC).isoformat()

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [project_id]

    await db.execute(
        f"UPDATE projects SET {set_clause} WHERE id = ?",
        values,
    )
    await db.commit()

    project = await get_project(project_id)
    await db.close()

    return project


async def delete_project(project_id: str) -> bool:
    """Delete a project and all its examples."""
    db = await get_db()

    await db.execute("DELETE FROM examples WHERE project_id = ?", (project_id,))
    await db.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    await db.commit()
    await db.close()

    return True


# =============================================================================
# Example CRUD with Split Support
# =============================================================================


async def add_examples(
    project_id: str,
    examples: list[dict],
    split: SplitType = "train",
) -> int:
    """
    Add examples to a project. Returns count added.

    Args:
        project_id: Project ID
        examples: List of example dicts with messages and optional metadata
        split: Dataset split (train/validation/test). Can be overridden per-example via metadata.

    Returns:
        Number of examples added
    """
    db = await get_db()

    now = datetime.now(UTC).isoformat()
    count = 0

    # Use executemany for better performance with bulk inserts
    records = []
    for example in examples:
        example_id = str(uuid4())
        messages = json.dumps(example.get("messages", []))
        metadata = example.get("metadata", {})

        # Allow per-example split override via metadata
        example_split = metadata.pop("split", None) or example.get("split") or split
        if example_split not in VALID_SPLITS:
            example_split = "train"

        metadata_json = json.dumps(metadata)
        records.append((example_id, project_id, messages, metadata_json, example_split, now, now))

    await db.executemany(
        """
        INSERT INTO examples (id, project_id, messages, metadata, split, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        records,
    )
    count = len(records)

    # Update project timestamp
    await db.execute(
        "UPDATE projects SET updated_at = ? WHERE id = ?",
        (now, project_id),
    )

    await db.commit()
    await db.close()

    return count


async def get_examples(
    project_id: str,
    offset: int = 0,
    limit: int = 100,
    split: SplitType | None = None,
    search_query: str | None = None,
    quality_filter: tuple[float, float] | None = None,
) -> list[dict]:
    """
    Get examples for a project with pagination and filtering.

    Args:
        project_id: Project ID
        offset: Pagination offset
        limit: Max results to return
        split: Filter by dataset split (train/validation/test)
        search_query: Optional text search in messages
        quality_filter: Optional (min_score, max_score) tuple

    Returns:
        List of example dictionaries
    """
    db = await get_db()

    # Build query with optional filters
    query = "SELECT * FROM examples WHERE project_id = ?"
    params = [project_id]

    if split:
        query += " AND split = ?"
        params.append(split)

    if search_query:
        # Search in JSON messages (SQLite doesn't support JSON search directly)
        # This is a simple text-based search
        query += " AND (messages LIKE ? OR metadata LIKE ?)"
        search_pattern = f"%{search_query}%"
        params.extend([search_pattern, search_pattern])

    if quality_filter:
        min_score, max_score = quality_filter
        query += " AND quality_score BETWEEN ? AND ?"
        params.extend([min_score, max_score])

    query += " ORDER BY created_at ASC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    await db.close()

    examples = []
    for row in rows:
        example = dict(row)
        example["messages"] = json.loads(example["messages"])
        example["metadata"] = json.loads(example["metadata"])
        examples.append(example)

    return examples


async def get_examples_by_split(
    project_id: str,
    split: SplitType,
    offset: int = 0,
    limit: int = 100000,
) -> list[dict]:
    """Get examples for a specific split."""
    return await get_examples(project_id, offset=offset, limit=limit, split=split)


async def get_example(example_id: str) -> dict | None:
    """Get a single example by ID."""
    db = await get_db()

    cursor = await db.execute(
        "SELECT * FROM examples WHERE id = ?",
        (example_id,),
    )
    row = await cursor.fetchone()
    await db.close()

    if row:
        example = dict(row)
        example["messages"] = json.loads(example["messages"])
        example["metadata"] = json.loads(example["metadata"])
        return example
    return None


async def update_example(example_id: str, **updates) -> dict | None:
    """Update an example."""
    db = await get_db()

    updates["updated_at"] = datetime.now(UTC).isoformat()

    # Validate split if provided
    if "split" in updates and updates["split"] not in VALID_SPLITS:
        updates["split"] = "train"

    # Serialize JSON fields
    if "messages" in updates:
        updates["messages"] = json.dumps(updates["messages"])
    if "metadata" in updates:
        updates["metadata"] = json.dumps(updates["metadata"])

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [example_id]

    await db.execute(
        f"UPDATE examples SET {set_clause} WHERE id = ?",
        values,
    )
    await db.commit()

    await db.close()
    # Fetch updated example without closing connection
    example = await get_example(example_id)

    return example


async def update_examples_split(
    project_id: str,
    example_ids: list[str],
    split: SplitType,
) -> int:
    """
    Update the split for multiple examples.

    Args:
        project_id: Project ID
        example_ids: List of example IDs to update
        split: New split value

    Returns:
        Number of examples updated
    """
    if split not in VALID_SPLITS:
        raise ValueError(f"Invalid split: {split}. Must be one of {VALID_SPLITS}")

    db = await get_db()
    now = datetime.now(UTC).isoformat()

    placeholders = ",".join("?" * len(example_ids))
    cursor = await db.execute(
        f"""
        UPDATE examples
        SET split = ?, updated_at = ?
        WHERE project_id = ? AND id IN ({placeholders})
        """,
        [split, now, project_id] + example_ids,
    )
    await db.commit()

    count = cursor.rowcount
    await db.close()

    return count


async def auto_split_examples(
    project_id: str,
    train_ratio: float = 0.8,
    validation_ratio: float = 0.1,
    test_ratio: float = 0.1,
    random_seed: int = 42,
) -> dict[str, int]:
    """
    Automatically split all examples in a project into train/validation/test.

    Args:
        project_id: Project ID
        train_ratio: Fraction for training set (default 0.8)
        validation_ratio: Fraction for validation set (default 0.1)
        test_ratio: Fraction for test set (default 0.1)
        random_seed: Random seed for reproducibility

    Returns:
        Dict with counts per split
    """
    import random

    # Validate ratios
    total_ratio = train_ratio + validation_ratio + test_ratio
    if abs(total_ratio - 1.0) > 0.001:
        raise ValueError(f"Ratios must sum to 1.0, got {total_ratio}")

    db = await get_db()

    # Get all example IDs
    cursor = await db.execute(
        "SELECT id FROM examples WHERE project_id = ? ORDER BY created_at",
        (project_id,),
    )
    rows = await cursor.fetchall()
    example_ids = [row[0] for row in rows]

    if not example_ids:
        await db.close()
        return {"train": 0, "validation": 0, "test": 0}

    # Shuffle with seed for reproducibility
    random.seed(random_seed)
    shuffled_ids = example_ids.copy()
    random.shuffle(shuffled_ids)

    # Calculate split indices
    total = len(shuffled_ids)
    train_end = int(total * train_ratio)
    val_end = train_end + int(total * validation_ratio)

    train_ids = shuffled_ids[:train_end]
    val_ids = shuffled_ids[train_end:val_end]
    test_ids = shuffled_ids[val_end:]

    now = datetime.now(UTC).isoformat()

    # Update splits in batch
    if train_ids:
        placeholders = ",".join("?" * len(train_ids))
        await db.execute(
            f"UPDATE examples SET split = 'train', updated_at = ? WHERE id IN ({placeholders})",
            [now] + train_ids,
        )

    if val_ids:
        placeholders = ",".join("?" * len(val_ids))
        await db.execute(
            f"UPDATE examples SET split = 'validation', updated_at = ? WHERE id IN ({placeholders})",
            [now] + val_ids,
        )

    if test_ids:
        placeholders = ",".join("?" * len(test_ids))
        await db.execute(
            f"UPDATE examples SET split = 'test', updated_at = ? WHERE id IN ({placeholders})",
            [now] + test_ids,
        )

    await db.commit()
    await db.close()

    return {
        "train": len(train_ids),
        "validation": len(val_ids),
        "test": len(test_ids),
    }


async def delete_example(example_id: str) -> bool:
    """Delete an example."""
    db = await get_db()

    await db.execute("DELETE FROM examples WHERE id = ?", (example_id,))
    await db.commit()
    await db.close()

    return True


async def delete_examples(project_id: str, example_ids: list[str]) -> int:
    """Delete multiple examples. Returns count deleted."""
    db = await get_db()

    placeholders = ",".join("?" * len(example_ids))
    cursor = await db.execute(
        f"DELETE FROM examples WHERE project_id = ? AND id IN ({placeholders})",
        [project_id] + example_ids,
    )
    await db.commit()

    count = cursor.rowcount
    await db.close()

    return count


async def bulk_update_examples(
    updates: list[tuple[str, dict[str, Any]]],
) -> int:
    """
    Update multiple examples in a single batch.

    Args:
        updates: List of (example_id, {field: value, ...}) tuples

    Returns:
        Number of examples updated
    """
    db = await get_db()
    now = datetime.now(UTC).isoformat()

    for example_id, update_data in updates:
        # Serialize JSON fields
        serialized_data = update_data.copy()
        if "messages" in serialized_data:
            serialized_data["messages"] = json.dumps(serialized_data["messages"])
        if "metadata" in serialized_data:
            serialized_data["metadata"] = json.dumps(serialized_data["metadata"])
        # Validate split
        if "split" in serialized_data and serialized_data["split"] not in VALID_SPLITS:
            serialized_data["split"] = "train"
        serialized_data["updated_at"] = now

        # Build SET clause and values dynamically
        set_fields = []
        values = []
        for field, value in serialized_data.items():
            set_fields.append(f"{field} = ?")
            values.append(value)

        set_clause = ", ".join(set_fields)
        values.append(example_id)

        await db.execute(
            f"UPDATE examples SET {set_clause} WHERE id = ?",
            tuple(values),
        )

    await db.commit()
    await db.close()

    return len(updates)


async def count_examples(
    project_id: str,
    split: SplitType | None = None,
) -> int:
    """Count examples in a project, optionally filtered by split."""
    db = await get_db()

    if split:
        cursor = await db.execute(
            "SELECT COUNT(*) FROM examples WHERE project_id = ? AND split = ?",
            (project_id, split),
        )
    else:
        cursor = await db.execute(
            "SELECT COUNT(*) FROM examples WHERE project_id = ?",
            (project_id,),
        )

    row = await cursor.fetchone()
    await db.close()

    return row[0] if row else 0


async def get_split_counts(project_id: str) -> dict[str, int]:
    """Get example counts per split for a project."""
    db = await get_db()

    cursor = await db.execute(
        """
        SELECT split, COUNT(*) as count
        FROM examples
        WHERE project_id = ?
        GROUP BY split
        """,
        (project_id,),
    )
    rows = await cursor.fetchall()
    await db.close()

    # Initialize with zeros
    counts = {"train": 0, "validation": 0, "test": 0}
    for row in rows:
        split_name = row[0] or "train"  # Handle NULL as train
        if split_name in counts:
            counts[split_name] = row[1]

    return counts


async def get_project_stats(project_id: str) -> dict:
    """Get statistics for a project's dataset, including split breakdown."""
    db = await get_db()

    # Get basic counts
    cursor = await db.execute(
        """
        SELECT
            COUNT(*) as total_examples,
            AVG(token_count) as avg_tokens,
            MIN(token_count) as min_tokens,
            MAX(token_count) as max_tokens,
            AVG(quality_score) as avg_quality
        FROM examples
        WHERE project_id = ?
        """,
        (project_id,),
    )
    row = await cursor.fetchone()
    stats = dict(row) if row else {}

    # Get split counts
    cursor = await db.execute(
        """
        SELECT split, COUNT(*) as count
        FROM examples
        WHERE project_id = ?
        GROUP BY split
        """,
        (project_id,),
    )
    split_rows = await cursor.fetchall()
    split_counts = {"train": 0, "validation": 0, "test": 0}
    for row in split_rows:
        split_name = row[0] or "train"
        if split_name in split_counts:
            split_counts[split_name] = row[1]
    stats["split_counts"] = split_counts

    # Get all examples for detailed analysis
    cursor = await db.execute(
        "SELECT messages FROM examples WHERE project_id = ?",
        (project_id,),
    )
    rows = await cursor.fetchall()
    await db.close()

    # Calculate message statistics
    total_user_chars = 0
    total_assistant_chars = 0
    total_messages = 0

    for row in rows:
        messages = json.loads(row["messages"])
        for msg in messages:
            total_messages += 1
            content = msg.get("content", "")
            if msg.get("role") == "user":
                total_user_chars += len(content)
            elif msg.get("role") == "assistant":
                total_assistant_chars += len(content)

    stats["total_messages"] = total_messages
    stats["avg_user_length"] = total_user_chars / max(1, stats.get("total_examples", 1))
    stats["avg_assistant_length"] = total_assistant_chars / max(1, stats.get("total_examples", 1))

    return stats


# =============================================================================
# Job management
# =============================================================================


async def create_job(
    project_id: str,
    job_type: str,
) -> dict:
    """Create a new job."""
    db = await get_db()

    job_id = str(uuid4())
    now = datetime.now(UTC).isoformat()

    await db.execute(
        """
        INSERT INTO jobs (id, project_id, job_type, status, created_at, updated_at)
        VALUES (?, ?, ?, 'pending', ?, ?)
        """,
        (job_id, project_id, job_type, now, now),
    )
    await db.commit()
    await db.close()

    return {"id": job_id, "project_id": project_id, "job_type": job_type, "status": "pending"}


async def update_job(job_id: str, **updates) -> None:
    """Update a job's status."""
    db = await get_db()

    updates["updated_at"] = datetime.now(UTC).isoformat()

    if "result" in updates and isinstance(updates["result"], dict):
        updates["result"] = json.dumps(updates["result"])

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [job_id]

    await db.execute(
        f"UPDATE jobs SET {set_clause} WHERE id = ?",
        values,
    )
    await db.commit()
    await db.close()


async def get_job(job_id: str) -> dict | None:
    """Get a job by ID."""
    db = await get_db()

    cursor = await db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
    row = await cursor.fetchone()
    await db.close()

    if row:
        job = dict(row)
        if job.get("result"):
            with contextlib.suppress(json.JSONDecodeError):
                job["result"] = json.loads(job["result"])
        return job
    return None


async def get_project_jobs(project_id: str, limit: int = 20) -> list[dict]:
    """Get jobs for a project, ordered by most recent."""
    db = await get_db()

    cursor = await db.execute(
        """
        SELECT * FROM jobs
        WHERE project_id = ?
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (project_id, limit),
    )
    rows = await cursor.fetchall()
    await db.close()

    jobs = []
    for row in rows:
        job = dict(row)
        if job.get("result"):
            with contextlib.suppress(json.JSONDecodeError):
                job["result"] = json.loads(job["result"])
        jobs.append(job)

    return jobs
