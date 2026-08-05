import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chat, chatJson } from '../src/modelClient.js';

const EP = { baseUrl: 'http://fake/v1', model: 'm', reasoningEffort: 'low' };
const okBody = (content, extra = {}) => JSON.stringify({ choices: [{ message: { role: 'assistant', content, reasoning_content: null, tool_calls: null } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 2 } }, ...extra });

beforeEach(() => { vi.restoreAllMocks(); });

describe('chat', () => {
  it('posts correct body and normalizes response', async () => {
    const seen = [];
    globalThis.fetch = vi.fn(async (url, opts) => { seen.push({ url, opts }); return { ok: true, status: 200, text: async () => okBody('hello') }; });
    const r = await chat(EP, { messages: [{ role: 'user', content: 'hi' }], apiKey: 'k' });
    expect(r.content).toBe('hello');
    expect(r.usage).toEqual({ prompt: 10, completion: 5, total: 15, cached: 2 });
    const req = JSON.parse(seen[0].opts.body);
    expect(req.model).toBe('m');
    expect(req.reasoning_effort).toBe('low');
    expect(seen[0].url).toBe('http://fake/v1/chat/completions');
    expect(seen[0].opts.headers.Authorization).toBe('Bearer k');
  });
  it('retries on 500 then succeeds', async () => {
    let n = 0;
    globalThis.fetch = vi.fn(async () => (++n === 1) ? { ok: false, status: 500, text: async () => 'boom' } : { ok: true, status: 200, text: async () => okBody('ok') });
    const r = await chat(EP, { messages: [], apiKey: 'k', retryDelaysMs: [1] });
    expect(n).toBe(2);
    expect(r.content).toBe('ok');
  });
  it('throws after exhausting retries', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 429, text: async () => 'rate' }));
    await expect(chat(EP, { messages: [], apiKey: 'k', retryDelaysMs: [1, 1] })).rejects.toThrow(/429/);
  });
});

describe('chatJson', () => {
  const jsonFormat = { type: 'json_object' };
  it('parses JSON and validates', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => okBody('{"a":1}') }));
    const r = await chatJson(EP, { messages: [], jsonFormat, validate: (o) => { if (typeof o.a !== 'number') throw new Error('a missing'); return o; }, apiKey: 'k' });
    expect(r.value).toEqual({ a: 1 });
    expect(r.attempts).toBe(1);
  });
  it('repairs once on invalid JSON then succeeds', async () => {
    let n = 0;
    globalThis.fetch = vi.fn(async () => { n++; return { ok: true, status: 200, text: async () => okBody(n === 1 ? 'not json' : '{"a":2}') }; });
    const r = await chatJson(EP, { messages: [{ role: 'user', content: 'x' }], jsonFormat, validate: (o) => o, apiKey: 'k', retryDelaysMs: [] });
    expect(r.value.a).toBe(2);
    expect(r.attempts).toBe(2);
    expect(n).toBe(2);
  });
});
