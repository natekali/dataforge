"""Model validation and constraint checking for dataset examples."""

from dataclasses import dataclass, field
from typing import Any, List, Optional
from enum import Enum


class IssueSeverity(str, Enum):
    """Severity level for validation issues."""
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


class IssueType(str, Enum):
    """Types of validation issues."""
    CONTEXT_OVERFLOW = "context_overflow"
    CONTEXT_WARNING = "context_warning"
    SYSTEM_UNSUPPORTED = "system_unsupported"
    TOKEN_CONFLICT = "token_conflict"
    EMPTY_CONTENT = "empty_content"
    MISSING_ROLE = "missing_role"
    MULTI_TURN_UNSUPPORTED = "multi_turn_unsupported"


@dataclass
class ModelConstraints:
    """Constraints for a model that affect dataset validity."""
    max_context_tokens: int = 4096
    max_output_tokens: Optional[int] = None
    supports_system_message: bool = True
    supports_multi_turn: bool = True
    supports_tools: bool = False
    forbidden_tokens: List[str] = field(default_factory=list)
    required_format: Optional[str] = None
    token_budget_for_training: Optional[int] = None

    def __post_init__(self):
        if self.token_budget_for_training is None:
            # Default to half of context length or 4096, whichever is smaller
            self.token_budget_for_training = min(self.max_context_tokens // 2, 4096)


@dataclass
class ValidationIssue:
    """A single validation issue found in an example."""
    example_id: str
    issue_type: IssueType
    severity: IssueSeverity
    message: str
    auto_fixable: bool = False
    suggested_fix: Optional[str] = None
    field: Optional[str] = None


@dataclass
class ModelValidationResult:
    """Result of validating examples against model constraints."""
    is_valid: bool
    total_examples: int
    valid_examples: int
    issues: List[ValidationIssue]
    recommendations: List[str]
    error_count: int = 0
    warning_count: int = 0


# Special tokens for each model family
MODEL_SPECIAL_TOKENS = {
    "llama-3": ["<|begin_of_text|>", "<|end_of_text|>", "<|eot_id|>", "<|start_header_id|>", "<|end_header_id|>"],
    "llama-4": ["<|begin_of_text|>", "<|eot_id|>", "<|header_start|>", "<|header_end|>"],
    "qwen": ["<|im_start|>", "<|im_end|>", "<|endoftext|>"],
    "chatml": ["<|im_start|>", "<|im_end|>"],
    "gemma": ["<start_of_turn>", "<end_of_turn>", "<bos>", "<eos>"],
    "mistral": ["<s>", "</s>", "[INST]", "[/INST]"],
    "phi": ["<|end|>", "<|user|>", "<|assistant|>", "<|system|>"],
    "deepseek": ["<|begin▁of▁sentence|>", "<|end▁of▁sentence|>"],
}


def get_model_constraints(model_id: str) -> ModelConstraints:
    """
    Get validation constraints for a model.

    Looks up model in registry or returns safe defaults.
    """
    from dataforge_core.models import MODEL_REGISTRY, get_model_info

    # Try to find model in registry
    model_info = get_model_info(model_id)

    if model_info:
        # Get special tokens for this model's template
        template_name = model_info.get("chat_template", "chatml")
        forbidden_tokens = MODEL_SPECIAL_TOKENS.get(template_name, [])

        return ModelConstraints(
            max_context_tokens=model_info.get("context_length", 4096),
            max_output_tokens=model_info.get("max_output_tokens"),
            supports_system_message=model_info.get("supports_system", True),
            supports_multi_turn=True,
            supports_tools=model_info.get("supports_tools", False),
            forbidden_tokens=forbidden_tokens,
            required_format=None,
        )

    # Default constraints for unknown models
    return ModelConstraints(
        max_context_tokens=4096,
        supports_system_message=True,
        supports_multi_turn=True,
        forbidden_tokens=MODEL_SPECIAL_TOKENS.get("chatml", []),
    )


def validate_for_model(
    examples: List[dict],
    model_id: str,
    constraints: Optional[ModelConstraints] = None,
) -> ModelValidationResult:
    """
    Validate examples against model constraints.

    Args:
        examples: List of examples with 'messages' key
        model_id: Model identifier
        constraints: Optional pre-computed constraints

    Returns:
        ModelValidationResult with issues and recommendations
    """
    if not constraints:
        constraints = get_model_constraints(model_id)

    issues: List[ValidationIssue] = []
    valid_count = 0

    for ex in examples:
        example_issues = _validate_single_example(ex, constraints)
        if example_issues:
            issues.extend(example_issues)
        else:
            valid_count += 1

    # Count by severity
    error_count = sum(1 for i in issues if i.severity == IssueSeverity.ERROR)
    warning_count = sum(1 for i in issues if i.severity == IssueSeverity.WARNING)

    # Generate recommendations
    recommendations = _generate_recommendations(issues, constraints, len(examples))

    return ModelValidationResult(
        is_valid=error_count == 0,
        total_examples=len(examples),
        valid_examples=valid_count,
        issues=issues,
        recommendations=recommendations,
        error_count=error_count,
        warning_count=warning_count,
    )


def _validate_single_example(
    example: dict,
    constraints: ModelConstraints,
) -> List[ValidationIssue]:
    """Validate a single example against constraints."""
    issues: List[ValidationIssue] = []
    example_id = example.get("id", "unknown")
    messages = example.get("messages", [])

    if not messages:
        issues.append(ValidationIssue(
            example_id=example_id,
            issue_type=IssueType.EMPTY_CONTENT,
            severity=IssueSeverity.ERROR,
            message="Example has no messages",
            auto_fixable=False,
        ))
        return issues

    # 1. Check context length
    from dataforge_core.formatters import estimate_tokens
    total_text = " ".join(m.get("content", "") for m in messages)
    tokens = estimate_tokens(total_text)

    if tokens > constraints.max_context_tokens:
        issues.append(ValidationIssue(
            example_id=example_id,
            issue_type=IssueType.CONTEXT_OVERFLOW,
            severity=IssueSeverity.ERROR,
            message=f"Example has {tokens} tokens, exceeds model limit of {constraints.max_context_tokens}",
            auto_fixable=False,
            suggested_fix="Split into multiple examples or summarize content",
        ))
    elif constraints.token_budget_for_training and tokens > constraints.token_budget_for_training:
        issues.append(ValidationIssue(
            example_id=example_id,
            issue_type=IssueType.CONTEXT_WARNING,
            severity=IssueSeverity.WARNING,
            message=f"Example has {tokens} tokens, may cause training issues (recommended < {constraints.token_budget_for_training})",
            auto_fixable=False,
            suggested_fix="Consider splitting long examples",
        ))

    # 2. Check system message support
    has_system = any(m.get("role") == "system" for m in messages)
    if has_system and not constraints.supports_system_message:
        issues.append(ValidationIssue(
            example_id=example_id,
            issue_type=IssueType.SYSTEM_UNSUPPORTED,
            severity=IssueSeverity.WARNING,
            message="Example has system message but model doesn't support it",
            auto_fixable=True,
            suggested_fix="Merge system message into first user message",
        ))

    # 3. Check for special token conflicts
    for msg in messages:
        content = msg.get("content", "")
        for token in constraints.forbidden_tokens:
            if token in content:
                issues.append(ValidationIssue(
                    example_id=example_id,
                    issue_type=IssueType.TOKEN_CONFLICT,
                    severity=IssueSeverity.ERROR,
                    message=f"Content contains model special token: {token}",
                    auto_fixable=True,
                    suggested_fix=f"Remove or escape '{token}'",
                    field=msg.get("role", "unknown"),
                ))

    # 4. Check for empty messages
    for i, msg in enumerate(messages):
        if not msg.get("content", "").strip():
            issues.append(ValidationIssue(
                example_id=example_id,
                issue_type=IssueType.EMPTY_CONTENT,
                severity=IssueSeverity.WARNING,
                message=f"Message {i} ({msg.get('role', 'unknown')}) has empty content",
                auto_fixable=True,
                suggested_fix="Remove empty message or add content",
            ))

    # 5. Check for required roles
    has_user = any(m.get("role") == "user" for m in messages)
    has_assistant = any(m.get("role") == "assistant" for m in messages)

    if not has_user:
        issues.append(ValidationIssue(
            example_id=example_id,
            issue_type=IssueType.MISSING_ROLE,
            severity=IssueSeverity.ERROR,
            message="Example missing 'user' message",
            auto_fixable=False,
        ))

    if not has_assistant:
        issues.append(ValidationIssue(
            example_id=example_id,
            issue_type=IssueType.MISSING_ROLE,
            severity=IssueSeverity.WARNING,
            message="Example missing 'assistant' response",
            auto_fixable=False,
            suggested_fix="Add assistant response or use for generation",
        ))

    # 6. Check multi-turn support
    user_count = sum(1 for m in messages if m.get("role") == "user")
    if user_count > 1 and not constraints.supports_multi_turn:
        issues.append(ValidationIssue(
            example_id=example_id,
            issue_type=IssueType.MULTI_TURN_UNSUPPORTED,
            severity=IssueSeverity.WARNING,
            message=f"Example has {user_count} turns but model may not support multi-turn",
            auto_fixable=False,
            suggested_fix="Split into single-turn examples",
        ))

    return issues


def _generate_recommendations(
    issues: List[ValidationIssue],
    constraints: ModelConstraints,
    total_examples: int,
) -> List[str]:
    """Generate actionable recommendations based on issues found."""
    recommendations = []

    # Count issue types
    issue_counts = {}
    for issue in issues:
        key = issue.issue_type.value
        issue_counts[key] = issue_counts.get(key, 0) + 1

    # Generate recommendations
    if issue_counts.get("context_overflow", 0) > 0:
        count = issue_counts["context_overflow"]
        pct = (count / total_examples) * 100
        recommendations.append(
            f"{count} examples ({pct:.1f}%) exceed context length. "
            f"Consider splitting long examples or using a model with larger context."
        )

    if issue_counts.get("system_unsupported", 0) > 0:
        count = issue_counts["system_unsupported"]
        recommendations.append(
            f"{count} examples have system messages that will be auto-merged. "
            f"Use 'Format for Model' to apply fixes."
        )

    if issue_counts.get("token_conflict", 0) > 0:
        count = issue_counts["token_conflict"]
        recommendations.append(
            f"{count} examples contain model special tokens in content. "
            f"These must be removed before training to avoid conflicts."
        )

    if issue_counts.get("empty_content", 0) > 0:
        count = issue_counts["empty_content"]
        recommendations.append(
            f"{count} empty messages found. "
            f"Remove or fill these messages before training."
        )

    if not recommendations:
        recommendations.append("Dataset looks good for this model!")

    return recommendations


def auto_fix_for_model(
    examples: List[dict],
    constraints: ModelConstraints,
) -> tuple[List[dict], List[str]]:
    """
    Automatically fix auto-fixable issues.

    Returns:
        (fixed_examples, changes_made)
    """
    fixed = []
    changes = []

    for ex in examples:
        fixed_ex = _fix_single_example(ex, constraints, changes)
        fixed.append(fixed_ex)

    return fixed, list(set(changes))


def _fix_single_example(
    example: dict,
    constraints: ModelConstraints,
    changes: List[str],
) -> dict:
    """Fix a single example."""
    fixed_ex = example.copy()
    fixed_ex["messages"] = [m.copy() for m in example.get("messages", [])]
    messages = fixed_ex["messages"]

    # 1. Fix system message if needed
    if not constraints.supports_system_message:
        system_msgs = [m for m in messages if m.get("role") == "system"]
        if system_msgs:
            # Merge system content into first user message
            system_content = "\n\n".join(m["content"] for m in system_msgs)
            messages = [m for m in messages if m.get("role") != "system"]

            for m in messages:
                if m.get("role") == "user":
                    m["content"] = f"{system_content}\n\n{m['content']}"
                    changes.append("Merged system message into first user message")
                    break

            fixed_ex["messages"] = messages

    # 2. Remove forbidden tokens from content
    for msg in fixed_ex["messages"]:
        original_content = msg.get("content", "")
        new_content = original_content

        for token in constraints.forbidden_tokens:
            if token in new_content:
                new_content = new_content.replace(token, "")
                changes.append(f"Removed special token: {token}")

        if new_content != original_content:
            msg["content"] = new_content

    # 3. Remove empty messages
    original_count = len(fixed_ex["messages"])
    fixed_ex["messages"] = [
        m for m in fixed_ex["messages"]
        if m.get("content", "").strip()
    ]
    if len(fixed_ex["messages"]) < original_count:
        changes.append("Removed empty messages")

    return fixed_ex


def check_special_tokens(example: dict, model_family: str) -> List[ValidationIssue]:
    """
    Check for special token conflicts in an example.

    Convenience function for quick token conflict checks.
    """
    forbidden = MODEL_SPECIAL_TOKENS.get(model_family, MODEL_SPECIAL_TOKENS.get("chatml", []))
    issues = []

    for msg in example.get("messages", []):
        content = msg.get("content", "")
        for token in forbidden:
            if token in content:
                issues.append(ValidationIssue(
                    example_id=example.get("id", "unknown"),
                    issue_type=IssueType.TOKEN_CONFLICT,
                    severity=IssueSeverity.ERROR,
                    message=f"Content contains special token: {token}",
                    auto_fixable=True,
                ))

    return issues
