import type { Narrative } from '../../server/aiGuard';

export type AiOutcome = { ok: true; narrative: Narrative; model: string } | { ok: false; reason: string };

/** Calls the server-side dispatcher. Any failure resolves to { ok:false } so the UI can fall back to the rule-based dispatcher. */
export async function requestAiNarrative(payload: unknown, signal?: AbortSignal): Promise<AiOutcome> {
  try {
    const res = await fetch('/api/dispatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload }), signal });
    const text = await res.text();
    let body: { narrative?: Narrative; model?: string; error?: string; message?: string } = {};
    try { body = JSON.parse(text); } catch { /* not JSON (e.g. SPA fallback html) */ }
    if (res.ok && body.narrative) return { ok: true, narrative: body.narrative, model: body.model ?? 'LLM' };
    if (body.error === 'no_api_key' || res.status === 404 || res.status === 503) return { ok: false, reason: 'No AI API key is configured on the server.' };
    return { ok: false, reason: body.message ?? `AI service unavailable (${res.status}).` };
  } catch (e) {
    return { ok: false, reason: (e as Error).name === 'AbortError' ? 'Cancelled.' : 'AI service not reachable.' };
  }
}
