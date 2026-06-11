/**
 * RL (GRPO / RLVR) editor: prompt-only conversation plus the verifiable
 * ground-truth answer reward functions check against.
 */
import type { Message } from '@/engine/types';
import { Input } from '@/components/ui/Input';
import { MessageList } from './ConversationEditor';

export interface RlEditorProps {
  /** The prompt-only conversation (last turn = user). */
  messages: Message[];
  answer: string;
  onChange: (patch: { messages?: Message[]; answer?: string }) => void;
}

export function RlEditor({ messages, answer, onChange }: RlEditorProps) {
  return (
    <div className="flex flex-col gap-4">
      <section>
        <div className="tech-label mb-2">Prompt</div>
        <MessageList
          messages={messages}
          onChange={(next) => onChange({ messages: next })}
          emptyText="No prompt yet. The last turn should be a user message."
        />
      </section>

      <section>
        <div className="tech-label mb-2">Verifiable answer</div>
        <Input
          value={answer}
          onChange={(e) => onChange({ answer: e.target.value })}
          placeholder="Ground-truth answer"
          aria-label="Verifiable answer"
          className="h-8 font-mono text-[13px]"
        />
        <p className="mt-1.5 text-xs leading-relaxed text-ink-dim">
          Reward functions compare model output against this answer.
        </p>
      </section>
    </div>
  );
}
