/**
 * Built-in demo dataset — loaded from the home screen so first-run visitors
 * (especially on the GitHub Pages deployment) can explore every workbench
 * surface without importing anything. Covers all four dataset types plus
 * reasoning traces and tool calls.
 */
import { createExample, type Example, type ToolDefinition } from '@/engine/types';

const WEATHER_TOOL: ToolDefinition = {
  name: 'get_weather',
  description: 'Get the current weather for a city',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name' },
      unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
    },
    required: ['city'],
  },
};

export function buildDemoExamples(projectId: string): Example[] {
  const mk = (partial: Parameters<typeof createExample>[0]) =>
    createExample({ ...partial, meta: { ...partial.meta, source: 'demo' } });

  return [
    // --- Plain SFT -----------------------------------------------------
    mk({
      projectId,
      messages: [
        { role: 'system', content: 'You are a concise technical assistant.' },
        { role: 'user', content: 'What is the difference between LoRA and full fine-tuning?' },
        {
          role: 'assistant',
          content:
            'Full fine-tuning updates every weight in the model, which needs a lot of GPU memory and storage per variant. LoRA freezes the base weights and trains small low-rank adapter matrices injected into attention and MLP layers — typically <1% of parameters. You get most of the quality at a fraction of the cost, and adapters can be swapped or merged at inference time.',
        },
      ],
      tags: ['ml-basics'],
    }),
    mk({
      projectId,
      messages: [
        { role: 'user', content: 'Write a haiku about training data.' },
        {
          role: 'assistant',
          content: 'Clean rows, ordered turns —\nten thousand small dialogues\nteach one voice to speak.',
        },
      ],
      tags: ['creative'],
    }),
    mk({
      projectId,
      messages: [
        { role: 'user', content: 'My JSONL file fails to parse on line 4 — what are common causes?' },
        {
          role: 'assistant',
          content:
            'Most JSONL parse failures come down to one of these:\n\n1. **Trailing comma** inside the object on that line.\n2. **Unescaped newline** inside a string value — each record must be exactly one line.\n3. **Smart quotes** (“ ”) pasted from a document instead of straight quotes.\n4. **BOM or invisible characters** at the start of the line.\n5. The line is actually **two JSON objects** concatenated without a newline.\n\nOpen the file in an editor that shows whitespace, jump to line 4, and check those in order.',
        },
      ],
      tags: ['debugging'],
    }),
    // --- SFT with reasoning trace --------------------------------------
    mk({
      projectId,
      messages: [
        { role: 'user', content: 'A train travels 240 km in 3 hours, then 180 km in 2 hours. What is its average speed for the whole trip?' },
        {
          role: 'assistant',
          reasoning:
            'Total distance = 240 + 180 = 420 km. Total time = 3 + 2 = 5 hours. Average speed = total distance / total time = 420 / 5 = 84 km/h. Note: averaging the two segment speeds (80 and 90) would give 85, which is wrong because the segments have different durations.',
          content: 'The average speed is **84 km/h** — total distance (420 km) divided by total time (5 h). Note that simply averaging the two segment speeds would give the wrong answer.',
        },
      ],
      tags: ['math', 'reasoning'],
    }),
    mk({
      projectId,
      messages: [
        { role: 'user', content: 'Is 1001 a prime number?' },
        {
          role: 'assistant',
          reasoning:
            'Check small divisors. 1001 / 7 = 143. So 1001 = 7 × 143. And 143 = 11 × 13. Therefore 1001 = 7 × 11 × 13 — composite.',
          content: 'No — 1001 = 7 × 11 × 13, so it is composite.',
        },
      ],
      tags: ['math', 'reasoning'],
    }),
    // --- SFT with tool calls --------------------------------------------
    mk({
      projectId,
      tools: [WEATHER_TOOL],
      messages: [
        { role: 'user', content: 'Should I bring an umbrella to Lyon today?' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'call_demo_1', name: 'get_weather', arguments: '{"city":"Lyon","unit":"celsius"}' },
          ],
        },
        {
          role: 'tool',
          toolCallId: 'call_demo_1',
          name: 'get_weather',
          content: '{"temp_c":14,"condition":"light rain","precipitation_mm":3.2}',
        },
        {
          role: 'assistant',
          content: 'Yes — Lyon currently has light rain at 14 °C with about 3 mm of precipitation expected, so an umbrella is a good idea.',
        },
      ],
      tags: ['tool-calling'],
    }),
    // --- Preference (DPO) pairs -----------------------------------------
    mk({
      projectId,
      type: 'preference',
      messages: [
        { role: 'user', content: 'Explain what overfitting is to a non-technical manager.' },
      ],
      chosen: [
        {
          role: 'assistant',
          content:
            'Overfitting is like an employee who memorizes last year’s exam answers instead of learning the subject. They score perfectly on the old test but fail on any new question. A model that overfits has memorized its training examples rather than learning the underlying patterns, so it performs poorly on real-world data it has never seen.',
        },
      ],
      rejected: [
        {
          role: 'assistant',
          content:
            'Overfitting occurs when a model minimizes empirical risk on the training distribution but exhibits high variance under distribution shift, indicating poor generalization of the learned decision boundary.',
        },
      ],
      tags: ['explanations'],
    }),
    mk({
      projectId,
      type: 'preference',
      messages: [{ role: 'user', content: 'Write a one-line commit message for a fix that stops the export button double-submitting.' }],
      chosen: [
        { role: 'assistant', content: 'fix(export): debounce submit handler to prevent duplicate export jobs' },
      ],
      rejected: [
        { role: 'assistant', content: 'fixed a bug with the button' },
      ],
      tags: ['code'],
    }),
    // --- KTO (unpaired feedback) -----------------------------------------
    mk({
      projectId,
      type: 'kto',
      messages: [{ role: 'user', content: 'Summarize the GDPR in two sentences.' }],
      completion: [
        {
          role: 'assistant',
          content:
            'The GDPR is the EU’s data-protection law: it gives individuals rights over their personal data (access, correction, deletion, portability) and requires organizations to collect data lawfully, minimize it, secure it, and report breaches. Non-compliance can draw fines of up to 4% of global annual revenue.',
        },
      ],
      label: true,
      tags: ['summarization'],
    }),
    mk({
      projectId,
      type: 'kto',
      messages: [{ role: 'user', content: 'Summarize the GDPR in two sentences.' }],
      completion: [
        { role: 'assistant', content: 'GDPR is a European law about data. It has rules.' },
      ],
      label: false,
      tags: ['summarization'],
    }),
    // --- RL / verifiable (GRPO) -------------------------------------------
    mk({
      projectId,
      type: 'rl',
      messages: [
        { role: 'user', content: 'Sarah has 3 boxes with 12 apples each. She gives away a quarter of all her apples. How many apples does she have left?' },
      ],
      answer: '27',
      tags: ['math', 'grpo'],
    }),
    mk({
      projectId,
      type: 'rl',
      messages: [
        { role: 'user', content: 'What is the output of: print(len(set("mississippi")))' },
      ],
      answer: '4',
      tags: ['code', 'grpo'],
    }),
  ];
}
