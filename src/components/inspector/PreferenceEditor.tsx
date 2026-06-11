/**
 * Preference (DPO/ORPO) editor: shared prompt context on top, then chosen vs
 * rejected assistant continuations side by side with a one-click swap.
 */
import { ArrowLeftRight, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { Message } from '@/engine/types';
import { Button } from '@/components/ui/Button';
import { Tip } from '@/components/ui/Tooltip';
import { collectToolCallIds, MessageList } from './ConversationEditor';

export interface PreferenceEditorProps {
  /** The prompt portion (system/user/multi-turn context). */
  messages: Message[];
  chosen: Message[];
  rejected: Message[];
  onChange: (patch: {
    messages?: Message[];
    chosen?: Message[];
    rejected?: Message[];
  }) => void;
}

export function PreferenceEditor({
  messages,
  chosen,
  rejected,
  onChange,
}: PreferenceEditorProps) {
  const promptToolCallIds = collectToolCallIds(messages);

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
        <div className="mb-2 flex items-center justify-between">
          <span className="tech-label">Responses</span>
          <Tip label="Swap chosen and rejected">
            <Button
              variant="ghost"
              size="xs"
              aria-label="Swap chosen and rejected"
              onClick={() => onChange({ chosen: rejected, rejected: chosen })}
            >
              <ArrowLeftRight /> Swap
            </Button>
          </Tip>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="overflow-hidden rounded-(--radius-panel) border border-ok/30">
            <div className="flex items-center gap-1.5 border-b border-ok/30 bg-ok/5 px-2 py-1.5">
              <ThumbsUp className="size-3.5 shrink-0 text-ok" />
              <span className="tech-label text-ok">Chosen</span>
            </div>
            <div className="p-2">
              <MessageList
                messages={chosen}
                onChange={(next) => onChange({ chosen: next })}
                allowedRoles={['assistant']}
                addRole="assistant"
                addLabel="Add turn"
                contextToolCallIds={promptToolCallIds}
                emptyText="No chosen response yet."
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-(--radius-panel) border border-danger/30">
            <div className="flex items-center gap-1.5 border-b border-danger/30 bg-danger/5 px-2 py-1.5">
              <ThumbsDown className="size-3.5 shrink-0 text-danger" />
              <span className="tech-label text-danger">Rejected</span>
            </div>
            <div className="p-2">
              <MessageList
                messages={rejected}
                onChange={(next) => onChange({ rejected: next })}
                allowedRoles={['assistant']}
                addRole="assistant"
                addLabel="Add turn"
                contextToolCallIds={promptToolCallIds}
                emptyText="No rejected response yet."
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
