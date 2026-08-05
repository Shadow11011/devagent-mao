import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('returns modal endpoints and defaults', () => {
    const c = loadConfig();
    expect(c.models.orchestrator.model).toBe('moonshotai/Kimi-K3');
    expect(c.models.worker.model).toBe('thinkingmachines/Inkling-NVFP4');
    expect(c.models.orchestrator.baseUrl).toContain('kimi-k3-server');
    expect(c.models.worker.baseUrl).toContain('inkling-nvfp4-server');
    expect(c.concurrency).toBe(2);
    expect(c.maxWorkerAttempts).toBe(3);
    expect(c.maxVerifyFixes).toBe(2);
    expect(c.workerProfiles).toEqual({ worker: 'inkling', orchestrator: 'kimi-k3' });
  });
  it('applies overrides shallowly on top level', () => {
    const c = loadConfig({ concurrency: 4, workerBin: '/x/mao' });
    expect(c.concurrency).toBe(4);
    expect(c.workerBin).toBe('/x/mao');
    expect(c.models.worker.reasoningEffort).toBe('low');
  });
});
