"use client";

import { useState } from "react";
import {
  Shuffle,
  PieChart,
  Info,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { useSplitCounts, useSplitInfo, useAutoSplit } from "@/lib/hooks";

interface SplitManagerProps {
  projectId: string | null;
  onSplitComplete?: () => void;
}

const SPLIT_PRESETS = {
  standard: { train: 0.8, validation: 0.1, test: 0.1, label: "Standard (80/10/10)" },
  small: { train: 0.7, validation: 0.15, test: 0.15, label: "Small Dataset (70/15/15)" },
  large: { train: 0.98, validation: 0.01, test: 0.01, label: "Large Dataset (98/1/1)" },
  no_test: { train: 0.9, validation: 0.1, test: 0, label: "No Test Set (90/10/0)" },
};

export function SplitManager({ projectId, onSplitComplete }: SplitManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<keyof typeof SPLIT_PRESETS>("standard");
  const [trainRatio, setTrainRatio] = useState(0.8);
  const [validationRatio, setValidationRatio] = useState(0.1);
  const [testRatio, setTestRatio] = useState(0.1);

  const { data: splitCounts, isLoading: countsLoading } = useSplitCounts(projectId);
  const { data: splitInfo, isLoading: infoLoading } = useSplitInfo(projectId);
  const autoSplit = useAutoSplit();

  const handlePresetChange = (preset: keyof typeof SPLIT_PRESETS) => {
    setSelectedPreset(preset);
    const { train, validation, test } = SPLIT_PRESETS[preset];
    setTrainRatio(train);
    setValidationRatio(validation);
    setTestRatio(test);
  };

  const handleAutoSplit = async () => {
    if (!projectId) return;

    try {
      const result = await autoSplit.mutateAsync({
        projectId,
        config: {
          train_ratio: trainRatio,
          validation_ratio: validationRatio,
          test_ratio: testRatio,
        },
      });

      if (result.success) {
        toast.success(result.message);
        setIsOpen(false);
        onSplitComplete?.();
      }
    } catch (error) {
      toast.error(`Split failed: ${error}`);
    }
  };

  const isLoading = countsLoading || infoLoading;
  const total = splitCounts?.total || 0;

  // Calculate split bar percentages
  const trainPct = total > 0 ? ((splitCounts?.train || 0) / total) * 100 : 0;
  const valPct = total > 0 ? ((splitCounts?.validation || 0) / total) * 100 : 0;
  const testPct = total > 0 ? ((splitCounts?.test || 0) / total) * 100 : 0;

  return (
    <Card variant="elevated">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <PieChart className="w-4 h-4" />
            Dataset Splits
          </CardTitle>
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={!projectId || total === 0}>
                <Shuffle className="w-3 h-3 mr-1.5" />
                Auto-Split
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Auto-Split Dataset</DialogTitle>
                <DialogDescription>
                  Automatically distribute your examples into train, validation, and test sets.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6 py-4">
                {/* Preset selector */}
                <div>
                  <label className="text-sm font-medium mb-2 block">Split Preset</label>
                  <Select
                    value={selectedPreset}
                    onValueChange={(v) => handlePresetChange(v as keyof typeof SPLIT_PRESETS)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(SPLIT_PRESETS).map(([key, { label }]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Custom ratios */}
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium">Train</label>
                      <span className="text-sm text-muted-foreground">
                        {Math.round(trainRatio * 100)}%
                      </span>
                    </div>
                    <Slider
                      value={[trainRatio * 100]}
                      onValueChange={([v]) => {
                        const newTrain = v / 100;
                        setTrainRatio(newTrain);
                        // Redistribute remaining to validation and test
                        const remaining = 1 - newTrain;
                        setValidationRatio(remaining / 2);
                        setTestRatio(remaining / 2);
                      }}
                      max={100}
                      min={50}
                      step={1}
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium">Validation</label>
                      <span className="text-sm text-muted-foreground">
                        {Math.round(validationRatio * 100)}%
                      </span>
                    </div>
                    <Slider
                      value={[validationRatio * 100]}
                      onValueChange={([v]) => {
                        const newVal = v / 100;
                        const maxVal = 1 - trainRatio;
                        setValidationRatio(Math.min(newVal, maxVal));
                        setTestRatio(Math.max(0, maxVal - Math.min(newVal, maxVal)));
                      }}
                      max={Math.round((1 - trainRatio) * 100)}
                      min={0}
                      step={1}
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium">Test</label>
                      <span className="text-sm text-muted-foreground">
                        {Math.round(testRatio * 100)}%
                      </span>
                    </div>
                    <Slider
                      value={[testRatio * 100]}
                      onValueChange={([v]) => {
                        const newTest = v / 100;
                        const maxTest = 1 - trainRatio - validationRatio;
                        setTestRatio(Math.min(newTest, maxTest));
                      }}
                      max={Math.round((1 - trainRatio - validationRatio) * 100)}
                      min={0}
                      step={1}
                    />
                  </div>
                </div>

                {/* Preview */}
                <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                  <p className="text-xs text-muted-foreground mb-2">Preview with {total} examples:</p>
                  <div className="flex gap-4 text-sm">
                    <div>
                      <span className="font-medium text-blue-500">Train:</span>{" "}
                      {Math.round(total * trainRatio)}
                    </div>
                    <div>
                      <span className="font-medium text-green-500">Val:</span>{" "}
                      {Math.round(total * validationRatio)}
                    </div>
                    <div>
                      <span className="font-medium text-orange-500">Test:</span>{" "}
                      {Math.round(total * testRatio)}
                    </div>
                  </div>
                </div>

                {/* Info box */}
                <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    Best practices: Use 80/10/10 for most datasets. For small datasets (&lt;1000),
                    use 70/15/15. The split is randomized but reproducible.
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="glow"
                  onClick={handleAutoSplit}
                  disabled={autoSplit.isPending}
                >
                  {autoSplit.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Splitting...
                    </>
                  ) : (
                    <>
                      <Shuffle className="w-4 h-4 mr-2" />
                      Apply Split
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No examples yet. Import some data first.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Split visualization bar */}
            <div className="h-3 rounded-full overflow-hidden flex bg-muted">
              {trainPct > 0 && (
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{ width: `${trainPct}%` }}
                  title={`Train: ${splitCounts?.train} (${trainPct.toFixed(1)}%)`}
                />
              )}
              {valPct > 0 && (
                <div
                  className="h-full bg-green-500 transition-all"
                  style={{ width: `${valPct}%` }}
                  title={`Validation: ${splitCounts?.validation} (${valPct.toFixed(1)}%)`}
                />
              )}
              {testPct > 0 && (
                <div
                  className="h-full bg-orange-500 transition-all"
                  style={{ width: `${testPct}%` }}
                  title={`Test: ${splitCounts?.test} (${testPct.toFixed(1)}%)`}
                />
              )}
            </div>

            {/* Split counts */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <p className="text-lg font-semibold text-blue-500">{splitCounts?.train || 0}</p>
                <p className="text-xs text-muted-foreground">Train</p>
              </div>
              <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/20">
                <p className="text-lg font-semibold text-green-500">{splitCounts?.validation || 0}</p>
                <p className="text-xs text-muted-foreground">Validation</p>
              </div>
              <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20">
                <p className="text-lg font-semibold text-orange-500">{splitCounts?.test || 0}</p>
                <p className="text-xs text-muted-foreground">Test</p>
              </div>
            </div>

            {/* Recommendation */}
            {splitInfo?.recommended_action && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-muted-foreground">
                  {splitInfo.recommended_action}
                </p>
              </div>
            )}

            {/* Status indicator */}
            {splitInfo?.is_split && (
              <div className="flex items-center gap-1.5 text-xs text-green-500">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Dataset is properly split for training
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Split badge component for use in example lists
export function SplitBadge({ split }: { split: string }) {
  const colors = {
    train: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    validation: "bg-green-500/10 text-green-500 border-green-500/20",
    test: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  };

  const color = colors[split as keyof typeof colors] || colors.train;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${color}`}
    >
      {split}
    </span>
  );
}
