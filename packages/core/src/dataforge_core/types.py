"""Core type definitions."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, List, Optional


class DatasetFormat(str, Enum):
    """Supported dataset formats."""

    ALPACA = "alpaca"
    SHAREGPT = "sharegpt"
    CHATML = "chatml"
    OPENAI = "openai"
    CUSTOM = "custom"
    UNKNOWN = "unknown"


class MessageRole(str, Enum):
    """Standard message roles."""

    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


@dataclass
class Message:
    """A single message in a conversation."""

    role: MessageRole
    content: str
    name: Optional[str] = None
    tool_calls: Optional[List[dict]] = None
    tool_call_id: Optional[str] = None


@dataclass
class Example:
    """A single example in the dataset."""

    id: str
    messages: List[Message]
    metadata: dict = field(default_factory=dict)

    def to_alpaca(self) -> dict:
        """Convert to Alpaca format."""
        system = ""
        instruction = ""
        input_text = ""
        output = ""

        for msg in self.messages:
            if msg.role == MessageRole.SYSTEM:
                system = msg.content
            elif msg.role == MessageRole.USER:
                if not instruction:
                    instruction = msg.content
                else:
                    input_text = msg.content
            elif msg.role == MessageRole.ASSISTANT:
                output = msg.content

        result = {"instruction": instruction, "output": output}
        if input_text:
            result["input"] = input_text
        if system:
            result["system"] = system
        return result

    def to_sharegpt(self) -> dict:
        """Convert to ShareGPT format."""
        role_map = {
            MessageRole.SYSTEM: "system",
            MessageRole.USER: "human",
            MessageRole.ASSISTANT: "gpt",
        }
        conversations = [
            {"from": role_map.get(msg.role, "human"), "value": msg.content}
            for msg in self.messages
        ]
        return {"conversations": conversations}

    def to_chatml(self) -> dict:
        """Convert to ChatML/OpenAI format."""
        messages = [
            {"role": msg.role.value, "content": msg.content} for msg in self.messages
        ]
        return {"messages": messages}


@dataclass
class DetectedSchema:
    """Result of schema detection."""

    format: DatasetFormat
    confidence: float
    fields: List[str]
    warnings: List[str] = field(default_factory=list)
    suggested_mapping: Optional[dict[str, str]] = None
    sample_data: List[dict] = field(default_factory=list)
    field_mapping: dict[str, str] = field(default_factory=dict)
    has_system_messages: bool = False
    avg_turns: float = 1.0
    example_count: int = 0


@dataclass
class ModelConfig:
    """Configuration for a target model."""

    id: str
    name: str
    family: str
    context_length: int
    chat_template: str
    special_tokens: dict[str, str] = field(default_factory=dict)
    supports_system: bool = True
    supports_tools: bool = False
    supports_vision: bool = False


@dataclass
class ExportPreview:
    """Preview of export result."""

    examples: List[dict]
    config: Optional[str]
    files: List[str]


@dataclass
class QualityScore:
    """Quality assessment of an example."""

    completeness: float  # 0-1: Has all required fields
    formatting: float  # 0-1: Proper structure
    length_ratio: float  # Response length vs instruction
    overall: float  # Weighted average

    @classmethod
    def compute(cls, example: Example) -> "QualityScore":
        """Compute quality score for an example."""
        # Completeness: check for required messages
        has_user = any(m.role == MessageRole.USER for m in example.messages)
        has_assistant = any(m.role == MessageRole.ASSISTANT for m in example.messages)
        completeness = (1.0 if has_user else 0.0) * 0.5 + (1.0 if has_assistant else 0.0) * 0.5

        # Formatting: check message structure
        formatting = 1.0
        for msg in example.messages:
            if not msg.content or not msg.content.strip():
                formatting -= 0.2

        # Length ratio
        user_len = sum(len(m.content) for m in example.messages if m.role == MessageRole.USER)
        assistant_len = sum(
            len(m.content) for m in example.messages if m.role == MessageRole.ASSISTANT
        )
        if user_len > 0:
            ratio = assistant_len / user_len
            # Ideal ratio is around 1-3x
            length_ratio = min(1.0, ratio / 3.0) if ratio <= 3 else max(0.5, 1.0 - (ratio - 3) / 10)
        else:
            length_ratio = 0.5

        overall = completeness * 0.4 + formatting * 0.3 + length_ratio * 0.3

        return cls(
            completeness=completeness,
            formatting=max(0, formatting),
            length_ratio=length_ratio,
            overall=overall,
        )
