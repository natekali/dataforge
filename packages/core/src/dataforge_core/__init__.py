"""DataForge Core - Dataset processing engine."""

__version__ = "0.1.0"

# Detection
from dataforge_core.detection import detect_schema

# Import
from dataforge_core.importers import detect_format, import_file

# Models and templates
from dataforge_core.models import CHAT_TEMPLATES, MODEL_REGISTRY

# Formatting
from dataforge_core.formatters import (
    format_for_model,
    convert_format,
    apply_chat_template,
    get_model_config,
)

# Export
from dataforge_core.exporters import (
    create_export,
    preview_export,
    generate_config,
    generate_training_config,
    export_jsonl,
    export_json,
    TrainingFramework,
)

# Quality
from dataforge_core.quality import (
    validate_example,
    score_example,
    clean_example,
    score_dataset,
    ValidationResult,
    QualityScore,
    QualityIssue,
)

# Types
from dataforge_core.types import (
    DatasetFormat,
    MessageRole,
    Message,
    Example,
    DetectedSchema,
    ModelConfig,
    ExportPreview,
)

__all__ = [
    # Version
    "__version__",
    # Detection
    "detect_schema",
    # Import
    "detect_format",
    "import_file",
    # Models
    "CHAT_TEMPLATES",
    "MODEL_REGISTRY",
    # Formatting
    "format_for_model",
    "convert_format",
    "apply_chat_template",
    "get_model_config",
    # Export
    "create_export",
    "preview_export",
    "generate_config",
    "generate_training_config",
    "export_jsonl",
    "export_json",
    "TrainingFramework",
    # Quality
    "validate_example",
    "score_example",
    "clean_example",
    "score_dataset",
    "ValidationResult",
    "QualityScore",
    "QualityIssue",
    # Types
    "DatasetFormat",
    "MessageRole",
    "Message",
    "Example",
    "DetectedSchema",
    "ModelConfig",
    "ExportPreview",
]
