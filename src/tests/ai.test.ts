import { describe, it, expect } from 'vitest';
import { handleDispatch } from '../../server/dispatchHandler';
import { verifyNarrative, parseNarrative } from '../../server/aiGuard';
import { net, closure, hm } from './helpers';
import { recommend, buildAiPayload } from '@/engine/dispatcher';

const sc = { closures: [closure('DEL', hm(12), 120)], actions: [] };
const payload = buildAiPayload(net, sc, recommend(net, sc));
const topId = payload.candidates[0].id;
const mockFetch = (text: string, ok = true, status = 200) => async () => ({ ok, status, json: async () => ({ content: [{ type: 'text', text }] }) });

describe('AI dispatcher safety', () => {
  it('without an API key the handler refuses (client then uses the rule-based dispatcher)', async () => {
    const r = await handleDispatch({ payload }, {});
    expect(r.status).toBe(503); expect(JSON.stringify(r.body)).not.toMatch(/sk-/);
  });
  it('rejects a narrative with invented numbers', async () => {
    const bad = JSON.stringify({ headline: 'Save 9999 minutes', summary: `Total delay is ${payload.metrics.totalDelayMinutes}.`, priorities: [{ candidateId: topId, why: 'x' }], tradeoffs: [] });
    const r = await handleDispatch({ payload }, { ANTHROPIC_API_KEY: 'k' }, mockFetch(bad));
    expect(r.status).toBe(422); expect(JSON.stringify(r.body)).toMatch(/9999/);
  });
  it('rejects unknown candidate ids', async () => {
    const bad = JSON.stringify({ headline: 'h', summary: 's', priorities: [{ candidateId: 'act-999', why: 'x' }], tradeoffs: [] });
    expect((await handleDispatch({ payload }, { ANTHROPIC_API_KEY: 'k' }, mockFetch(bad))).status).toBe(422);
  });
  it('accepts a grounded narrative and returns it', async () => {
    const good = JSON.stringify({ headline: `Network is ${payload.metrics.status}`, summary: `${payload.metrics.delayedFlights} flights are delayed for ${payload.metrics.totalDelayMinutes} minutes in total.`, priorities: [{ candidateId: topId, why: `Saves ${payload.candidates[0].delayMinutesSaved} delay minutes.` }], tradeoffs: ['Uses the spare aircraft.'] });
    const r = await handleDispatch({ payload }, { ANTHROPIC_API_KEY: 'k' }, mockFetch(good));
    expect(r.status).toBe(200);
  });
  it('handles provider failure, garbage output, bad request and network errors gracefully', async () => {
    expect((await handleDispatch({ payload }, { ANTHROPIC_API_KEY: 'k' }, mockFetch('', false, 500))).status).toBe(502);
    expect((await handleDispatch({ payload }, { ANTHROPIC_API_KEY: 'k' }, mockFetch('not json'))).status).toBe(502);
    expect((await handleDispatch({}, { ANTHROPIC_API_KEY: 'k' })).status).toBe(400);
    expect((await handleDispatch({ payload }, { ANTHROPIC_API_KEY: 'k' }, async () => { throw new Error('boom'); })).status).toBe(502);
  });
  it('guard helpers', () => {
    expect(parseNarrative('xx {"headline":"a","summary":"b","priorities":[],"tradeoffs":[]} yy')).not.toBeNull();
    expect(parseNarrative('{"headline":1}')).toBeNull();
    expect(verifyNarrative({ headline: 'h', summary: 'DS0501 and CX05 mentioned', priorities: [], tradeoffs: [] }, payload).ok).toBe(true);
  });
});
