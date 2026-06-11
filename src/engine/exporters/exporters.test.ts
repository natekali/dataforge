import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { strFromU8, unzipSync } from 'fflate';
import {
  createExample,
  DATASET_TYPES,
  type DatasetType,
  type Example,
  type ExportBundle,
  type ExportOptions,
  type FrameworkId,
  type ModelInfo,
} from '@/engine/types';
import { getModel } from '@/engine/registry';
import {
  buildExportBundle,
  bundleToZip,
  isExportSupported,
  unsupportedDatasetTypes,
  UnsupportedExportError,
} from './index';
import { buildOpenAiFtRows } from './openaiFt';
import { buildReadme } from './readme';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Loose row shape for ergonomic assertions on parsed JSONL. */
type Row = Record<string, any>;

function mustModel(id: string): ModelInfo {
  const model = getModel(id);
  if (model === undefined) throw new Error(`registry is missing model: ${id}`);
  return model;
}

const QWEN = mustModel('qwen3-8b'); // chatml, inline <think>, hermes tools
const GPT_OSS = mustModel('gpt-oss-20b'); // harmony → separate thinking field
const MAGISTRAL = mustModel('magistral-small-2509'); // [THINK]…[/THINK] tokens

const PROJECT = 'proj-1';

function makeOptions(over: Partial<ExportOptions> = {}): ExportOptions {
  return {
    framework: 'jsonl',
    datasetType: 'sft',
    includeReasoning: true,
    stripPriorThinking: false,
    includeSystem: true,
    splitFiles: false,
    projectName: 'My Project',
    ...over,
  };
}

function sftExamples(): Example[] {
  return [
    createExample({
      projectId: PROJECT,
      type: 'sft',
      split: 'train',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: 'It is 4.', reasoning: 'Simple arithmetic.', weight: 1 },
      ],
    }),
    createExample({
      projectId: PROJECT,
      type: 'sft',
      split: 'train',
      messages: [
        { role: 'user', content: 'Weather in Paris?' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'get_weather', arguments: '{"city":"Paris"}' }],
        },
        { role: 'tool', content: '{"temp_c":21}', toolCallId: 'call_1', name: 'get_weather' },
        { role: 'assistant', content: 'It is 21 degrees in Paris.', weight: 0 },
      ],
      tools: [
        {
          name: 'get_weather',
          description: 'Get current weather',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
      ],
    }),
  ];
}

function preferenceExamples(): Example[] {
  return [
    createExample({
      projectId: PROJECT,
      type: 'preference',
      split: 'train',
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Name a prime.' },
      ],
      chosen: [{ role: 'assistant', content: '7', reasoning: 'Pick a small prime.' }],
      rejected: [{ role: 'assistant', content: '8' }],
    }),
  ];
}

function ktoExamples(): Example[] {
  return [
    createExample({
      projectId: PROJECT,
      type: 'kto',
      split: 'train',
      messages: [{ role: 'user', content: 'Say hi.' }],
      completion: [{ role: 'assistant', content: 'Hi!' }],
      label: true,
    }),
    createExample({
      projectId: PROJECT,
      type: 'kto',
      split: 'train',
      messages: [{ role: 'user', content: 'Say hi.' }],
      completion: [{ role: 'assistant', content: 'Go away.' }],
      label: false,
    }),
  ];
}

function rlExamples(): Example[] {
  return [
    createExample({
      projectId: PROJECT,
      type: 'rl',
      split: 'train',
      messages: [{ role: 'user', content: 'Compute 2+2.' }],
      answer: '4',
    }),
  ];
}

function examplesFor(type: DatasetType): Example[] {
  switch (type) {
    case 'sft':
      return sftExamples();
    case 'preference':
      return preferenceExamples();
    case 'kto':
      return ktoExamples();
    case 'rl':
      return rlExamples();
  }
}

function bundleFor(
  framework: FrameworkId,
  datasetType: DatasetType,
  over: Partial<ExportOptions> = {},
  model: ModelInfo | undefined = QWEN,
): ExportBundle {
  return buildExportBundle(
    examplesFor(datasetType),
    makeOptions({ framework, datasetType, ...over }),
    model,
  );
}

function fileContent(bundle: ExportBundle, path: string): string {
  const file = bundle.files.find((f) => f.path === path);
  expect(file, `expected bundle file "${path}"`).toBeDefined();
  expect(typeof file?.content).toBe('string');
  return file?.content as string;
}

/** Parse every JSONL line — throws (failing the test) on any malformed line. */
function rows(bundle: ExportBundle, path = 'data/train.jsonl'): Row[] {
  return fileContent(bundle, path)
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Row);
}

// ---------------------------------------------------------------------------
// Support matrix: every supported framework × dataset-type combo
// ---------------------------------------------------------------------------

const SUPPORTED: [FrameworkId, DatasetType[]][] = [
  ['jsonl', ['sft', 'preference', 'kto', 'rl']],
  ['axolotl', ['sft', 'preference', 'kto', 'rl']],
  ['trl', ['sft', 'preference', 'kto', 'rl']],
  ['llama-factory', ['sft', 'preference', 'kto']],
  ['ms-swift', ['sft', 'preference', 'kto', 'rl']],
  ['unsloth', ['sft', 'preference', 'kto', 'rl']],
  ['openai-ft', ['sft', 'preference']],
  ['alpaca', ['sft', 'preference']],
  ['sharegpt', ['sft']],
];

describe('support matrix', () => {
  for (const [framework, types] of SUPPORTED) {
    for (const type of types) {
      it(`${framework} × ${type}: bundles with parseable JSONL, README and metadata`, () => {
        const examples = examplesFor(type);
        const bundle = bundleFor(framework, type);

        expect(isExportSupported(framework, type)).toBe(true);
        const data = rows(bundle); // every line JSON.parses
        expect(data).toHaveLength(examples.length);
        expect(fileContent(bundle, 'data/train.jsonl').endsWith('\n')).toBe(true);

        expect(fileContent(bundle, 'README.md')).toContain('DataForge Studio v2');
        const metadata = JSON.parse(fileContent(bundle, 'metadata.json')) as Row;
        expect(metadata['generator']).toBe('DataForge Studio v2');
        expect(metadata['options']['framework']).toBe(framework);
        expect(metadata['options']['datasetType']).toBe(type);
        expect(metadata['examples']['exported']).toBe(examples.length);
        expect(metadata['files']).toContain('metadata.json');
        expect(bundle.summary).toContain(`${examples.length} ${type}`);
      });
    }
  }

  for (const [framework, types] of SUPPORTED) {
    for (const type of DATASET_TYPES.filter((t) => !types.includes(t))) {
      it(`${framework} × ${type}: throws UnsupportedExportError`, () => {
        expect(isExportSupported(framework, type)).toBe(false);
        expect(unsupportedDatasetTypes(framework)).toContain(type);
        try {
          bundleFor(framework, type);
          expect.unreachable('expected buildExportBundle to throw');
        } catch (error) {
          expect(error).toBeInstanceOf(UnsupportedExportError);
          const e = error as UnsupportedExportError;
          expect(e.framework).toBe(framework);
          expect(e.datasetType).toBe(type);
          expect(e.message).toContain(type);
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Canonical JSONL
// ---------------------------------------------------------------------------

describe('jsonl (canonical)', () => {
  it('keeps preference / kto / rl structural columns', () => {
    const pref = rows(bundleFor('jsonl', 'preference'))[0]!;
    expect(pref['messages'].map((m: Row) => m['role'])).toEqual(['system', 'user']);
    expect(pref['chosen'][0]['role']).toBe('assistant');
    expect(pref['rejected'][0]['content']).toBe('8');

    const kto = rows(bundleFor('jsonl', 'kto'));
    expect(kto[0]!['completion'][0]['content']).toBe('Hi!');
    expect(kto[0]!['label']).toBe(true);
    expect(kto[1]!['label']).toBe(false);

    const rl = rows(bundleFor('jsonl', 'rl'))[0]!;
    expect(rl['answer']).toBe('4');
    expect(rl['messages'][0]['role']).toBe('user');
  });

  it('wraps tool calls in the OpenAI shape with string arguments', () => {
    const row = rows(bundleFor('jsonl', 'sft'))[1]!;
    const call = row['messages'][1]['tool_calls'][0];
    expect(call['type']).toBe('function');
    expect(call['function']['name']).toBe('get_weather');
    expect(JSON.parse(call['function']['arguments'])).toEqual({ city: 'Paris' });
    expect(row['messages'][2]['tool_call_id']).toBe('call_1');
    expect(row['messages'][2]['name']).toBe('get_weather');
    expect(row['tools'][0]['type']).toBe('function');
    expect(row['tools'][0]['function']['name']).toBe('get_weather');
  });

  it('passes the loss weight through on assistant turns', () => {
    const data = rows(bundleFor('jsonl', 'sft'));
    expect(data[0]!['messages'][2]['weight']).toBe(1);
    expect(data[1]!['messages'][3]['weight']).toBe(0);
    expect(data[0]!['messages'][1]['weight']).toBeUndefined();
  });

  it('drops system turns when includeSystem is off', () => {
    const row = rows(bundleFor('jsonl', 'sft', { includeSystem: false }))[0]!;
    expect(row['messages'].map((m: Row) => m['role'])).toEqual(['user', 'assistant']);
  });
});

// ---------------------------------------------------------------------------
// Reasoning rendering
// ---------------------------------------------------------------------------

describe('reasoning rendering', () => {
  it('inlines <think> blocks for chatml models', () => {
    const row = rows(bundleFor('jsonl', 'sft'))[0]!;
    const content = row['messages'][2]['content'] as string;
    expect(content).toContain('<think>\nSimple arithmetic.\n</think>');
    expect(content).toContain('It is 4.');
    expect(row['messages'][2]['thinking']).toBeUndefined();
  });

  it('uses bracket tokens for mistral-tekken models', () => {
    const row = rows(bundleFor('jsonl', 'sft', {}, MAGISTRAL))[0]!;
    expect(row['messages'][2]['content']).toBe('[THINK]Simple arithmetic.[/THINK]It is 4.');
  });

  it('emits a separate thinking field for harmony models', () => {
    const row = rows(bundleFor('jsonl', 'sft', {}, GPT_OSS))[0]!;
    expect(row['messages'][2]['thinking']).toBe('Simple arithmetic.');
    expect(row['messages'][2]['content']).toBe('It is 4.');
  });

  it('strips all traces when includeReasoning is off', () => {
    const bundle = bundleFor('jsonl', 'sft', { includeReasoning: false });
    expect(fileContent(bundle, 'data/train.jsonl')).not.toContain('Simple arithmetic.');
  });

  it('keeps only the final assistant trace when stripPriorThinking is on', () => {
    const multi = createExample({
      projectId: PROJECT,
      type: 'sft',
      messages: [
        { role: 'user', content: 'U1' },
        { role: 'assistant', content: 'A1', reasoning: 'R1' },
        { role: 'user', content: 'U2' },
        { role: 'assistant', content: 'A2', reasoning: 'R2' },
      ],
    });
    const bundle = buildExportBundle(
      [multi],
      makeOptions({ framework: 'jsonl', stripPriorThinking: true }),
      QWEN,
    );
    const messages = rows(bundle)[0]!['messages'] as Row[];
    expect(messages[1]!['content']).toBe('A1');
    expect(messages[3]!['content']).toContain('R2');
  });

  it('treats preference prompts as having no final turn for stripPriorThinking', () => {
    const ex = createExample({
      projectId: PROJECT,
      type: 'preference',
      messages: [
        { role: 'user', content: 'U1' },
        { role: 'assistant', content: 'A1', reasoning: 'prompt trace' },
        { role: 'user', content: 'U2' },
      ],
      chosen: [{ role: 'assistant', content: 'good', reasoning: 'chosen trace' }],
      rejected: [{ role: 'assistant', content: 'bad' }],
    });
    const bundle = buildExportBundle(
      [ex],
      makeOptions({ framework: 'jsonl', datasetType: 'preference', stripPriorThinking: true }),
      QWEN,
    );
    const row = rows(bundle)[0]!;
    expect(row['messages'][1]['content']).toBe('A1'); // prompt trace stripped
    expect(row['chosen'][0]['content']).toContain('chosen trace');
  });
});

// ---------------------------------------------------------------------------
// Axolotl
// ---------------------------------------------------------------------------

describe('axolotl', () => {
  it('emits a parseable axolotl.yaml with base_model = hfId', () => {
    const config = parseYaml(fileContent(bundleFor('axolotl', 'sft'), 'axolotl.yaml')) as Row;
    expect(config['base_model']).toBe(QWEN.hfId);
    expect(config['adapter']).toBe('qlora');
    expect(config['datasets'][0]['path']).toBe('./data/train.jsonl');
    expect(config['datasets'][0]['type']).toBe('chat_template');
    expect(config['sequence_len']).toBe(QWEN.recommendedSeqLen);
    expect(config['chat_template']).toBe('tokenizer_default');
  });

  it('maps dataset types to rl stages with the right user_defined fields', () => {
    const dpo = parseYaml(fileContent(bundleFor('axolotl', 'preference'), 'axolotl.yaml')) as Row;
    expect(dpo['rl']).toBe('dpo');
    expect(dpo['datasets'][0]['field_chosen']).toBe('chosen');

    const kto = parseYaml(fileContent(bundleFor('axolotl', 'kto'), 'axolotl.yaml')) as Row;
    expect(kto['rl']).toBe('kto');
    expect(kto['datasets'][0]['field_label']).toBe('label');

    const grpo = parseYaml(fileContent(bundleFor('axolotl', 'rl'), 'axolotl.yaml')) as Row;
    expect(grpo['rl']).toBe('grpo');
  });

  it('flattens preference / kto / rl rows to text columns', () => {
    const pref = rows(bundleFor('axolotl', 'preference'))[0]!;
    expect(typeof pref['prompt']).toBe('string');
    expect(pref['prompt']).toContain('Name a prime.');
    expect(pref['chosen']).toContain('7');
    expect(pref['chosen']).toContain('<think>'); // reasoning survives inline
    expect(pref['rejected']).toContain('8');

    const kto = rows(bundleFor('axolotl', 'kto'));
    expect(kto[1]!['label']).toBe(false);
    expect(kto[0]!['completion']).toBe('Hi!');

    const rl = rows(bundleFor('axolotl', 'rl'))[0]!;
    expect(rl['answer']).toBe('4');
  });

  it('wires validation split files as test_datasets for SFT', () => {
    const examples = [
      ...sftExamples(),
      createExample({
        projectId: PROJECT,
        type: 'sft',
        split: 'validation',
        messages: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello!' },
        ],
      }),
    ];
    const bundle = buildExportBundle(
      examples,
      makeOptions({ framework: 'axolotl', splitFiles: true }),
      QWEN,
    );
    const config = parseYaml(fileContent(bundle, 'axolotl.yaml')) as Row;
    expect(config['test_datasets'][0]['path']).toBe('./data/validation.jsonl');
    expect(config['val_set_size']).toBe(0);
    expect(rows(bundle, 'data/validation.jsonl')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// TRL
// ---------------------------------------------------------------------------

describe('trl', () => {
  it('emits column-typed conversational rows', () => {
    const pref = rows(bundleFor('trl', 'preference'))[0]!;
    expect(Array.isArray(pref['prompt'])).toBe(true);
    expect(pref['chosen'][0]['role']).toBe('assistant');
    expect(pref['rejected'][0]['content']).toBe('8');

    const kto = rows(bundleFor('trl', 'kto'));
    expect(kto[0]!['completion'][0]['content']).toBe('Hi!');
    expect(kto[1]!['label']).toBe(false);

    const rl = rows(bundleFor('trl', 'rl'))[0]!;
    expect(rl['answer']).toBe('4');
  });

  it('generates train.py with the matching trainer and model id', () => {
    const sft = fileContent(bundleFor('trl', 'sft'), 'train.py');
    expect(sft).toContain(`MODEL_ID = "${QWEN.hfId}"`);
    expect(sft).toContain('SFTTrainer');
    expect(fileContent(bundleFor('trl', 'preference'), 'train.py')).toContain('DPOTrainer');
    expect(fileContent(bundleFor('trl', 'kto'), 'train.py')).toContain('trl.experimental.kto');
    const rl = fileContent(bundleFor('trl', 'rl'), 'train.py');
    expect(rl).toContain('GRPOTrainer');
    expect(rl).toContain('reward_exact_answer');
  });
});

// ---------------------------------------------------------------------------
// LLaMA-Factory
// ---------------------------------------------------------------------------

describe('llama-factory', () => {
  it('emits dataset_info.json with the sharegpt tags block', () => {
    const info = JSON.parse(
      fileContent(bundleFor('llama-factory', 'sft'), 'dataset_info.json'),
    ) as Row;
    const entry = info['my_project'];
    expect(entry).toBeDefined();
    expect(entry['file_name']).toBe('data/train.jsonl');
    expect(entry['formatting']).toBe('sharegpt');
    expect(entry['columns']['messages']).toBe('messages');
    expect(entry['columns']['tools']).toBe('tools'); // tool example present
    expect(entry['tags']['role_tag']).toBe('role');
    expect(entry['tags']['function_tag']).toBe('function_call');
    expect(entry['tags']['observation_tag']).toBe('tool');
  });

  it('marks preference entries as ranking and kto entries with kto_tag', () => {
    const pref = JSON.parse(
      fileContent(bundleFor('llama-factory', 'preference'), 'dataset_info.json'),
    ) as Row;
    expect(pref['my_project']['ranking']).toBe(true);
    expect(pref['my_project']['columns']['chosen']).toBe('chosen');

    const kto = JSON.parse(
      fileContent(bundleFor('llama-factory', 'kto'), 'dataset_info.json'),
    ) as Row;
    expect(kto['my_project']['columns']['kto_tag']).toBe('label');
  });

  it('adds per-split dataset_info entries when split files are emitted', () => {
    const examples = [
      ...sftExamples(),
      createExample({
        projectId: PROJECT,
        type: 'sft',
        split: 'validation',
        messages: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello!' },
        ],
      }),
    ];
    const bundle = buildExportBundle(
      examples,
      makeOptions({ framework: 'llama-factory', splitFiles: true }),
      QWEN,
    );
    const info = JSON.parse(fileContent(bundle, 'dataset_info.json')) as Row;
    expect(info['my_project']['file_name']).toBe('data/train.jsonl');
    expect(info['my_project_validation']['file_name']).toBe('data/validation.jsonl');
    const yaml = parseYaml(fileContent(bundle, 'llamafactory.yaml')) as Row;
    expect(yaml['eval_dataset']).toBe('my_project_validation');
  });

  it('emits llamafactory.yaml with model_name_or_path = hfId and stage mapping', () => {
    const sft = parseYaml(fileContent(bundleFor('llama-factory', 'sft'), 'llamafactory.yaml')) as Row;
    expect(sft['model_name_or_path']).toBe(QWEN.hfId);
    expect(sft['stage']).toBe('sft');
    expect(sft['template']).toBe('qwen');
    expect(sft['dataset']).toBe('my_project');

    const dpo = parseYaml(
      fileContent(bundleFor('llama-factory', 'preference'), 'llamafactory.yaml'),
    ) as Row;
    expect(dpo['stage']).toBe('dpo');
    expect(dpo['pref_beta']).toBe(0.1);

    const kto = parseYaml(fileContent(bundleFor('llama-factory', 'kto'), 'llamafactory.yaml')) as Row;
    expect(kto['stage']).toBe('kto');
  });

  it('renders tool calls as function_call turns and tools as a JSON string', () => {
    const row = rows(bundleFor('llama-factory', 'sft'))[1]!;
    const roles = row['messages'].map((m: Row) => m['role']);
    expect(roles).toEqual(['user', 'function_call', 'tool', 'assistant']);
    const call = JSON.parse(row['messages'][1]['content']) as Row;
    expect(call['name']).toBe('get_weather');
    expect(call['arguments']).toEqual({ city: 'Paris' });
    const tools = JSON.parse(row['tools']) as Row[];
    expect(tools[0]!['name']).toBe('get_weather');
  });

  it('shapes preference and kto rows per the sharegpt spec', () => {
    const pref = rows(bundleFor('llama-factory', 'preference'))[0]!;
    expect(pref['chosen']['role']).toBe('assistant');
    expect(pref['chosen']['content']).toContain('7');
    expect(pref['rejected']['content']).toBe('8');

    const kto = rows(bundleFor('llama-factory', 'kto'));
    const lastTurn = kto[0]!['messages'].at(-1) as Row;
    expect(lastTurn['role']).toBe('assistant');
    expect(lastTurn['content']).toBe('Hi!');
    expect(kto[1]!['label']).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MS-SWIFT
// ---------------------------------------------------------------------------

describe('ms-swift', () => {
  it('inlines chosen into messages with a flat rejected_response', () => {
    const row = rows(bundleFor('ms-swift', 'preference'))[0]!;
    const last = row['messages'].at(-1) as Row;
    expect(last['role']).toBe('assistant');
    expect(last['content']).toContain('7');
    expect(row['rejected_response']).toBe('8');
  });

  it('appends kto completions to messages and keeps rl solutions', () => {
    const kto = rows(bundleFor('ms-swift', 'kto'));
    expect((kto[0]!['messages'].at(-1) as Row)['content']).toBe('Hi!');
    expect(kto[1]!['label']).toBe(false);

    const rl = rows(bundleFor('ms-swift', 'rl'))[0]!;
    expect(rl['solution']).toBe('4');
    expect((rl['messages'].at(-1) as Row)['role']).toBe('user');
  });

  it('always uses <think> tags regardless of the model delimiters', () => {
    const row = rows(bundleFor('ms-swift', 'sft', {}, MAGISTRAL))[0]!;
    const content = row['messages'][2]['content'] as string;
    expect(content).toContain('<think>');
    expect(content).not.toContain('[THINK]');
  });

  it('serializes tools as a JSON string field', () => {
    const row = rows(bundleFor('ms-swift', 'sft'))[1]!;
    expect(typeof row['tools']).toBe('string');
    expect((JSON.parse(row['tools']) as Row[])[0]!['name']).toBe('get_weather');
  });
});

// ---------------------------------------------------------------------------
// Unsloth
// ---------------------------------------------------------------------------

describe('unsloth', () => {
  it('emits the same data rows as TRL', () => {
    for (const type of DATASET_TYPES) {
      expect(fileContent(bundleFor('unsloth', type), 'data/train.jsonl')).toBe(
        fileContent(bundleFor('trl', type), 'data/train.jsonl'),
      );
    }
  });

  it('generates a FastLanguageModel train.py pinned to the model', () => {
    const script = fileContent(bundleFor('unsloth', 'sft'), 'train.py');
    expect(script).toContain('FastLanguageModel.from_pretrained');
    expect(script).toContain(`model_name="${QWEN.hfId}"`);
    expect(script).toContain('SFTTrainer');
    expect(fileContent(bundleFor('unsloth', 'rl'), 'train.py')).toContain('GRPOTrainer');
  });
});

// ---------------------------------------------------------------------------
// OpenAI fine-tuning
// ---------------------------------------------------------------------------

describe('openai-ft', () => {
  it('emits the supervised chat shape with tools and parallel_tool_calls', () => {
    const data = rows(bundleFor('openai-ft', 'sft'));
    expect(data[0]!['messages'][2]['weight']).toBe(1); // weight passthrough
    const toolRow = data[1]!;
    expect(toolRow['tools'][0]['function']['name']).toBe('get_weather');
    expect(toolRow['parallel_tool_calls']).toBe(false); // single-call data
    expect(toolRow['messages'][1]['tool_calls'][0]['type']).toBe('function');
    expect(data[0]!['parallel_tool_calls']).toBeUndefined(); // no tools declared
  });

  it('never emits a thinking field, even for harmony targets', () => {
    const row = rows(bundleFor('openai-ft', 'sft', {}, GPT_OSS))[0]!;
    expect(row['messages'][2]['thinking']).toBeUndefined();
    expect(row['messages'][2]['content']).toContain('<think>');
  });

  it('emits the DPO preference shape', () => {
    const row = rows(bundleFor('openai-ft', 'preference'))[0]!;
    expect(row['input']['messages'].map((m: Row) => m['role'])).toEqual(['system', 'user']);
    expect(row['preferred_output']).toHaveLength(1);
    expect(row['preferred_output'][0]['role']).toBe('assistant');
    expect(row['preferred_output'][0]['content']).toContain('7');
    expect(row['preferred_output'][0]['content']).toContain('<think>'); // inline reasoning
    expect(row['non_preferred_output'][0]['content']).toBe('8');
  });

  it('strips loss weights from non-assistant messages in sft rows', () => {
    const ex = createExample({
      projectId: PROJECT,
      type: 'sft',
      messages: [
        { role: 'system', content: 'S', weight: 0 },
        { role: 'user', content: 'Q', weight: 0 },
        { role: 'assistant', content: 'A', weight: 0 },
      ],
    });
    const bundle = buildExportBundle(
      [ex],
      makeOptions({ framework: 'openai-ft', datasetType: 'sft' }),
      QWEN,
    );
    const messages = rows(bundle)[0]!['messages'] as Row[];
    expect(messages[0]!['weight']).toBeUndefined();
    expect(messages[1]!['weight']).toBeUndefined();
    expect(messages[2]!['weight']).toBe(0); // assistant weight survives
  });

  it('strips loss weights from preference rows', () => {
    const ex = createExample({
      projectId: PROJECT,
      type: 'preference',
      messages: [{ role: 'user', content: 'Q', weight: 0 }],
      chosen: [{ role: 'assistant', content: 'good', weight: 1 }],
      rejected: [{ role: 'assistant', content: 'bad', weight: 0 }],
    });
    const bundle = buildExportBundle(
      [ex],
      makeOptions({ framework: 'openai-ft', datasetType: 'preference' }),
      QWEN,
    );
    const row = rows(bundle)[0]!;
    expect(JSON.stringify(row)).not.toContain('"weight"');
  });

  it('takes the LAST assistant turn of multi-message continuations', () => {
    const ex = createExample({
      projectId: PROJECT,
      type: 'preference',
      messages: [{ role: 'user', content: 'Q' }],
      chosen: [
        { role: 'assistant', content: 'draft' },
        { role: 'assistant', content: 'final answer' },
      ],
      rejected: [{ role: 'assistant', content: 'bad' }],
    });
    const bundle = buildExportBundle(
      [ex],
      makeOptions({ framework: 'openai-ft', datasetType: 'preference' }),
      QWEN,
    );
    expect(rows(bundle)[0]!['preferred_output'][0]['content']).toBe('final answer');
  });

  it('throws UnsupportedExportError from the row builder for kto and rl', () => {
    for (const type of ['kto', 'rl'] as const) {
      expect(() =>
        buildOpenAiFtRows(examplesFor(type), {
          options: makeOptions({ framework: 'openai-ft', datasetType: type }),
          model: QWEN,
        }),
      ).toThrow(UnsupportedExportError);
    }
  });
});

// ---------------------------------------------------------------------------
// Legacy formats
// ---------------------------------------------------------------------------

describe('legacy alpaca / sharegpt', () => {
  it('flattens sft to instruction/output and preference to the chosen answer', () => {
    const sft = rows(bundleFor('alpaca', 'sft'))[0]!;
    expect(sft['system']).toBe('You are helpful.');
    expect(sft['instruction']).toBe('What is 2+2?');
    expect(sft['output']).toContain('It is 4.');

    const pref = rows(bundleFor('alpaca', 'preference'))[0]!;
    expect(pref['output']).toContain('7');
  });

  it('maps sharegpt speakers from canonical roles', () => {
    const row = rows(bundleFor('sharegpt', 'sft'))[0]!;
    const speakers = row['conversations'].map((t: Row) => t['from']);
    expect(speakers).toEqual(['system', 'human', 'gpt']);
  });
});

// ---------------------------------------------------------------------------
// Split files, filtering and metadata
// ---------------------------------------------------------------------------

describe('split grouping and metadata', () => {
  const mixedSplits = (): Example[] => [
    ...sftExamples(), // 2 × train
    createExample({
      projectId: PROJECT,
      type: 'sft',
      split: 'validation',
      messages: [
        { role: 'user', content: 'V' },
        { role: 'assistant', content: 'v' },
      ],
    }),
    createExample({
      projectId: PROJECT,
      type: 'sft',
      split: 'test',
      messages: [
        { role: 'user', content: 'T' },
        { role: 'assistant', content: 't' },
      ],
    }),
  ];

  it('emits one data file per non-empty split when splitFiles is on', () => {
    const bundle = buildExportBundle(mixedSplits(), makeOptions({ splitFiles: true }), QWEN);
    expect(rows(bundle, 'data/train.jsonl')).toHaveLength(2);
    expect(rows(bundle, 'data/validation.jsonl')).toHaveLength(1);
    expect(rows(bundle, 'data/test.jsonl')).toHaveLength(1);
  });

  it('merges every split into data/train.jsonl when splitFiles is off', () => {
    const bundle = buildExportBundle(mixedSplits(), makeOptions({ splitFiles: false }), QWEN);
    expect(rows(bundle, 'data/train.jsonl')).toHaveLength(4);
    expect(bundle.files.some((f) => f.path === 'data/validation.jsonl')).toBe(false);
  });

  it('always emits data/train.jsonl, even when train is empty', () => {
    const onlyValidation = [
      createExample({
        projectId: PROJECT,
        type: 'sft',
        split: 'validation',
        messages: [
          { role: 'user', content: 'V' },
          { role: 'assistant', content: 'v' },
        ],
      }),
    ];
    const bundle = buildExportBundle(onlyValidation, makeOptions({ splitFiles: true }), QWEN);
    expect(fileContent(bundle, 'data/train.jsonl')).toBe('');
    expect(rows(bundle, 'data/validation.jsonl')).toHaveLength(1);
  });

  it('exports only examples matching the dataset type and records both counts', () => {
    const mixed = [...sftExamples(), ...preferenceExamples()];
    const bundle = buildExportBundle(mixed, makeOptions({ framework: 'jsonl' }), QWEN);
    expect(rows(bundle)).toHaveLength(2);
    const metadata = JSON.parse(fileContent(bundle, 'metadata.json')) as Row;
    expect(metadata['examples']['provided']).toBe(3);
    expect(metadata['examples']['exported']).toBe(2);
    expect(metadata['examples']['byType']).toEqual({ sft: 2, preference: 1 });
    expect(metadata['examples']['bySplit']).toEqual({ train: 2 });
    expect(metadata['model']).toEqual({ id: QWEN.id, hfId: QWEN.hfId, name: QWEN.name });
  });
});

// ---------------------------------------------------------------------------
// Zip round-trip
// ---------------------------------------------------------------------------

describe('bundleToZip', () => {
  it('round-trips every file through fflate unzipSync', () => {
    const examples = [
      ...sftExamples(),
      createExample({
        projectId: PROJECT,
        type: 'sft',
        split: 'validation',
        messages: [
          { role: 'user', content: 'V' },
          { role: 'assistant', content: 'v' },
        ],
      }),
    ];
    const bundle = buildExportBundle(
      examples,
      makeOptions({ framework: 'axolotl', splitFiles: true }),
      QWEN,
    );
    const unzipped = unzipSync(bundleToZip(bundle));
    expect(Object.keys(unzipped).sort()).toEqual(bundle.files.map((f) => f.path).sort());
    for (const file of bundle.files) {
      expect(strFromU8(unzipped[file.path]!)).toBe(file.content as string);
    }
  });
});

// ---------------------------------------------------------------------------
// README
// ---------------------------------------------------------------------------

describe('readme', () => {
  it('pins the documented framework versions and commands', () => {
    const cases: [FrameworkId, DatasetType, string[]][] = [
      ['jsonl', 'sft', ['load_dataset', 'data/train.jsonl']],
      ['axolotl', 'sft', ['Axolotl 0.17', 'axolotl train axolotl.yaml']],
      ['trl', 'sft', ['trl==1.5.1', 'python train.py', 'SFTTrainer']],
      ['llama-factory', 'sft', ['LLaMA-Factory 0.9.5', 'llamafactory-cli train llamafactory.yaml']],
      ['ms-swift', 'sft', ['ms-swift==4.3', 'swift sft', `--model ${QWEN.hfId}`]],
      ['ms-swift', 'preference', ['swift rlhf --rlhf_type dpo']],
      ['unsloth', 'sft', ['unsloth==2026.6', 'python train.py']],
      ['openai-ft', 'sft', ['files.create', 'fine_tuning.jobs.create', 'purpose="fine-tune"']],
      ['openai-ft', 'preference', ['"type": "dpo"']],
      ['alpaca', 'sft', ['Alpaca']],
      ['sharegpt', 'sft', ['ShareGPT']],
    ];
    for (const [framework, type, needles] of cases) {
      const readme = fileContent(bundleFor(framework, type), 'README.md');
      for (const needle of needles) {
        expect(readme, `${framework} README should mention "${needle}"`).toContain(needle);
      }
    }
  });

  it('mentions dataset stats, the target model and provenance', () => {
    const readme = fileContent(bundleFor('trl', 'sft'), 'README.md');
    expect(readme).toContain('**Examples:** 2');
    expect(readme).toContain(QWEN.hfId);
    expect(readme).toContain('DataForge Studio v2');
    expect(readme).toContain('My Project');
  });

  it('describes the reasoning policy per target model', () => {
    expect(buildReadme('jsonl', makeOptions(), GPT_OSS)).toContain('harmony');
    expect(buildReadme('jsonl', makeOptions(), MAGISTRAL)).toContain('[THINK]');
    expect(buildReadme('jsonl', makeOptions({ includeReasoning: false }), QWEN)).toContain(
      'stripped at export',
    );
  });

  it('adds the validation upload to the OpenAI snippet when a validation split exists', () => {
    const examples = [
      ...sftExamples(),
      createExample({
        projectId: PROJECT,
        type: 'sft',
        split: 'validation',
        messages: [
          { role: 'user', content: 'V' },
          { role: 'assistant', content: 'v' },
        ],
      }),
    ];
    const bundle = buildExportBundle(
      examples,
      makeOptions({ framework: 'openai-ft', splitFiles: true }),
      QWEN,
    );
    const readme = fileContent(bundle, 'README.md');
    expect(readme).toContain('data/validation.jsonl');
    expect(readme).toContain('validation_file=validation_file.id');
  });

  it('omits the validation upload when splitFiles is off, even with validation examples', () => {
    const examples = [
      ...sftExamples(),
      createExample({
        projectId: PROJECT,
        type: 'sft',
        split: 'validation',
        messages: [
          { role: 'user', content: 'V' },
          { role: 'assistant', content: 'v' },
        ],
      }),
    ];
    const bundle = buildExportBundle(
      examples,
      makeOptions({ framework: 'openai-ft', splitFiles: false }),
      QWEN,
    );
    const readme = fileContent(bundle, 'README.md');
    expect(readme).not.toContain('data/validation.jsonl');
    expect(readme).not.toContain('validation_file');
  });
});
