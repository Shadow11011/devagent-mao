import path from 'node:path';

const K3_BASE = 'https://oluwafemifrancisca27--ep-kimi-k3-server.us-west.modal.direct/v1';
const INKLING_BASE = 'https://oluwafemifrancisca27--ep-inkling-nvfp4-server.us-west.modal.direct/v1';

export function loadConfig(overrides = {}) {
  return {
    apiKey: process.env.MODAL_PROXY_TOKEN || '',
    models: {
      orchestrator: { baseUrl: K3_BASE, model: 'moonshotai/Kimi-K3', reasoningEffort: 'low' },
      worker: { baseUrl: INKLING_BASE, model: 'thinkingmachines/Inkling-NVFP4', reasoningEffort: 'low' },
    },
    workerBin: process.env.MAO_WORKER_BIN || '/root/devagent-mao/agent/target/release/mao',
    workerProfiles: { worker: 'inkling', orchestrator: 'kimi-k3' },
    concurrency: Number(process.env.MAO_CONCURRENCY || 2),
    maxWorkerAttempts: 3,
    maxVerifyFixes: 2,
    dataDir: process.env.MAO_DATA_DIR || path.resolve(process.cwd(), 'data'),
    runTimeoutMs: Number(process.env.MAO_RUN_TIMEOUT_MS || 20 * 60_000),
    workerTimeoutMs: Number(process.env.MAO_WORKER_TIMEOUT_MS || 15 * 60_000),
    requestTimeoutMs: Number(process.env.MAO_REQUEST_TIMEOUT_MS || 600_000),
    recursive: process.env.MAO_RECURSIVE === '1',
    recursiveMaxDepth: Number(process.env.MAO_RECURSIVE_MAX_DEPTH || 1),
    ...overrides,
  };
}
