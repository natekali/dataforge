import { describe, expect, it } from 'vitest';
import type {
  CleaningOptions,
  Example,
  IssueType,
  Message,
  ModelInfo,
  Role,
} from '@/engine/types';
import { createExample } from '@/engine/types';
import {
  DEFAULT_CLEANING,
  TOO_LONG_CHARS,
  analyzeDataset,
  analyzeExample,
  cleanExample,
} from '@/engine/quality';

const PROJECT = 'proj-quality';

/** A substantial, PII-free, refusal-free user prompt (77 chars). */
const USER_TEXT =
  'Explain how photosynthesis converts sunlight into chemical energy in plants.';

/** A clean assistant answer with a healthy ~2.6x response/instruction ratio. */
const ASSISTANT_TEXT =
  'Photosynthesis happens in chloroplasts. Light-dependent reactions split water to ' +
  'produce ATP and NADPH, and the Calvin cycle then uses that stored energy to fix ' +
  'carbon dioxide into glucose for the plant.';

/** Build a message from a raw (possibly invalid) role string. */
function msg(role: string, content: string, extra: Partial<Message> = {}): Message {
  return { role: role as Role, content, ...extra };
}

function sft(messages: Message[], extra: Partial<Example> = {}): Example {
  return createExample({ projectId: PROJECT, messages, ...extra });
}

function cleanSft(): Example {
  return sft([msg('user', USER_TEXT), msg('assistant', ASSISTANT_TEXT)]);
}

function cleanPreference(extra: Partial<Example> = {}): Example {
  return createExample({
    projectId: PROJECT,
    type: 'preference',
    messages: [msg('user', USER_TEXT)],
    chosen: [msg('assistant', ASSISTANT_TEXT)],
    rejected: [
      msg('assistant', 'That answer is wrong because the question was never about plants.'),
    ],
    ...extra,
  });
}

function cleanKto(extra: Partial<Example> = {}): Example {
  return createExample({
    projectId: PROJECT,
    type: 'kto',
    messages: [msg('user', USER_TEXT)],
    completion: [msg('assistant', ASSISTANT_TEXT)],
    label: true,
    ...extra,
  });
}

function cleanRl(extra: Partial<Example> = {}): Example {
  return createExample({
    projectId: PROJECT,
    type: 'rl',
    messages: [
      msg(
        'user',
        `${USER_TEXT} Walk through each stage carefully and name the molecules involved.`,
      ),
    ],
    answer: 'glucose',
    ...extra,
  });
}

function issueTypes(example: Example, opts?: { targetModel?: ModelInfo }): IssueType[] {
  return analyzeExample(example, opts).issues.map((issue) => issue.type);
}

function model(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: 'test-model',
    hfId: 'test/model',
    name: 'Test Model',
    vendor: 'Test',
    family: 'test',
    totalParams: '1B',
    nativeCtx: 8192,
    templateFamily: 'chatml',
    reasoningMode: 'none',
    preservesThinking: false,
    supportsSystemRole: true,
    toolCallStyle: 'openai',
    multimodal: [],
    license: 'apache-2.0',
    recommendedSeqLen: 4096,
    sizeClass: 'small',
    released: '2026-01',
    ...overrides,
  };
}

/** Every cleaning op disabled — base for single-op tests. */
const OFF: CleaningOptions = {
  removeEmptyMessages: false,
  normalizeRoles: false,
  fixEncoding: false,
  normalizeWhitespace: false,
  removeRefusals: false,
  maskPii: false,
  removeSpecialTokens: false,
};

function only(op: keyof CleaningOptions): CleaningOptions {
  const opts: CleaningOptions = { ...OFF };
  opts[op] = true;
  return opts;
}

// ---------------------------------------------------------------------------
// analyzeExample — clean baselines
// ---------------------------------------------------------------------------

describe('analyzeExample — clean examples', () => {
  it('reports no issues and a perfect score for a clean sft example', () => {
    const report = analyzeExample(cleanSft());
    expect(report.issues).toEqual([]);
    expect(report.score).toBe(100);
    expect(report.components).toEqual({
      completeness: 100,
      formatting: 100,
      lengthBalance: 100,
      contentQuality: 100,
    });
  });

  it('reports no issues for clean preference / kto / rl examples', () => {
    expect(analyzeExample(cleanPreference()).issues).toEqual([]);
    expect(analyzeExample(cleanPreference()).score).toBe(100);
    expect(analyzeExample(cleanKto()).issues).toEqual([]);
    expect(analyzeExample(cleanKto()).score).toBe(100);
    expect(analyzeExample(cleanRl()).issues).toEqual([]);
    expect(analyzeExample(cleanRl()).score).toBe(100);
  });

  it('reports the analyzed example id', () => {
    const example = cleanSft();
    expect(analyzeExample(example).exampleId).toBe(example.id);
  });
});

// ---------------------------------------------------------------------------
// analyzeExample — structural issue types
// ---------------------------------------------------------------------------

describe('analyzeExample — empty_field', () => {
  it('fires critically when an example has no messages', () => {
    const report = analyzeExample(sft([]));
    const issue = report.issues.find((i) => i.type === 'empty_field');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('critical');
  });

  it('fires on a message with whitespace-only content', () => {
    const example = sft([msg('user', USER_TEXT), msg('assistant', '   ')]);
    const issue = analyzeExample(example).issues.find((i) => i.type === 'empty_field');
    expect(issue).toBeDefined();
    expect(issue?.messageIndex).toBe(1);
    expect(issue?.autoFixable).toBe(true);
  });

  it('does not fire on an empty-content assistant turn that carries tool calls', () => {
    const example = sft([
      msg('user', USER_TEXT),
      msg('assistant', '', {
        toolCalls: [{ id: 'call_1', name: 'get_weather', arguments: '{"city":"Paris"}' }],
      }),
    ]);
    expect(issueTypes(example)).not.toContain('empty_field');
  });
});

describe('analyzeExample — missing_role / invalid_role', () => {
  it('fires missing_role critically for a message with no role', () => {
    const example = sft([msg('', USER_TEXT), msg('assistant', ASSISTANT_TEXT)]);
    const issue = analyzeExample(example).issues.find((i) => i.type === 'missing_role');
    expect(issue?.severity).toBe('critical');
    expect(issue?.messageIndex).toBe(0);
  });

  it('fires missing_role when there is no user message', () => {
    const example = sft([msg('assistant', ASSISTANT_TEXT)]);
    expect(issueTypes(example)).toContain('missing_role');
  });

  it('fires missing_role when an sft example has no assistant message', () => {
    const example = sft([msg('user', USER_TEXT)]);
    expect(issueTypes(example)).toContain('missing_role');
  });

  it('does not require an assistant turn for kto / rl examples', () => {
    expect(issueTypes(cleanKto())).not.toContain('missing_role');
    expect(issueTypes(cleanRl())).not.toContain('missing_role');
  });

  it('fires invalid_role (auto-fixable) for a normalizable alias like "human"', () => {
    const example = sft([msg('human', USER_TEXT), msg('assistant', ASSISTANT_TEXT)]);
    const issue = analyzeExample(example).issues.find((i) => i.type === 'invalid_role');
    expect(issue?.severity).toBe('high');
    expect(issue?.autoFixable).toBe(true);
  });

  it('fires invalid_role (not auto-fixable) for an unknown role', () => {
    const example = sft([msg('narrator', USER_TEXT), msg('assistant', ASSISTANT_TEXT)]);
    const issue = analyzeExample(example).issues.find((i) => i.type === 'invalid_role');
    expect(issue?.autoFixable).toBe(false);
  });

  it('does not fire on canonical roles', () => {
    const types = issueTypes(cleanSft());
    expect(types).not.toContain('invalid_role');
    expect(types).not.toContain('missing_role');
  });
});

describe('analyzeExample — too_short / too_long / imbalanced_ratio', () => {
  it('fires too_short for a tiny user turn and not for substantial turns', () => {
    const example = sft([msg('user', 'Hi'), msg('assistant', ASSISTANT_TEXT)]);
    const issue = analyzeExample(example).issues.find((i) => i.type === 'too_short');
    expect(issue?.messageIndex).toBe(0);
    expect(issueTypes(cleanSft())).not.toContain('too_short');
  });

  it('does not fire too_short for a short assistant turn that carries tool calls', () => {
    const example = sft([
      msg('user', USER_TEXT),
      msg('assistant', '', {
        toolCalls: [{ id: 'call_1', name: 'lookup', arguments: '{}' }],
      }),
    ]);
    expect(issueTypes(example)).not.toContain('too_short');
  });

  it('fires too_long beyond the character limit', () => {
    const example = sft([
      msg('user', USER_TEXT),
      msg('assistant', 'a'.repeat(TOO_LONG_CHARS + 1)),
    ]);
    const issue = analyzeExample(example).issues.find((i) => i.type === 'too_long');
    expect(issue?.severity).toBe('high');
    expect(issueTypes(cleanSft())).not.toContain('too_long');
  });

  it('fires medium imbalanced_ratio when the response is under a tenth of the prompt', () => {
    const longUser =
      'Please write a complete and detailed report about renewable energy adoption across ' +
      'Europe, covering policy, economics and grid integration challenges in depth.';
    const example = sft([msg('user', longUser), msg('assistant', 'Sure thing.')]);
    const issue = analyzeExample(example).issues.find((i) => i.type === 'imbalanced_ratio');
    expect(issue?.severity).toBe('medium');
  });

  it('fires low imbalanced_ratio when the response is over fifty times the prompt', () => {
    const example = sft([
      msg('user', 'Tell me more please now.'),
      msg('assistant', ASSISTANT_TEXT.repeat(7)),
    ]);
    const issue = analyzeExample(example).issues.find((i) => i.type === 'imbalanced_ratio');
    expect(issue?.severity).toBe('low');
  });

  it('never fires imbalanced_ratio for prompt-only rl examples', () => {
    expect(issueTypes(cleanRl())).not.toContain('imbalanced_ratio');
  });
});

describe('analyzeExample — refusal_pattern', () => {
  it('fires on a refusing assistant turn', () => {
    const example = sft([
      msg('user', USER_TEXT),
      msg('assistant', "I'm sorry, but I can't help with that request at all, unfortunately."),
    ]);
    expect(issueTypes(example)).toContain('refusal_pattern');
  });

  it('does not fire on refusal phrasing inside a user turn', () => {
    const example = sft([
      msg('user', 'Earlier you said "as an AI language model" — why do models say that?'),
      msg('assistant', ASSISTANT_TEXT),
    ]);
    expect(issueTypes(example)).not.toContain('refusal_pattern');
  });

  it('does not fire inside rejected continuations (legitimate DPO negatives)', () => {
    const example = cleanPreference({
      rejected: [msg('assistant', "I'm sorry, but I can't help with that request at all.")],
    });
    expect(issueTypes(example)).not.toContain('refusal_pattern');
  });

  it('does not fire on a clean answer', () => {
    expect(issueTypes(cleanSft())).not.toContain('refusal_pattern');
  });
});

describe('analyzeExample — pii_detected', () => {
  const piiCases: ReadonlyArray<readonly [string, string]> = [
    ['email address', 'You can reach the maintainer at john.doe@example.com for details.'],
    ['phone number', 'Call our office at (555) 123-4567 during business hours please.'],
    ['SSN', 'The social security number on file is 123-45-6789 for this record.'],
    ['credit card number', 'Charge the card 4111-1111-1111-1111 for the full invoice amount.'],
    ['IP address', 'The server at 192.168.1.100 stopped responding to health checks.'],
  ];

  for (const [label, text] of piiCases) {
    it(`detects a ${label}`, () => {
      const example = sft([msg('user', USER_TEXT), msg('assistant', text)]);
      const pii = analyzeExample(example).issues.filter((i) => i.type === 'pii_detected');
      expect(pii.some((i) => i.message.includes(label))).toBe(true);
      expect(pii.every((i) => i.severity === 'high' && i.autoFixable)).toBe(true);
    });
  }

  it('detects PII inside reasoning traces', () => {
    const example = sft([
      msg('user', USER_TEXT),
      msg('assistant', ASSISTANT_TEXT, {
        reasoning: 'The user email is jane.doe@corp.example.com so keep that private.',
      }),
    ]);
    expect(issueTypes(example)).toContain('pii_detected');
  });

  it('does not fire on clean text', () => {
    expect(issueTypes(cleanSft())).not.toContain('pii_detected');
  });
});

describe('analyzeExample — encoding_error', () => {
  it('fires on cp1252 mojibake', () => {
    const example = sft([
      msg('user', USER_TEXT),
      msg('assistant', `Itâ€™s a great day for plants and chlorophyll everywhere.`),
    ]);
    expect(issueTypes(example)).toContain('encoding_error');
  });

  it('fires on the replacement character and null bytes', () => {
    const replaced = sft([msg('user', USER_TEXT), msg('assistant', `caf� menu ${ASSISTANT_TEXT}`)]);
    expect(issueTypes(replaced)).toContain('encoding_error');
    const nulled = sft([msg('user', USER_TEXT), msg('assistant', `bad byte ${ASSISTANT_TEXT}`)]);
    expect(issueTypes(nulled)).toContain('encoding_error');
  });

  it('does not fire on clean text with legitimate unicode', () => {
    const example = sft([
      msg('user', USER_TEXT),
      msg('assistant', `Voilà — cafés use “smart quotes” and that's fine. ${ASSISTANT_TEXT}`),
    ]);
    expect(issueTypes(example)).not.toContain('encoding_error');
  });
});

describe('analyzeExample — special_token_conflict', () => {
  const withToken = (): Example =>
    sft([msg('user', USER_TEXT), msg('assistant', `${ASSISTANT_TEXT} <|im_start|>`)]);

  it('fires at medium severity against all families when no target model is set', () => {
    const issue = analyzeExample(withToken()).issues.find(
      (i) => i.type === 'special_token_conflict',
    );
    expect(issue?.severity).toBe('medium');
    expect(issue?.autoFixable).toBe(true);
  });

  it('fires at high severity when the token belongs to the target family', () => {
    const issue = analyzeExample(withToken(), {
      targetModel: model({ templateFamily: 'chatml' }),
    }).issues.find((i) => i.type === 'special_token_conflict');
    expect(issue?.severity).toBe('high');
  });

  it('does not fire when the token is foreign to the target family', () => {
    const types = issueTypes(withToken(), { targetModel: model({ templateFamily: 'llama3' }) });
    expect(types).not.toContain('special_token_conflict');
  });

  it('detects control tokens inside reasoning traces', () => {
    const example = sft([
      msg('user', USER_TEXT),
      msg('assistant', ASSISTANT_TEXT, { reasoning: 'emit <|eot_id|> when finished thinking' }),
    ]);
    expect(issueTypes(example)).toContain('special_token_conflict');
  });

  it('does not fire on clean text', () => {
    expect(issueTypes(cleanSft())).not.toContain('special_token_conflict');
  });
});

// ---------------------------------------------------------------------------
// analyzeExample — tool calling
// ---------------------------------------------------------------------------

describe('analyzeExample — tool calls', () => {
  function toolConversation(toolCallId: string): Example {
    return sft([
      msg('user', USER_TEXT),
      msg('assistant', '', {
        toolCalls: [{ id: 'call_1', name: 'get_weather', arguments: '{"city":"Paris"}' }],
      }),
      msg('tool', 'Sunny and warm with clear skies.', { toolCallId }),
      msg('assistant', 'It is sunny in Paris today with clear skies and warm weather.'),
    ]);
  }

  it('accepts a well-formed call/result conversation', () => {
    expect(analyzeExample(toolConversation('call_1')).issues).toEqual([]);
  });

  it('fires malformed_tool_call for non-JSON arguments', () => {
    const example = sft([
      msg('user', USER_TEXT),
      msg('assistant', '', {
        toolCalls: [{ id: 'call_1', name: 'get_weather', arguments: 'city=Paris' }],
      }),
    ]);
    const issue = analyzeExample(example).issues.find((i) => i.type === 'malformed_tool_call');
    expect(issue?.severity).toBe('high');
  });

  it('fires malformed_tool_call for a tool result without a toolCallId', () => {
    const example = sft([
      msg('user', USER_TEXT),
      msg('tool', 'Sunny and warm with clear skies today.'),
      msg('assistant', ASSISTANT_TEXT),
    ]);
    expect(issueTypes(example)).toContain('malformed_tool_call');
  });

  it('fires orphan_tool_result when the referenced call id does not exist', () => {
    const issue = analyzeExample(toolConversation('call_9')).issues.find(
      (i) => i.type === 'orphan_tool_result',
    );
    expect(issue?.severity).toBe('high');
    expect(issue?.message).toContain('call_9');
  });
});

// ---------------------------------------------------------------------------
// analyzeExample — turn order
// ---------------------------------------------------------------------------

describe('analyzeExample — incoherent_turn_order', () => {
  it('fires when an assistant turn precedes any user turn', () => {
    const example = sft([msg('assistant', ASSISTANT_TEXT), msg('user', USER_TEXT)]);
    expect(issueTypes(example)).toContain('incoherent_turn_order');
  });

  it('fires for consecutive user turns', () => {
    const example = sft([
      msg('user', USER_TEXT),
      msg('user', 'Also, why are leaves green in summer but red in autumn?'),
      msg('assistant', ASSISTANT_TEXT),
    ]);
    const issue = analyzeExample(example).issues.find((i) => i.type === 'incoherent_turn_order');
    expect(issue?.messageIndex).toBe(1);
  });

  it('fires (high) when a preference prompt does not end with a user turn', () => {
    const example = cleanPreference({
      messages: [msg('user', USER_TEXT), msg('assistant', 'Let me think about how to answer.')],
    });
    const issue = analyzeExample(example).issues.find((i) => i.type === 'incoherent_turn_order');
    expect(issue?.severity).toBe('high');
  });

  it('does not fire on a well-ordered conversation', () => {
    expect(issueTypes(cleanSft())).not.toContain('incoherent_turn_order');
    expect(issueTypes(cleanPreference())).not.toContain('incoherent_turn_order');
  });
});

// ---------------------------------------------------------------------------
// analyzeExample — context overflow (target model)
// ---------------------------------------------------------------------------

describe('analyzeExample — context_overflow', () => {
  it('fires critically when the example exceeds the target recommendedSeqLen', () => {
    const issue = analyzeExample(cleanSft(), {
      targetModel: model({ recommendedSeqLen: 10 }),
    }).issues.find((i) => i.type === 'context_overflow');
    expect(issue?.severity).toBe('critical');
  });

  it('does not fire when the example fits, or when no target model is given', () => {
    expect(
      issueTypes(cleanSft(), { targetModel: model({ recommendedSeqLen: 100_000 }) }),
    ).not.toContain('context_overflow');
    expect(issueTypes(cleanSft())).not.toContain('context_overflow');
  });
});

// ---------------------------------------------------------------------------
// analyzeExample — dataset-type validation
// ---------------------------------------------------------------------------

describe('analyzeExample — dataset-type requirements', () => {
  it('preference: requires a non-empty chosen continuation', () => {
    const example = cleanPreference({ chosen: undefined });
    const issue = analyzeExample(example).issues.find(
      (i) => i.type === 'empty_field' && i.field === 'chosen',
    );
    expect(issue?.severity).toBe('critical');
  });

  it('preference: requires a non-empty rejected continuation', () => {
    const example = cleanPreference({ rejected: [msg('assistant', '   ')] });
    const issue = analyzeExample(example).issues.find(
      (i) => i.type === 'empty_field' && i.field === 'rejected',
    );
    expect(issue).toBeDefined();
  });

  it('kto: requires a non-empty completion and a boolean label', () => {
    const noCompletion = cleanKto({ completion: undefined });
    expect(
      analyzeExample(noCompletion).issues.some(
        (i) => i.type === 'empty_field' && i.field === 'completion',
      ),
    ).toBe(true);

    const noLabel = cleanKto({ label: undefined });
    expect(
      analyzeExample(noLabel).issues.some(
        (i) => i.type === 'empty_field' && /label/.test(i.message),
      ),
    ).toBe(true);
  });

  it('rl: requires a non-empty verifiable answer', () => {
    const example = cleanRl({ answer: '   ' });
    expect(
      analyzeExample(example).issues.some(
        (i) => i.type === 'empty_field' && /answer/.test(i.message),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe('analyzeExample — scoring', () => {
  it('applies the 0.2/0.2/0.35/0.25 weights when issues are present', () => {
    // One high-severity issue (refusal): formatting 0.9, everything else 1.0.
    const example = sft([
      msg('user', USER_TEXT),
      msg('assistant', `${ASSISTANT_TEXT} I'm sorry, but I can't elaborate further on it.`),
    ]);
    const report = analyzeExample(example);
    expect(report.issues.map((i) => i.type)).toEqual(['refusal_pattern']);
    expect(report.components.formatting).toBe(90);
    // 1*0.2 + 0.9*0.2 + 1*0.35 + 1*0.25 = 0.98
    expect(report.score).toBe(98);
  });

  it('scores monotonically lower as issues accumulate', () => {
    const clean = analyzeExample(cleanSft()).score;
    const oneIssue = analyzeExample(
      sft([
        msg('user', USER_TEXT),
        msg('assistant', `${ASSISTANT_TEXT} I'm sorry, but I can't elaborate further on it.`),
      ]),
    ).score;
    const twoIssues = analyzeExample(
      sft([
        msg('user', USER_TEXT),
        msg(
          'assistant',
          `${ASSISTANT_TEXT} I'm sorry, but I can't elaborate further on it. ` +
            'Contact john.doe@example.com for more details on the matter.',
        ),
      ]),
    ).score;
    expect(clean).toBeGreaterThan(oneIssue);
    expect(oneIssue).toBeGreaterThan(twoIssues);
  });

  it('scores a structurally broken example in the poor band', () => {
    // Empty sft example: completeness 0, lengthBalance 0, formatting 0.5
    // (1 critical + 2 high), contentQuality 1 -> 0.35.
    const report = analyzeExample(sft([]));
    expect(report.score).toBe(35);
    expect(report.components.completeness).toBe(0);
    expect(report.components.lengthBalance).toBe(0);
  });

  it('keeps scores within 0–100', () => {
    const horror = sft([msg('', ''), msg('wizard', ''), msg('assistant', 'a')]);
    const report = analyzeExample(horror);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// analyzeDataset
// ---------------------------------------------------------------------------

describe('analyzeDataset', () => {
  it('flags later exact duplicates (case/whitespace-insensitive) but not the first', () => {
    const a = sft(
      [
        msg('user', 'What is the capital of France?'),
        msg(
          'assistant',
          'The capital of France is Paris, a historic city on the Seine river in northern Europe.',
        ),
      ],
      { id: 'dup-a' },
    );
    const b = sft(
      [
        msg('user', '  WHAT IS   the capital of France?  '),
        msg(
          'assistant',
          'The Capital of France is Paris,   a historic city on the Seine river in northern Europe.',
        ),
      ],
      { id: 'dup-b' },
    );
    const c = sft([msg('user', USER_TEXT), msg('assistant', ASSISTANT_TEXT)], { id: 'uniq-c' });

    const { reports, summary } = analyzeDataset([a, b, c]);
    expect(reports.map((r) => r.exampleId)).toEqual(['dup-a', 'dup-b', 'uniq-c']);
    expect(reports[0].issues.map((i) => i.type)).not.toContain('duplicate');
    expect(reports[2].issues.map((i) => i.type)).not.toContain('duplicate');

    const dup = reports[1].issues.find((i) => i.type === 'duplicate');
    expect(dup?.severity).toBe('high');
    expect(dup?.message).toContain('dup-a');
    expect(reports[1].score).toBeLessThan(reports[0].score);
    expect(summary.issueCounts.duplicate).toBe(1);
  });

  it('does not flag distinct examples as duplicates', () => {
    const { reports } = analyzeDataset([
      cleanSft(),
      sft([msg('user', 'Why is the sky blue during the day?'), msg('assistant', ASSISTANT_TEXT)]),
    ]);
    for (const report of reports) {
      expect(report.issues.map((i) => i.type)).not.toContain('duplicate');
    }
  });

  it('aggregates the summary (average, distribution, issue counts)', () => {
    const { summary } = analyzeDataset([cleanSft(), sft([])]);
    expect(summary).toEqual({
      scored: 2,
      averageScore: 67.5, // (100 + 35) / 2
      scoreDistribution: { excellent: 1, good: 0, fair: 0, poor: 1 },
      issueCounts: { empty_field: 1, missing_role: 2 },
    });
  });

  it('handles an empty dataset', () => {
    const { reports, summary } = analyzeDataset([]);
    expect(reports).toEqual([]);
    expect(summary).toEqual({
      scored: 0,
      averageScore: 0,
      scoreDistribution: { excellent: 0, good: 0, fair: 0, poor: 0 },
      issueCounts: {},
    });
  });
});

// ---------------------------------------------------------------------------
// cleanExample — defaults + single operations
// ---------------------------------------------------------------------------

describe('DEFAULT_CLEANING', () => {
  it('enables the safe operations and keeps destructive ones opt-in', () => {
    expect(DEFAULT_CLEANING).toEqual({
      removeEmptyMessages: true,
      normalizeRoles: true,
      fixEncoding: true,
      normalizeWhitespace: true,
      removeRefusals: false,
      maskPii: true,
      removeSpecialTokens: false,
    });
  });
});

describe('cleanExample — removeEmptyMessages', () => {
  it('drops whitespace-only messages but keeps tool-call and reasoning-only turns', () => {
    const example = sft([
      msg('user', USER_TEXT),
      msg('assistant', '   '),
      msg('assistant', '', { toolCalls: [{ id: 'call_1', name: 'f', arguments: '{}' }] }),
      msg('assistant', '', { reasoning: 'still thinking through the problem here' }),
    ]);
    const { example: out, changed } = cleanExample(example, only('removeEmptyMessages'));
    expect(out.messages).toHaveLength(3);
    expect(changed).toContain('Removed empty assistant message');
  });
});

describe('cleanExample — normalizeRoles', () => {
  it('maps aliases to canonical roles and leaves valid roles alone', () => {
    const example = sft([msg('human', USER_TEXT), msg('gpt', ASSISTANT_TEXT)]);
    const { example: out, changed } = cleanExample(example, only('normalizeRoles'));
    expect(out.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(changed).toContain('Normalized role "human" to "user"');
    expect(cleanExample(cleanSft(), only('normalizeRoles')).changed).toEqual([]);
  });
});

describe('cleanExample — fixEncoding', () => {
  it('repairs cp1252 and latin-1 mojibake forms', () => {
    const example = sft([
      msg('user', `Itâ€™s broken and itâs also broken here.`),
      msg('assistant', ASSISTANT_TEXT),
    ]);
    const { example: out, changed } = cleanExample(example, only('fixEncoding'));
    expect(out.messages[0].content).toBe("It's broken and it's also broken here.");
    expect(changed).toContain('Fixed encoding artifacts');
  });

  it('strips null bytes and replacement characters', () => {
    const example = sft([
      msg('user', `null byte and caf� here, please explain the weird artifacts.`),
      msg('assistant', ASSISTANT_TEXT),
    ]);
    const { example: out, changed } = cleanExample(example, only('fixEncoding'));
    expect(out.messages[0].content).toBe(
      'nullbyte and caf here, please explain the weird artifacts.',
    );
    expect(changed).toContain('Removed null characters');
  });
});

describe('cleanExample — normalizeWhitespace', () => {
  it('collapses 3+ newlines, strips trailing spaces per line and trims edges', () => {
    const example = sft([
      msg('user', '  first line   \nsecond line\n\n\n\nthird line  '),
      msg('assistant', ASSISTANT_TEXT),
    ]);
    const { example: out, changed } = cleanExample(example, only('normalizeWhitespace'));
    expect(out.messages[0].content).toBe('first line\nsecond line\n\nthird line');
    expect(changed).toContain('Normalized whitespace');
  });
});

describe('cleanExample — removeRefusals', () => {
  it('removes the refusal sentence from assistant turns only', () => {
    const example = sft([
      msg('user', 'I cannot help wondering about this — what is the capital of France?'),
      msg('assistant', 'As an AI language model, I cannot browse. The capital of France is Paris.'),
    ]);
    const { example: out, changed } = cleanExample(example, only('removeRefusals'));
    expect(out.messages[1].content).toBe('The capital of France is Paris.');
    // User turn untouched even though it superficially matches a pattern.
    expect(out.messages[0].content).toBe(example.messages[0].content);
    expect(changed).toContain('Removed refusal text from assistant message');
  });

  it('never strips refusals from rejected continuations or reasoning traces', () => {
    const rejectedText = "I'm sorry, but I can't help with that request at all.";
    const example = cleanPreference({
      rejected: [msg('assistant', rejectedText)],
      chosen: [
        msg('assistant', ASSISTANT_TEXT, {
          reasoning: 'I cannot help with shortcuts here. Reason step by step instead.',
        }),
      ],
    });
    const { example: out } = cleanExample(example, only('removeRefusals'));
    expect(out.rejected?.[0].content).toBe(rejectedText);
    expect(out.chosen?.[0].reasoning).toBe(
      'I cannot help with shortcuts here. Reason step by step instead.',
    );
  });

  it('strips refusals from kto completions', () => {
    const example = cleanKto({
      completion: [msg('assistant', 'As an AI, I cannot answer this. Plants use chlorophyll.')],
    });
    const { example: out } = cleanExample(example, only('removeRefusals'));
    expect(out.completion?.[0].content).toBe('Plants use chlorophyll.');
  });
});

describe('cleanExample — maskPii', () => {
  it('masks every PII kind with its placeholder', () => {
    const example = sft([
      msg(
        'user',
        'Email john.doe@example.com, SSN 123-45-6789, card 4111-1111-1111-1111, ' +
          'host 10.0.0.1, phone (555) 123-4567.',
      ),
      msg('assistant', ASSISTANT_TEXT),
    ]);
    const { example: out, changed } = cleanExample(example, only('maskPii'));
    expect(out.messages[0].content).toBe(
      'Email [EMAIL], SSN [SSN], card [CARD], host [IP], phone [PHONE].',
    );
    expect(changed).toEqual(
      expect.arrayContaining([
        'Masked email address with [EMAIL]',
        'Masked SSN with [SSN]',
        'Masked credit card number with [CARD]',
        'Masked IP address with [IP]',
        'Masked phone number with [PHONE]',
      ]),
    );
  });

  it('masks SSNs as [SSN], not as partial phone numbers', () => {
    const example = sft([msg('user', 'The number 123-45-6789 was on the form.'), msg('assistant', ASSISTANT_TEXT)]);
    const { example: out } = cleanExample(example, only('maskPii'));
    expect(out.messages[0].content).toBe('The number [SSN] was on the form.');
  });

  it('masks PII inside reasoning traces and chosen continuations', () => {
    const example = cleanPreference({
      chosen: [
        msg('assistant', 'Write to support@vendor.example.org for an answer.', {
          reasoning: 'Their internal host is 192.168.0.12 according to the report.',
        }),
      ],
    });
    const { example: out } = cleanExample(example, only('maskPii'));
    expect(out.chosen?.[0].content).toBe('Write to [EMAIL] for an answer.');
    expect(out.chosen?.[0].reasoning).toBe('Their internal host is [IP] according to the report.');
  });
});

describe('cleanExample — removeSpecialTokens', () => {
  it('strips template control tokens from content', () => {
    const example = sft([
      msg('user', '<|im_start|>What is photosynthesis really about then?<|im_end|>'),
      msg('assistant', `[INST]${ASSISTANT_TEXT}`),
    ]);
    const { example: out, changed } = cleanExample(example, only('removeSpecialTokens'));
    expect(out.messages[0].content).toBe('What is photosynthesis really about then?');
    expect(out.messages[1].content).toBe(ASSISTANT_TEXT);
    expect(changed).toContain('Removed special token "<|im_start|>"');
  });
});

// ---------------------------------------------------------------------------
// cleanExample — purity, no-op behaviour, idempotency
// ---------------------------------------------------------------------------

describe('cleanExample — contracts', () => {
  function messyExample(): Example {
    return sft([
      msg(
        'human',
        '  Hello  there â€™ friend, my email is jane@corp.example.com ' +
          'and my phone is 555-123-4567.  ',
      ),
      msg(
        'gpt',
        'As an AI language model, I cannot do this. <|im_start|>Sure!\n\n\n\nHere is the answer you asked for.',
      ),
      msg('assistant', '   '),
    ]);
  }

  const ALL_ON: CleaningOptions = {
    removeEmptyMessages: true,
    normalizeRoles: true,
    fixEncoding: true,
    normalizeWhitespace: true,
    removeRefusals: true,
    maskPii: true,
    removeSpecialTokens: true,
  };

  it('never mutates the input example', () => {
    const example = messyExample();
    const snapshot = JSON.parse(JSON.stringify(example)) as Example;
    cleanExample(example, ALL_ON);
    expect(example).toEqual(snapshot);
  });

  it('returns no changes for an already-clean example', () => {
    const example = cleanSft();
    const { example: out, changed } = cleanExample(example, DEFAULT_CLEANING);
    expect(changed).toEqual([]);
    expect(out).toEqual(example);
  });

  it('applies every operation and is idempotent', () => {
    const first = cleanExample(messyExample(), ALL_ON);
    expect(first.changed.length).toBeGreaterThan(0);
    expect(first.example.messages).toHaveLength(2);
    expect(first.example.messages[0].role).toBe('user');
    expect(first.example.messages[0].content).toBe(
      "Hello there ' friend, my email is [EMAIL] and my phone is [PHONE].",
    );
    expect(first.example.messages[1].role).toBe('assistant');
    expect(first.example.messages[1].content).toBe(
      'Sure!\n\nHere is the answer you asked for.',
    );

    const second = cleanExample(first.example, ALL_ON);
    expect(second.changed).toEqual([]);
    expect(second.example).toEqual(first.example);
  });

  it('cleaning resolves the issues analysis found', () => {
    // Note: refusal_pattern is absent BEFORE cleaning because the refusing
    // turn still carries the alias role "gpt" — cleaning normalizes the role
    // first, then strips the refusal in the same pass.
    const before = issueTypes(messyExample());
    expect(before).toEqual(
      expect.arrayContaining([
        'invalid_role',
        'encoding_error',
        'pii_detected',
        'special_token_conflict',
        'empty_field',
      ]),
    );
    const { example: out } = cleanExample(messyExample(), ALL_ON);
    const after = issueTypes(out);
    for (const type of [
      'invalid_role',
      'encoding_error',
      'pii_detected',
      'refusal_pattern',
      'special_token_conflict',
      'empty_field',
    ] as const) {
      expect(after).not.toContain(type);
    }
  });
});
