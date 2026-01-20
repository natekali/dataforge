"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Download,
  FileJson,
  Zap,
  Rocket,
  Box,
  Flame,
  Check,
  ArrowLeft,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useExportDataset } from "@/lib/hooks";

interface ExportPanelProps {
  dataset: any[];
  targetModel: string | null;
  projectId: string;
  onBack: () => void;
}

const EXPORT_FORMATS = [
  {
    id: "unsloth",
    name: "Unsloth",
    icon: Zap,
    description: "2-5x faster training, 80% less VRAM",
    recommended: true,
    features: ["QLoRA optimized", "Free Colab support", "Best for single GPU"],
  },
  {
    id: "axolotl",
    name: "Axolotl",
    icon: Rocket,
    description: "Production-ready, multi-GPU support",
    features: ["DeepSpeed/FSDP", "LoRA/QLoRA/Full", "Best for serious training"],
  },
  {
    id: "llamafactory",
    name: "LLaMA-Factory",
    icon: Box,
    description: "Web UI included, no-code option",
    features: ["LlamaBoard UI", "100+ models", "Easy experimentation"],
  },
  {
    id: "torchtune",
    name: "Torchtune",
    icon: Flame,
    description: "Pure PyTorch, maximum flexibility",
    features: ["Native PyTorch", "Research-oriented", "Full control"],
  },
  {
    id: "jsonl",
    name: "Raw JSONL",
    icon: FileJson,
    description: "Plain JSONL format",
    features: ["Universal format", "No config", "Custom workflows"],
  },
];

export function ExportPanel({ dataset, targetModel, projectId, onBack }: ExportPanelProps) {
  const [selectedFormat, setSelectedFormat] = useState<string>("unsloth");
  const exportDataset = useExportDataset();

  const handleExport = async () => {
    try {
      await exportDataset.mutateAsync({
        projectId,
        config: {
          format: selectedFormat,
          target_model: targetModel || undefined,
        },
      });
      toast.success("Dataset exported successfully!");
    } catch (error) {
      toast.error(`Export failed: ${error}`);
    }
  };

  const selectedFormatData = EXPORT_FORMATS.find((f) => f.id === selectedFormat);

  return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={onBack} className="mb-4">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Edit
      </Button>

      {/* Format Selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {EXPORT_FORMATS.map((format) => {
          const Icon = format.icon;
          const isSelected = selectedFormat === format.id;

          return (
            <Card
              key={format.id}
              className={`cursor-pointer transition-all ${
                isSelected
                  ? "border-primary ring-2 ring-primary ring-offset-2"
                  : "hover:border-primary/50"
              }`}
              onClick={() => setSelectedFormat(format.id)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{format.name}</CardTitle>
                      {format.recommended && (
                        <span className="text-xs text-primary font-medium">
                          Recommended
                        </span>
                      )}
                    </div>
                  </div>
                  {isSelected && (
                    <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                      <Check className="w-4 h-4 text-primary-foreground" />
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="mb-3">{format.description}</CardDescription>
                <ul className="space-y-1">
                  {format.features.map((feature, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex items-center gap-1">
                      <span className="w-1 h-1 rounded-full bg-muted-foreground" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Export Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Export Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div>
              <div className="text-sm text-muted-foreground">Format</div>
              <div className="font-medium">{selectedFormatData?.name}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Target Model</div>
              <div className="font-medium">{targetModel || "Not specified"}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Examples</div>
              <div className="font-medium">{dataset.length}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Includes Config</div>
              <div className="font-medium">
                {selectedFormat !== "jsonl" ? "Yes" : "No"}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Ready to export {dataset.length} examples
            </div>
            <Button onClick={handleExport} size="lg" disabled={exportDataset.isPending}>
              {exportDataset.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Export Dataset
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Quick Start Guide */}
      {selectedFormat !== "jsonl" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick Start Guide</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 text-sm">
              {selectedFormat === "unsloth" && (
                <>
                  <div className="p-3 rounded-lg bg-muted font-mono text-xs">
                    pip install unsloth
                  </div>
                  <div className="p-3 rounded-lg bg-muted font-mono text-xs">
                    python train.py
                  </div>
                  <a
                    href="https://github.com/unslothai/unsloth"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-primary hover:underline"
                  >
                    View Unsloth documentation
                    <ExternalLink className="w-3 h-3 ml-1" />
                  </a>
                </>
              )}
              {selectedFormat === "axolotl" && (
                <>
                  <div className="p-3 rounded-lg bg-muted font-mono text-xs">
                    pip install axolotl
                  </div>
                  <div className="p-3 rounded-lg bg-muted font-mono text-xs">
                    accelerate launch -m axolotl.cli.train config.yaml
                  </div>
                  <a
                    href="https://github.com/OpenAccess-AI-Collective/axolotl"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-primary hover:underline"
                  >
                    View Axolotl documentation
                    <ExternalLink className="w-3 h-3 ml-1" />
                  </a>
                </>
              )}
              {selectedFormat === "llamafactory" && (
                <>
                  <div className="p-3 rounded-lg bg-muted font-mono text-xs">
                    pip install llamafactory
                  </div>
                  <div className="p-3 rounded-lg bg-muted font-mono text-xs">
                    llamafactory-cli train --config config.yaml
                  </div>
                  <a
                    href="https://github.com/hiyouga/LLaMA-Factory"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-primary hover:underline"
                  >
                    View LLaMA-Factory documentation
                    <ExternalLink className="w-3 h-3 ml-1" />
                  </a>
                </>
              )}
              {selectedFormat === "torchtune" && (
                <>
                  <div className="p-3 rounded-lg bg-muted font-mono text-xs">
                    pip install torchtune
                  </div>
                  <div className="p-3 rounded-lg bg-muted font-mono text-xs">
                    tune run lora_finetune_single_device --config config.yaml
                  </div>
                  <a
                    href="https://github.com/pytorch/torchtune"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-primary hover:underline"
                  >
                    View Torchtune documentation
                    <ExternalLink className="w-3 h-3 ml-1" />
                  </a>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
