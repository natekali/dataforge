/**
 * KTO (unpaired preference) editor: prompt context, the completion being
 * labelled, and the desirable/undesirable switch bound to Example.label.
 */
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import type { Message } from '@/engine/types';
import { Switch } from '@/components/ui/Controls';
import { collectToolCallIds, MessageList } from './ConversationEditor';

export interface KtoEditorProps {
  /** The prompt portion (system/user/multi-turn context). */
  messages: Message[];
  completion: Message[];
  /** true = desirable, false = undesirable. */
  label: boolean;
  onChange: (patch: {
    messages?: Message[];
    completion?: Message[];
    label?: boolean;
  }) => void;
}

export function KtoEditor({ messages, completion, label, onChange }: KtoEditorProps) {
  return (
    <div className="flex flex-col gap-4">
      <section>
        <div className="tech-label mb-2">Prompt</div>
        <MessageList
          messages={messages}
          onChange={(next) => onChange({ messages: next })}
          emptyText="No prompt yet. Add a user turn."
        />
      </section>

      <section>
        <div className="tech-label mb-2">Completion</div>
        <MessageList
          messages={completion}
          onChange={(next) => onChange({ completion: next })}
          allowedRoles={['assistant']}
          addRole="assistant"
          addLabel="Add turn"
          contextToolCallIds={collectToolCallIds(messages)}
          emptyText="No completion yet."
        />
      </section>

      <div className="flex items-center gap-2.5 rounded-(--radius-panel) border border-hairline bg-surface-2 px-3 py-2">
        <Switch
          checked={label}
          onCheckedChange={(checked) => onChange({ label: checked })}
          aria-label="Desirable response"
        />
        {label ? (
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-ok">
            <ThumbsUp className="size-4 shrink-0" />
            Desirable response
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-danger">
            <ThumbsDown className="size-4 shrink-0" />
            Undesirable response
          </span>
        )}
      </div>
    </div>
  );
}
