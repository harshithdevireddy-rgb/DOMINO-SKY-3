import { handleDispatch } from '../server/dispatchHandler.ts';

interface Req { method?: string; body?: unknown }
interface Res { status(code: number): Res; json(body: unknown): void; setHeader(k: string, v: string): void }

/** Vercel serverless function: POST /api/dispatch */
export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
  const out = await handleDispatch(req.body, process.env);
  res.status(out.status).json(out.body);
}
