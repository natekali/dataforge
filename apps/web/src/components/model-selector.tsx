"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useModelFamilies } from "@/lib/hooks";
import { Loader2 } from "lucide-react";

interface ModelSelectorProps {
  value: string | null;
  onChange: (value: string) => void;
}

// Fallback data for when API is unavailable
const FALLBACK_FAMILIES = [
  {
    id: "llama",
    name: "Meta Llama",
    provider: "Meta",
    models: [
      { id: "llama-3.3-70b", name: "Llama 3.3 70B", recommended_for: ["general"] },
      { id: "llama-3.1-8b", name: "Llama 3.1 8B", recommended_for: [] },
    ],
  },
  {
    id: "qwen",
    name: "Alibaba Qwen",
    provider: "Alibaba",
    models: [
      { id: "qwen3-8b", name: "Qwen 3 8B", recommended_for: ["general"] },
      { id: "qwen2.5-coder-7b", name: "Qwen 2.5 Coder 7B", recommended_for: ["code"] },
    ],
  },
  {
    id: "gemma",
    name: "Google Gemma",
    provider: "Google",
    models: [
      { id: "gemma-3-12b", name: "Gemma 3 12B", recommended_for: ["general"] },
    ],
  },
  {
    id: "mistral",
    name: "Mistral AI",
    provider: "Mistral",
    models: [
      { id: "mistral-nemo-12b", name: "Mistral Nemo 12B", recommended_for: ["general"] },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    provider: "DeepSeek",
    models: [
      { id: "deepseek-r1-8b", name: "DeepSeek R1 8B", recommended_for: ["reasoning"] },
    ],
  },
];

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const { data: families, isLoading, error } = useModelFamilies();

  // Use API data or fallback
  const modelFamilies = families || FALLBACK_FAMILIES;

  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className="w-[280px]">
        {isLoading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading models...</span>
          </div>
        ) : (
          <SelectValue placeholder="Select target model" />
        )}
      </SelectTrigger>
      <SelectContent>
        {modelFamilies.map((family) => (
          <SelectGroup key={family.id}>
            <SelectLabel>{family.name}</SelectLabel>
            {family.models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.name}
                {model.recommended_for?.includes("general") && (
                  <span className="ml-2 text-xs text-primary">Recommended</span>
                )}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
        {error && (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            Using cached models (API unavailable)
          </div>
        )}
      </SelectContent>
    </Select>
  );
}
