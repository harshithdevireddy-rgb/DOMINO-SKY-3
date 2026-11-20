/** Numeric grounding guard: an LLM narrative may only quote numbers that exist in the engine payload. */
export interface Narrative {
  headline: string;
  summary: string;
  priorities: { candidateId: string; why: string }[];
  tradeoffs: string[];
}

const NUM = /\d+(?:[.,:]\d+)*/g;
export const numbersIn = (text: string): string[] => (text.match(NUM) ?? []).map((n) => n.replace(/^0+(?=\d)/, ''));

/** Allowed = every numeric token in the payload JSON (incl. HH:MM parts), plus small ordinals used in prose (1–9). */
export function allowedNumbers(payload: unknown): Set<string> {
  const set = new Set<string>();
  const text = JSON.stringify(payload);
  for (const n of numbersIn(text)) {
    set.add(n);
    for (const part of n.split(/[.,:]/)) set.add(part.replace(/^0+(?=\d)/, ''));
  }
  for (let i = 0; i <= 9; i++) set.add(String(i));
  return set;
}

export function verifyNarrative(n: Narrative, payload: unknown): { ok: true } | { ok: false; reason: string; offending: string[] } {
  const ids = new Set(((payload as { candidates?: { id: string }[] }).candidates ?? []).map((c) => c.id));
  for (const p of n.priorities) if (!ids.has(p.candidateId)) return { ok: false, reason: `unknown candidate ${p.candidateId}`, offending: [p.candidateId] };
  const allowed = allowedNumbers(payload);
  const text = [n.headline, n.summary, ...n.priorities.map((p) => p.why), ...n.tradeoffs].join(' \n ');
  // candidate ids like "act-12" are identifiers, not metrics
  const stripped = text.replace(/\bact-\d+\b/g, ' ').replace(/\bCX\d+\b|\bDS\d{4}\b|\bVT-DS\d+\b|\bCR\d+\b/g, ' ');
  const offending = [...new Set(numbersIn(stripped).filter((x) => !allowed.has(x)))];
  return offending.length ? { ok: false, reason: 'narrative contains numbers that are not in the engine payload', offending } : { ok: true };
}

export function parseNarrative(raw: string): Narrative | null {
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(raw.slice(start, end + 1)) as Partial<Narrative>;
    if (typeof j.headline !== 'string' || typeof j.summary !== 'string' || !Array.isArray(j.priorities) || !Array.isArray(j.tradeoffs)) return null;
    return { headline: j.headline, summary: j.summary, priorities: j.priorities.filter((p) => p && typeof p.candidateId === 'string' && typeof p.why === 'string'), tradeoffs: j.tradeoffs.filter((t) => typeof t === 'string') };
  } catch { return null; }
}
