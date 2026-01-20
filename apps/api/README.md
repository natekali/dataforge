# DataForge API

FastAPI backend for DataForge Studio - REST API for dataset management and processing.

## Features

- **Project Management** - Create, update, delete projects
- **Dataset Import** - Import JSONL, JSON, CSV, Parquet files
- **Dataset Splits** - Train/validation/test split management with auto-split
- **Quality Validation** - Validate and score dataset quality
- **Format Conversion** - Convert between Alpaca, ShareGPT, ChatML
- **Export** - Generate training configs for Axolotl, Unsloth, LLaMA-Factory

## Quick Start

```bash
# Install dependencies
uv sync --extra dev

# Run development server
uv run uvicorn dataforge_api.main:app --reload --host 0.0.0.0 --port 8000
```

## API Docs

- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Dataset Splits

DataForge supports train/validation/test dataset splits for ML fine-tuning workflows.

### Split Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/datasets/{id}/splits` | GET | Get split counts |
| `/api/v1/datasets/{id}/splits/info` | GET | Get detailed split info with recommendations |
| `/api/v1/datasets/{id}/splits/auto` | POST | Auto-split dataset with configurable ratios |
| `/api/v1/datasets/{id}/splits/update` | POST | Update splits for specific examples |
| `/api/v1/datasets/{id}/splits/reset` | POST | Reset all examples to train split |

### Auto-Split Configuration

```json
{
  "train_ratio": 0.8,
  "validation_ratio": 0.1,
  "test_ratio": 0.1,
  "random_seed": 42
}
```

### Split Presets

| Preset | Train | Validation | Test | Use Case |
|--------|-------|------------|------|----------|
| Standard | 80% | 10% | 10% | Most datasets |
| Small Dataset | 70% | 15% | 15% | <1000 examples |
| Large Dataset | 98% | 1% | 1% | >100k examples |
| No Test | 90% | 10% | 0% | When test set not needed |

### Export with Splits

When exporting, DataForge creates separate files per split:
- `dataset_train.jsonl` - Training examples
- `dataset_validation.jsonl` - Validation examples
- `dataset_test.jsonl` - Test examples

Training configs are automatically configured to use the appropriate files.

## Testing

```bash
uv run pytest tests -v
```

## License

MIT
