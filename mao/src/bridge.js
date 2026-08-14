// Bridge to the vendored Prime Agent fork (devagent-mao/prime-agent/).
//
// The in-process path replicates Prime Agent's own test harness (see
// prime-agent/packages/coding-agent/test/suite/harness.ts): construct Agent +
// AgentSession directly with an in-memory ModelRegistry wired to the faux (or
// real) provider. This avoids createAgentSession's on-disk defaults, which
// re-create a ModelRegistry that does not know about our registered provider.
//
// A future RPC fallback (spawn `prime-agent --mode rpc`) would isolate Prime
// Agent's heavy dependency graph; the bridge interface is the seam for that.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __DIR = path.dirname(fileURLToPath(import.meta.url));
// devagent-mao/mao/src -> devagent-mao/prime-agent/packages/...
export const PRIME_AGENT_DIST = path.resolve(
  __DIR,
  '..',
  '..',
  'prime-agent',
  'packages',
  'coding-agent',
  'dist',
  'index.js',
);
export const PI_AI_DIST = path.resolve(
  __DIR,
  '..',
  '..',
  'prime-agent',
  'packages',
  'ai',
  'dist',
  'index.js',
);
export const PI_AGENT_CORE_DIST = path.resolve(
  __DIR,
  '..',
  '..',
  'prime-agent',
  'packages',
  'agent',
  'dist',
  'index.js',
);

export async function primeAgentModule() {
  return import(PRIME_AGENT_DIST);
}
export async function piAiModule() {
  return import(PI_AI_DIST);
}
export async function piAgentCoreModule() {
  return import(PI_AGENT_CORE_DIST);
}

export async function createAgentSession(options = {}) {
  const mod = await primeAgentModule();
  return mod.createAgentSession(options);
}

export async function registerFauxProvider(options = {}) {
  const mod = await piAiModule();
  return mod.registerFauxProvider(options);
}

export async function fauxAssistantMessage(content, options = {}) {
  const mod = await piAiModule();
  return mod.fauxAssistantMessage(content, options);
}

// Build an in-memory AuthStorage with a runtime key for the model's provider.
export async function authStorageForKey(model, apiKey = 'mao-local-key') {
  const mod = await primeAgentModule();
  const storage = mod.AuthStorage.inMemory();
  storage.setRuntimeApiKey(model.provider, apiKey);
  return storage;
}

// Register a faux provider's models in an in-memory ModelRegistry, mirroring
// Prime Agent's own test harness. This is what makes streamSimple route through
// the registered faux API.
export async function modelRegistryForFaux(faux, authStorage) {
  const mod = await primeAgentModule();
  const registry = mod.ModelRegistry.inMemory(authStorage);
  registry.registerProvider(faux.models[0].provider, {
    baseUrl: faux.models[0].baseUrl,
    apiKey: 'mao-local-key',
    api: faux.api,
    models: faux.models.map((m) => ({
      id: m.id,
      name: m.name,
      api: m.api,
      reasoning: m.reasoning,
      input: m.input,
      cost: m.cost,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      baseUrl: m.baseUrl,
    })),
  });
  return registry;
}

// Minimal resource loader matching Prime Agent's test utilities. The AgentSession
// requires this shape (getSkills/getPrompts/getThemes/getExtensions) to build its
// runtime; without it the constructor throws on `this._resourceLoader.getSkills`.
export async function minimalResourceLoader() {
  const pa = await primeAgentModule();
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: pa.createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => undefined,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

// Create a headless AgentSession the same way Prime Agent's own harness does.
// Returns { session, modelRegistry, authStorage, faux } so callers keep refs.
export async function createHeadlessSession(faux, { modelId, systemPrompt = 'You are MAO.' }) {
  const pa = await primeAgentModule();
  const core = await piAgentCoreModule();

  const model = faux.getModel(modelId);
  const authStorage = await authStorageForKey(model);
  const modelRegistry = await modelRegistryForFaux(faux, authStorage);

  const settingsManager = pa.SettingsManager.inMemory();
  const sessionManager = pa.SessionManager.inMemory();
  const resourceLoader = await minimalResourceLoader();

  const agent = new core.Agent({
    getApiKey: () => 'mao-local-key',
    initialState: {
      model,
      systemPrompt,
      tools: [],
    },
    convertToLlm: pa.convertToLlm,
  });

  const session = new pa.AgentSession({
    agent,
    sessionManager,
    settingsManager,
    cwd: process.cwd(),
    modelRegistry,
    resourceLoader,
  });

  return { session, modelRegistry, authStorage, faux, model };
}

// Run one headless prompt and return the final assistant text.
export async function runFauxTurn(faux, { prompt, modelId, systemPrompt }) {
  const { session } = await createHeadlessSession(faux, { modelId, systemPrompt });
  await session.promptAndWait(prompt);
  return { session, text: session.getLastAssistantText() };
}
