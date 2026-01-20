"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Sparkles,
  Trash2,
  Copy,
  Shield,
  FileText,
  Wrench,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  useQualityScore,
  useCleanDataset,
  useDeduplicateDataset,
  useValidateForModel,
  useFormatForModel,
} from "@/lib/hooks";

interface QualityPanelProps {
  projectId: string;
  targetModel: string | null;
}

const CLEANING_OPERATIONS = [
  { id: "remove_empty_messages", name: "Remove Empty Messages", description: "Delete messages with no content" },
  { id: "normalize_roles", name: "Normalize Roles", description: "Fix role names (user, assistant, system)" },
  { id: "fix_encoding", name: "Fix Encoding", description: "Repair character encoding issues" },
  { id: "normalize_whitespace", name: "Normalize Whitespace", description: "Clean up extra spaces and newlines" },
  { id: "remove_refusals", name: "Remove Refusals", description: "Filter out refusal responses" },
  { id: "mask_pii", name: "Mask PII", description: "Redact personal information" },
];

export function QualityPanel({ projectId, targetModel }: QualityPanelProps) {
  const [selectedOperations, setSelectedOperations] = useState<string[]>([
    "normalize_whitespace",
    "fix_encoding",
  ]);
  const [dedupeMethod, setDedupeMethod] = useState<"exact" | "fuzzy">("exact");
  const [dedupeThreshold, setDedupeThreshold] = useState(0.95);

  // Hooks
  const { data: qualityScore, isLoading: scoreLoading, refetch: refetchScore } = useQualityScore(projectId);
  const cleanDataset = useCleanDataset();
  const deduplicate = useDeduplicateDataset();
  const validateForModel = useValidateForModel();
  const formatForModel = useFormatForModel();

  const toggleOperation = (opId: string) => {
    setSelectedOperations((prev) =>
      prev.includes(opId) ? prev.filter((id) => id !== opId) : [...prev, opId]
    );
  };

  const handleClean = async (previewOnly: boolean) => {
    if (selectedOperations.length === 0) {
      toast.error("Please select at least one cleaning operation");
      return;
    }

    try {
      const result = await cleanDataset.mutateAsync({
        projectId,
        operations: selectedOperations,
        previewOnly,
      });

      if (previewOnly) {
        toast.info(`Preview: Would modify ${result.examples_modified} examples`);
      } else {
        toast.success(`Cleaned ${result.examples_modified} examples, fixed ${result.issues_fixed} issues`);
        refetchScore();
      }
    } catch (error) {
      toast.error(`Cleaning failed: ${error}`);
    }
  };

  const handleDeduplicate = async () => {
    try {
      const result = await deduplicate.mutateAsync({
        projectId,
        method: dedupeMethod,
        threshold: dedupeThreshold,
      });

      if (result.duplicates_removed > 0) {
        toast.success(`Removed ${result.duplicates_removed} duplicates`);
        refetchScore();
      } else {
        toast.info("No duplicates found");
      }
    } catch (error) {
      toast.error(`Deduplication failed: ${error}`);
    }
  };

  const handleValidate = async () => {
    if (!targetModel) {
      toast.error("Please select a target model first");
      return;
    }

    try {
      const result = await validateForModel.mutateAsync({
        projectId,
        modelId: targetModel,
      });

      if (result.is_valid) {
        toast.success(`Dataset is valid for ${targetModel}!`);
      } else {
        toast.warning(`Found ${result.error_count} errors and ${result.warning_count} warnings`);
      }
    } catch (error) {
      toast.error(`Validation failed: ${error}`);
    }
  };

  const handleAutoFix = async () => {
    if (!targetModel) {
      toast.error("Please select a target model first");
      return;
    }

    try {
      const result = await formatForModel.mutateAsync({
        projectId,
        modelId: targetModel,
      });

      if (result.examples_modified > 0) {
        toast.success(`Auto-fixed ${result.examples_modified} examples`);
        refetchScore();
      } else {
        toast.info("No fixes needed");
      }
    } catch (error) {
      toast.error(`Auto-fix failed: ${error}`);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 0.8) return "text-green-600";
    if (score >= 0.6) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreBadge = (score: number) => {
    if (score >= 0.8) return { label: "Excellent", variant: "default" as const };
    if (score >= 0.6) return { label: "Good", variant: "secondary" as const };
    if (score >= 0.4) return { label: "Fair", variant: "outline" as const };
    return { label: "Poor", variant: "destructive" as const };
  };

  return (
    <div className="space-y-6">
      {/* Quality Score Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Quality Score
              </CardTitle>
              <CardDescription>
                Overall quality assessment of your dataset
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchScore()}
              disabled={scoreLoading}
            >
              {scoreLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span className="ml-2">Refresh</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {scoreLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : qualityScore ? (
            <div className="space-y-6">
              {/* Overall Score */}
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <div className={`text-5xl font-bold ${getScoreColor(qualityScore.overall)}`}>
                    {(qualityScore.overall * 100).toFixed(0)}
                  </div>
                  <Badge {...getScoreBadge(qualityScore.overall)} className="mt-2">
                    {getScoreBadge(qualityScore.overall).label}
                  </Badge>
                </div>
                <div className="flex-1 space-y-3">
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>Completeness</span>
                      <span>{(qualityScore.avg_completeness * 100).toFixed(0)}%</span>
                    </div>
                    <Progress value={qualityScore.avg_completeness * 100} className="h-2" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>Formatting</span>
                      <span>{(qualityScore.avg_formatting * 100).toFixed(0)}%</span>
                    </div>
                    <Progress value={qualityScore.avg_formatting * 100} className="h-2" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>Length Balance</span>
                      <span>{(qualityScore.avg_length_balance * 100).toFixed(0)}%</span>
                    </div>
                    <Progress value={qualityScore.avg_length_balance * 100} className="h-2" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>Content Quality</span>
                      <span>{(qualityScore.avg_content_quality * 100).toFixed(0)}%</span>
                    </div>
                    <Progress value={qualityScore.avg_content_quality * 100} className="h-2" />
                  </div>
                </div>
              </div>

              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t">
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold">{qualityScore.total_examples}</div>
                  <div className="text-xs text-muted-foreground">Total Examples</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold">{qualityScore.examples_with_issues}</div>
                  <div className="text-xs text-muted-foreground">With Issues</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold text-red-600">{qualityScore.critical_issues}</div>
                  <div className="text-xs text-muted-foreground">Critical Issues</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold">
                    {qualityScore.scores_distribution.excellent || 0}
                  </div>
                  <div className="text-xs text-muted-foreground">Excellent</div>
                </div>
              </div>

              {/* Issue Breakdown */}
              {Object.keys(qualityScore.issue_counts).length > 0 && (
                <div className="pt-4 border-t">
                  <div className="text-sm font-medium mb-3">Issues Found</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(qualityScore.issue_counts).map(([type, count]) => (
                      <Badge key={type} variant="outline">
                        {type.replace(/_/g, " ")}: {count}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No quality data available</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cleaning Operations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            Clean Dataset
          </CardTitle>
          <CardDescription>
            Apply automatic cleaning operations to fix common issues
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {CLEANING_OPERATIONS.map((op) => {
              const isSelected = selectedOperations.includes(op.id);
              return (
                <div
                  key={op.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    isSelected ? "border-primary bg-primary/5" : "hover:border-primary/50"
                  }`}
                  onClick={() => toggleOperation(op.id)}
                >
                  <div
                    className={`w-5 h-5 rounded border flex items-center justify-center ${
                      isSelected ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground"
                    }`}
                  >
                    {isSelected && <CheckCircle2 className="w-3 h-3" />}
                  </div>
                  <div>
                    <div className="font-medium text-sm">{op.name}</div>
                    <div className="text-xs text-muted-foreground">{op.description}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => handleClean(true)}
              disabled={cleanDataset.isPending || selectedOperations.length === 0}
            >
              {cleanDataset.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <FileText className="w-4 h-4 mr-2" />
              )}
              Preview
            </Button>
            <Button
              onClick={() => handleClean(false)}
              disabled={cleanDataset.isPending || selectedOperations.length === 0}
            >
              {cleanDataset.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              Apply Cleaning
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Deduplication */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Copy className="w-5 h-5" />
            Remove Duplicates
          </CardTitle>
          <CardDescription>
            Find and remove duplicate examples from your dataset
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Detection Method</Label>
              <Select value={dedupeMethod} onValueChange={(v: "exact" | "fuzzy") => setDedupeMethod(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exact">Exact Match (Fast)</SelectItem>
                  <SelectItem value="fuzzy">Fuzzy Match (Thorough)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {dedupeMethod === "fuzzy" && (
              <div className="space-y-2">
                <Label>Similarity Threshold: {(dedupeThreshold * 100).toFixed(0)}%</Label>
                <Slider
                  value={[dedupeThreshold]}
                  onValueChange={(values: number[]) => setDedupeThreshold(values[0])}
                  min={0.7}
                  max={0.99}
                  step={0.01}
                />
              </div>
            )}
          </div>

          <Button
            onClick={handleDeduplicate}
            disabled={deduplicate.isPending}
          >
            {deduplicate.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4 mr-2" />
            )}
            Find & Remove Duplicates
          </Button>
        </CardContent>
      </Card>

      {/* Model Validation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Model Compatibility
          </CardTitle>
          <CardDescription>
            Validate and fix dataset for your target model
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {targetModel ? (
            <>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                <Badge>{targetModel}</Badge>
                <span className="text-sm text-muted-foreground">Selected target model</span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handleValidate}
                  disabled={validateForModel.isPending}
                >
                  {validateForModel.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                  )}
                  Validate
                </Button>
                <Button
                  onClick={handleAutoFix}
                  disabled={formatForModel.isPending}
                >
                  {formatForModel.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Wrench className="w-4 h-4 mr-2" />
                  )}
                  Auto-Fix Issues
                </Button>
              </div>

              {/* Validation Results */}
              {validateForModel.data && (
                <div className="p-4 rounded-lg border space-y-3">
                  <div className="flex items-center gap-2">
                    {validateForModel.data.is_valid ? (
                      <>
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                        <span className="font-medium text-green-600">Dataset is valid!</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-5 h-5 text-yellow-600" />
                        <span className="font-medium text-yellow-600">Issues found</span>
                      </>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {validateForModel.data.valid_examples} of {validateForModel.data.total_examples} examples valid
                  </div>
                  {validateForModel.data.recommendations.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-sm font-medium">Recommendations:</div>
                      <ul className="text-sm text-muted-foreground list-disc list-inside">
                        {validateForModel.data.recommendations.map((rec, i) => (
                          <li key={i}>{rec}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <AlertTriangle className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Please select a target model to validate compatibility</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
