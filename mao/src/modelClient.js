const DEFAULT_RETRY_DELAYS = [2000, 5000, 15000];

export async function chat(endpoint, {
  messages, responseFormat = null, maxTokens = 8192, reasoningEffort = null,
  apiKey, timeoutMs = 600_000, retryDelaysMs = DEFAULT_RETRY_DELAYS,
}) {
  const body = { model: endpoint.model, messages, max_tokens: maxTokens };
  const effort = reasoningEffort ?? endpoint.reasoningEffort ?? null;
  if (effort) body.reasoning_effort = effort;
  if (responseFormat) body.response_format = responseFormat;

  let lastErr;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(`${endpoint.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
      }
      const data = JSON.parse(await res.text());
      const msg = data.choices?.[0]?.message ?? {};
      return {
        content: msg.content ?? '',
        reasoning: msg.reasoning_content ?? null,
        usage: normalizeUsage(data.usage),
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      lastErr = err;
      const retryable = /HTTP (429|5\d\d)|fetch failed|timeout|Timeout/.test(String(err.message));
      if (attempt >= retryDelaysMs.length || !retryable) break;
      await new Promise((r) => setTimeout(r, retryDelaysMs[attempt]));
    }
  }
  throw lastErr;
}

function normalizeUsage(u = {}) {
  return {
    prompt: u.prompt_tokens ?? 0,
    completion: u.completion_tokens ?? 0,
    total: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
    cached: u.prompt_tokens_details?.cached_tokens ?? 0,
  };
}

export async function chatJson(endpoint, {
  messages, jsonFormat, validate, maxAttempts = 2, ...chatOpts
}) {
  const convo = [...messages];
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await chat(endpoint, { ...chatOpts, messages: convo, responseFormat: jsonFormat });
    try {
      const value = validate(JSON.parse(r.content));
      return { value, usage: r.usage, latencyMs: r.latencyMs, attempts: attempt };
    } catch (err) {
      lastErr = err;
      convo.push(
        { role: 'assistant', content: r.content },
        { role: 'user', content: `Your reply was invalid (${err.message}). Reply again with ONLY corrected JSON matching the requested schema.` },
      );
    }
  }
  throw new Error(`chatJson: ${maxAttempts} attempts failed. Last error: ${lastErr.message}`);
}
