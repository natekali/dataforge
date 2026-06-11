/**
 * Settings — one BYOK provider configuration card.
 *
 * Reads its initial state from the Dexie `providers` row (passed in by the
 * page so live-query loading is handled once) and persists every change via
 * db.providers.put. Text fields are debounced 500ms; the enable switch
 * persists immediately. Connection tests run against the latest local state.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Copy,
  Eye,
  EyeOff,
  Info,
  PlugZap,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ProviderConfig, ProviderId } from '@/engine/types';
import type { ConnectionTestResult, ProviderAdapter } from '@/lib/providers';
import { db } from '@/lib/db';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Spinner, Switch } from '@/components/ui/Controls';

const KEY_PLACEHOLDERS: Partial<Record<ProviderId, string>> = {
  openai: 'sk-…',
  anthropic: 'sk-ant-…',
  gemini: 'AIza…',
  openrouter: 'sk-or-…',
  groq: 'gsk_…',
};

const MODEL_PLACEHOLDERS: Record<ProviderId, string> = {
  openai: 'e.g. gpt-5-mini',
  anthropic: 'e.g. claude-sonnet-4-5',
  gemini: 'e.g. gemini-2.5-flash',
  openrouter: 'e.g. meta-llama/llama-3.3-70b-instruct',
  groq: 'e.g. llama-3.3-70b-versatile',
  ollama: 'e.g. qwen3:8b',
};

const OLLAMA_COMMANDS = [
  {
    label: 'PowerShell',
    command: '[System.Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS","*","User")',
  },
  { label: 'macOS', command: 'launchctl setenv OLLAMA_ORIGINS "*"' },
  { label: 'Linux', command: 'export OLLAMA_ORIGINS="*"' },
];

async function copyCommand(command: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(command);
    toast.success('Command copied to clipboard');
  } catch {
    toast.error('Clipboard unavailable. Copy the command manually.');
  }
}

function CommandRow({ label, command }: { label: string; command: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="tech-label w-18 shrink-0">{label}</span>
      <code
        className="min-w-0 flex-1 truncate rounded-(--radius-control) border border-hairline bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink-dim"
        title={command}
      >
        {command}
      </code>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Copy ${label} command`}
        onClick={() => void copyCommand(command)}
      >
        <Copy />
      </Button>
    </div>
  );
}

function OllamaCorsHelp() {
  return (
    <div className="space-y-2 rounded-(--radius-control) border border-info/30 bg-info/5 p-2.5">
      <p className="flex items-start gap-1.5 text-[13px] text-ink-dim">
        <Info className="mt-px size-4 shrink-0 text-info" />
        <span>
          To let this deployed app reach a local Ollama, allow browser origins, then
          restart Ollama:
        </span>
      </p>
      {OLLAMA_COMMANDS.map((c) => (
        <CommandRow key={c.label} label={c.label} command={c.command} />
      ))}
      <p className="text-[13px] text-ink-faint">
        Safari blocks HTTPS→localhost calls; use Chrome, Edge or Firefox for local
        models.
      </p>
    </div>
  );
}

export function ProviderCard({
  adapter,
  initial,
}: {
  adapter: ProviderAdapter;
  initial: ProviderConfig | undefined;
}) {
  const [cfg, setCfg] = useState<ProviderConfig>(() => ({
    id: adapter.id,
    apiKey: '',
    enabled: false,
    ...initial,
  }));
  const cfgRef = useRef(cfg);
  const timerRef = useRef<number | null>(null);

  const [showKey, setShowKey] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);

  /** Apply a patch locally and persist it (immediately or debounced 500ms). */
  function apply(patch: Partial<ProviderConfig>, immediate: boolean): void {
    const next = { ...cfgRef.current, ...patch };
    cfgRef.current = next;
    setCfg(next);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (immediate) {
      timerRef.current = null;
      void db.providers.put(next);
    } else {
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void db.providers.put(cfgRef.current);
      }, 500);
    }
  }

  // Flush a pending debounced write if the card unmounts mid-typing.
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        void db.providers.put(cfgRef.current);
      }
    },
    [],
  );

  async function runTest(): Promise<void> {
    setTesting(true);
    setResult(null);
    try {
      setResult(await adapter.testConnection(cfgRef.current));
    } finally {
      setTesting(false);
    }
  }

  const isOllama = adapter.id === 'ollama';
  const testDisabled = testing || (adapter.needsKey && cfg.apiKey.trim() === '');

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="text-sm font-semibold text-ink">{adapter.label}</span>
        <Switch
          checked={cfg.enabled}
          onCheckedChange={(enabled) => apply({ enabled }, true)}
          aria-label={`Enable ${adapter.label}`}
        />
      </div>

      {cfg.enabled && (
        <div className="space-y-3 p-3">
          {!isOllama && (
            <div>
              <Label htmlFor={`${adapter.id}-api-key`}>API key</Label>
              <div className="relative">
                <Input
                  id={`${adapter.id}-api-key`}
                  type={showKey ? 'text' : 'password'}
                  value={cfg.apiKey}
                  onChange={(e) => apply({ apiKey: e.target.value }, false)}
                  placeholder={KEY_PLACEHOLDERS[adapter.id]}
                  autoComplete="off"
                  spellCheck={false}
                  className="pr-8 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  aria-label={showKey ? 'Hide API key' : 'Show API key'}
                  className="absolute inset-y-0 right-0 flex items-center px-2 text-ink-faint transition-colors duration-100 hover:text-ink"
                >
                  {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
          )}

          <div>
            <Label htmlFor={`${adapter.id}-model`}>Default model</Label>
            <Input
              id={`${adapter.id}-model`}
              value={cfg.defaultModel ?? ''}
              onChange={(e) => apply({ defaultModel: e.target.value }, false)}
              placeholder={MODEL_PLACEHOLDERS[adapter.id]}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </div>

          <div>
            <button
              type="button"
              onClick={() => setAdvancedOpen((o) => !o)}
              aria-expanded={advancedOpen}
              aria-controls={`${adapter.id}-advanced`}
              className="flex items-center gap-1 text-[13px] text-ink-dim transition-colors duration-100 hover:text-ink"
            >
              <ChevronRight
                className={cn('size-3.5 transition-transform duration-100', advancedOpen && 'rotate-90')}
              />
              Advanced
            </button>
            {advancedOpen && (
              <div id={`${adapter.id}-advanced`} className="mt-2">
                <Label htmlFor={`${adapter.id}-base-url`}>Base URL</Label>
                <Input
                  id={`${adapter.id}-base-url`}
                  value={cfg.baseUrl ?? adapter.defaultBaseUrl}
                  onChange={(e) => apply({ baseUrl: e.target.value }, false)}
                  placeholder={adapter.defaultBaseUrl}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                />
              </div>
            )}
          </div>

          {isOllama && <OllamaCorsHelp />}

          <div className="flex min-w-0 items-center gap-2">
            <Button onClick={() => void runTest()} disabled={testDisabled}>
              {testing ? <Spinner /> : <PlugZap />} Test
            </Button>
            {result &&
              (result.ok ? (
                <Badge tone="ok">
                  <CircleCheck className="size-3 shrink-0" />
                  Connected · {result.latencyMs}ms
                </Badge>
              ) : (
                <Badge tone="danger" className="min-w-0" title={result.message}>
                  <CircleAlert className="size-3 shrink-0" />
                  <span className="truncate normal-case tracking-normal">
                    {result.message}
                  </span>
                </Badge>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
