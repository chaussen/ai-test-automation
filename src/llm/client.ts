import Anthropic from '@anthropic-ai/sdk';

const SONNET = 'claude-sonnet-4-6';
const HAIKU  = 'claude-haiku-4-5-20251001';

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        '[llm] ANTHROPIC_API_KEY is not set. Add it to .env or set it as an environment variable.',
      );
    }
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

/**
 * Call Claude Sonnet 4.6 for code generation tasks.
 * Returns the raw text content of the first content block.
 */
export async function generateCode(
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const client = getClient();
  const message = await client.messages.create({
    model: SONNET,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const block = message.content[0];
  if (block.type !== 'text') {
    throw new Error('[llm] Unexpected non-text response from model');
  }
  return block.text;
}

/**
 * Call Claude Haiku 4.5 for structured extraction tasks (JSON output).
 * Higher token budget than enrich() to accommodate structured responses.
 */
export async function extract(systemPrompt: string, userPrompt: string): Promise<string> {
  const client = getClient();
  const message = await client.messages.create({
    model: HAIKU,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const block = message.content[0];
  if (block.type !== 'text') throw new Error('[llm] Unexpected non-text response from model');
  return block.text.trim();
}

