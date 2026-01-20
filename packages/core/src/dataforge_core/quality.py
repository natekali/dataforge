"""Quality validation and cleaning pipeline."""

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, List, Optional


class IssueSeverity(str, Enum):
    """Severity levels for quality issues."""

    CRITICAL = "critical"  # Must fix - will break training
    HIGH = "high"  # Should fix - will hurt quality
    MEDIUM = "medium"  # Consider fixing - may affect quality
    LOW = "low"  # Optional - minor improvement


class IssueType(str, Enum):
    """Types of quality issues."""

    EMPTY_FIELD = "empty_field"
    MISSING_ROLE = "missing_role"
    INVALID_ROLE = "invalid_role"
    DUPLICATE = "duplicate"
    NEAR_DUPLICATE = "near_duplicate"
    TOO_SHORT = "too_short"
    TOO_LONG = "too_long"
    CONTEXT_OVERFLOW = "context_overflow"
    REFUSAL_PATTERN = "refusal_pattern"
    PII_DETECTED = "pii_detected"
    ENCODING_ERROR = "encoding_error"
    IMBALANCED_RATIO = "imbalanced_ratio"
    SPECIAL_TOKEN_CONFLICT = "special_token_conflict"
    FORMATTING_ERROR = "formatting_error"


@dataclass
class QualityIssue:
    """A quality issue found in an example."""

    type: IssueType
    severity: IssueSeverity
    message: str
    field: Optional[str] = None
    suggestion: Optional[str] = None
    auto_fixable: bool = False


@dataclass
class QualityScore:
    """Quality assessment for an example."""

    overall: float  # 0-1 aggregate score
    completeness: float  # Has all required fields
    formatting: float  # Proper structure
    length_balance: float  # Response/instruction ratio
    content_quality: float  # No issues detected
    issues: List[QualityIssue] = field(default_factory=list)

    @property
    def has_critical_issues(self) -> bool:
        return any(i.severity == IssueSeverity.CRITICAL for i in self.issues)


@dataclass
class CleaningResult:
    """Result of cleaning an example."""

    original: dict
    cleaned: dict
    changes: List[str]
    issues_fixed: int
    issues_remaining: int


@dataclass
class ValidationResult:
    """Result of validating an example."""

    is_valid: bool
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


# =============================================================================
# VALIDATION CHECKS
# =============================================================================

# Refusal patterns to detect
REFUSAL_PATTERNS = [
    r"(?i)as an ai( language model)?",
    r"(?i)i('m| am) (not able|unable|cannot)",
    r"(?i)i (can't|cannot|won't|will not) (help|assist|provide)",
    r"(?i)i('m| am) sorry,? (but )?i (can't|cannot)",
    r"(?i)it('s| is) (not |in)appropriate",
    r"(?i)i (don't|do not) have (the ability|access)",
    r"(?i)i('m| am) (just )?a(n)? (ai|language model|llm)",
    r"(?i)my (programming|guidelines|training)",
]

# PII patterns
PII_PATTERNS = {
    "email": r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
    "phone": r"(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}",
    "ssn": r"\b\d{3}-\d{2}-\d{4}\b",
    "credit_card": r"\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b",
    "ip_address": r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b",
}

# Model special tokens to check for conflicts
SPECIAL_TOKENS = {
    "llama": ["<|begin_of_text|>", "<|end_of_text|>", "<|eot_id|>", "<|start_header_id|>", "<|end_header_id|>"],
    "qwen": ["<|im_start|>", "<|im_end|>", "<|endoftext|>"],
    "gemma": ["<start_of_turn>", "<end_of_turn>", "<bos>", "<eos>"],
    "mistral": ["[INST]", "[/INST]", "<s>", "</s>"],
    "phi": ["<|user|>", "<|assistant|>", "<|system|>", "<|end|>"],
}


def check_empty_fields(example: dict) -> List[QualityIssue]:
    """Check for empty or missing fields."""
    issues = []
    messages = example.get("messages", [])

    if not messages:
        issues.append(QualityIssue(
            type=IssueType.EMPTY_FIELD,
            severity=IssueSeverity.CRITICAL,
            message="No messages found in example",
            field="messages",
            auto_fixable=False,
        ))
        return issues

    for i, msg in enumerate(messages):
        if not msg.get("content") or not msg["content"].strip():
            issues.append(QualityIssue(
                type=IssueType.EMPTY_FIELD,
                severity=IssueSeverity.CRITICAL,
                message=f"Empty content in message {i} (role: {msg.get('role', 'unknown')})",
                field=f"messages[{i}].content",
                suggestion="Remove this message or add content",
                auto_fixable=True,
            ))

    return issues


def check_roles(example: dict) -> List[QualityIssue]:
    """Check for valid message roles."""
    issues = []
    messages = example.get("messages", [])
    valid_roles = {"system", "user", "assistant", "tool"}

    has_user = False
    has_assistant = False

    for i, msg in enumerate(messages):
        role = msg.get("role", "").lower()

        if not role:
            issues.append(QualityIssue(
                type=IssueType.MISSING_ROLE,
                severity=IssueSeverity.CRITICAL,
                message=f"Missing role in message {i}",
                field=f"messages[{i}].role",
                suggestion="Add a role (user, assistant, system)",
                auto_fixable=False,
            ))
        elif role not in valid_roles:
            issues.append(QualityIssue(
                type=IssueType.INVALID_ROLE,
                severity=IssueSeverity.HIGH,
                message=f"Invalid role '{role}' in message {i}",
                field=f"messages[{i}].role",
                suggestion=f"Use one of: {', '.join(valid_roles)}",
                auto_fixable=True,
            ))

        if role == "user":
            has_user = True
        if role == "assistant":
            has_assistant = True

    if not has_user:
        issues.append(QualityIssue(
            type=IssueType.MISSING_ROLE,
            severity=IssueSeverity.HIGH,
            message="No user message found",
            suggestion="Add at least one user message",
            auto_fixable=False,
        ))

    if not has_assistant:
        issues.append(QualityIssue(
            type=IssueType.MISSING_ROLE,
            severity=IssueSeverity.HIGH,
            message="No assistant message found",
            suggestion="Add at least one assistant response",
            auto_fixable=False,
        ))

    return issues


def check_length(example: dict, min_length: int = 10, max_length: int = 32000) -> List[QualityIssue]:
    """Check message lengths."""
    issues = []
    messages = example.get("messages", [])

    total_length = 0
    user_length = 0
    assistant_length = 0

    for i, msg in enumerate(messages):
        content = msg.get("content", "")
        length = len(content)
        total_length += length

        if msg.get("role") == "user":
            user_length += length
        elif msg.get("role") == "assistant":
            assistant_length += length

        if length < min_length and msg.get("role") in ("user", "assistant"):
            issues.append(QualityIssue(
                type=IssueType.TOO_SHORT,
                severity=IssueSeverity.MEDIUM,
                message=f"Message {i} is very short ({length} chars)",
                field=f"messages[{i}].content",
                suggestion="Consider expanding or removing",
                auto_fixable=False,
            ))

        if length > max_length:
            issues.append(QualityIssue(
                type=IssueType.TOO_LONG,
                severity=IssueSeverity.HIGH,
                message=f"Message {i} exceeds max length ({length} > {max_length})",
                field=f"messages[{i}].content",
                suggestion="Consider splitting or truncating",
                auto_fixable=False,
            ))

    # Check response/instruction ratio
    if user_length > 0:
        ratio = assistant_length / user_length
        if ratio < 0.1:
            issues.append(QualityIssue(
                type=IssueType.IMBALANCED_RATIO,
                severity=IssueSeverity.MEDIUM,
                message=f"Very short assistant response (ratio: {ratio:.2f})",
                suggestion="Consider expanding the response",
                auto_fixable=False,
            ))
        elif ratio > 50:
            issues.append(QualityIssue(
                type=IssueType.IMBALANCED_RATIO,
                severity=IssueSeverity.LOW,
                message=f"Very long response relative to instruction (ratio: {ratio:.2f})",
                suggestion="Response may be overly verbose",
                auto_fixable=False,
            ))

    return issues


def check_refusals(example: dict) -> List[QualityIssue]:
    """Check for AI refusal patterns in responses."""
    issues = []
    messages = example.get("messages", [])

    for i, msg in enumerate(messages):
        if msg.get("role") != "assistant":
            continue

        content = msg.get("content", "")

        for pattern in REFUSAL_PATTERNS:
            if re.search(pattern, content):
                issues.append(QualityIssue(
                    type=IssueType.REFUSAL_PATTERN,
                    severity=IssueSeverity.HIGH,
                    message=f"Detected refusal pattern in message {i}",
                    field=f"messages[{i}].content",
                    suggestion="Remove or rewrite the response to be helpful",
                    auto_fixable=True,
                ))
                break  # Only report once per message

    return issues


def check_pii(example: dict) -> List[QualityIssue]:
    """Check for personally identifiable information."""
    issues = []
    messages = example.get("messages", [])

    for i, msg in enumerate(messages):
        content = msg.get("content", "")

        for pii_type, pattern in PII_PATTERNS.items():
            matches = re.findall(pattern, content)
            if matches:
                issues.append(QualityIssue(
                    type=IssueType.PII_DETECTED,
                    severity=IssueSeverity.HIGH,
                    message=f"Potential {pii_type} detected in message {i}",
                    field=f"messages[{i}].content",
                    suggestion=f"Remove or mask the {pii_type}",
                    auto_fixable=True,
                ))

    return issues


def check_special_tokens(example: dict, model_family: str = "llama") -> List[QualityIssue]:
    """Check for special token conflicts."""
    issues = []
    messages = example.get("messages", [])

    tokens_to_check = SPECIAL_TOKENS.get(model_family, [])
    # Also check all common tokens
    all_tokens = set()
    for tokens in SPECIAL_TOKENS.values():
        all_tokens.update(tokens)

    for i, msg in enumerate(messages):
        content = msg.get("content", "")

        for token in all_tokens:
            if token in content:
                severity = IssueSeverity.HIGH if token in tokens_to_check else IssueSeverity.MEDIUM
                issues.append(QualityIssue(
                    type=IssueType.SPECIAL_TOKEN_CONFLICT,
                    severity=severity,
                    message=f"Special token '{token}' found in message {i}",
                    field=f"messages[{i}].content",
                    suggestion="Remove or escape the special token",
                    auto_fixable=True,
                ))

    return issues


def check_encoding(example: dict) -> List[QualityIssue]:
    """Check for encoding issues."""
    issues = []
    messages = example.get("messages", [])

    # Patterns that indicate encoding problems
    encoding_patterns = [
        r"â€™",  # Smart quote encoding issue
        r"â€œ",  # Smart quote encoding issue
        r"â€",  # General encoding issue
        r"Ã¢",  # UTF-8 double encoding
        r"Ã©",  # Accented character encoding issue
        r"\ufffd",  # Unicode replacement character
        r"\\x[0-9a-fA-F]{2}",  # Escaped hex bytes
    ]

    for i, msg in enumerate(messages):
        content = msg.get("content", "")

        for pattern in encoding_patterns:
            if re.search(pattern, content):
                issues.append(QualityIssue(
                    type=IssueType.ENCODING_ERROR,
                    severity=IssueSeverity.MEDIUM,
                    message=f"Possible encoding issue in message {i}",
                    field=f"messages[{i}].content",
                    suggestion="Fix character encoding",
                    auto_fixable=True,
                ))
                break

    return issues


# =============================================================================
# VALIDATION
# =============================================================================

def validate_example(example: dict) -> ValidationResult:
    """
    Validate an example and return validation result.

    Args:
        example: Example dict with messages array

    Returns:
        ValidationResult with is_valid, errors, and warnings
    """
    errors: List[str] = []
    warnings: List[str] = []

    # Check for messages key
    if "messages" not in example:
        errors.append("Missing 'messages' key in example")
        return ValidationResult(is_valid=False, errors=errors, warnings=warnings)

    messages = example.get("messages", [])

    # Check for empty messages array
    if not messages:
        errors.append("Empty messages array")
        return ValidationResult(is_valid=False, errors=errors, warnings=warnings)

    # Check each message
    has_user = False
    has_assistant = False

    for i, msg in enumerate(messages):
        role = msg.get("role", "").lower()
        content = msg.get("content", "")

        # Check for missing role
        if not role:
            errors.append(f"Message {i}: missing 'role' field")
            continue

        # Check for invalid role (but these can be normalized)
        valid_roles = {"system", "user", "assistant", "tool"}
        normalizable_roles = {"human": "user", "gpt": "assistant", "ai": "assistant", "bot": "assistant"}

        if role not in valid_roles:
            if role in normalizable_roles:
                warnings.append(f"Message {i}: role '{role}' should be '{normalizable_roles[role]}'")
                role = normalizable_roles[role]  # Normalize for further checks
            else:
                warnings.append(f"Message {i}: invalid role '{role}'")

        # Track roles
        if role == "user":
            has_user = True
        if role == "assistant":
            has_assistant = True

        # Check for empty content
        if not content or not content.strip():
            if role in ("user", "assistant"):
                warnings.append(f"Message {i}: empty content for {role}")

    # Check for required roles
    if not has_user:
        warnings.append("No user message found")

    if not has_assistant:
        warnings.append("No assistant message found")

    # Determine if valid (no critical errors)
    is_valid = len(errors) == 0

    return ValidationResult(is_valid=is_valid, errors=errors, warnings=warnings)


# =============================================================================
# QUALITY SCORING
# =============================================================================

def score_example(example: dict, model_family: str = "llama") -> QualityScore:
    """
    Calculate quality score for an example.

    Returns a QualityScore with overall score (0-1) and individual metrics.
    """
    issues: List[QualityIssue] = []

    # Run all checks
    issues.extend(check_empty_fields(example))
    issues.extend(check_roles(example))
    issues.extend(check_length(example))
    issues.extend(check_refusals(example))
    issues.extend(check_pii(example))
    issues.extend(check_special_tokens(example, model_family))
    issues.extend(check_encoding(example))

    # Calculate component scores
    messages = example.get("messages", [])

    # Completeness: has user and assistant messages
    has_user = any(m.get("role") == "user" for m in messages)
    has_assistant = any(m.get("role") == "assistant" for m in messages)
    completeness = (0.5 if has_user else 0) + (0.5 if has_assistant else 0)

    # Formatting: no critical issues
    critical_issues = sum(1 for i in issues if i.severity == IssueSeverity.CRITICAL)
    high_issues = sum(1 for i in issues if i.severity == IssueSeverity.HIGH)
    formatting = max(0, 1.0 - (critical_issues * 0.3) - (high_issues * 0.1))

    # Length balance
    user_len = sum(len(m.get("content", "")) for m in messages if m.get("role") == "user")
    assistant_len = sum(len(m.get("content", "")) for m in messages if m.get("role") == "assistant")

    if user_len > 0:
        ratio = assistant_len / user_len
        # Ideal ratio is 1-5x
        if 1 <= ratio <= 5:
            length_balance = 1.0
        elif ratio < 1:
            # Low ratio - penalize proportionally (linear, more aggressive)
            length_balance = max(0.1, ratio)
        else:
            length_balance = max(0.3, 1.0 - (ratio - 5) / 10)

        # Additional penalty for very short total content
        total_len = user_len + assistant_len
        if total_len < 50:  # Very short exchanges
            length_balance *= 0.5
        elif total_len < 100:
            length_balance *= 0.8
    else:
        length_balance = 0.5 if assistant_len > 0 else 0

    # Content quality: penalize issues more heavily
    medium_issues = sum(1 for i in issues if i.severity == IssueSeverity.MEDIUM)
    low_issues = sum(1 for i in issues if i.severity == IssueSeverity.LOW)
    content_quality = max(0, 1.0 - (medium_issues * 0.15) - (low_issues * 0.05))

    # Overall score - weight components dynamically based on scores
    # If length_balance is very low, it should pull down the overall score significantly
    if length_balance < 0.5 or issues:
        overall = (
            completeness * 0.2 +
            formatting * 0.2 +
            length_balance * 0.35 +
            content_quality * 0.25
        )
    else:
        overall = (
            completeness * 0.25 +
            formatting * 0.25 +
            length_balance * 0.25 +
            content_quality * 0.25
        )

    return QualityScore(
        overall=round(overall, 3),
        completeness=round(completeness, 3),
        formatting=round(formatting, 3),
        length_balance=round(length_balance, 3),
        content_quality=round(content_quality, 3),
        issues=issues,
    )


def score_dataset(examples: List[dict], model_family: str = "llama") -> dict:
    """
    Calculate aggregate quality metrics for a dataset.
    """
    if not examples:
        return {
            "overall": 0,
            "total_examples": 0,
            "scores_distribution": {},
            "issue_counts": {},
            "critical_issues": 0,
        }

    scores = [score_example(ex, model_family) for ex in examples]

    # Score distribution
    distribution = {"excellent": 0, "good": 0, "fair": 0, "poor": 0}
    for s in scores:
        if s.overall >= 0.9:
            distribution["excellent"] += 1
        elif s.overall >= 0.7:
            distribution["good"] += 1
        elif s.overall >= 0.5:
            distribution["fair"] += 1
        else:
            distribution["poor"] += 1

    # Issue counts
    issue_counts: dict[str, int] = {}
    critical_count = 0
    for s in scores:
        for issue in s.issues:
            issue_counts[issue.type.value] = issue_counts.get(issue.type.value, 0) + 1
            if issue.severity == IssueSeverity.CRITICAL:
                critical_count += 1

    return {
        "overall": round(sum(s.overall for s in scores) / len(scores), 3),
        "total_examples": len(examples),
        "scores_distribution": distribution,
        "issue_counts": issue_counts,
        "critical_issues": critical_count,
        "avg_completeness": round(sum(s.completeness for s in scores) / len(scores), 3),
        "avg_formatting": round(sum(s.formatting for s in scores) / len(scores), 3),
        "avg_length_balance": round(sum(s.length_balance for s in scores) / len(scores), 3),
        "avg_content_quality": round(sum(s.content_quality for s in scores) / len(scores), 3),
    }


# =============================================================================
# CLEANING OPERATIONS
# =============================================================================

def clean_example(example: dict, remove_empty: bool = False) -> dict:
    """
    Clean an example by normalizing roles, fixing whitespace, and optionally removing empty messages.

    Args:
        example: Example dict with messages array
        remove_empty: If True, remove messages with empty content

    Returns:
        Cleaned example dict
    """
    if "messages" not in example:
        return example.copy()

    cleaned = {"messages": [m.copy() for m in example.get("messages", [])]}

    # Normalize roles
    role_map = {
        "human": "user",
        "gpt": "assistant",
        "ai": "assistant",
        "bot": "assistant",
        "model": "assistant",
        "sys": "system",
    }

    for msg in cleaned["messages"]:
        old_role = msg.get("role", "").lower()
        if old_role in role_map:
            msg["role"] = role_map[old_role]

        # Clean content
        content = msg.get("content", "")

        # Remove null characters
        content = content.replace("\x00", "")

        # Fix common encoding issues
        encoding_fixes = {
            "\u00e2\u0080\u0099": "'",  # â€™ -> '
            "\u00e2\u0080\u009c": '"',  # â€œ -> "
            "\u00e2\u0080\u009d": '"',  # â€ -> "
            "\u00e2\u0080\u0094": "\u2014",  # â€" -> em-dash
            "\u00e2\u0080\u0093": "\u2013",  # â€" -> en-dash
            "\u00c3\u00a2": "\u00e2",  # Ã¢ -> â
            "\u00c3\u00a9": "\u00e9",  # Ã© -> é
            "\ufffd": "",
        }
        for bad, good in encoding_fixes.items():
            content = content.replace(bad, good)

        # Normalize whitespace (but preserve single internal spaces)
        # Multiple newlines to double
        content = re.sub(r"\n{3,}", "\n\n", content)
        # Strip leading/trailing
        content = content.strip()

        msg["content"] = content

    # Remove empty messages if requested
    if remove_empty:
        cleaned["messages"] = [
            msg for msg in cleaned["messages"]
            if msg.get("content", "").strip()
        ]

    return cleaned


def clean_example_detailed(example: dict, operations: List[str] | None = None) -> CleaningResult:
    """
    Apply cleaning operations to an example with detailed results.

    Available operations:
    - remove_empty_messages: Remove messages with empty content
    - normalize_roles: Standardize role names
    - fix_encoding: Fix common encoding issues
    - remove_refusals: Remove refusal phrases
    - mask_pii: Replace PII with placeholders
    - normalize_whitespace: Fix whitespace issues
    - remove_special_tokens: Remove model special tokens
    """
    if operations is None:
        operations = [
            "remove_empty_messages",
            "normalize_roles",
            "fix_encoding",
            "normalize_whitespace",
        ]

    original = example.copy()
    cleaned = {"messages": [m.copy() for m in example.get("messages", [])]}
    changes: List[str] = []

    # Track original issue count
    original_issues = len(score_example(original).issues)

    for op in operations:
        if op == "remove_empty_messages":
            new_messages = []
            for msg in cleaned["messages"]:
                if msg.get("content", "").strip():
                    new_messages.append(msg)
                else:
                    changes.append(f"Removed empty {msg.get('role', 'unknown')} message")
            cleaned["messages"] = new_messages

        elif op == "normalize_roles":
            role_map = {
                "human": "user",
                "gpt": "assistant",
                "ai": "assistant",
                "bot": "assistant",
                "model": "assistant",
                "sys": "system",
            }
            for msg in cleaned["messages"]:
                old_role = msg.get("role", "").lower()
                if old_role in role_map:
                    msg["role"] = role_map[old_role]
                    changes.append(f"Normalized role '{old_role}' to '{msg['role']}'")

        elif op == "fix_encoding":
            encoding_fixes = {
                "\u00e2\u0080\u0099": "'",  # â€™ -> '
                "\u00e2\u0080\u009c": '"',  # â€œ -> "
                "\u00e2\u0080\u009d": '"',  # â€ -> "
                "\u00e2\u0080\u0094": "\u2014",  # â€" -> em-dash
                "\u00e2\u0080\u0093": "\u2013",  # â€" -> en-dash
                "\u00c3\u00a2": "\u00e2",  # Ã¢ -> â
                "\u00c3\u00a9": "\u00e9",  # Ã© -> é
                "\ufffd": "",
            }
            for msg in cleaned["messages"]:
                content = msg.get("content", "")
                # Also remove null characters
                content = content.replace("\x00", "")
                for bad, good in encoding_fixes.items():
                    if bad in content:
                        content = content.replace(bad, good)
                        changes.append(f"Fixed encoding issue: {bad}")
                msg["content"] = content

        elif op == "normalize_whitespace":
            for msg in cleaned["messages"]:
                content = msg.get("content", "")
                # Multiple spaces to single
                new_content = re.sub(r" +", " ", content)
                # Multiple newlines to double
                new_content = re.sub(r"\n{3,}", "\n\n", new_content)
                # Strip leading/trailing
                new_content = new_content.strip()
                if new_content != content:
                    msg["content"] = new_content
                    changes.append("Normalized whitespace")

        elif op == "remove_refusals":
            for msg in cleaned["messages"]:
                if msg.get("role") != "assistant":
                    continue
                content = msg.get("content", "")
                for pattern in REFUSAL_PATTERNS:
                    if re.search(pattern, content):
                        # Remove the refusal sentence
                        content = re.sub(pattern + r"[^.]*\.", "", content, flags=re.IGNORECASE)
                        changes.append("Removed refusal pattern")
                msg["content"] = content.strip()

        elif op == "mask_pii":
            for msg in cleaned["messages"]:
                content = msg.get("content", "")
                for pii_type, pattern in PII_PATTERNS.items():
                    matches = re.findall(pattern, content)
                    for match in matches:
                        placeholder = f"[{pii_type.upper()}]"
                        content = content.replace(match if isinstance(match, str) else match[0], placeholder)
                        changes.append(f"Masked {pii_type}")
                msg["content"] = content

        elif op == "remove_special_tokens":
            all_tokens = set()
            for tokens in SPECIAL_TOKENS.values():
                all_tokens.update(tokens)

            for msg in cleaned["messages"]:
                content = msg.get("content", "")
                for token in all_tokens:
                    if token in content:
                        content = content.replace(token, "")
                        changes.append(f"Removed special token: {token}")
                msg["content"] = content

    # Calculate issues fixed
    cleaned_issues = len(score_example(cleaned).issues)
    issues_fixed = original_issues - cleaned_issues

    return CleaningResult(
        original=original,
        cleaned=cleaned,
        changes=list(set(changes)),  # Deduplicate
        issues_fixed=max(0, issues_fixed),
        issues_remaining=cleaned_issues,
    )


def clean_dataset(
    examples: List[dict],
    operations: List[str] | None = None,
) -> tuple[List[dict], dict]:
    """
    Clean all examples in a dataset.

    Returns (cleaned_examples, summary).
    """
    cleaned_examples = []
    total_changes = 0
    total_issues_fixed = 0

    for ex in examples:
        result = clean_example_detailed(ex, operations)
        cleaned_examples.append(result.cleaned)
        total_changes += len(result.changes)
        total_issues_fixed += result.issues_fixed

    summary = {
        "total_examples": len(examples),
        "examples_modified": sum(1 for i, ex in enumerate(examples) if ex != cleaned_examples[i]),
        "total_changes": total_changes,
        "issues_fixed": total_issues_fixed,
    }

    return cleaned_examples, summary
