/**
 * Single message editor card — the building block reused by every dataset-type
 * editor. Role chip select, move/weight/delete controls, auto-growing content,
 * assistant extras (reasoning trace, tool calls) and tool-role call-id linking.
 */
import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Plus, TriangleAlert, X } from 'lucide-react';
import type { Message, Role, ToolCall } from '@/engine/types';
import { useTextTokenCount } from '@/lib/tokensLazy';
import { cn, fmtNum } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { Switch } from '@/components/ui/Controls';
import { Tip } from '@/components/ui/Tooltip';
import { ToolCallEditor, autoRows, generateCallId } from './ToolCallEditor';

const ALL_ROLES: Role[] = ['system', 'developer', 'user', 'assistant', 'tool'];

/** Role → chip tint. system/developer=info, user=ink, assistant=accent, tool=warn. */
const ROLE_CHIP: Record<Role, string> = {
  system: 'border-info/40 bg-info/10 text-info',
  developer: 'border-info/40 bg-info/10 text-info',
  user: 'border-hairline-strong bg-surface-3 text-ink',
  assistant: 'border-ember-600/50 bg-ember-500/10 text-ember-400',
  tool: 'border-warn/40 bg-warn/10 text-warn',
};

export interface MessageCardProps {
  message: Message;
  onChange: (message: Message) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Show the loss-weight toggle on assistant turns (SFT conversations only). */
  showWeight?: boolean;
  /** Restrict the role select (chosen/rejected/completion lists are assistant-only). */
  allowedRoles?: Role[];
  /** Tool-call ids emitted by PRIOR assistant turns — validates `toolCallId`. */
  priorToolCallIds?: string[];
}

export function MessageCard({
  message,
  onChange,
  onDelete,
  onMove,
  canMoveUp,
  canMoveDown,
  showWeight = false,
  allowedRoles,
  priorToolCallIds,
}: MessageCardProps) {
  const [reasoningOpen, setReasoningOpen] = useState(true);
  const reasoningTokens = useTextTokenCount(message.reasoning ?? null);
  const isAssistant = message.role === 'assistant';
  const roles = allowedRoles ?? ALL_ROLES;

  const setRole = (role: Role) => {
    const next: Message = { ...message, role };
    if (role !== 'assistant') {
      delete next.reasoning;
      delete next.toolCalls;
      delete next.weight;
    }
    if (role !== 'tool') delete next.toolCallId;
    onChange(next);
  };

  const setToolCalls = (toolCalls: ToolCall[]) => {
    const next: Message = { ...message };
    if (toolCalls.length === 0) delete next.toolCalls;
    else next.toolCalls = toolCalls;
    onChange(next);
  };

  const removeReasoning = () => {
    const next: Message = { ...message };
    delete next.reasoning;
    onChange(next);
  };

  const toolCallIdUnmatched =
    message.role === 'tool' && !(priorToolCallIds ?? []).includes(message.toolCallId ?? '');

  return (
    <div className="rounded-(--radius-panel) border border-hairline bg-surface-2">
      <div className="flex items-center gap-1 border-b border-hairline px-2 py-1.5">
        <Select value={message.role} onValueChange={(v) => setRole(v as Role)}>
          <SelectTrigger
            aria-label="Message role"
            className={cn(
              'h-5 w-auto gap-1 px-1.5 font-mono text-[11px] font-medium uppercase tracking-wide',
              ROLE_CHIP[message.role],
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roles.map((role) => (
              <SelectItem key={role} value={role}>
                {role}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-0.5">
          {showWeight && isAssistant && (
            <Tip label="Include in training loss">
              <Switch
                aria-label="Include in training loss"
                checked={message.weight !== 0}
                onCheckedChange={(checked) =>
                  onChange({ ...message, weight: checked ? 1 : 0 })
                }
                className="mr-1"
              />
            </Tip>
          )}
          <Tip label="Move up">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={!canMoveUp}
              onClick={() => onMove(-1)}
              aria-label="Move message up"
            >
              <ArrowUp />
            </Button>
          </Tip>
          <Tip label="Move down">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={!canMoveDown}
              onClick={() => onMove(1)}
              aria-label="Move message down"
            >
              <ArrowDown />
            </Button>
          </Tip>
          <Tip label="Delete message">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:text-danger"
              onClick={onDelete}
              aria-label="Delete message"
            >
              <X />
            </Button>
          </Tip>
        </div>
      </div>

      <div className="flex flex-col gap-2 p-2">
        <Textarea
          value={message.content}
          onChange={(e) => onChange({ ...message, content: e.target.value })}
          rows={autoRows(message.content)}
          placeholder={`${message.role} content…`}
          aria-label={`${message.role} message content`}
          className="min-h-0 py-1.5"
        />

        {isAssistant &&
          (message.reasoning !== undefined ? (
            <div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setReasoningOpen((open) => !open)}
                  aria-expanded={reasoningOpen}
                  className="flex items-center gap-1 rounded-(--radius-control) text-ink-dim transition-colors duration-100 hover:text-ink focus-visible:outline focus-visible:outline-accent"
                >
                  <ChevronRight
                    className={cn(
                      'size-3.5 transition-transform duration-150',
                      reasoningOpen && 'rotate-90',
                    )}
                  />
                  <span className="tech-label">Reasoning trace</span>
                </button>
                <span className="font-mono text-[11px] tabular-nums text-ink-faint">
                  {reasoningTokens == null ? '·' : fmtNum(reasoningTokens)} tok
                </span>
                <Tip label="Remove reasoning trace">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto h-6 w-6 hover:text-danger"
                    onClick={removeReasoning}
                    aria-label="Remove reasoning trace"
                  >
                    <X />
                  </Button>
                </Tip>
              </div>
              {reasoningOpen && (
                <Textarea
                  value={message.reasoning}
                  onChange={(e) => onChange({ ...message, reasoning: e.target.value })}
                  rows={autoRows(message.reasoning)}
                  placeholder="Model thinking…"
                  aria-label="Reasoning trace"
                  className="mt-1.5 min-h-0 border-l-2 border-l-ember-600/60 py-1.5"
                />
              )}
            </div>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              className="self-start text-ink-faint hover:text-ink"
              onClick={() => onChange({ ...message, reasoning: '' })}
            >
              <Plus /> Add reasoning trace
            </Button>
          ))}

        {isAssistant && (
          <>
            {(message.toolCalls ?? []).map((toolCall, i) => (
              <ToolCallEditor
                key={toolCall.id}
                toolCall={toolCall}
                onChange={(next) =>
                  setToolCalls(
                    (message.toolCalls ?? []).map((c, j) => (j === i ? next : c)),
                  )
                }
                onRemove={() =>
                  setToolCalls((message.toolCalls ?? []).filter((_, j) => j !== i))
                }
              />
            ))}
            <Button
              variant="ghost"
              size="xs"
              className="self-start text-ink-faint hover:text-ink"
              onClick={() =>
                setToolCalls([
                  ...(message.toolCalls ?? []),
                  { id: generateCallId(), name: '', arguments: '{}' },
                ])
              }
            >
              <Plus /> Add tool call
            </Button>
          </>
        )}

        {message.role === 'tool' && (
          <div>
            <div className="flex items-center gap-2">
              <span className="tech-label shrink-0">Tool call id</span>
              <Input
                value={message.toolCallId ?? ''}
                onChange={(e) => onChange({ ...message, toolCallId: e.target.value })}
                placeholder="call_…"
                aria-label="Tool call id"
                className={cn(
                  'h-7 flex-1 font-mono text-xs',
                  toolCallIdUnmatched && 'border-warn/60 text-warn',
                )}
              />
            </div>
            {toolCallIdUnmatched && (
              <p className="mt-1 flex items-center gap-1 text-xs text-warn">
                <TriangleAlert className="size-3.5 shrink-0" />
                No matching tool call in a prior assistant turn
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
