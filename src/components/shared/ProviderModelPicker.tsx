/**
 * Shared provider + model selector used by Generate, Quality (judge),
 * Import (document Q&A) and anywhere else that talks to an LLM.
 * Reads configured providers from Dexie; fetches live model lists.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Settings2 } from 'lucide-react';
import type { ProviderConfig, ProviderId } from '@/engine/types';
import { getAdapter } from '@/lib/providers';
import { useProviderConfigs } from '@/lib/hooks';
import { Label, Input } from '@/components/ui/Input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';

export interface ProviderSelection {
  providerId: ProviderId;
  model: string;
  config: ProviderConfig;
}

export function ProviderModelPicker({
  value,
  onChange,
}: {
  value: ProviderSelection | null;
  onChange: (v: ProviderSelection | null) => void;
}) {
  const configs = useProviderConfigs();
  const enabled = (configs ?? []).filter((c) => c.enabled && (c.apiKey || c.id === 'ollama'));

  const activeConfig = value?.config ?? null;

  const models = useQuery({
    queryKey: ['provider-models', activeConfig?.id, activeConfig?.baseUrl],
    queryFn: () => getAdapter(activeConfig!.id).listModels(activeConfig!),
    enabled: !!activeConfig,
    staleTime: 5 * 60_000,
    retry: 0,
  });

  if (configs && enabled.length === 0) {
    return (
      <div className="rounded-(--radius-control) border border-dashed border-hairline px-3 py-2.5 text-[13px] text-ink-dim">
        No AI provider configured.{' '}
        <Link to="/settings" className="inline-flex items-center gap-1 text-accent hover:underline">
          <Settings2 className="size-3.5" /> Add one in Settings
        </Link>
        . Keys stay in your browser.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <Label>Provider</Label>
        <Select
          value={value?.providerId ?? ''}
          onValueChange={(id) => {
            const config = enabled.find((c) => c.id === id);
            if (!config) return;
            onChange({
              providerId: config.id,
              model: config.defaultModel ?? '',
              config,
            });
          }}
        >
          <SelectTrigger aria-label="AI provider">
            <SelectValue placeholder="Select provider…" />
          </SelectTrigger>
          <SelectContent>
            {enabled.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {getAdapter(c.id).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Model</Label>
        {models.data && models.data.length > 0 ? (
          <Select
            value={value?.model ?? ''}
            onValueChange={(model) => value && onChange({ ...value, model })}
            disabled={!value}
          >
            <SelectTrigger aria-label="Model">
              <SelectValue placeholder={models.isLoading ? 'Loading models…' : 'Select model…'} />
            </SelectTrigger>
            <SelectContent>
              {models.data.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            placeholder={
              !value
                ? 'Pick a provider first'
                : models.isLoading
                  ? 'Loading models…'
                  : 'Model id (list unavailable)'
            }
            value={value?.model ?? ''}
            disabled={!value}
            onChange={(e) => value && onChange({ ...value, model: e.target.value })}
            aria-label="Model id"
          />
        )}
      </div>
    </div>
  );
}
