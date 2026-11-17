/** Serverless entry for hosts that map api/*.ts to functions with the Web Request/Response signature (for example Vercel). */
export async function POST(request: Request): Promise<Response> {
  // Answer before loading the handler and the Anthropic SDK, so a deployment
  // without a key responds quickly and can't fail on anything the key would need.
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'Claude suggestions are turned off on this deployment.' }, { status: 503 });
  }
  const text = await request.text();
  if (text.length > 64 * 1024) return Response.json({ error: 'Request body too large.' }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }
  const { handleResolve } = await import('../server/resolve.ts');
  const out = await handleResolve(body);
  return Response.json(out.json, { status: out.status });
}
