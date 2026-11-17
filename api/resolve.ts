import { handleResolve } from '../server/resolve.ts';

/** Serverless entry for hosts that map api/*.ts to functions with the Web Request/Response signature (for example Vercel). */
export async function POST(request: Request): Promise<Response> {
  const text = await request.text();
  if (text.length > 64 * 1024) return Response.json({ error: 'Request body too large.' }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }
  const out = await handleResolve(body);
  return Response.json(out.json, { status: out.status });
}
