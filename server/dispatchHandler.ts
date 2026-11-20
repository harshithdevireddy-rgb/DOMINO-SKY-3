import { parseNarrative, verifyNarrative } from './aiGuard.ts';

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const SYSTEM = `You are the AI Dispatcher inside an airline disruption simulator.
A deterministic simulation engine has ALREADY computed every number. You receive them as JSON.
RULES:
- Never calculate, estimate, round, sum or infer any number. Quote numbers exactly as they appear in the JSON, or use none.
- Only recommend candidates that exist in "candidates" (reference them by their "id").
- Explain bottlenecks, trade-offs and priorities in plain operational language.
Reply with ONLY a JSON object: {"headline": string, "summary": string, "priorities": [{"candidateId": string, "why": string}], "tradeoffs": [string]}.`;

/**
 * Server-side only. The API key never reaches the browser.
 * Returns {status, body}; the client falls back to the deterministic Rule-based Dispatcher on any non-200.
 */
export async function handleDispatch(
  body: unknown,
  env: Record<string, string | undefined>,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<{ status: number; body: unknown }> {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return { status: 503, body: { error: 'no_api_key', message: 'ANTHROPIC_API_KEY is not configured on the server.' } };
  const payload = (body as { payload?: unknown } | null)?.payload;
  if (!payload || typeof payload !== 'object') return { status: 400, body: { error: 'bad_request', message: 'Missing payload.' } };
  try {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 1200, system: SYSTEM, messages: [{ role: 'user', content: JSON.stringify(payload) }] }),
    });
    if (!res.ok) return { status: 502, body: { error: 'upstream_error', message: `LLM provider returned ${res.status}.` } };
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    const narrative = parseNarrative(text);
    if (!narrative) return { status: 502, body: { error: 'unparseable', message: 'LLM response was not valid JSON.' } };
    const v = verifyNarrative(narrative, payload);
    if (!v.ok) return { status: 422, body: { error: 'ungrounded', message: v.reason, offending: v.offending } };
    return { status: 200, body: { narrative, model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5' } };
  } catch (e) {
    return { status: 502, body: { error: 'network', message: (e as Error).message } };
  }
}
