# DataForge Studio

<div align="center">

**The Ultimate Fine-Tuning Dataset Builder**

*Create, manage, and export high-quality datasets for AI model training — no coding required*

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.12+-green.svg)
![Node](https://img.shields.io/badge/node-22+-green.svg)

[Quick Start](#-quick-start) | [Features](#-features) | [Installation](#-installation) | [User Guide](#-user-guide) | [Use Cases](#-use-cases)

</div>

---

## What is DataForge Studio?

DataForge Studio is a **visual tool** that helps you prepare training data for AI language models (like ChatGPT, Llama, or Mistral).

Think of it as a **"dataset kitchen"** where you can:
- **Import** your data from various sources (files, websites, HuggingFace)
- **Clean & Improve** your data with AI-powered assistance
- **Validate** your data meets quality standards
- **Export** ready-to-use training packages for popular frameworks

**No programming skills required** — everything happens through an intuitive web interface.

---

## Who Is This For?

| You Are... | DataForge Helps You... |
|------------|------------------------|
| **AI Researcher** | Quickly prepare and validate datasets for fine-tuning experiments |
| **ML Engineer** | Convert between formats and generate training configs automatically |
| **Data Scientist** | Analyze dataset quality, find issues, and fix them in bulk |
| **Content Creator** | Turn your documents (PDFs, Word files) into training data |
| **Hobbyist/Learner** | Get started with fine-tuning without complex data pipelines |

---

## Key Features

### Import Data From Anywhere

| Source | What You Can Import |
|--------|---------------------|
| **Files** | JSONL, JSON, CSV, Parquet, Excel, PDF, Word documents |
| **Clipboard** | Paste JSON/JSONL directly from your clipboard |
| **Web** | Import from URLs or HuggingFace Hub datasets |
| **Documents** | Convert PDFs, Word docs, and PowerPoints into Q&A pairs |

### Smart Format Detection

DataForge automatically recognizes your data format:
- **Alpaca** — `instruction`, `input`, `output` fields
- **ShareGPT** — `conversations` array format
- **ChatML/OpenAI** — `messages` array with roles

No manual configuration needed — just upload and go!

### AI-Powered Enhancement

Improve your dataset quality with one click:
- **Improve Quality** — Enhance response clarity and accuracy
- **Add Reasoning** — Include step-by-step thinking in responses
- **Expand Responses** — Make answers more detailed
- **Add Code Examples** — Insert relevant code snippets
- **Simplify** — Make complex responses easier to understand

### Quality Validation & Cleaning

Catch problems before training:
- Empty or missing messages
- Unbalanced response lengths
- Encoding issues
- Duplicate entries
- Sensitive data (PII) detection

**Auto-fix** common issues with a single click!

### Export to Any Framework

Generate ready-to-train packages for:

| Framework | What You Get |
|-----------|--------------|
| **Axolotl** | YAML config + formatted dataset |
| **Unsloth** | Python training script + dataset |
| **LLaMA-Factory** | dataset_info.json + dataset |
| **Torchtune** | YAML config + dataset |

Each export includes a README with training instructions!

### 2025 Model Support

Pre-configured for the latest models:
- **Meta**: Llama 4, Llama 3.3, Llama 3.2, Llama 3.1
- **Alibaba**: Qwen 3, Qwen 2.5, Qwen 2.5 Coder
- **Google**: Gemma 3, Gemma 2
- **Mistral**: Mistral Large, Small, Nemo
- **Microsoft**: Phi-4, Phi-3.5
- **DeepSeek**: DeepSeek V3, DeepSeek R1
- **Others**: Command R, OLMo 2, SmolLM2

---

## Quick Start

Get DataForge running in **under 5 minutes**:

### Option 1: Docker (Easiest)

```bash
# Clone the repository
git clone https://github.com/natekali/dataforge.git
cd dataforge

# Start with Docker
docker compose up
```

Open http://localhost:3000 in your browser. Done!

### Option 2: Local Installation

```bash
# Clone the repository
git clone https://github.com/natekali/dataforge.git
cd dataforge

# Install dependencies
pnpm install

# Start the application
pnpm dev
```

Open http://localhost:3000 in your browser.

---

## Installation

### What You'll Need

| Software | Version | Download Link |
|----------|---------|---------------|
| Node.js | 22 or newer | [nodejs.org](https://nodejs.org) |
| Python | 3.12 or newer | [python.org](https://python.org) |
| pnpm | 9 or newer | Run: `npm install -g pnpm` |
| uv | Latest | Run: `pip install uv` |

### Step-by-Step Installation

#### 1. Download DataForge

```bash
git clone https://github.com/natekali/dataforge.git
cd dataforge
```

#### 2. Install Frontend Dependencies

```bash
pnpm install
```

#### 3. Install Backend Dependencies

```bash
cd apps/api
uv sync
cd ../..
```

#### 4. Start the Application

**Run everything together:**
```bash
pnpm dev
```

**Or run separately (recommended for development):**

Terminal 1 - Start the web interface:
```bash
pnpm dev:web
```

Terminal 2 - Start the API server:
```bash
cd apps/api
uv run uvicorn dataforge_api.main:app --reload --port 8000
```

#### 5. Open in Browser

| Service | URL | Description |
|---------|-----|-------------|
| **Web App** | http://localhost:3000 | Main interface |
| **API Docs** | http://localhost:8000/docs | Interactive API documentation |

### Docker Installation

For a containerized setup with no local dependencies:

```bash
# Development mode (with live code reloading)
docker compose --profile dev up

# Production mode
docker compose up -d
```

---

## User Guide

### Step 1: Create a Project

1. Open DataForge at http://localhost:3000
2. Click **"New Project"**
3. Give your project a name (e.g., "Customer Support Bot")
4. Optionally select your target model (e.g., "Llama 3.3")
5. Click **"Create"**

### Step 2: Import Your Data

You have several options:

#### Option A: Upload a File
1. Click the **"Upload"** area or drag-and-drop your file
2. Supported formats: `.jsonl`, `.json`, `.csv`, `.parquet`, `.xlsx`, `.pdf`, `.docx`
3. DataForge will auto-detect the format
4. Review the preview and click **"Import"**

#### Option B: Paste from Clipboard
1. Click the **"Paste"** tab
2. Paste your JSON or JSONL data
3. Click **"Import"**

#### Option C: Import from HuggingFace
1. Click **"HuggingFace"** tab
2. Search for a dataset (e.g., "tatsu-lab/alpaca")
3. Select the split (train/test/validation)
4. Click **"Import"**

#### Option D: Generate from Documents
1. Click **"Documents"** tab
2. Upload a PDF, Word doc, or PowerPoint
3. DataForge will generate Q&A pairs from the content
4. Review and import the generated examples

### Step 3: Review & Edit Your Data

After importing, you'll see your dataset in a table view:

- **Browse**: Scroll through all your examples
- **Search**: Find specific content using the search bar
- **Edit**: Click any example to open the conversation editor
- **Delete**: Remove unwanted examples individually or in bulk

#### Editing a Conversation

1. Click on any example row
2. The **Conversation Editor** opens
3. You can:
   - Edit the text of any message
   - Add new messages (system, user, or assistant)
   - Reorder messages
   - Delete messages
4. Click **"Save"** when done

### Step 4: Check Data Quality

1. Go to the **"Quality"** section
2. Click **"Analyze Quality"**
3. Review the quality score and any issues found:

| Issue Type | What It Means |
|------------|---------------|
| **Empty Messages** | Some messages have no content |
| **Missing Roles** | Conversations missing user or assistant messages |
| **Length Imbalance** | Response is too short/long compared to the question |
| **Duplicates** | Same content appears multiple times |
| **PII Detected** | Personal information found (emails, phone numbers) |

4. Click **"Auto-Fix"** to automatically resolve common issues

### Step 5: Enhance with AI (Optional)

Make your dataset better with AI assistance:

1. Go to the **"Enhance"** section
2. Choose an enhancement type:
   - **Improve Quality**: Better grammar, clarity, accuracy
   - **Add Reasoning**: Include step-by-step thinking
   - **Expand**: Make responses more detailed
   - **Add Code**: Include code examples
   - **Simplify**: Make responses easier to understand
3. Select which examples to enhance
4. Click **"Enhance"** and wait for processing

### Step 6: Export Your Dataset

1. Go to the **"Export"** section
2. Choose your target framework:
   - **Axolotl** — Popular, flexible training framework
   - **Unsloth** — Fast 4-bit training
   - **LLaMA-Factory** — Easy-to-use trainer
   - **Torchtune** — PyTorch native training
3. Configure options:
   - Include/exclude system prompts
   - Create train/test split
4. Click **"Download"**
5. You'll get a ZIP file containing:
   - Your formatted dataset
   - Training configuration file
   - README with instructions

---

## Use Cases

### Fine-Tune a Customer Support Bot

**Goal**: Create a bot that answers questions about your product

1. **Import** your existing FAQ document (PDF or Word)
2. DataForge **generates** Q&A pairs automatically
3. **Review** and edit the generated conversations
4. **Enhance** responses with AI to add more detail
5. **Export** for Axolotl and train your model

### Create a Coding Assistant

**Goal**: Train a model to help with programming tasks

1. **Import** coding examples from HuggingFace
2. **Convert** to ChatML format for your target model
3. **Validate** against your model's context length
4. **Add reasoning** to show step-by-step problem solving
5. **Export** with code-optimized settings

### Clean Up an Existing Dataset

**Goal**: Improve a messy dataset you found online

1. **Import** the dataset from HuggingFace or upload a file
2. **Run quality checks** to find issues
3. **Auto-fix** common problems (duplicates, encoding)
4. **Remove** low-quality examples
5. **Export** the cleaned dataset

### Convert Dataset Formats

**Goal**: Use an Alpaca dataset with a ShareGPT-expecting tool

1. **Import** your Alpaca-format dataset
2. Go to **Format Conversion**
3. Select **ShareGPT** as target format
4. **Preview** the conversion
5. **Apply** and export in new format

### Build a Reasoning Model

**Goal**: Create training data with chain-of-thought reasoning

1. **Import** your instruction-response pairs
2. Use **"Add Reasoning"** enhancement
3. AI adds `<think>` tags with step-by-step reasoning
4. **Validate** the enhanced responses
5. **Export** for DeepSeek R1 or similar reasoning models

---

## Features In Detail

### Data Import

| Feature | Description |
|---------|-------------|
| **Multi-Format Support** | JSONL, JSON, CSV, Parquet, Excel, PDF, Word, PowerPoint, HTML, Markdown |
| **Auto-Detection** | Automatically identifies Alpaca, ShareGPT, or ChatML format |
| **Field Mapping** | Smart suggestions for mapping your columns to standard fields |
| **Large File Handling** | Efficiently processes files with millions of examples |
| **Validation** | Checks data structure before import |

### Data Editing

| Feature | Description |
|---------|-------------|
| **Table View** | Browse all examples in a sortable, searchable table |
| **Conversation Editor** | Visual editor for multi-turn conversations |
| **Bulk Operations** | Select and modify multiple examples at once |
| **Undo Support** | Revert changes if something goes wrong |
| **Live Preview** | See formatted output as you edit |

### Quality Assurance

| Feature | Description |
|---------|-------------|
| **Quality Scoring** | 0-100 score for each example and overall dataset |
| **Issue Detection** | Finds 15+ types of common problems |
| **Auto-Fix** | One-click fixes for encoding, whitespace, duplicates |
| **PII Masking** | Automatically redact sensitive information |
| **Model Validation** | Check compatibility with your target model |

### AI Enhancement

| Feature | Description |
|---------|-------------|
| **Quality Improvement** | Better grammar, clarity, factual accuracy |
| **Reasoning Addition** | Chain-of-thought with `<think>` tags |
| **Response Expansion** | More detailed, comprehensive answers |
| **Code Examples** | Relevant code snippets added where appropriate |
| **Simplification** | Complex responses made accessible |
| **Synthetic Generation** | Create new examples from existing ones |

### Export & Integration

| Feature | Description |
|---------|-------------|
| **Framework Configs** | Auto-generated YAML/JSON for training tools |
| **Format Conversion** | Convert between Alpaca, ShareGPT, ChatML |
| **Train/Test Split** | Automatically split data for evaluation |
| **HuggingFace Push** | Upload directly to HuggingFace Hub |
| **Batch Export** | Export multiple projects at once |

### Analytics & Monitoring

| Feature | Description |
|---------|-------------|
| **Dataset Statistics** | Example count, token counts, message distribution |
| **Quality Metrics** | Score distribution, issue breakdown |
| **Token Analysis** | Estimate training costs and time |
| **System Logs** | Real-time activity monitoring for debugging |
| **Job Tracking** | Monitor background processing tasks |

---

## Supported Models (2025)

| Provider | Models | Context Length | Best For |
|----------|--------|----------------|----------|
| **Meta** | Llama 4 Scout/Maverick | 10M tokens | General purpose, production |
| **Meta** | Llama 3.3 70B | 128K tokens | Fine-tuning, production |
| **Meta** | Llama 3.2 1B-90B | 128K tokens | Edge deployment, vision |
| **Alibaba** | Qwen 3 (0.6B-235B) | 32K tokens | Multilingual, fine-tuning |
| **Alibaba** | Qwen 2.5 Coder | 32K tokens | Code generation |
| **Google** | Gemma 3 (1B-27B) | 128K tokens | Vision, fine-tuning |
| **Mistral** | Mistral Large/Small/Nemo | 32-128K tokens | Fine-tuning, production |
| **Microsoft** | Phi-4 14B | 16K tokens | Edge deployment |
| **DeepSeek** | DeepSeek R1 | 64K tokens | Reasoning, fine-tuning |
| **Others** | OLMo 2, SmolLM2 | 4-8K tokens | Research, edge deployment |

---

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```bash
# API Server
DEBUG=true
HOST=0.0.0.0
PORT=8000

# Database (default: SQLite, no setup needed)
DATABASE_URL=sqlite+aiosqlite:///./dataforge.db

# AI Providers (optional - for enhancement features)
OLLAMA_BASE_URL=http://localhost:11434
OPENAI_API_KEY=your-openai-key
ANTHROPIC_API_KEY=your-anthropic-key

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### AI Provider Setup

To use AI enhancement features, configure at least one provider:

#### Ollama (Free, Local)
1. Install Ollama from [ollama.ai](https://ollama.ai)
2. Run: `ollama pull llama3.2`
3. DataForge will auto-detect Ollama

#### OpenAI
1. Get API key from [platform.openai.com](https://platform.openai.com)
2. Add to `.env`: `OPENAI_API_KEY=sk-...`

#### Anthropic
1. Get API key from [console.anthropic.com](https://console.anthropic.com)
2. Add to `.env`: `ANTHROPIC_API_KEY=sk-ant-...`

---

## Troubleshooting

### Common Issues

#### "Port already in use"
```bash
# Kill process on port 3000
npx kill-port 3000

# Kill process on port 8000
npx kill-port 8000
```

#### "Module not found" (Python)
```bash
cd apps/api
uv sync --refresh
```

#### "Cannot find module" (Node.js)
```bash
rm -rf node_modules
pnpm install
```

#### "Database error"
```bash
# Delete database and restart (data will be lost)
rm dataforge.db dataforge_analytics.duckdb
# Restart the application
```

#### AI Enhancement not working
1. Check your AI provider is configured in `.env`
2. Verify the provider is running (e.g., `ollama list`)
3. Check the **System Logs** tab for error messages

### Getting Help

- Check the [System Logs](#) tab in the app for detailed error messages
- Open an issue on [GitHub](https://github.com/natekali/dataforge/issues)
- Review the [API Documentation](http://localhost:8000/docs) for technical details

---

## Project Structure

```
dataforge/
├── apps/
│   ├── web/                    # Web interface (Next.js)
│   │   ├── src/
│   │   │   ├── app/           # Pages and routes
│   │   │   ├── components/    # UI components
│   │   │   └── lib/           # Utilities and hooks
│   │   └── package.json
│   │
│   └── api/                    # Backend API (FastAPI)
│       ├── src/dataforge_api/
│       │   ├── main.py        # Application entry
│       │   ├── routers/       # API endpoints
│       │   └── database.py    # Data storage
│       └── tests/             # API tests
│
├── packages/
│   └── core/                   # Data processing library
│       ├── src/dataforge_core/
│       │   ├── detection.py   # Format detection
│       │   ├── importers.py   # File importers
│       │   ├── formatters.py  # Data formatting
│       │   ├── exporters.py   # Export generation
│       │   ├── quality.py     # Quality validation
│       │   └── models.py      # Model registry
│       └── tests/
│
├── docker/                     # Docker configuration
├── docker-compose.yml          # Container orchestration
└── README.md                   # This file
```

---

## API Reference

Full API documentation is available at http://localhost:8000/docs when running the application.

### Quick API Examples

**Create a Project:**
```bash
curl -X POST http://localhost:8000/api/v1/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "My Dataset", "description": "Training data for my bot"}'
```

**Add Examples:**
```bash
curl -X POST http://localhost:8000/api/v1/datasets/{project_id}/examples \
  -H "Content-Type: application/json" \
  -d '{
    "examples": [{
      "messages": [
        {"role": "user", "content": "Hello!"},
        {"role": "assistant", "content": "Hi! How can I help you?"}
      ]
    }]
  }'
```

**Export Dataset:**
```bash
curl -X POST http://localhost:8000/api/v1/export/{project_id} \
  -H "Content-Type: application/json" \
  -d '{"format": "axolotl"}' \
  --output dataset.zip
```

---

## Contributing

We welcome contributions! Here's how to get started:

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/amazing-feature`
3. **Make** your changes
4. **Test** your changes: `pnpm test`
5. **Commit**: `git commit -m 'Add amazing feature'`
6. **Push**: `git push origin feature/amazing-feature`
7. **Open** a Pull Request

### Development Tips

- Run `pnpm lint` before committing
- Add tests for new features
- Update documentation for user-facing changes

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Acknowledgments

Built with:
- [FastAPI](https://fastapi.tiangolo.com/) — Python web framework
- [Next.js](https://nextjs.org/) — React framework
- [shadcn/ui](https://ui.shadcn.com/) — UI components
- [Polars](https://pola.rs/) — Fast data processing
- [DuckDB](https://duckdb.org/) — Analytical database
- [LiteLLM](https://litellm.ai/) — Multi-provider AI integration

---

<div align="center">

**Made with care for the AI fine-tuning community**

[Report Bug](https://github.com/natekali/dataforge/issues) | [Request Feature](https://github.com/natekali/dataforge/issues) | [Documentation](https://github.com/natekali/dataforge/wiki)

</div>
