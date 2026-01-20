"""Enhanced export functionality with proper ZIP generation and split support."""

import io
import json
import zipfile
from datetime import datetime
from typing import Any

from dataforge_api import database as db
from dataforge_api.logging_config import get_logger

logger = get_logger(__name__)


async def create_export(
    project_id: str,
    config: dict[str, Any],
) -> bytes:
    """
    Create a ZIP archive with exported dataset and training configs.

    Supports train/validation/test splits - creates separate files for each split.

    Args:
        project_id: Project ID to export
        config: Export configuration including format, target_model, etc.
            - export_splits: bool - Whether to export as separate files per split (default: True)
            - split: str - Export only a specific split (train/validation/test)

    Returns:
        ZIP file as bytes
    """
    logger.info(
        "export_started",
        project_id=project_id,
        format=config.get("format"),
        target_model=config.get("target_model"),
    )

    project = await db.get_project(project_id)

    if not project:
        raise ValueError(f"Project not found: {project_id}")

    # Determine export mode
    export_splits = config.get("export_splits", True)
    single_split = config.get("split")  # If set, only export this split

    # Fetch examples based on configuration
    if single_split:
        # Export only one split
        examples = await db.get_examples_by_split(project_id, single_split)
        split_counts = {single_split: len(examples)}
    else:
        # Fetch all examples
        examples = await db.get_examples(project_id, offset=0, limit=100000)
        split_counts = await db.get_split_counts(project_id)

    if not examples:
        raise ValueError(f"No examples found in project: {project_id}")

    # Group examples by split
    examples_by_split = {"train": [], "validation": [], "test": []}
    for ex in examples:
        split_name = ex.get("split", "train")
        if split_name in examples_by_split:
            examples_by_split[split_name].append(ex)
        else:
            examples_by_split["train"].append(ex)

    # Create in-memory ZIP file
    zip_buffer = io.BytesIO()

    with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zip_file:
        format_type = config.get("format", "jsonl")
        filenames = {}

        if export_splits and not single_split:
            # Export as separate files per split
            for split_name, split_examples in examples_by_split.items():
                if split_examples:
                    dataset_content, base_filename = _format_dataset(
                        split_examples, format_type, config
                    )
                    # Add split suffix to filename
                    name_parts = base_filename.rsplit(".", 1)
                    if len(name_parts) == 2:
                        split_filename = f"{name_parts[0]}_{split_name}.{name_parts[1]}"
                    else:
                        split_filename = f"{base_filename}_{split_name}"

                    zip_file.writestr(split_filename, dataset_content)
                    filenames[split_name] = split_filename

            # Use train file as the main dataset file for config
            dataset_filename = filenames.get("train", list(filenames.values())[0] if filenames else "dataset.jsonl")
        else:
            # Export as single file (all examples or single split)
            dataset_content, dataset_filename = _format_dataset(
                examples, format_type, config
            )
            zip_file.writestr(dataset_filename, dataset_content)
            filenames["all"] = dataset_filename

        # Add training config if supported
        if config.get("generate_config", True):
            config_content = _generate_training_config(
                format_type,
                config["target_model"],
                dataset_filename,
                len(examples),
                config,
                filenames,  # Pass split filenames
            )
            config_filename = _get_config_filename(format_type)
            zip_file.writestr(config_filename, config_content)

            # Add training script for some formats
            script_content = _generate_training_script(
                format_type,
                config["target_model"],
                dataset_filename,
                config_filename,
            )
            if script_content:
                script_filename = _get_script_filename(format_type)
                zip_file.writestr(script_filename, script_content)

        # Add README with split information
        readme_content = _generate_readme(
            format_type,
            config["target_model"],
            dataset_filename,
            len(examples),
            config,
            split_counts,
            filenames,
        )
        zip_file.writestr("README.md", readme_content)

        # Add metadata with split information
        metadata = {
            "exported_at": datetime.utcnow().isoformat(),
            "project_id": project_id,
            "project_name": project["name"],
            "format": format_type,
            "target_model": config["target_model"],
            "num_examples": len(examples),
            "split_counts": split_counts,
            "files": filenames,
            "config": config,
        }
        zip_file.writestr("metadata.json", json.dumps(metadata, indent=2))

    zip_bytes = zip_buffer.getvalue()

    logger.info(
        "export_completed",
        project_id=project_id,
        format=config.get("format"),
        num_examples=len(examples),
        split_counts=split_counts,
        size_bytes=len(zip_bytes),
    )

    return zip_bytes


def _format_dataset(
    examples: list[dict],
    format_type: str,
    config: dict[str, Any],
) -> tuple[str, str]:
    """Format dataset according to specified format."""
    include_system = config.get("include_system_prompt", True)

    match format_type:
        case "jsonl":
            # ChatML JSONL format
            lines = []
            for ex in examples:
                messages = ex.get("messages", [])

                # Filter system messages if configured
                if not include_system:
                    messages = [m for m in messages if m.get("role") != "system"]

                lines.append(json.dumps({"messages": messages}, ensure_ascii=False))

            return "\n".join(lines), "dataset.jsonl"

        case "sharegpt":
            # ShareGPT from/value format
            lines = []
            for ex in examples:
                messages = ex.get("messages", [])

                if not include_system:
                    messages = [m for m in messages if m.get("role") != "system"]

                conversations = []
                for msg in messages:
                    role_map = {"user": "human", "assistant": "gpt", "system": "system"}
                    conversations.append(
                        {
                            "from": role_map.get(msg.get("role"), msg.get("role", "user")),
                            "value": msg.get("content", ""),
                        }
                    )

                lines.append(json.dumps({"conversations": conversations}, ensure_ascii=False))

            return "\n".join(lines), "dataset_sharegpt.json"

        case "alpaca":
            # Alpaca instruction/input/output format
            lines = []
            for ex in examples:
                messages = ex.get("messages", [])

                if not include_system:
                    messages = [m for m in messages if m.get("role") != "system"]

                # Extract instruction, input, output
                instruction = ""
                input_text = ""
                output = ""

                for msg in messages:
                    role = msg.get("role")
                    content = msg.get("content", "")

                    if role == "system":
                        instruction = (
                            f"{instruction}System: {content}\n"
                            if instruction
                            else f"System: {content}\n"
                        )
                    elif role == "user":
                        if instruction:
                            instruction += f"User: {content}"
                        else:
                            instruction = f"User: {content}"
                    elif role == "assistant":
                        output = content

                lines.append(
                    json.dumps(
                        {
                            "instruction": instruction.strip(),
                            "input": input_text,
                            "output": output,
                        },
                        ensure_ascii=False,
                    )
                )

            return "\n".join(lines), "dataset_alpaca.json"

        case "axolotl" | "unsloth" | "torchtune":
            # These formats use ChatML JSONL
            lines = []
            for ex in examples:
                messages = ex.get("messages", [])

                if not include_system:
                    messages = [m for m in messages if m.get("role") != "system"]

                lines.append(json.dumps({"messages": messages}, ensure_ascii=False))

            return "\n".join(lines), "dataset.jsonl"

        case "llamafactory":
            # LLaMA-Factory uses a specific JSON structure
            dataset_list = []
            for ex in examples:
                messages = ex.get("messages", [])

                if not include_system:
                    messages = [m for m in messages if m.get("role") != "system"]

                dataset_list.append(
                    {
                        "id": ex.get("id", ""),
                        "conversations": messages,
                    }
                )

            return json.dumps(dataset_list, ensure_ascii=False, indent=2), "dataset.json"

        case _:
            raise ValueError(f"Unsupported export format: {format_type}")


def _generate_training_config(
    format_type: str,
    target_model: str,
    dataset_filename: str,
    num_examples: int,
    config: dict[str, Any],
    filenames: dict[str, str] | None = None,
) -> str:
    """Generate training configuration for the specified framework with split support."""
    # Get split filenames if available
    train_file = filenames.get("train", dataset_filename) if filenames else dataset_filename
    val_file = filenames.get("validation") if filenames else None
    # Note: test_file not used in training configs (test sets are for final evaluation only)

    # Build validation section if validation file exists
    val_section = ""
    if val_file:
        val_section = f"""
# Validation dataset (separate file)
eval_dataset:
  path: {val_file}
  type: jsonl
  conversation: chatml
val_set_size: 0  # Using separate validation file instead of splitting train
"""
    else:
        val_section = """
val_set_size: 0.1  # Auto-split 10% for validation
"""

    match format_type:
        case "axolotl":
            return f"""# Axolotl Training Configuration
# Dataset includes train/validation/test splits
base_model: {target_model}
model_type: LlamaForCausalLM
tokenizer_type: LlamaTokenizer

load_in_8bit: false
load_in_4bit: true

datasets:
  - path: {train_file}
    type: jsonl
    conversation: chatml
{val_section}
output_dir: ./outputs
num_train_epochs: 3
per_device_train_batch_size: 2
gradient_accumulation_steps: 4
learning_rate: 0.0002
cutoff_len: 2048
logging_steps: 10
save_steps: 100

warmup_ratio: 0.1
lr_scheduler: cosine
optim: adamw_bnb_8bit
bf16: true

dataset_prepared_path: ./prepared_dataset
"""

        case "unsloth":
            val_config = f'  validation_dataset: "{val_file}"' if val_file else '  # No separate validation file'
            return f"""# Unsloth Training Configuration
# Dataset includes train/validation/test splits
model_name: "{target_model}"
adapter: "lora"
lora_r: 64
lora_alpha: 16
lora_dropout: 0.05

data:
  train_dataset: "{train_file}"
{val_config}
  format: "jsonl"
  field: "messages"
  max_length: 2048

training:
  batch_size: 2
  gradient_accumulation_steps: 4
  learning_rate: 0.0002
  num_epochs: 3
  warmup_ratio: 0.1
  max_grad_norm: 1.0

output:
  output_dir: "./unsloth_output"
  save_steps: 100
  logging_steps: 10
"""

        case "llamafactory":
            return json.dumps(
                {
                    "model_name_or_path": target_model,
                    "stage": "sft",
                    "do_train": True,
                    "finetuning_type": "lora",
                    "lora_target": "all",
                    "dataset": "custom_dataset",
                    "template": "llama3",
                    "cutoff_len": 2048,
                    "max_samples": num_examples,
                    "overwrite_cache": True,
                    "preprocessing_num_workers": 16,
                    "output_dir": "./llamafactory_output",
                    "logging_steps": 10,
                    "save_steps": 100,
                    "plot_loss": True,
                    "overwrite_output_dir": True,
                    "per_device_train_batch_size": 2,
                    "gradient_accumulation_steps": 4,
                    "learning_rate": 0.0002,
                    "num_train_epochs": 3,
                    "lr_scheduler_type": "cosine",
                    "warmup_ratio": 0.1,
                    "bf16": True,
                    "dataloader_num_workers": 0,
                    "dataset_dir": "./data",
                },
                indent=2,
            )

        case "torchtune":
            return f"""# Torchtune Configuration
model: {target_model}

checkpointer:
  _component_: torchtune.utils.FullModelHFCheckpointer
  checkpoint_dir: ./
  checkpoint_files:
    - {target_model.split("/")[-1]}
  metric_for_best_model: eval/loss
  output_dir: ./torchtune_output

dataset:
  _component_: torchtune.datasets.text_completion_dataset
  dataset_files:
    - {dataset_filename}
  max_seq_len: 2048

optimizer:
  _component_: torch.optim.AdamW
  lr: 0.0002
  weight_decay: 0.01

scheduler:
  _component_: torchtune.modules.get_cosine_schedule_with_warmup
  num_warmup_steps: 100

loss:
  _component_: torch.nn.CrossEntropyLoss

trainer:
  _component_: torchtune.config.Config
  max_steps: 1000
  batch_size: 2
  gradient_accumulation_steps: 4
  compile: False
"""

        case _:
            return "# No training configuration available for this format"


def _generate_training_script(
    format_type: str,
    target_model: str,
    dataset_filename: str,
    config_filename: str,
) -> str | None:
    """Generate training script for the framework."""
    match format_type:
        case "axolotl":
            return f"""#!/bin/bash
# Training script for Axolotl

# Install dependencies
pip install -U "transformers>=4.31.0" "peft>=0.4.0" "bitsandbytes>=0.40.2"
pip install "trl>=0.4.7" "deepspeed>=0.9.3"

# Train
accelerate launch -m axolotl.cli.train {config_filename}

# Merge adapters
python -m axolotl.cli.merge_lora {config_filename}
"""

        case "unsloth":
            return f"""#!/usr/bin/env python3
# Training script for Unsloth

from unsloth import FastLanguageModel
import torch
from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="{target_model}",
    max_seq_length=2048,
    dtype=None,
    load_in_4bit=True,
)

dataset = load_dataset("json", data_files="{dataset_filename}", split="train")

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    dataset_text_field="messages",
    max_seq_length=2048,
    dataset_num_proc=2,
    packing=False,
    args=TrainingArguments(
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        warmup_steps=10,
        max_steps=1000,
        learning_rate=0.0002,
        fp16=not torch.cuda.is_bf16_supported(),
        bf16=torch.cuda.is_bf16_supported(),
        logging_steps=10,
        optim="adamw_8bit",
        weight_decay=0.01,
        lr_scheduler_type="cosine",
        seed=3407,
        output_dir="./unsloth_output",
    ),
)

trainer.train()
model.save_pretrained_gguf("unsloth_output", tokenizer, quantization_method="q4_k_m")
"""

        case _:
            return None


def _generate_readme(
    format_type: str,
    target_model: str,
    dataset_filename: str,
    num_examples: int,
    config: dict[str, Any],
    split_counts: dict[str, int] | None = None,
    filenames: dict[str, str] | None = None,
) -> str:
    """Generate README with instructions for using the export, including split information."""
    timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

    # Build split statistics section
    split_section = ""
    if split_counts:
        total = sum(split_counts.values())
        split_section = "\n## Dataset Splits\n\n| Split | Count | Percentage |\n|-------|-------|------------|\n"
        for split_name in ["train", "validation", "test"]:
            count = split_counts.get(split_name, 0)
            if count > 0:
                pct = (count / total * 100) if total > 0 else 0
                split_section += f"| {split_name.capitalize()} | {count} | {pct:.1f}% |\n"
        split_section += f"\n**Total:** {total} examples\n"

    # Build files section with split files
    files_section = "## Files Included\n\n"
    if filenames:
        for split_name, filename in filenames.items():
            if split_name in ["train", "validation", "test"]:
                files_section += f"- `{filename}` - {split_name.capitalize()} split ({split_counts.get(split_name, 0) if split_counts else 'N/A'} examples)\n"
            else:
                files_section += f"- `{filename}` - Dataset in {format_type.upper()} format\n"
    else:
        files_section += f"- `{dataset_filename}` - The exported dataset in {format_type.upper()} format\n"

    files_section += f"- `{_get_config_filename(format_type)}` - Training configuration (if applicable)\n"
    files_section += "- `README.md` - This file\n"
    files_section += "- `metadata.json` - Export metadata\n"

    readme = f"""# Dataset Export

**Generated:** {timestamp}
**Format:** {format_type.upper()}
**Target Model:** {target_model}
**Examples:** {num_examples}
{split_section}
{files_section}

## Usage

### {format_type.upper()} Format

1. **Load the dataset:**
"""

    match format_type:
        case "jsonl":
            readme += """```python
import json

with open('dataset.jsonl', 'r', encoding='utf-8') as f:
    examples = [json.loads(line) for line in f]
print(f"Loaded {len(examples)} examples")
```"""

        case "alpaca":
            readme += """```python
import json

with open('dataset_alpaca.json', 'r', encoding='utf-8') as f:
    examples = json.load(f)
print(f"Loaded {len(examples)} examples")
```"""

        case "llamafactory":
            readme += """```python
import json

with open('dataset.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
examples = data
print(f"Loaded {len(examples)} examples")
```"""

        case "axolotl" | "unsloth" | "torchtune":
            readme += """The dataset is formatted for ChatML-style finetuning.
See the generated training script or config for usage instructions."""

        case "sharegpt":
            readme += """```python
import json

with open('dataset_sharegpt.json', 'r', encoding='utf-8') as f:
    examples = [json.loads(line) for line in f]
print(f"Loaded {len(examples)} examples")
```"""

    readme += f"""

2. **Train the model:**

See the generated training configuration and scripts for specific instructions on training with {format_type.upper()}.

## Configuration Details

"""

    readme += f"- **Format:** {format_type}\n"
    readme += f"- **Target Model:** {target_model}\n"
    readme += f"- **Include System Prompt:** {config.get('include_system_prompt', True)}\n"
    readme += f"- **Split Train/Test:** {config.get('split_train_test', False)}\n"
    if config.get("split_train_test"):
        readme += f"- **Test Size:** {config.get('test_size', 0.1)}\n"

    readme += """

## Notes

- All text is UTF-8 encoded
- Empty messages have been removed
- Quality scores are preserved in metadata where applicable
- For production use, consider:
  - Using a validation split
  - Monitoring training metrics
  - Adjusting hyperparameters for your specific use case

## Support

For issues or questions, please refer to the documentation of your chosen training framework.
"""

    return readme


def _get_config_filename(format_type: str) -> str:
    """Get the config filename for the format."""
    filenames = {
        "axolotl": "config.yml",
        "unsloth": "config.yml",
        "llamafactory": "dataset_info.json",
        "torchtune": "config.yaml",
    }
    return filenames.get(format_type, "config.yml")


def _get_script_filename(format_type: str) -> str:
    """Get the training script filename for the format."""
    filenames = {
        "axolotl": "train.sh",
        "unsloth": "train.py",
    }
    return filenames.get(format_type, "")
