/**
 * React Query Hooks for DataForge API
 *
 * Custom hooks for data fetching with caching and automatic refetching.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  projectsApi,
  datasetsApi,
  datasetsApiExtended,
  modelsApi,
  modelsApiExtended,
  exportApi,
  providersApi,
  enhanceApi,
  qualityApi,
  qualityEvaluationApi,
  logsApi,
  huggingfaceApi,
  analyticsApi,
  type Project,
  type ProjectCreate,
  type ProjectUpdate,
  type DatasetExample,
  type Message,
  type ModelFamily,
  type ModelConstraints,
  type ExportConfig,
  type ProviderConfig,
  type ProviderStatus,
  type EnhancementConfig,
  type GenerationConfig,
  type JobStatus,
  type DatasetQualityReport,
  type DocumentGenerationConfig,
  type SplitCounts,
  type SplitInfo,
  type AutoSplitConfig,
  type SplitType,
  type LogLevel,
  type LogEntry,
  type LogsResponse,
  type LogStats,
  type HFDatasetInfo,
  type HFSearchResult,
  type HFImportConfig,
  type HFPushConfig,
  type ProjectAnalytics,
  type TokenDistribution,
  type EvaluationConfig,
  type BatchEvaluationResult,
  type SingleEvaluationResult,
  type URLPreviewResult,
  type DatasetStats,
} from './api';

// ============================================================================
// Query Keys
// ============================================================================

export const queryKeys = {
  projects: ['projects'] as const,
  project: (id: string) => ['projects', id] as const,
  projectStats: (id: string) => ['projects', id, 'stats'] as const,
  examples: (projectId: string) => ['examples', projectId] as const,
  example: (projectId: string, exampleId: string) =>
    ['examples', projectId, exampleId] as const,
  datasetStats: (projectId: string) => ['datasets', projectId, 'stats'] as const,
  splits: (projectId: string) => ['splits', projectId] as const,
  splitInfo: (projectId: string) => ['splits', projectId, 'info'] as const,
  models: ['models'] as const,
  modelConstraints: (modelId: string) => ['models', modelId, 'constraints'] as const,
  providers: ['providers'] as const,
  providerStatus: (id: string) => ['providers', id, 'status'] as const,
  ollamaModels: ['providers', 'ollama', 'models'] as const,
  job: (id: string) => ['jobs', id] as const,
  qualityScore: (projectId: string) => ['quality', projectId, 'score'] as const,
  evaluation: (projectId: string, jobId: string) => ['quality', projectId, 'evaluation', jobId] as const,
  logs: ['logs'] as const,
  logStats: ['logs', 'stats'] as const,
  // HuggingFace
  hfSearch: (query: string) => ['huggingface', 'search', query] as const,
  hfDataset: (datasetId: string) => ['huggingface', 'dataset', datasetId] as const,
  hfPopular: ['huggingface', 'popular'] as const,
  // Analytics
  analytics: (projectId: string) => ['analytics', projectId] as const,
  analyticsSummary: (projectId: string) => ['analytics', projectId, 'summary'] as const,
  tokenDistribution: (projectId: string) => ['analytics', projectId, 'tokens'] as const,
};

// ============================================================================
// Project Hooks
// ============================================================================

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => projectsApi.list(),
  });
}

export function useProject(id: string | null) {
  return useQuery({
    queryKey: queryKeys.project(id || ''),
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
  });
}

export function useProjectStats(id: string | null) {
  return useQuery({
    queryKey: queryKeys.projectStats(id || ''),
    queryFn: () => projectsApi.getStats(id!),
    enabled: !!id,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ProjectCreate) => projectsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ProjectUpdate }) =>
      projectsApi.update(id, data),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      queryClient.setQueryData(queryKeys.project(project.id), project);
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => projectsApi.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      queryClient.removeQueries({ queryKey: queryKeys.project(id) });
    },
  });
}

// ============================================================================
// Dataset Hooks
// ============================================================================

export function useExamples(
  projectId: string | null,
  options?: { offset?: number; limit?: number }
) {
  return useQuery({
    queryKey: [...queryKeys.examples(projectId || ''), options],
    queryFn: () => datasetsApi.getExamples(projectId!, options),
    enabled: !!projectId,
  });
}

export function useImportFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, file }: { projectId: string; file: File }) =>
      datasetsApi.importFile(projectId, file),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examples(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
    },
  });
}

export function useImportPaste() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, content }: { projectId: string; content: string }) =>
      datasetsApi.importPaste(projectId, content),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examples(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
    },
  });
}

export function useImportUrl() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      url,
      options,
    }: {
      projectId: string;
      url: string;
      options?: { split?: string; max_examples?: number };
    }) => datasetsApi.importUrl(projectId, url, options),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examples(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
    },
  });
}

export function useGenerateFromDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      file,
      config,
    }: {
      projectId: string;
      file: File;
      config?: DocumentGenerationConfig;
    }) => datasetsApi.generateFromDocument(projectId, file, config),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examples(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
    },
  });
}

// ============================================================================
// Split Hooks
// ============================================================================

export function useSplitCounts(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.splits(projectId || ''),
    queryFn: () => datasetsApi.getSplitCounts(projectId!),
    enabled: !!projectId,
  });
}

export function useSplitInfo(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.splitInfo(projectId || ''),
    queryFn: () => datasetsApi.getSplitInfo(projectId!),
    enabled: !!projectId,
  });
}

export function useAutoSplit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      config,
    }: {
      projectId: string;
      config?: AutoSplitConfig;
    }) => datasetsApi.autoSplit(projectId, config),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.splits(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.splitInfo(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.examples(projectId) });
    },
  });
}

export function useUpdateExampleSplits() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      exampleIds,
      split,
    }: {
      projectId: string;
      exampleIds: string[];
      split: SplitType;
    }) => datasetsApi.updateExampleSplits(projectId, exampleIds, split),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.splits(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.splitInfo(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.examples(projectId) });
    },
  });
}

export function useResetSplits() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId }: { projectId: string }) =>
      datasetsApi.resetSplits(projectId),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.splits(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.splitInfo(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.examples(projectId) });
    },
  });
}

export function useUpdateExample() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      exampleId,
      data,
    }: {
      projectId: string;
      exampleId: string;
      data: { messages?: Message[]; metadata?: Record<string, unknown> };
    }) => datasetsApi.updateExample(projectId, exampleId, data),
    onSuccess: (example, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examples(projectId) });
    },
  });
}

export function useDeleteExample() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, exampleId }: { projectId: string; exampleId: string }) =>
      datasetsApi.deleteExample(projectId, exampleId),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examples(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
    },
  });
}

export function useDeleteExamples() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, exampleIds }: { projectId: string; exampleIds: string[] }) =>
      datasetsApi.deleteExamples(projectId, exampleIds),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examples(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
    },
  });
}

export function useAddExamples() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      examples,
    }: {
      projectId: string;
      examples: Array<{ messages: Message[]; metadata?: Record<string, unknown> }>;
    }) => datasetsApi.addExamples(projectId, examples),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examples(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
    },
  });
}

// ============================================================================
// Model Hooks
// ============================================================================

export function useModelFamilies() {
  return useQuery({
    queryKey: queryKeys.models,
    queryFn: () => modelsApi.listFamilies(),
    staleTime: 1000 * 60 * 60, // Models don't change often, cache for 1 hour
  });
}

// ============================================================================
// Export Hooks
// ============================================================================

export function useExportDataset() {
  return useMutation({
    mutationFn: ({ projectId, config }: { projectId: string; config: ExportConfig }) =>
      exportApi.exportDataset(projectId, config),
    onSuccess: (blob, { config }) => {
      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dataset-${config.format}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  });
}

// ============================================================================
// Provider Hooks
// ============================================================================

export function useProviders() {
  return useQuery({
    queryKey: queryKeys.providers,
    queryFn: () => providersApi.list(),
  });
}

export function useProviderStatus(providerId: string | null) {
  return useQuery({
    queryKey: queryKeys.providerStatus(providerId || ''),
    queryFn: () => providersApi.getStatus(providerId!),
    enabled: !!providerId,
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

export function useOllamaModels() {
  return useQuery({
    queryKey: queryKeys.ollamaModels,
    queryFn: () => providersApi.listOllamaModels(),
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });
}

export function useTestProvider() {
  return useMutation({
    mutationFn: (providerId: string) => providersApi.test(providerId),
  });
}

// ============================================================================
// Enhancement Hooks
// ============================================================================

export function useEnhanceDataset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, config }: { projectId: string; config: EnhancementConfig }) =>
      enhanceApi.improve(projectId, config),
    onSuccess: (_, { projectId }) => {
      // Invalidate examples after enhancement starts
      queryClient.invalidateQueries({ queryKey: queryKeys.examples(projectId) });
    },
  });
}

export function useGenerateData() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, config }: { projectId: string; config: GenerationConfig }) =>
      enhanceApi.generate(projectId, config),
    onSuccess: (_, { projectId }) => {
      // Invalidate examples after generation starts
      queryClient.invalidateQueries({ queryKey: queryKeys.examples(projectId) });
    },
  });
}

export function useJobStatus(jobId: string | null) {
  return useQuery({
    queryKey: queryKeys.job(jobId || ''),
    queryFn: () => enhanceApi.getJobStatus(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      // Poll every 2 seconds while job is running
      const data = query.state.data as JobStatus | undefined;
      if (data?.status === 'running') return 2000;
      return false; // Stop polling when complete
    },
  });
}

export function usePreviewEnhancement() {
  return useMutation({
    mutationFn: ({
      projectId,
      config,
      exampleIds,
    }: {
      projectId: string;
      config: EnhancementConfig;
      exampleIds?: string[];
    }) => enhanceApi.previewEnhancement(projectId, config, exampleIds),
  });
}

// ============================================================================
// Quality Hooks
// ============================================================================

export function useQualityScore(projectId: string | null, modelFamily = 'llama') {
  return useQuery({
    queryKey: [...queryKeys.qualityScore(projectId || ''), modelFamily],
    queryFn: () => qualityApi.getScore(projectId!, modelFamily),
    enabled: !!projectId,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });
}

export function useCleanDataset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      operations,
      previewOnly,
    }: {
      projectId: string;
      operations: string[];
      previewOnly?: boolean;
    }) => qualityApi.clean(projectId, operations, previewOnly),
    onSuccess: (_, { projectId, previewOnly }) => {
      if (!previewOnly) {
        queryClient.invalidateQueries({ queryKey: queryKeys.examples(projectId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.qualityScore(projectId) });
      }
    },
  });
}

export function useDeduplicateDataset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      method,
      threshold,
    }: {
      projectId: string;
      method?: 'exact' | 'fuzzy';
      threshold?: number;
    }) => qualityApi.deduplicate(projectId, method, threshold),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examples(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.qualityScore(projectId) });
    },
  });
}

export function useValidateForModel() {
  return useMutation({
    mutationFn: ({ projectId, modelId }: { projectId: string; modelId: string }) =>
      qualityApi.validateForModel(projectId, modelId),
  });
}

export function useFormatForModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, modelId }: { projectId: string; modelId: string }) =>
      qualityApi.formatForModel(projectId, modelId),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examples(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.qualityScore(projectId) });
    },
  });
}

// ============================================================================
// Logs Hooks
// ============================================================================

export interface UseLogsOptions {
  level?: LogLevel;
  source?: string;
  limit?: number;
  offset?: number;
  search?: string;
  enabled?: boolean;
  refetchInterval?: number | false;
}

export function useLogs(options: UseLogsOptions = {}) {
  const { enabled = true, refetchInterval = false, ...queryOptions } = options;

  return useQuery({
    queryKey: [...queryKeys.logs, queryOptions],
    queryFn: () => logsApi.getLogs(queryOptions),
    enabled,
    refetchInterval,
  });
}

export function useLogStats() {
  return useQuery({
    queryKey: queryKeys.logStats,
    queryFn: () => logsApi.getStats(),
    refetchInterval: 5000, // Update every 5 seconds
  });
}

export function useClearLogs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => logsApi.clearLogs(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.logs });
      queryClient.invalidateQueries({ queryKey: queryKeys.logStats });
    },
  });
}

// ============================================================================
// HuggingFace Hooks
// ============================================================================

export function useHFSearch(query: string, options?: { limit?: number; filter_task?: string }) {
  return useQuery({
    queryKey: [...queryKeys.hfSearch(query), options],
    queryFn: () => huggingfaceApi.search(query, options),
    enabled: query.length >= 2,
  });
}

export function useHFDatasetInfo(datasetId: string | null) {
  return useQuery({
    queryKey: queryKeys.hfDataset(datasetId || ''),
    queryFn: () => huggingfaceApi.getDatasetInfo(datasetId!),
    enabled: !!datasetId,
  });
}

export function useHFPopular(options?: { task?: string; limit?: number }) {
  return useQuery({
    queryKey: [...queryKeys.hfPopular, options],
    queryFn: () => huggingfaceApi.getPopular(options),
    staleTime: 1000 * 60 * 30, // Cache for 30 minutes
  });
}

export function useHFImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, config }: { projectId: string; config: HFImportConfig }) =>
      huggingfaceApi.import(projectId, config),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examples(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
    },
  });
}

export function useHFPush() {
  return useMutation({
    mutationFn: ({
      projectId,
      config,
      token,
    }: {
      projectId: string;
      config: HFPushConfig;
      token?: string;
    }) => huggingfaceApi.push(projectId, config, token),
  });
}

// ============================================================================
// Analytics Hooks
// ============================================================================

export function useAnalytics(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.analytics(projectId || ''),
    queryFn: () => analyticsApi.getAnalytics(projectId!),
    enabled: !!projectId,
  });
}

export function useAnalyticsSummary(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.analyticsSummary(projectId || ''),
    queryFn: () => analyticsApi.getSummary(projectId!),
    enabled: !!projectId,
  });
}

export function useTokenDistribution(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.tokenDistribution(projectId || ''),
    queryFn: () => analyticsApi.getTokenDistribution(projectId!),
    enabled: !!projectId,
  });
}

// ============================================================================
// Quality Evaluation Hooks
// ============================================================================

export function useEvaluateDataset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, config }: { projectId: string; config: EvaluationConfig }) =>
      qualityEvaluationApi.evaluate(projectId, config),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.qualityScore(projectId) });
    },
  });
}

export function useEvaluationStatus(projectId: string | null, jobId: string | null) {
  return useQuery({
    queryKey: queryKeys.evaluation(projectId || '', jobId || ''),
    queryFn: () => qualityEvaluationApi.getEvaluationStatus(projectId!, jobId!),
    enabled: !!projectId && !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data as BatchEvaluationResult | undefined;
      if (data?.status === 'running') return 2000;
      return false;
    },
  });
}

export function useEvaluateSingle() {
  return useMutation({
    mutationFn: ({
      projectId,
      exampleId,
      config,
    }: {
      projectId: string;
      exampleId: string;
      config: EvaluationConfig;
    }) => qualityEvaluationApi.evaluateSingle(projectId, exampleId, config),
  });
}

// ============================================================================
// Extended Dataset Hooks
// ============================================================================

export function usePreviewUrl() {
  return useMutation({
    mutationFn: ({
      projectId,
      url,
      options,
    }: {
      projectId: string;
      url: string;
      options?: { split?: string; max_examples?: number };
    }) => datasetsApiExtended.previewUrl(projectId, url, options),
  });
}

export function useDatasetStats(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.datasetStats(projectId || ''),
    queryFn: () => datasetsApiExtended.getStats(projectId!),
    enabled: !!projectId,
  });
}

export function useConvertFormat() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, targetFormat }: { projectId: string; targetFormat: string }) =>
      datasetsApiExtended.convertFormat(projectId, targetFormat),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examples(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
    },
  });
}

// ============================================================================
// Extended Model Hooks
// ============================================================================

export function useModelConstraints(modelId: string | null) {
  return useQuery({
    queryKey: queryKeys.modelConstraints(modelId || ''),
    queryFn: () => modelsApiExtended.getConstraints(modelId!),
    enabled: !!modelId,
    staleTime: 1000 * 60 * 60, // Cache for 1 hour
  });
}
