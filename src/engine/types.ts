/**
 * DataForge V2 — canonical data model.
 *
 * This file is the single source of truth for every engine module, worker,
 * and UI surface. It has ZERO runtime dependencies and ZERO DOM types so it
 * is safe to import from Web Workers and from Node (vitest).
 *
 * Design principles (from the 2026 landscape research):
 *  - Store STRUCTURALLY, render at export: reasoning traces, tool calls and
 *    loss weights live as dedicated fields, never pre-rendered into content.
 *  - OpenAI messages JSONL is the canonical interchange shape; everything
 *    else (Alpaca, ShareGPT, Hermes tags, think tags) is an import/export
 *    transform.
 */

// ---------------------------------------------------------------------------
// Dataset types
// ---------------------------------------------------------------------------

/**
 * sft        — chat/instruction data (covers tool-calling + reasoning via fields)
 * preference — paired DPO/ORPO data (prompt + chosen + rejected)
 * kto        — unpaired preference (prompt + completion + boolean label)
 * rl         — prompt-only + verifiable answer (GRPO / RLVR / verl-style)
 */
export type DatasetType = 'sft' | 'preference' | 'kto' | 'rl';

export const DATASET_TYPES: DatasetType[] = ['sft', 'preference', 'kto', 'rl'];

export type Role = 'system' | 'developer' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  /** Provider-style call id (e.g. "call_abc123"). Generated if absent on import. */
  id: string;
  /** Function name. */
  name: string;
  /** Canonical form: JSON-encoded string (OpenAI spec). Exporters may parse to object. */
  arguments: string;
}

export interface Message {
  role: Role;
  content: string;
  /** Reasoning trace for assistant turns. Rendered per-target at export:
   *  <think>…</think> inline, [THINK] tokens, or Harmony analysis channel. */
  reasoning?: string;
  /** Tool invocations emitted by an assistant turn. */
  toolCalls?: ToolCall[];
  /** For role:"tool" — id of the call this message answers. */
  toolCallId?: string;
  /** Optional name (tool name for tool turns, participant name otherwise). */
  name?: string;
  /** Loss mask for assistant turns: 0 = exclude from loss, 1/undefined = train. */
  weight?: 0 | 1;
}

/** JSON-Schema tool definition (OpenAI "function" shape, unwrapped). */
export interface ToolDefinition {
  name: string;
  description?: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

export type SplitName = 'train' | 'validation' | 'test';
export const SPLITS: SplitName[] = ['train', 'validation', 'test'];

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------

export interface Example {
  id: string;
  projectId: string;
  type: DatasetType;
  /**
   * - sft:        the full conversation.
   * - preference: the PROMPT portion (system/user/multi-turn context).
   * - kto:        the prompt portion; completion lives in `completion`.
   * - rl:         the prompt-only conversation (last turn = user).
   */
  messages: Message[];
  /** preference: chosen assistant continuation (1+ messages). */
  chosen?: Message[];
  /** preference: rejected assistant continuation. */
  rejected?: Message[];
  /** kto: the completion being labelled. */
  completion?: Message[];
  /** kto: true = desirable, false = undesirable. */
  label?: boolean;
  /** rl: verifiable ground-truth answer (string match / math / code tests). */
  answer?: string;
  /** Tool schemas available in this example (exported as top-level `tools`). */
  tools?: ToolDefinition[];
  split: SplitName;
  tags: string[];
  flagged: boolean;
  reviewed: boolean;
  /** 0–100, from the last quality analysis. Null = not yet scored. */
  qualityScore: number | null;
  qualityIssues: QualityIssue[];
  /** Token count for the rendered example (target-model tokenizer or fallback). */
  tokenCount: number | null;
  createdAt: number;
  updatedAt: number;
  /** Free-form provenance / custom metadata (source file, generator, etc.). */
  meta: Record<string, unknown>;
}

/** Factory with all invariants applied. */
export function createExample(
  partial: Partial<Example> & Pick<Example, 'projectId' | 'messages'>,
): Example {
  const now = Date.now();
  return {
    id: partial.id ?? crypto.randomUUID(),
    type: partial.type ?? 'sft',
    split: partial.split ?? 'train',
    tags: partial.tags ?? [],
    flagged: partial.flagged ?? false,
    reviewed: partial.reviewed ?? false,
    qualityScore: partial.qualityScore ?? null,
    qualityIssues: partial.qualityIssues ?? [],
    tokenCount: partial.tokenCount ?? null,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    meta: partial.meta ?? {},
    ...{ projectId: partial.projectId, messages: partial.messages },
    chosen: partial.chosen,
    rejected: partial.rejected,
    completion: partial.completion,
    label: partial.label,
    answer: partial.answer,
    tools: partial.tools,
  };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  description: string;
  /** Registry id (ModelInfo.id) of the fine-tune target, if chosen. */
  targetModelId: string | null;
  /** Primary dataset type — drives default editors and export presets. */
  datasetType: DatasetType;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low';

export type IssueType =
  | 'empty_field'
  | 'missing_role'
  | 'invalid_role'
  | 'duplicate'
  | 'near_duplicate'
  | 'too_short'
  | 'too_long'
  | 'context_overflow'
  | 'refusal_pattern'
  | 'pii_detected'
  | 'encoding_error'
  | 'imbalanced_ratio'
  | 'special_token_conflict'
  | 'malformed_tool_call'
  | 'orphan_tool_result'
  | 'benchmark_contamination'
  | 'incoherent_turn_order';

export interface QualityIssue {
  type: IssueType;
  severity: IssueSeverity;
  message: string;
  /** Index into Example.messages (or chosen/rejected via `field`). */
  messageIndex?: number;
  field?: 'messages' | 'chosen' | 'rejected' | 'completion';
  autoFixable: boolean;
}

export interface QualityReport {
  exampleId: string;
  score: number; // 0–100
  components: {
    completeness: number;
    formatting: number;
    lengthBalance: number;
    contentQuality: number;
  };
  issues: QualityIssue[];
}

export interface DatasetQualitySummary {
  scored: number;
  averageScore: number;
  scoreDistribution: { excellent: number; good: number; fair: number; poor: number };
  issueCounts: Partial<Record<IssueType, number>>;
}

export interface CleaningOptions {
  removeEmptyMessages: boolean;
  normalizeRoles: boolean;
  fixEncoding: boolean;
  normalizeWhitespace: boolean;
  removeRefusals: boolean;
  maskPii: boolean;
  removeSpecialTokens: boolean;
}

/** Default cleaning config: every safe operation on, destructive ones off.
 *  Lives here (not in quality.ts) so UI code can import it without pulling
 *  the quality module's tokenizer dependency into the entry bundle. */
export const DEFAULT_CLEANING: CleaningOptions = {
  removeEmptyMessages: true,
  normalizeRoles: true,
  fixEncoding: true,
  normalizeWhitespace: true,
  removeRefusals: false,
  maskPii: true,
  removeSpecialTokens: false,
};

// ---------------------------------------------------------------------------
// Model registry
// ---------------------------------------------------------------------------

export type TemplateFamily =
  | 'chatml'        // Qwen, SmolLM3, Nemotron 3, MiniMax, many community tunes
  | 'kimi-chatml'   // <|im_user|>/<|im_assistant|>/<|im_middle|>
  | 'llama3'        // <|start_header_id|>…<|eot_id|>
  | 'llama4'        // <|header_start|>…<|eot|>
  | 'gemma'         // <start_of_turn>; no system role before Gemma 4
  | 'mistral-tekken'// [INST]/[SYSTEM_PROMPT]/[TOOL_CALLS]/[THINK]
  | 'deepseek'      // <｜User｜>/<｜Assistant｜>
  | 'harmony'       // gpt-oss channels (analysis/final)
  | 'glm'           // [gMASK]<sop> + <|user|>/<|assistant|>/<|observation|>
  | 'granite'       // <|start_of_role|>
  | 'phi4'          // <|im_start|>role<|im_sep|>
  | 'phi4-mini';    // <|user|>/<|assistant|>/<|end|>

export type ReasoningMode =
  | 'none'
  | 'always-on'
  | 'hybrid'               // toggle via enable_thinking / soft switches
  | 'separate-checkpoints';// distinct Instruct vs Thinking models

export type ToolCallStyle =
  | 'none'
  | 'hermes'        // <tool_call>{json}</tool_call>
  | 'openai'        // structured tool_calls JSON
  | 'mistral'       // [TOOL_CALLS] tokens
  | 'harmony-ts'    // TypeScript-namespace functions (gpt-oss)
  | 'glm'           // <|observation|> role
  | 'llama-ipython';// ipython role (Llama 3.1+)

export interface ModelInfo {
  /** Registry slug, e.g. "qwen3.6-35b-a3b". */
  id: string;
  /** Exact HuggingFace id, e.g. "Qwen/Qwen3.6-35B-A3B". */
  hfId: string;
  name: string;
  vendor: string;
  family: string;
  totalParams: string;
  activeParams?: string;
  nativeCtx: number;
  extendedCtx?: number;
  ctxExtension?: 'YaRN' | 'RoPE' | 'other';
  templateFamily: TemplateFamily;
  reasoningMode: ReasoningMode;
  /** Delimiters for inline traces, or 'harmony-channel' for gpt-oss. */
  thinkDelimiters?: [string, string] | 'harmony-channel';
  /** GLM-4.7+/Kimi K2.5+/Qwen3.6/DeepSeek V4 retain think blocks across turns. */
  preservesThinking: boolean;
  supportsSystemRole: boolean;
  toolCallStyle: ToolCallStyle;
  multimodal: ('image' | 'video' | 'audio')[];
  license: string;
  /** Practical SFT sequence length (NOT the marketing context figure). */
  recommendedSeqLen: number;
  /** small: consumer GPU; medium: 1×A100-class; large: LoRA/QLoRA multi-GPU only. */
  sizeClass: 'small' | 'medium' | 'large';
  /** "YYYY-MM" first release of this checkpoint. */
  released: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export type SourceFormat =
  | 'openai-messages' // {"messages":[{role, content}]}
  | 'alpaca'          // {instruction, input?, output}
  | 'sharegpt'        // {"conversations":[{from, value}]}
  | 'dpo-pairs'       // {prompt|question|messages, chosen, rejected}
  | 'kto-unpaired'    // {prompt, completion, label}
  | 'text'            // raw text rows
  | 'unknown';

export interface DetectedSchema {
  format: SourceFormat;
  confidence: number; // 0–1
  /** Source-field → canonical-field mapping that was applied/suggested. */
  fieldMapping: Record<string, string>;
  sampleCount: number;
  warnings: string[];
}

export interface ImportResult {
  examples: Example[];
  schema: DetectedSchema;
  skipped: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type FrameworkId =
  | 'jsonl'          // canonical OpenAI messages JSONL (universal)
  | 'axolotl'        // 0.17+: chat_template YAML + JSONL
  | 'trl'            // 1.5+: column-typed JSONL + python script
  | 'llama-factory'  // 0.9.5: dataset_info.json + data file
  | 'ms-swift'       // 4.3: messages JSONL with swift keys
  | 'unsloth'        // 2026.x: python notebook-style script
  | 'openai-ft'      // OpenAI fine-tuning API JSONL (SFT or DPO shape)
  | 'alpaca'         // legacy
  | 'sharegpt';      // legacy

export interface ExportOptions {
  framework: FrameworkId;
  datasetType: DatasetType;
  /** Render reasoning into target shape; false strips traces entirely. */
  includeReasoning: boolean;
  /** Strip think blocks from non-final assistant turns (off for preserved-thinking models). */
  stripPriorThinking: boolean;
  includeSystem: boolean;
  splitFiles: boolean; // emit one file per split
  targetModelId?: string;
  projectName: string;
}

export interface ExportFile {
  path: string;
  content: string | Uint8Array;
}

export interface ExportBundle {
  files: ExportFile[];
  /** Human-readable summary shown in the UI before download. */
  summary: string;
}

// ---------------------------------------------------------------------------
// AI providers (BYOK)
// ---------------------------------------------------------------------------

export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'groq'
  | 'ollama';

export interface ProviderConfig {
  id: ProviderId;
  apiKey: string;
  /** Override base URL (Ollama host, proxies, Azure-style gateways). */
  baseUrl?: string;
  enabled: boolean;
  defaultModel?: string;
}

export interface ProviderModel {
  id: string;
  name: string;
  contextLength?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for a JSON object response where supported. */
  jsonMode?: boolean;
  signal?: AbortSignal;
}

export interface ChatResult {
  content: string;
  /** Reasoning/thinking text if the provider returns it separately. */
  reasoning?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

// ---------------------------------------------------------------------------
// Jobs (enhancement / generation runs — persisted so refresh survives)
// ---------------------------------------------------------------------------

export type JobKind =
  | 'enhance'
  | 'generate-synthetic'
  | 'generate-from-document'
  | 'build-preference-pairs'
  | 'quality-scan'
  | 'dedup'
  | 'llm-judge';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  projectId: string;
  kind: JobKind;
  status: JobStatus;
  /** 0–1 */
  progress: number;
  detail: string;
  total: number;
  done: number;
  failed: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  /** Kind-specific parameters snapshot (for resume/debug). */
  params: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface DatasetStats {
  exampleCount: number;
  byType: Partial<Record<DatasetType, number>>;
  bySplit: Record<SplitName, number>;
  roleCounts: Record<string, number>;
  /** Histogram buckets of total tokens per example. */
  tokenHistogram: { bucket: string; count: number }[];
  avgTokensPerExample: number;
  totalTokens: number;
  avgTurnsPerExample: number;
  withReasoning: number;
  withToolCalls: number;
  flagged: number;
  reviewed: number;
  quality: DatasetQualitySummary | null;
}
