/**
 * SFT conversation editor plus the shared MessageList used by every
 * dataset-type editor: ordered MessageCards with add/move/delete wiring and
 * tool-call id threading across prior turns.
 */
import { Plus } from 'lucide-react';
import type { Message, Role } from '@/engine/types';
import { Button } from '@/components/ui/Button';
import { MessageCard } from './MessageCard';

/** The role a freshly added message should take, given the turns so far. */
export function nextNaturalRole(messages: Message[]): Role {
  const last = messages[messages.length - 1];
  if (!last) return 'user';
  if (last.role === 'user') return 'assistant';
  if (last.role === 'assistant') return last.toolCalls?.length ? 'tool' : 'user';
  if (last.role === 'tool') return 'assistant';
  return 'user'; // system / developer
}

/** All tool-call ids emitted by assistant turns in a message list. */
export function collectToolCallIds(messages: Message[]): string[] {
  const ids: string[] = [];
  for (const m of messages) {
    for (const call of m.toolCalls ?? []) ids.push(call.id);
  }
  return ids;
}

/** First emitted tool-call id that has no matching tool message yet. */
function firstUnansweredCallId(messages: Message[]): string | undefined {
  const answered = new Set<string>();
  for (const m of messages) {
    if (m.role === 'tool' && m.toolCallId) answered.add(m.toolCallId);
  }
  return collectToolCallIds(messages).find((id) => !answered.has(id));
}

export interface MessageListProps {
  messages: Message[];
  onChange: (messages: Message[]) => void;
  /** Show the loss-weight toggle on assistant turns (SFT conversations only). */
  showWeight?: boolean;
  /** Restrict the role select (response lists are assistant-only). */
  allowedRoles?: Role[];
  /** Force the role of added messages; defaults to the next natural turn. */
  addRole?: Role;
  addLabel?: string;
  /** Tool-call ids emitted by messages that precede this list (prompt context). */
  contextToolCallIds?: string[];
  /** Shown when the list is empty. */
  emptyText?: string;
}

export function MessageList({
  messages,
  onChange,
  showWeight = false,
  allowedRoles,
  addRole,
  addLabel = 'Add message',
  contextToolCallIds = [],
  emptyText,
}: MessageListProps) {
  const replaceAt = (index: number, message: Message) =>
    onChange(messages.map((m, i) => (i === index ? message : m)));

  const deleteAt = (index: number) => onChange(messages.filter((_, i) => i !== index));

  const moveAt = (index: number, direction: -1 | 1) => {
    const next = [...messages];
    const [moved] = next.splice(index, 1);
    next.splice(index + direction, 0, moved);
    onChange(next);
  };

  const priorIdsFor = (index: number): string[] => [
    ...contextToolCallIds,
    ...collectToolCallIds(messages.slice(0, index)),
  ];

  const addMessage = () => {
    const role = addRole ?? nextNaturalRole(messages);
    const message: Message = { role, content: '' };
    if (role === 'tool') {
      const open = firstUnansweredCallId(messages);
      if (open) message.toolCallId = open;
    }
    onChange([...messages, message]);
  };

  return (
    <div className="flex flex-col gap-2">
      {messages.length === 0 && emptyText && (
        <p className="rounded-(--radius-control) border border-dashed border-hairline px-3 py-2 text-center text-xs text-ink-faint">
          {emptyText}
        </p>
      )}
      {messages.map((message, i) => (
        <MessageCard
          key={i}
          message={message}
          onChange={(next) => replaceAt(i, next)}
          onDelete={() => deleteAt(i)}
          onMove={(direction) => moveAt(i, direction)}
          canMoveUp={i > 0}
          canMoveDown={i < messages.length - 1}
          showWeight={showWeight}
          allowedRoles={allowedRoles}
          priorToolCallIds={priorIdsFor(i)}
        />
      ))}
      <Button
        variant="ghost"
        size="xs"
        className="self-start text-ink-faint hover:text-ink"
        onClick={addMessage}
      >
        <Plus /> {addLabel}
      </Button>
    </div>
  );
}

export interface ConversationEditorProps {
  messages: Message[];
  onChange: (messages: Message[]) => void;
}

/** SFT editor: the full conversation with loss weights on assistant turns. */
export function ConversationEditor({ messages, onChange }: ConversationEditorProps) {
  return (
    <section>
      <div className="tech-label mb-2">Conversation</div>
      <MessageList
        messages={messages}
        onChange={onChange}
        showWeight
        emptyText="No messages yet. Add the first turn."
      />
    </section>
  );
}
