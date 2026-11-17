import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  ResolveRequestSchema,
  SuggestionSchema,
  SYSTEM_PROMPT,
  userPrompt,
  validateSuggestion,
  type Suggestion,
} from '../src/llm/suggestion.ts';

/**
 * Server-side half of "Ask Claude": runs where the API key lives, never in the
 * browser. Returns an HTTP status and a JSON body so both the Vite dev
 * middleware and a serverless function can use it.
 */
export async function handleResolve(body: unknown): Promise<{ status: number; json: unknown }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { status: 503, json: { error: 'Set ANTHROPIC_API_KEY on the server to enable Claude suggestions.' } };
  }
  const req = ResolveRequestSchema.safeParse(body);
  if (!req.success) return { status: 400, json: { error: 'Malformed request.' } };

  const client = new Anthropic();
  try {
    const response = await client.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt(req.data) }],
      output_config: { effort: 'medium', format: zodOutputFormat(SuggestionSchema) },
    });
    if (response.stop_reason === 'refusal') {
      const suggestion: Suggestion = { status: 'declined', rationale: 'Claude declined to answer this one. Match it by hand.' };
      return { status: 200, json: suggestion };
    }
    const suggestion = validateSuggestion(response.parsed_output, req.data);
    return { status: 200, json: suggestion };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return { status: 429, json: { error: 'Claude is rate limited. Try again in a minute.' } };
    if (err instanceof Anthropic.AuthenticationError) return { status: 502, json: { error: 'The server’s Anthropic API key was rejected.' } };
    if (err instanceof Anthropic.APIError) return { status: 502, json: { error: `Claude request failed (${err.status ?? 'network'}).` } };
    throw err;
  }
}
