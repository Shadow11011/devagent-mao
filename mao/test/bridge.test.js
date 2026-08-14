import { describe, it, expect } from 'vitest';
import {
  createAgentSession,
  runFauxTurn,
  registerFauxProvider,
  fauxAssistantMessage,
} from '../src/bridge.js';

// This is the Phase A proof gate: the vendored Prime Agent must import in-process
// and drive one headless turn through the faux provider (no real API, no IPython
// kernel, no TUI). Sequential because the vendored import is cold-heavy and must
// not contend with the rest of the suite's transform/import phase.
describe.sequential('Prime Agent bridge (in-process)', () => {
  it('imports createAgentSession and registerFauxProvider', async () => {
    expect(typeof createAgentSession).toBe('function');
    expect(typeof registerFauxProvider).toBe('function');
  });

  it('drives one headless turn and returns assistant text', { timeout: 90000 }, async () => {
    const faux = await registerFauxProvider({
      provider: 'mao-bridge-test',
      models: [
        {
          id: 'test-model',
          name: 'Test Model',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 16384,
        },
      ],
      tokensPerSecond: 0,
    });
    // A response factory returns a fresh message on every provider call, which is
    // the robust pattern: the session makes several internal calls and a single
    // fixed response gets consumed by an early internal call rather than the turn.
    faux.setResponses([() => fauxAssistantMessage('hello from prime agent')]);

    try {
      const { text } = await runFauxTurn(faux, { prompt: 'say hello', modelId: 'test-model' });
      expect(text).toContain('hello from prime agent');
    } finally {
      faux.unregister();
    }
  });

  it('runFauxTurn returns the final assistant text', { timeout: 90000 }, async () => {
    const faux = await registerFauxProvider({
      provider: 'mao-bridge-turn',
      models: [
        {
          id: 'turn-model',
          name: 'Turn Model',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 16384,
        },
      ],
      tokensPerSecond: 0,
    });
    faux.setResponses([() => fauxAssistantMessage('turn complete')]);

    try {
      const { text } = await runFauxTurn(faux, { prompt: 'run', modelId: 'turn-model' });
      expect(text).toContain('turn complete');
    } finally {
      faux.unregister();
    }
  });
});
