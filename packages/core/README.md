# DataForge Core

Core Python library for DataForge Studio - dataset processing engine for LLM fine-tuning.

## Features

- **Format Detection** - Auto-detect Alpaca, ShareGPT, ChatML formats
- **Import/Export** - Support for JSONL, JSON, CSV, Parquet
- **Quality Validation** - Comprehensive validation and scoring
- **Model Templates** - 2025 model chat templates (Llama 4, Qwen 3, Gemma 3, etc.)
- **Format Conversion** - Convert between dataset formats

## Installation

```bash
pip install dataforge-core
# or with uv
uv add dataforge-core
```

## Usage

```python
from dataforge_core import (
    detect_schema,
    import_file,
    detect_format,
    format_for_model,
    validate_example,
    score_example,
)

# Import a dataset
content = open("data.jsonl", "rb").read()
file_format = detect_format("data.jsonl", content)
examples = import_file(content, file_format)

# Detect schema
schema = detect_schema(examples)
print(f"Format: {schema.format}, Confidence: {schema.confidence}")

# Validate examples
for example in examples:
    result = validate_example(example)
    if not result.is_valid:
        print(f"Invalid: {result.errors}")

# Score quality
score = score_example(examples[0])
print(f"Quality score: {score.overall}")

# Format for model
formatted = format_for_model(examples[0], "llama-3.3")
```

## License

MIT
