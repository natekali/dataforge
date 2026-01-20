"""Dataset export functionality."""

import io
import json
import zipfile
from enum import Enum
from typing import Any, List, Optional
from uuid import UUID

import orjson

from dataforge_core.types import ExportPreview


class TrainingFramework(str, Enum):
    """Supported training frameworks."""

    AXOLOTL = "axolotl"
    UNSLOTH = "unsloth"
    LLAMA_FACTORY = "llamafactory"
    TORCHTUNE = "torchtune"


def export_jsonl(examples: List[dict], include_metadata: bool = False) -> bytes:
    """Export examples to JSONL format as bytes."""
    lines = []
    for example in examples:
        if not include_metadata and "metadata" in example:
            example = {k: v for k, v in example.items() if k != "metadata"}
        lines.append(orjson.dumps(example).decode("utf-8"))
    return "\n".join(lines).encode("utf-8") if lines else b""


def export_json(examples: List[dict], pretty: bool = False) -> bytes:
    """Export examples to JSON format as bytes."""
    if pretty:
        return json.dumps(examples, indent=2, ensure_ascii=False).encode("utf-8")
    return orjson.dumps(examples)


def generate_training_config(
    framework: TrainingFramework,
    model_name: str,
    dataset_path: str,
    learning_rate: float = 2e-4,
    num_epochs: int = 3,
    batch_size: int = 2,
    **kwargs,
) -> dict:
    """
    Generate training configuration for a specific framework.

    Args:
        framework: Target training framework
        model_name: Model identifier (e.g., "llama-3", "qwen3")
        dataset_path: Path to the dataset file
        learning_rate: Training learning rate
        num_epochs: Number of training epochs
        batch_size: Micro batch size

    Returns:
        Configuration dictionary for the framework
    """
    if framework == TrainingFramework.AXOLOTL:
        return _build_axolotl_config(model_name, dataset_path, learning_rate, num_epochs, batch_size)
    elif framework == TrainingFramework.UNSLOTH:
        return _build_unsloth_config(model_name, dataset_path, learning_rate, num_epochs, batch_size)
    elif framework == TrainingFramework.LLAMA_FACTORY:
        return _build_llamafactory_config(model_name, dataset_path, learning_rate, num_epochs, batch_size)
    elif framework == TrainingFramework.TORCHTUNE:
        return _build_torchtune_config(model_name, dataset_path, learning_rate, num_epochs, batch_size)
    else:
        raise ValueError(f"Unknown framework: {framework}")


def _get_model_path(model_name: str) -> str:
    """Get HuggingFace model path from model name."""
    model_map = {
        "llama-4": "meta-llama/Llama-4-Scout-17B-16E-Instruct",
        "llama-3.3": "meta-llama/Llama-3.3-70B-Instruct",
        "llama-3.2": "meta-llama/Llama-3.2-3B-Instruct",
        "llama-3.1": "meta-llama/Llama-3.1-8B-Instruct",
        "llama-3": "meta-llama/Llama-3.1-8B-Instruct",
        "qwen3": "Qwen/Qwen3-8B",
        "qwen2.5": "Qwen/Qwen2.5-7B-Instruct",
        "gemma-3": "google/gemma-3-12b-it",
        "gemma-2": "google/gemma-2-9b-it",
        "mistral": "mistralai/Mistral-7B-Instruct-v0.3",
        "phi-4": "microsoft/phi-4",
        "deepseek-r1": "deepseek-ai/DeepSeek-R1-Distill-Llama-8B",
    }
    return model_map.get(model_name, model_name)


def _get_chat_template(model_name: str) -> str:
    """Get chat template name for model."""
    template_map = {
        "llama-4": "llama4",
        "llama-3.3": "llama3",
        "llama-3.2": "llama3",
        "llama-3.1": "llama3",
        "llama-3": "llama3",
        "qwen3": "qwen",
        "qwen2.5": "qwen",
        "gemma-3": "gemma",
        "gemma-2": "gemma",
        "mistral": "mistral",
        "phi-4": "phi",
        "deepseek-r1": "deepseek",
    }
    return template_map.get(model_name, "chatml")


def _get_context_length(model_name: str) -> int:
    """Get context length for model."""
    context_map = {
        "llama-4": 131072,
        "llama-3.3": 128000,
        "llama-3.2": 128000,
        "llama-3.1": 128000,
        "llama-3": 128000,
        "qwen3": 32768,
        "qwen2.5": 32768,
        "gemma-3": 128000,
        "gemma-2": 8192,
        "mistral": 32000,
        "phi-4": 16384,
        "deepseek-r1": 64000,
    }
    return context_map.get(model_name, 4096)


def _build_axolotl_config(
    model_name: str,
    dataset_path: str,
    learning_rate: float,
    num_epochs: int,
    batch_size: int,
) -> dict:
    """Build Axolotl configuration dictionary."""
    return {
        "base_model": _get_model_path(model_name),
        "model_type": "AutoModelForCausalLM",
        "tokenizer_type": "AutoTokenizer",
        "trust_remote_code": True,
        "load_in_4bit": True,
        "datasets": [
            {
                "path": dataset_path,
                "type": "sharegpt",
                "conversation": "chatml",
            }
        ],
        "chat_template": _get_chat_template(model_name),
        "sequence_len": min(4096, _get_context_length(model_name)),
        "sample_packing": True,
        "adapter": "qlora",
        "lora_r": 32,
        "lora_alpha": 64,
        "lora_dropout": 0.05,
        "lora_target_modules": ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        "gradient_accumulation_steps": 4,
        "micro_batch_size": batch_size,
        "num_epochs": num_epochs,
        "learning_rate": learning_rate,
        "lr_scheduler": "cosine",
        "warmup_ratio": 0.1,
        "optimizer": "adamw_torch_fused",
        "bf16": True,
        "gradient_checkpointing": True,
        "flash_attention": True,
        "output_dir": "./output",
    }


def _build_unsloth_config(
    model_name: str,
    dataset_path: str,
    learning_rate: float,
    num_epochs: int,
    batch_size: int,
) -> dict:
    """Build Unsloth configuration dictionary."""
    return {
        "model_name": f"unsloth/{_get_model_path(model_name).split('/')[-1]}",
        "dataset_path": dataset_path,
        "max_seq_length": min(4096, _get_context_length(model_name)),
        "load_in_4bit": True,
        "lora_r": 32,
        "lora_alpha": 64,
        "lora_dropout": 0.05,
        "target_modules": ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        "per_device_train_batch_size": batch_size,
        "gradient_accumulation_steps": 4,
        "num_train_epochs": num_epochs,
        "learning_rate": learning_rate,
        "lr_scheduler_type": "cosine",
        "warmup_ratio": 0.1,
        "bf16": True,
        "optim": "adamw_8bit",
        "output_dir": "./output",
    }


def _build_llamafactory_config(
    model_name: str,
    dataset_path: str,
    learning_rate: float,
    num_epochs: int,
    batch_size: int,
) -> dict:
    """Build LLaMA-Factory configuration dictionary."""
    return {
        "model_name_or_path": _get_model_path(model_name),
        "template": _get_chat_template(model_name),
        "dataset": "dataforge_export",
        "dataset_dir": ".",
        "finetuning_type": "lora",
        "lora_rank": 32,
        "lora_alpha": 64,
        "lora_dropout": 0.05,
        "lora_target": "all",
        "cutoff_len": min(4096, _get_context_length(model_name)),
        "per_device_train_batch_size": batch_size,
        "gradient_accumulation_steps": 4,
        "num_train_epochs": num_epochs,
        "learning_rate": learning_rate,
        "lr_scheduler_type": "cosine",
        "warmup_ratio": 0.1,
        "bf16": True,
        "flash_attn": "auto",
        "output_dir": "./output",
    }


def _build_torchtune_config(
    model_name: str,
    dataset_path: str,
    learning_rate: float,
    num_epochs: int,
    batch_size: int,
) -> dict:
    """Build Torchtune configuration dictionary."""
    return {
        "model": {
            "_component_": f"torchtune.models.{model_name.replace('-', '_').replace('.', '_')}",
        },
        "tokenizer": {
            "_component_": f"torchtune.models.{model_name.replace('-', '_').replace('.', '_')}_tokenizer",
        },
        "dataset": {
            "_component_": "torchtune.datasets.chat_dataset",
            "source": dataset_path,
            "conversation_style": "sharegpt",
            "max_seq_len": min(4096, _get_context_length(model_name)),
        },
        "batch_size": batch_size,
        "epochs": num_epochs,
        "optimizer": {
            "_component_": "torch.optim.AdamW",
            "lr": learning_rate,
            "weight_decay": 0.01,
        },
        "lr_scheduler": {
            "_component_": "torchtune.modules.get_cosine_schedule_with_warmup",
            "num_warmup_steps": 100,
        },
        "lora": {
            "r": 32,
            "alpha": 64,
            "dropout": 0.05,
            "target_modules": ["q_proj", "k_proj", "v_proj", "o_proj"],
        },
        "output_dir": "./output",
    }


async def create_export(project_id: UUID, config: Any) -> bytes:
    """
    Create export package for a project.

    Returns ZIP file bytes containing:
    - Dataset file(s)
    - Training configuration (if applicable)
    - README with instructions
    """
    # TODO: Implement with actual project storage
    # For now, return a placeholder

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        # Add placeholder data file
        zf.writestr("data.jsonl", "")

        # Add README
        readme = _generate_readme(config.format, config.target_model)
        zf.writestr("README.md", readme)

        # Add training config if requested
        if config.generate_config:
            if config.format == "axolotl":
                config_content = _generate_axolotl_config(config.target_model)
                zf.writestr("config.yaml", config_content)
            elif config.format == "unsloth":
                script_content = _generate_unsloth_script(config.target_model)
                zf.writestr("train.py", script_content)
            elif config.format == "llamafactory":
                dataset_info = _generate_llamafactory_config()
                zf.writestr("dataset_info.json", dataset_info)

    buffer.seek(0)
    return buffer.read()


async def preview_export(
    project_id: UUID,
    config: Any,
    num_examples: int = 3,
) -> ExportPreview:
    """
    Generate preview of export without creating full package.
    """
    # TODO: Implement with actual project storage
    examples = []
    config_preview = None
    files = ["data.jsonl", "README.md"]

    if config.generate_config:
        if config.format == "axolotl":
            config_preview = _generate_axolotl_config(config.target_model)
            files.append("config.yaml")
        elif config.format == "unsloth":
            config_preview = _generate_unsloth_script(config.target_model)
            files.append("train.py")
        elif config.format == "llamafactory":
            config_preview = _generate_llamafactory_config()
            files.append("dataset_info.json")

    return ExportPreview(examples=examples, config=config_preview, files=files)


async def generate_config(
    project_id: UUID,
    format: str,
    target_model: str,
) -> str:
    """Generate training configuration for a specific framework."""
    if format == "axolotl":
        return _generate_axolotl_config(target_model)
    elif format == "unsloth":
        return _generate_unsloth_script(target_model)
    elif format == "llamafactory":
        return _generate_llamafactory_config()
    elif format == "torchtune":
        return _generate_torchtune_config(target_model)
    else:
        raise ValueError(f"Unknown format: {format}")


def _generate_readme(format: str, target_model: str) -> str:
    """Generate README for export package."""
    return f"""# DataForge Studio Export

## Dataset Information
- Format: {format}
- Target Model: {target_model}
- Generated by: DataForge Studio

## Usage

### Axolotl
```bash
accelerate launch -m axolotl.cli.train config.yaml
```

### Unsloth
```bash
python train.py
```

### LLaMA-Factory
```bash
llamafactory-cli train \\
    --model_name_or_path {target_model} \\
    --dataset dataforge_export \\
    --output_dir ./output
```

## Files
- `data.jsonl` - Training data in JSONL format
- `config.yaml` / `train.py` - Training configuration
- `README.md` - This file

## Notes
- Ensure you have the required dependencies installed
- Adjust hyperparameters based on your hardware
- Monitor training with wandb or tensorboard
"""


def _generate_axolotl_config(target_model: str) -> str:
    """Generate Axolotl YAML configuration."""
    # Determine base model path
    model_map = {
        "llama-3.1": "meta-llama/Llama-3.1-8B-Instruct",
        "llama-3.2": "meta-llama/Llama-3.2-3B-Instruct",
        "llama-3.3": "meta-llama/Llama-3.3-70B-Instruct",
        "qwen2.5": "Qwen/Qwen2.5-7B-Instruct",
        "qwen3": "Qwen/Qwen3-8B",
        "mistral": "mistralai/Mistral-7B-Instruct-v0.3",
        "gemma-2": "google/gemma-2-9b-it",
        "gemma-3": "google/gemma-3-12b-it",
        "phi-4": "microsoft/phi-4",
    }

    base_model = model_map.get(target_model, f"{target_model}")

    return f"""# Axolotl Configuration
# Generated by DataForge Studio

base_model: {base_model}
model_type: AutoModelForCausalLM
tokenizer_type: AutoTokenizer
trust_remote_code: true

load_in_8bit: false
load_in_4bit: true
strict: false

# Dataset
datasets:
  - path: data.jsonl
    type: sharegpt
    conversation: chatml

dataset_prepared_path: ./prepared_data
val_set_size: 0.05
output_dir: ./output

# LoRA Configuration
adapter: qlora
lora_r: 32
lora_alpha: 64
lora_dropout: 0.05
lora_target_modules:
  - q_proj
  - k_proj
  - v_proj
  - o_proj
  - gate_proj
  - up_proj
  - down_proj

# Training
sequence_len: 4096
sample_packing: true
pad_to_sequence_len: true

gradient_accumulation_steps: 4
micro_batch_size: 2
num_epochs: 3
learning_rate: 2e-4
lr_scheduler: cosine
warmup_ratio: 0.1

optimizer: adamw_torch_fused
weight_decay: 0.01
max_grad_norm: 1.0

# Efficiency
bf16: auto
tf32: true
gradient_checkpointing: true
flash_attention: true

# Logging
logging_steps: 10
save_steps: 100
eval_steps: 100
save_total_limit: 3

wandb_project: dataforge-training
wandb_run_id:
wandb_watch:
wandb_log_model:

# NEFTune for better generalization
neftune_noise_alpha: 5
"""


def _generate_unsloth_script(target_model: str) -> str:
    """Generate Unsloth training script."""
    model_map = {
        "llama-3.1": "unsloth/Llama-3.1-8B-Instruct",
        "llama-3.2": "unsloth/Llama-3.2-3B-Instruct",
        "qwen2.5": "unsloth/Qwen2.5-7B-Instruct",
        "mistral": "unsloth/Mistral-7B-Instruct-v0.3",
        "gemma-2": "unsloth/gemma-2-9b-it",
        "phi-4": "unsloth/Phi-4",
    }

    base_model = model_map.get(target_model, f"unsloth/{target_model}")

    return f'''"""
Unsloth Training Script
Generated by DataForge Studio

Usage:
    pip install unsloth
    python train.py
"""

from unsloth import FastLanguageModel
from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments

# Configuration
MODEL_NAME = "{base_model}"
MAX_SEQ_LENGTH = 4096
DTYPE = None  # Auto-detect
LOAD_IN_4BIT = True

# Load model with Unsloth optimizations
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=MODEL_NAME,
    max_seq_length=MAX_SEQ_LENGTH,
    dtype=DTYPE,
    load_in_4bit=LOAD_IN_4BIT,
)

# Add LoRA adapters
model = FastLanguageModel.get_peft_model(
    model,
    r=32,
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    ],
    lora_alpha=64,
    lora_dropout=0.05,
    bias="none",
    use_gradient_checkpointing="unsloth",
    random_state=42,
)

# Load dataset
dataset = load_dataset("json", data_files="data.jsonl", split="train")


def formatting_func(example):
    """Format examples for training."""
    messages = example.get("messages", [])
    return tokenizer.apply_chat_template(messages, tokenize=False)


# Training arguments
training_args = TrainingArguments(
    output_dir="./output",
    per_device_train_batch_size=2,
    gradient_accumulation_steps=4,
    num_train_epochs=3,
    learning_rate=2e-4,
    lr_scheduler_type="cosine",
    warmup_ratio=0.1,
    logging_steps=10,
    save_steps=100,
    save_total_limit=3,
    bf16=True,
    optim="adamw_8bit",
    weight_decay=0.01,
    max_grad_norm=1.0,
    seed=42,
)

# Trainer
trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    formatting_func=formatting_func,
    max_seq_length=MAX_SEQ_LENGTH,
    args=training_args,
    packing=True,
)

# Train
trainer.train()

# Save
model.save_pretrained("./output/final")
tokenizer.save_pretrained("./output/final")

print("Training complete! Model saved to ./output/final")
'''


def _generate_llamafactory_config() -> str:
    """Generate LLaMA-Factory dataset_info.json."""
    config = {
        "dataforge_export": {
            "file_name": "data.jsonl",
            "formatting": "sharegpt",
            "columns": {"messages": "messages"},
            "tags": {"role_tag": "role", "content_tag": "content"},
        }
    }
    return json.dumps(config, indent=2)


def _generate_torchtune_config(target_model: str) -> str:
    """Generate Torchtune YAML configuration."""
    return f"""# Torchtune Configuration
# Generated by DataForge Studio

# Model
model:
  _component_: torchtune.models.llama3.llama3_8b

# Tokenizer
tokenizer:
  _component_: torchtune.models.llama3.llama3_tokenizer
  path: /path/to/tokenizer.model

# Dataset
dataset:
  _component_: torchtune.datasets.chat_dataset
  source: data.jsonl
  conversation_style: sharegpt
  max_seq_len: 4096

# Training
batch_size: 2
epochs: 3

optimizer:
  _component_: torch.optim.AdamW
  lr: 2e-4
  weight_decay: 0.01

lr_scheduler:
  _component_: torchtune.modules.get_cosine_schedule_with_warmup
  num_warmup_steps: 100

# LoRA
lora:
  r: 32
  alpha: 64
  dropout: 0.05
  target_modules:
    - q_proj
    - k_proj
    - v_proj
    - o_proj

# Output
output_dir: ./output
save_every_n_epochs: 1

# Logging
metric_logger:
  _component_: torchtune.utils.metric_logging.WandBLogger
  project: dataforge-training
"""


def export_to_jsonl(examples: List[dict], include_metadata: bool = False) -> str:
    """Export examples to JSONL format."""
    lines = []
    for example in examples:
        if not include_metadata and "metadata" in example:
            example = {k: v for k, v in example.items() if k != "metadata"}
        lines.append(orjson.dumps(example).decode("utf-8"))
    return "\n".join(lines)


def export_to_json(examples: List[dict]) -> str:
    """Export examples to JSON format."""
    return json.dumps(examples, indent=2, ensure_ascii=False)
