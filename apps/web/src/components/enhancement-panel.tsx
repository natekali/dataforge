"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sparkles,
  Wand2,
  Brain,
  Code,
  FileText,
  Minimize,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Play,
  Eye,
  RefreshCw,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  useProviders,
  useProviderStatus,
  useOllamaModels,
  useTestProvider,
  useEnhanceDataset,
  useGenerateData,
  useJobStatus,
  usePreviewEnhancement,
} from "@/lib/hooks";

interface EnhancementPanelProps {
  projectId: string;
  exampleCount: number;
}

const ENHANCEMENT_OPERATIONS = [
  {
    id: "improve_quality",
    name: "Improve Quality",
    description: "General quality improvement for responses",
    icon: Sparkles,
  },
  {
    id: "add_reasoning",
    name: "Add Reasoning",
    description: "Add step-by-step reasoning with <thinking> tags",
    icon: Brain,
  },
  {
    id: "expand_response",
    name: "Expand Response",
    description: "Make responses more detailed and comprehensive",
    icon: FileText,
  },
  {
    id: "add_code_examples",
    name: "Add Code",
    description: "Add well-commented code examples where relevant",
    icon: Code,
  },
  {
    id: "simplify",
    name: "Simplify",
    description: "Make responses clearer and more accessible",
    icon: Minimize,
  },
];

const GENERATION_TECHNIQUES = [
  {
    id: "evol_instruct",
    name: "Evol-Instruct",
    description: "Evolve instructions to be more complex",
  },
  {
    id: "persona",
    name: "Persona-Based",
    description: "Generate from different user personas",
  },
  {
    id: "seed_expansion",
    name: "Seed Expansion",
    description: "Create variations of existing examples",
  },
];

export function EnhancementPanel({ projectId, exampleCount }: EnhancementPanelProps) {
  // Provider state
  const [selectedProvider, setSelectedProvider] = useState<string>("ollama");
  const [selectedModel, setSelectedModel] = useState<string>("");

  // Enhancement state
  const [selectedOperations, setSelectedOperations] = useState<string[]>(["improve_quality"]);
  const [temperature, setTemperature] = useState(0.7);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  // Generation state
  const [numExamples, setNumExamples] = useState(10);
  const [technique, setTechnique] = useState("evol_instruct");

  // Preview state
  const [showPreview, setShowPreview] = useState(false);

  // Hooks
  const { data: providers, isLoading: providersLoading } = useProviders();
  const { data: providerStatus, isLoading: statusLoading } = useProviderStatus(selectedProvider);
  const { data: ollamaModels } = useOllamaModels();
  const testProvider = useTestProvider();
  const enhanceDataset = useEnhanceDataset();
  const generateData = useGenerateData();
  const { data: jobStatus } = useJobStatus(currentJobId);
  const previewEnhancement = usePreviewEnhancement();

  // Set default model when provider changes
  useEffect(() => {
    if (selectedProvider === "ollama" && ollamaModels?.length) {
      setSelectedModel(ollamaModels[0]);
    } else if (selectedProvider === "openai") {
      setSelectedModel("gpt-4o-mini");
    } else if (selectedProvider === "anthropic") {
      setSelectedModel("claude-3-5-haiku-20241022");
    }
  }, [selectedProvider, ollamaModels]);

  // Handle job completion
  useEffect(() => {
    if (jobStatus?.status === "completed") {
      toast.success("Enhancement completed successfully!");
      setCurrentJobId(null);
    } else if (jobStatus?.status === "failed") {
      toast.error(`Enhancement failed: ${jobStatus.error}`);
      setCurrentJobId(null);
    }
  }, [jobStatus?.status, jobStatus?.error]);

  const toggleOperation = (opId: string) => {
    setSelectedOperations((prev) =>
      prev.includes(opId) ? prev.filter((id) => id !== opId) : [...prev, opId]
    );
  };

  const handleTestConnection = async () => {
    try {
      const result = await testProvider.mutateAsync(selectedProvider);
      if (result.success) {
        toast.success(`Connected! Latency: ${result.latency_ms?.toFixed(0)}ms`);
      } else {
        toast.error(`Connection failed: ${result.error}`);
      }
    } catch (error) {
      toast.error(`Test failed: ${error}`);
    }
  };

  const handlePreview = async () => {
    if (!selectedModel || selectedOperations.length === 0) {
      toast.error("Please select a model and at least one operation");
      return;
    }

    setShowPreview(true);
    try {
      await previewEnhancement.mutateAsync({
        projectId,
        config: {
          provider: selectedProvider,
          model: selectedModel,
          operations: selectedOperations,
          temperature,
        },
      });
    } catch (error) {
      toast.error(`Preview failed: ${error}`);
    }
  };

  const handleEnhance = async () => {
    if (!selectedModel || selectedOperations.length === 0) {
      toast.error("Please select a model and at least one operation");
      return;
    }

    try {
      const result = await enhanceDataset.mutateAsync({
        projectId,
        config: {
          provider: selectedProvider,
          model: selectedModel,
          operations: selectedOperations,
          temperature,
          batch_size: 10,
        },
      });
      setCurrentJobId(result.job_id);
      toast.success("Enhancement started!");
    } catch (error) {
      toast.error(`Enhancement failed: ${error}`);
    }
  };

  const handleGenerate = async () => {
    if (!selectedModel) {
      toast.error("Please select a model");
      return;
    }

    try {
      const result = await generateData.mutateAsync({
        projectId,
        config: {
          provider: selectedProvider,
          model: selectedModel,
          num_examples: numExamples,
          technique,
          temperature: temperature + 0.1,
        },
      });
      setCurrentJobId(result.job_id);
      toast.success("Generation started!");
    } catch (error) {
      toast.error(`Generation failed: ${error}`);
    }
  };

  const isJobRunning = currentJobId && jobStatus?.status === "running";

  return (
    <div className="space-y-6">
      {/* Provider Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5" />
            AI Provider
          </CardTitle>
          <CardDescription>
            Select an AI provider to power enhancement operations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {providersLoading ? (
              <div className="col-span-3 flex items-center justify-center py-4">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : (
              providers?.map((provider) => (
                <Card
                  key={provider.id}
                  className={`cursor-pointer transition-all ${
                    selectedProvider === provider.id
                      ? "border-primary ring-2 ring-primary"
                      : provider.enabled
                      ? "hover:border-primary/50"
                      : "opacity-50"
                  }`}
                  onClick={() => provider.enabled && setSelectedProvider(provider.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{provider.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {provider.type}
                        </div>
                      </div>
                      {provider.enabled ? (
                        <Badge variant="outline" className="text-green-600 border-green-600">
                          Available
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Not Configured
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label>Model</Label>
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {selectedProvider === "ollama" ? (
                    ollamaModels?.length ? (
                      ollamaModels.map((model) => (
                        <SelectItem key={model} value={model}>
                          {model}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="__no_models__" disabled>
                        No models available
                      </SelectItem>
                    )
                  ) : selectedProvider === "openai" ? (
                    <>
                      <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                      <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                      <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                    </>
                  ) : (
                    <>
                      <SelectItem value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</SelectItem>
                      <SelectItem value="claude-3-5-haiku-20241022">Claude 3.5 Haiku</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="pt-6">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={testProvider.isPending}
              >
                {testProvider.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                <span className="ml-2">Test</span>
              </Button>
            </div>
          </div>

          {providerStatus && (
            <div className="flex items-center gap-2 text-sm">
              {providerStatus.connected ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <span className="text-green-600">Connected</span>
                  <span className="text-muted-foreground">
                    ({providerStatus.available_models.length} models)
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4 text-red-600" />
                  <span className="text-red-600">{providerStatus.error || "Not connected"}</span>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Enhancement/Generation Tabs */}
      <Tabs defaultValue="enhance">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="enhance">
            <Wand2 className="w-4 h-4 mr-2" />
            Enhance Existing
          </TabsTrigger>
          <TabsTrigger value="generate">
            <Sparkles className="w-4 h-4 mr-2" />
            Generate New
          </TabsTrigger>
        </TabsList>

        <TabsContent value="enhance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Enhancement Operations</CardTitle>
              <CardDescription>
                Select operations to apply to your {exampleCount} examples
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {ENHANCEMENT_OPERATIONS.map((op) => {
                  const Icon = op.icon;
                  const isSelected = selectedOperations.includes(op.id);

                  return (
                    <div
                      key={op.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "hover:border-primary/50"
                      }`}
                      onClick={() => toggleOperation(op.id)}
                    >
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-medium text-sm">{op.name}</div>
                        <div className="text-xs text-muted-foreground">{op.description}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2">
                <Label>Temperature: {temperature.toFixed(1)}</Label>
                <Slider
                  value={[temperature]}
                  onValueChange={(values: number[]) => setTemperature(values[0])}
                  min={0}
                  max={1}
                  step={0.1}
                />
                <p className="text-xs text-muted-foreground">
                  Lower = more consistent, Higher = more creative
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handlePreview}
                  disabled={previewEnhancement.isPending || !!isJobRunning}
                >
                  {previewEnhancement.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Eye className="w-4 h-4 mr-2" />
                  )}
                  Preview (3 examples)
                </Button>
                <Button
                  onClick={handleEnhance}
                  disabled={enhanceDataset.isPending || !!isJobRunning}
                >
                  {enhanceDataset.isPending || isJobRunning ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  Enhance All ({exampleCount})
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Preview Results */}
          {previewEnhancement.data?.previews && previewEnhancement.data.previews.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Preview Results</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {previewEnhancement.data.previews.map((preview, idx) => (
                  <div key={idx} className="space-y-2 p-4 rounded-lg bg-muted/50">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">Original</div>
                      <div className="text-sm">{preview.original.slice(0, 200)}...</div>
                    </div>
                    {Object.entries(preview.enhanced).map(([op, text]) => (
                      <div key={op}>
                        <div className="text-xs font-medium text-primary mb-1">
                          {ENHANCEMENT_OPERATIONS.find((o) => o.id === op)?.name || op}
                        </div>
                        <div className="text-sm">{text.slice(0, 200)}...</div>
                      </div>
                    ))}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="generate" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Synthetic Data Generation</CardTitle>
              <CardDescription>
                Generate new training examples using AI
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Generation Technique</Label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {GENERATION_TECHNIQUES.map((tech) => (
                    <div
                      key={tech.id}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        technique === tech.id
                          ? "border-primary bg-primary/5"
                          : "hover:border-primary/50"
                      }`}
                      onClick={() => setTechnique(tech.id)}
                    >
                      <div className="font-medium text-sm">{tech.name}</div>
                      <div className="text-xs text-muted-foreground">{tech.description}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Number of Examples: {numExamples}</Label>
                <Slider
                  value={[numExamples]}
                  onValueChange={(values: number[]) => setNumExamples(values[0])}
                  min={5}
                  max={100}
                  step={5}
                />
              </div>

              <Button
                onClick={handleGenerate}
                disabled={generateData.isPending || !!isJobRunning}
              >
                {generateData.isPending || isJobRunning ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-2" />
                )}
                Generate {numExamples} Examples
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Job Progress */}
      {isJobRunning && jobStatus && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              {jobStatus.type === "enhance" ? "Enhancing" : "Generating"}...
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={jobStatus.progress * 100} />
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Progress: {Math.round(jobStatus.progress * 100)}%</span>
              {jobStatus.result && (
                <span>
                  {jobStatus.type === "enhance"
                    ? `${(jobStatus.result as any).improved || 0} improved`
                    : `${(jobStatus.result as any).generated || 0} generated`}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
