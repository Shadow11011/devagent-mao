import { chatJson } from './modelClient.js';
import { loadPrompt, renderPrompt } from './prompts.js';

export const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    failureClass: { type: ['string', 'null'], enum: ['syntax', 'logic', 'scope', 'model', 'infra', null] },
    reason: { type: 'string' },
    lesson: { type: ['string', 'null'] },
  },
  required: ['verdict', 'reason'],
  additionalProperties: false,
};
export const JUDGE_JSON_FORMAT = { type: 'json_schema', json_schema: { name: 'judge', strict: true, schema: JUDGE_SCHEMA } };

export async function judgeFeature(cfg, { feature, diffInfo, gateLog, summary }) {
  const system = renderPrompt(loadPrompt('judge.v2'), {
    FEATURE_DESCRIPTION: feature.description,
    WORKER_SUMMARY: summary || '(none)',
    DIFF: `${gateLog}\n\n${diffInfo.diff || '(empty diff)'}`.slice(0, 60_000),
  });
  const r = await chatJson(cfg.models.orchestrator, {
    messages: [{ role: 'system', content: system }],
    jsonFormat: JUDGE_JSON_FORMAT,
    validate: (o) => {
      if (o.verdict !== 'pass' && o.verdict !== 'fail') throw new Error(`bad verdict ${o.verdict}`);
      if (o.verdict === 'fail' && !o.lesson) throw new Error('fail verdict requires lesson');
      return o;
    },
    apiKey: cfg.apiKey, timeoutMs: cfg.requestTimeoutMs,
  });
  return { ...r.value, usage: r.usage };
}
