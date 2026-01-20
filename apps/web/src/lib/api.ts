/**
 * DataForge API Client
 *
 * Typed API client for communicating with the FastAPI backend.
 */

// In production/Docker, use relative URLs to go through Next.js rewrites
// In development, can use direct URL for faster local development
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

// ============================================================================
// Types
// ============================================================================

// Dataset Split Types (defined first as used in other interfaces)
export type SplitType = 'train' | 'validation' | 'test';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface DatasetExample {
  id: string;
  messages: Message[];
  metadata?: Record<string, unknown>;
  split?: SplitType;
  quality_score?: number;
  token_count?: number;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  target_model: string | null;
  source_format: string | null;
  example_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectCreate {
  name: string;
  description?: string;
  target_model?: string;
}

export interface ProjectUpdate {
  name?: string;
  description?: string;
  target_model?: string;
}

export interface ProjectStats {
  total_examples: number;
  total_messages: number;
  avg_user_length: number;
  avg_assistant_length: number;
  avg_tokens: number | null;
  avg_quality: number | null;
}

export interface DetectedSchema {
  format: string;
  confidence: number;
  fields: string[];
  sample_count: number;
  suggested_mapping: Record<string, string> | null;
}

export interface ImportResult {
  success: boolean;
  imported: number;
  detected_schema: DetectedSchema;
  warnings: string[];
  errors: string[];
}

export interface URLImportResult {
  success: boolean;
  imported: number;
  source_url: string;
  detected_schema: DetectedSchema;
  warnings?: string[];
  errors?: string[];
}

export interface DocumentGenerationResult {
  success: boolean;
  examples_generated: number;
  chunks_processed: number;
  total_chunks: number;
  errors?: string[];
  warnings?: string[];
}

export interface DocumentGenerationConfig {
  questions_per_chunk?: number;
  style?: 'qa' | 'instruction' | 'summary';
  provider?: string;
  model?: string;
  temperature?: number;
}

export interface SplitCounts {
  train: number;
  validation: number;
  test: number;
  total: number;
}

export interface AutoSplitConfig {
  train_ratio?: number;
  validation_ratio?: number;
  test_ratio?: number;
  random_seed?: number;
}

export interface AutoSplitResult {
  success: boolean;
  train_count: number;
  validation_count: number;
  test_count: number;
  total: number;
  message: string;
}

export interface SplitInfo {
  total_examples: number;
  splits: Array<{
    split: string;
    count: number;
    percentage: number;
  }>;
  is_split: boolean;
  recommended_action?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  family: string;
  variants: string[];
  context_length: number;
  supports_system: boolean;
  supports_tools: boolean;
  supports_vision: boolean;
  chat_template: string;
  license: string | null;
  recommended_for: string[];
}

export interface ModelFamily {
  id: string;
  name: string;
  provider: string;
  models: ModelInfo[];
}

export interface ExportConfig {
  format: string;
  target_model?: string;
  framework?: string;
}

// ============================================================================
// API Error Handling
// ============================================================================

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail: string | undefined;
    try {
      const data = await response.json();
      detail = data.detail || data.message;
    } catch {
      // Response wasn't JSON
    }
    throw new ApiError(
      `API Error: ${response.status} ${response.statusText}`,
      response.status,
      detail
    );
  }
  return response.json();
}

// ============================================================================
// Projects API
// ============================================================================

export const projectsApi = {
  async list(): Promise<Project[]> {
    const response = await fetch(`${API_BASE_URL}/api/v1/projects`);
    return handleResponse<Project[]>(response);
  },

  async get(id: string): Promise<Project> {
    const response = await fetch(`${API_BASE_URL}/api/v1/projects/${id}`);
    return handleResponse<Project>(response);
  },

  async create(data: ProjectCreate): Promise<Project> {
    const response = await fetch(`${API_BASE_URL}/api/v1/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse<Project>(response);
  },

  async update(id: string, data: ProjectUpdate): Promise<Project> {
    const response = await fetch(`${API_BASE_URL}/api/v1/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse<Project>(response);
  },

  async delete(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/v1/projects/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new ApiError('Failed to delete project', response.status);
    }
  },

  async getStats(id: string): Promise<ProjectStats> {
    const response = await fetch(`${API_BASE_URL}/api/v1/projects/${id}/stats`);
    return handleResponse<ProjectStats>(response);
  },
};

// ============================================================================
// Datasets API
// ============================================================================

export const datasetsApi = {
  async importFile(projectId: string, file: File): Promise<ImportResult> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(
      `${API_BASE_URL}/api/v1/datasets/${projectId}/import`,
      {
        method: 'POST',
        body: formData,
      }
    );
    return handleResponse<ImportResult>(response);
  },

  async importPaste(projectId: string, content: string): Promise<ImportResult> {
    const formData = new FormData();
    formData.append('content', content);

    const response = await fetch(
      `${API_BASE_URL}/api/v1/datasets/${projectId}/import/paste`,
      {
        method: 'POST',
        body: formData,
      }
    );
    return handleResponse<ImportResult>(response);
  },

  async getExamples(
    projectId: string,
    options?: { offset?: number; limit?: number }
  ): Promise<DatasetExample[]> {
    const params = new URLSearchParams();
    if (options?.offset) params.set('offset', String(options.offset));
    if (options?.limit) params.set('limit', String(options.limit));

    const url = `${API_BASE_URL}/api/v1/datasets/${projectId}/examples?${params}`;
    const response = await fetch(url);
    return handleResponse<DatasetExample[]>(response);
  },

  async getExample(projectId: string, exampleId: string): Promise<DatasetExample> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/datasets/${projectId}/examples/${exampleId}`
    );
    return handleResponse<DatasetExample>(response);
  },

  async updateExample(
    projectId: string,
    exampleId: string,
    data: { messages?: Message[]; metadata?: Record<string, unknown> }
  ): Promise<DatasetExample> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/datasets/${projectId}/examples/${exampleId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }
    );
    return handleResponse<DatasetExample>(response);
  },

  async deleteExample(projectId: string, exampleId: string): Promise<void> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/datasets/${projectId}/examples/${exampleId}`,
      { method: 'DELETE' }
    );
    if (!response.ok) {
      throw new ApiError('Failed to delete example', response.status);
    }
  },

  async deleteExamples(projectId: string, exampleIds: string[]): Promise<{ deleted: number }> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/datasets/${projectId}/examples/delete`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ example_ids: exampleIds }),
      }
    );
    return handleResponse<{ deleted: number }>(response);
  },

  async addExamples(
    projectId: string,
    examples: Array<{ messages: Message[]; metadata?: Record<string, unknown> }>
  ): Promise<{ added: number }> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/datasets/${projectId}/examples`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ examples }),
      }
    );
    return handleResponse<{ added: number }>(response);
  },

  async importUrl(
    projectId: string,
    url: string,
    options?: { split?: string; max_examples?: number }
  ): Promise<URLImportResult> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/datasets/${projectId}/import/url`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          split: options?.split,
          max_examples: options?.max_examples,
        }),
      }
    );
    return handleResponse<URLImportResult>(response);
  },

  async generateFromDocument(
    projectId: string,
    file: File,
    config?: DocumentGenerationConfig
  ): Promise<DocumentGenerationResult> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('questions_per_chunk', String(config?.questions_per_chunk ?? 3));
    formData.append('style', config?.style ?? 'qa');
    formData.append('provider', config?.provider ?? 'ollama');
    formData.append('model', config?.model ?? 'llama3.2');
    formData.append('temperature', String(config?.temperature ?? 0.7));

    const response = await fetch(
      `${API_BASE_URL}/api/v1/datasets/${projectId}/import/document/generate`,
      {
        method: 'POST',
        body: formData,
      }
    );
    return handleResponse<DocumentGenerationResult>(response);
  },

  // Split Management
  async getSplitCounts(projectId: string): Promise<SplitCounts> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/datasets/${projectId}/splits`
    );
    return handleResponse<SplitCounts>(response);
  },

  async getSplitInfo(projectId: string): Promise<SplitInfo> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/datasets/${projectId}/splits/info`
    );
    return handleResponse<SplitInfo>(response);
  },

  async autoSplit(
    projectId: string,
    config?: AutoSplitConfig
  ): Promise<AutoSplitResult> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/datasets/${projectId}/splits/auto`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          train_ratio: config?.train_ratio ?? 0.8,
          validation_ratio: config?.validation_ratio ?? 0.1,
          test_ratio: config?.test_ratio ?? 0.1,
          random_seed: config?.random_seed ?? 42,
        }),
      }
    );
    return handleResponse<AutoSplitResult>(response);
  },

  async updateExampleSplits(
    projectId: string,
    exampleIds: string[],
    split: SplitType
  ): Promise<{ updated: number; split: string }> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/datasets/${projectId}/splits/update`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          example_ids: exampleIds,
          split,
        }),
      }
    );
    return handleResponse<{ updated: number; split: string }>(response);
  },

  async resetSplits(projectId: string): Promise<{ reset: number; message: string }> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/datasets/${projectId}/splits/reset`,
      {
        method: 'POST',
      }
    );
    return handleResponse<{ reset: number; message: string }>(response);
  },
};

// ============================================================================
// Models API
// ============================================================================

export const modelsApi = {
  async listFamilies(): Promise<ModelFamily[]> {
    const response = await fetch(`${API_BASE_URL}/api/v1/models`);
    return handleResponse<ModelFamily[]>(response);
  },

  async get(modelId: string): Promise<ModelInfo> {
    const response = await fetch(`${API_BASE_URL}/api/v1/models/${modelId}`);
    return handleResponse<ModelInfo>(response);
  },
};

// ============================================================================
// Export API
// ============================================================================

export const exportApi = {
  async exportDataset(
    projectId: string,
    config: ExportConfig
  ): Promise<Blob> {
    const response = await fetch(`${API_BASE_URL}/api/v1/export/${projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      throw new ApiError('Export failed', response.status);
    }

    return response.blob();
  },
};

// ============================================================================
// Health API
// ============================================================================

export const healthApi = {
  async check(): Promise<{ status: string }> {
    const response = await fetch(`${API_BASE_URL}/health`);
    return handleResponse<{ status: string }>(response);
  },
};

// ============================================================================
// Providers API
// ============================================================================

export interface ProviderConfig {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  base_url: string | null;
  models: string[];
}

export interface ProviderStatus {
  id: string;
  connected: boolean;
  available_models: string[];
  error: string | null;
}

export interface ProviderTestResult {
  success: boolean;
  latency_ms: number | null;
  error: string | null;
}

export const providersApi = {
  async list(): Promise<ProviderConfig[]> {
    const response = await fetch(`${API_BASE_URL}/api/v1/providers`);
    return handleResponse<ProviderConfig[]>(response);
  },

  async getStatus(providerId: string): Promise<ProviderStatus> {
    const response = await fetch(`${API_BASE_URL}/api/v1/providers/${providerId}/status`);
    return handleResponse<ProviderStatus>(response);
  },

  async test(providerId: string): Promise<ProviderTestResult> {
    const response = await fetch(`${API_BASE_URL}/api/v1/providers/${providerId}/test`, {
      method: 'POST',
    });
    return handleResponse<ProviderTestResult>(response);
  },

  async listOllamaModels(): Promise<string[]> {
    const response = await fetch(`${API_BASE_URL}/api/v1/providers/ollama/models`);
    return handleResponse<string[]>(response);
  },
};

// ============================================================================
// Enhancement API
// ============================================================================

export interface EnhancementConfig {
  provider: string;
  model: string;
  operations: string[];
  batch_size?: number;
  temperature?: number;
  max_tokens?: number;
}

export interface GenerationConfig {
  provider: string;
  model: string;
  num_examples: number;
  technique: string;
  seed_examples?: Array<{ messages: Message[] }>;
  topics?: string[];
  personas?: string[];
  temperature?: number;
  diversity?: number;
}

export interface EnhancementResult {
  job_id: string;
  status: string;
  processed: number;
  total: number;
  improved: number;
}

export interface GenerationResult {
  job_id: string;
  status: string;
  generated: number;
  target: number;
}

export interface JobStatus {
  id: string;
  type: string;
  status: string;
  progress: number;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnhancementPreview {
  example_id: string;
  original: string;
  enhanced: Record<string, string>;
}

// ============================================================================
// Quality API
// ============================================================================

export interface QualityIssue {
  type: string;
  severity: string;
  message: string;
  field: string | null;
  suggestion: string | null;
  auto_fixable: boolean;
}

export interface DatasetQualityReport {
  overall: number;
  total_examples: number;
  scores_distribution: Record<string, number>;
  issue_counts: Record<string, number>;
  critical_issues: number;
  avg_completeness: number;
  avg_formatting: number;
  avg_length_balance: number;
  avg_content_quality: number;
  examples_with_issues: number;
}

export interface CleaningResult {
  total_examples: number;
  examples_modified: number;
  total_changes: number;
  issues_fixed: number;
  preview?: Array<{ example_id: string; original: unknown; cleaned: unknown }>;
}

export interface DeduplicationResult {
  duplicates_removed: number;
  examples_remaining: number;
}

export const qualityApi = {
  async getScore(projectId: string, modelFamily = 'llama'): Promise<DatasetQualityReport> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/quality/${projectId}/score?model_family=${modelFamily}`
    );
    return handleResponse<DatasetQualityReport>(response);
  },

  async clean(
    projectId: string,
    operations: string[],
    previewOnly = false
  ): Promise<CleaningResult> {
    const response = await fetch(`${API_BASE_URL}/api/v1/quality/${projectId}/clean`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations, preview_only: previewOnly }),
    });
    return handleResponse<CleaningResult>(response);
  },

  async deduplicate(
    projectId: string,
    method: 'exact' | 'fuzzy' = 'exact',
    threshold = 0.95
  ): Promise<DeduplicationResult> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/quality/${projectId}/deduplicate?method=${method}&threshold=${threshold}`,
      { method: 'POST' }
    );
    return handleResponse<DeduplicationResult>(response);
  },

  async validateForModel(
    projectId: string,
    modelId: string
  ): Promise<{
    is_valid: boolean;
    total_examples: number;
    valid_examples: number;
    error_count: number;
    warning_count: number;
    issues: Array<{
      example_id: string;
      issue_type: string;
      severity: string;
      message: string;
    }>;
    recommendations: string[];
  }> {
    const response = await fetch(`${API_BASE_URL}/api/v1/quality/${projectId}/validate-for-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelId }),
    });
    return handleResponse(response);
  },

  async formatForModel(
    projectId: string,
    modelId: string
  ): Promise<{ examples_modified: number; changes_applied: string[] }> {
    const response = await fetch(`${API_BASE_URL}/api/v1/quality/${projectId}/format-for-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelId }),
    });
    return handleResponse(response);
  },
};

export const enhanceApi = {
  async improve(projectId: string, config: EnhancementConfig): Promise<EnhancementResult> {
    const response = await fetch(`${API_BASE_URL}/api/v1/enhance/${projectId}/improve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return handleResponse<EnhancementResult>(response);
  },

  async generate(projectId: string, config: GenerationConfig): Promise<GenerationResult> {
    const response = await fetch(`${API_BASE_URL}/api/v1/enhance/${projectId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return handleResponse<GenerationResult>(response);
  },

  async getJobStatus(jobId: string): Promise<JobStatus> {
    const response = await fetch(`${API_BASE_URL}/api/v1/enhance/jobs/${jobId}`);
    return handleResponse<JobStatus>(response);
  },

  async previewEnhancement(
    projectId: string,
    config: EnhancementConfig,
    exampleIds?: string[]
  ): Promise<{ previews: EnhancementPreview[] }> {
    const response = await fetch(`${API_BASE_URL}/api/v1/enhance/${projectId}/preview-enhancement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...config, example_ids: exampleIds }),
    });
    return handleResponse<{ previews: EnhancementPreview[] }>(response);
  },
};

// ============================================================================
// Logs API
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface LogsResponse {
  logs: LogEntry[];
  total: number;
  has_more: boolean;
}

export interface LogStats {
  total_logs: number;
  max_logs: number;
  by_level: Record<LogLevel, number>;
  by_source: Record<string, number>;
}

export const logsApi = {
  async getLogs(options?: {
    level?: LogLevel;
    source?: string;
    limit?: number;
    offset?: number;
    search?: string;
  }): Promise<LogsResponse> {
    const params = new URLSearchParams();
    if (options?.level) params.set('level', options.level);
    if (options?.source) params.set('source', options.source);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    if (options?.search) params.set('search', options.search);

    const url = `${API_BASE_URL}/api/v1/logs?${params}`;
    const response = await fetch(url);
    return handleResponse<LogsResponse>(response);
  },

  async getStats(): Promise<LogStats> {
    const response = await fetch(`${API_BASE_URL}/api/v1/logs/stats`);
    return handleResponse<LogStats>(response);
  },

  async clearLogs(): Promise<{ status: string }> {
    const response = await fetch(`${API_BASE_URL}/api/v1/logs`, {
      method: 'DELETE',
    });
    return handleResponse<{ status: string }>(response);
  },
};

// ============================================================================
// HuggingFace API
// ============================================================================

export interface HFDatasetInfo {
  id: string;
  name: string;
  description: string | null;
  downloads: number;
  likes: number;
  tags: string[];
  task_categories: string[];
}

export interface HFSearchResult {
  datasets: HFDatasetInfo[];
  total: number;
}

export interface HFImportConfig {
  dataset_id: string;
  config?: string;
  split?: string;
  max_examples?: number;
}

export interface HFPushConfig {
  repo_id: string;
  private?: boolean;
  commit_message?: string;
}

export const huggingfaceApi = {
  async search(query: string, options?: { limit?: number; filter_task?: string }): Promise<HFSearchResult> {
    const params = new URLSearchParams({ query });
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.filter_task) params.set('filter_task', options.filter_task);

    const response = await fetch(`${API_BASE_URL}/api/v1/huggingface/search?${params}`);
    return handleResponse<HFSearchResult>(response);
  },

  async getDatasetInfo(datasetId: string): Promise<HFDatasetInfo> {
    const response = await fetch(`${API_BASE_URL}/api/v1/huggingface/dataset/${encodeURIComponent(datasetId)}`);
    return handleResponse<HFDatasetInfo>(response);
  },

  async import(projectId: string, config: HFImportConfig): Promise<{
    success: boolean;
    imported: number;
    source: string;
    format: string;
  }> {
    const response = await fetch(`${API_BASE_URL}/api/v1/huggingface/${projectId}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return handleResponse(response);
  },

  async push(projectId: string, config: HFPushConfig, token?: string): Promise<{
    success: boolean;
    repo_id: string;
    examples_pushed: number;
    url: string;
  }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['X-HF-Token'] = token;

    const response = await fetch(`${API_BASE_URL}/api/v1/huggingface/${projectId}/push`, {
      method: 'POST',
      headers,
      body: JSON.stringify(config),
    });
    return handleResponse(response);
  },

  async getPopular(options?: { task?: string; limit?: number }): Promise<HFDatasetInfo[]> {
    const params = new URLSearchParams();
    if (options?.task) params.set('task', options.task);
    if (options?.limit) params.set('limit', String(options.limit));

    const response = await fetch(`${API_BASE_URL}/api/v1/huggingface/popular?${params}`);
    return handleResponse<HFDatasetInfo[]>(response);
  },
};

// ============================================================================
// Analytics API
// ============================================================================

export interface ProjectAnalytics {
  dataset_stats: {
    total_examples: number;
    total_messages: number;
    avg_messages_per_example: number;
  };
  role_distribution: Record<string, number>;
  length_distribution: {
    min: number;
    max: number;
    avg: number;
    median: number;
  };
  quality_stats?: {
    avg_score: number;
    score_distribution: Record<string, number>;
  };
  top_topics: Array<{ topic: string; count: number }>;
  format_info: {
    format: string;
    confidence: number;
  };
  recent_activity: Array<{ action: string; timestamp: string }>;
}

export interface TokenDistribution {
  buckets: Array<{ range: string; count: number }>;
  min: number;
  max: number;
  avg: number;
  total_examples: number;
}

export const analyticsApi = {
  async getAnalytics(projectId: string): Promise<ProjectAnalytics> {
    const response = await fetch(`${API_BASE_URL}/api/v1/analytics/${projectId}`);
    return handleResponse<ProjectAnalytics>(response);
  },

  async getSummary(projectId: string): Promise<{
    project_id: string;
    name: string;
    format: string;
    example_count: number;
    created_at: string;
    updated_at: string;
  }> {
    const response = await fetch(`${API_BASE_URL}/api/v1/analytics/${projectId}/summary`);
    return handleResponse(response);
  },

  async getTokenDistribution(projectId: string): Promise<TokenDistribution> {
    const response = await fetch(`${API_BASE_URL}/api/v1/analytics/${projectId}/token-distribution`);
    return handleResponse<TokenDistribution>(response);
  },
};

// ============================================================================
// Quality Evaluation API (extends qualityApi)
// ============================================================================

export interface EvaluationConfig {
  provider: string;
  model: string;
  sample_size?: number;
  dimensions?: string[];
}

export interface DimensionScore {
  score: number;
  explanation: string;
  suggestions: string[];
}

export interface SingleEvaluationResult {
  example_id: string;
  overall_score: number;
  dimensions: Record<string, DimensionScore>;
  errors: string[];
  needs_review: boolean;
}

export interface BatchEvaluationResult {
  job_id: string;
  status: string;
  total_examples: number;
  evaluated_count: number;
  average_score: number | null;
  needs_review_count: number;
  score_distribution: Record<string, number> | null;
  results: SingleEvaluationResult[] | null;
  error: string | null;
}

export const qualityEvaluationApi = {
  async evaluate(projectId: string, config: EvaluationConfig): Promise<BatchEvaluationResult> {
    const response = await fetch(`${API_BASE_URL}/api/v1/quality/${projectId}/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return handleResponse<BatchEvaluationResult>(response);
  },

  async getEvaluationStatus(projectId: string, jobId: string): Promise<BatchEvaluationResult> {
    const response = await fetch(`${API_BASE_URL}/api/v1/quality/${projectId}/evaluate/${jobId}`);
    return handleResponse<BatchEvaluationResult>(response);
  },

  async evaluateSingle(
    projectId: string,
    exampleId: string,
    config: EvaluationConfig
  ): Promise<SingleEvaluationResult> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/quality/${projectId}/evaluate/single?example_id=${exampleId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      }
    );
    return handleResponse<SingleEvaluationResult>(response);
  },
};

// ============================================================================
// Extended Datasets API methods
// ============================================================================

export interface URLPreviewResult {
  url_type: string;
  dataset_id: string | null;
  detected_schema: DetectedSchema;
  sample_examples: Record<string, unknown>[];
  total_count: number | null;
  error: string | null;
}

export interface DatasetStats {
  total_examples: number;
  avg_instruction_length: number;
  avg_response_length: number;
  format: string;
  token_estimate: number;
}

// Add these methods to datasetsApi by extending
export const datasetsApiExtended = {
  async previewUrl(
    projectId: string,
    url: string,
    options?: { split?: string; max_examples?: number }
  ): Promise<URLPreviewResult> {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/datasets/${projectId}/import/url/preview`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          split: options?.split,
          max_examples: options?.max_examples,
        }),
      }
    );
    return handleResponse<URLPreviewResult>(response);
  },

  async getStats(projectId: string): Promise<DatasetStats> {
    const response = await fetch(`${API_BASE_URL}/api/v1/datasets/${projectId}/stats`);
    return handleResponse<DatasetStats>(response);
  },

  async convertFormat(projectId: string, targetFormat: string): Promise<{
    status: string;
    target_format: string;
    count: number;
  }> {
    const formData = new FormData();
    formData.append('target_format', targetFormat);

    const response = await fetch(`${API_BASE_URL}/api/v1/datasets/${projectId}/convert`, {
      method: 'POST',
      body: formData,
    });
    return handleResponse(response);
  },
};

// ============================================================================
// Extended Models API
// ============================================================================

export interface ModelConstraints {
  max_context_tokens: number;
  max_output_tokens: number | null;
  supports_system_message: boolean;
  supports_multi_turn: boolean;
  supports_tools: boolean;
  forbidden_tokens: string[];
  required_format: string | null;
  token_budget_for_training: number | null;
}

export const modelsApiExtended = {
  async getConstraints(modelId: string): Promise<ModelConstraints> {
    const response = await fetch(`${API_BASE_URL}/api/v1/models/${modelId}/constraints`);
    return handleResponse<ModelConstraints>(response);
  },
};
