/**
 * Tool-call editor card: function name, JSON arguments with live validity
 * feedback, and a regenerable provider-style call id. Rendered by MessageCard
 * for assistant turns.
 */
import { useMemo } from 'react';
import { Check, RefreshCw, TriangleAlert, X } from 'lucide-react';
import type { ToolCall } from '@/engine/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Tip } from '@/components/ui/Tooltip';

/** Provider-style call id, e.g. "call_9f2c41ab03de". */
export function generateCallId(): string {
  return `call_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * Estimate textarea rows from content so editor fields grow with their text
 * (manual resize via the native handle still wins once used).
 */
export function autoRows(text: string, min = 2, max = 18): number {
  const lines = text
    .split('\n')
    .reduce((acc, line) => acc + Math.max(1, Math.ceil(line.length / 64)), 0);
  return Math.min(max, Math.max(min, lines));
}

export interface ToolCallEditorProps {
  toolCall: ToolCall;
  onChange: (toolCall: ToolCall) => void;
  onRemove: () => void;
}

export function ToolCallEditor({ toolCall, onChange, onRemove }: ToolCallEditorProps) {
  const validJson = useMemo(() => {
    try {
      JSON.parse(toolCall.arguments);
      return true;
    } catch {
      return false;
    }
  }, [toolCall.arguments]);

  return (
    <div className="rounded-(--radius-control) border border-hairline bg-surface-3/50 p-2">
      <div className="flex items-center gap-1.5">
        <span className="tech-label shrink-0">Tool call</span>
        <span className="min-w-0 truncate font-mono text-[11px] text-ink-faint">
          {toolCall.id}
        </span>
        <Tip label="Regenerate call id">
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-6 w-6"
            aria-label="Regenerate call id"
            onClick={() => onChange({ ...toolCall, id: generateCallId() })}
          >
            <RefreshCw />
          </Button>
        </Tip>
        <Tip label="Remove tool call">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 hover:text-danger"
            aria-label="Remove tool call"
            onClick={onRemove}
          >
            <X />
          </Button>
        </Tip>
      </div>

      <Input
        value={toolCall.name}
        onChange={(e) => onChange({ ...toolCall, name: e.target.value })}
        placeholder="function_name"
        aria-label="Tool function name"
        className="mt-1.5 h-7 font-mono text-xs"
      />

      <Textarea
        value={toolCall.arguments}
        onChange={(e) => onChange({ ...toolCall, arguments: e.target.value })}
        rows={autoRows(toolCall.arguments, 2, 10)}
        placeholder='{"location": "Berlin"}'
        aria-label="Tool call arguments (JSON)"
        className={cn(
          'mt-1.5 min-h-0 py-1.5 font-mono text-xs',
          !validJson && 'border-danger/60',
        )}
      />

      <p
        className={cn(
          'mt-1 flex items-center gap-1 font-mono text-[11px]',
          validJson ? 'text-ok' : 'text-danger',
        )}
      >
        {validJson ? (
          <Check className="size-3.5 shrink-0" />
        ) : (
          <TriangleAlert className="size-3.5 shrink-0" />
        )}
        {validJson ? 'valid JSON' : 'invalid JSON'}
      </p>
    </div>
  );
}
