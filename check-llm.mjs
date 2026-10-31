import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = join(dirname(fileURLToPath(import.meta.url)), '.env');

try {
  const envFile = readFileSync(envPath, 'utf8');

  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;

    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }

    process.env[match[1]] = value;
  }
} catch (error) {
  console.error(`Could not read .env: ${error.message}`);
  process.exit(1);
}

const baseUrl = process.env.LLM_BASE_URL?.replace(/\/+$/, '');
const apiKey = process.env.LLM_API_KEY?.trim();
const model = process.env.LLM_MODEL?.trim() || 'auto';

if (!baseUrl) {
  console.error('LLM_BASE_URL is missing or empty in .env.');
  process.exit(1);
}

const redact = (value) => (apiKey ? value.replaceAll(apiKey, '[redacted]') : value);

try {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      max_tokens: 10,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const responseText = await response.text();
  let data;

  try {
    data = JSON.parse(responseText);
  } catch {
    data = undefined;
  }

  if (!response.ok) {
    const detail = data?.error?.message || responseText || response.statusText;
    console.error(`LLM call failed (HTTP ${response.status}): ${redact(detail).slice(0, 1000)}`);
    process.exit(1);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (content === undefined || content === null) {
    console.error(`LLM returned HTTP ${response.status}, but no assistant message was found.`);
    if (responseText) console.error(redact(responseText).slice(0, 1000));
    process.exit(1);
  }

  console.log(`LLM call succeeded (HTTP ${response.status}, model: ${model}).`);
  console.log('Response:', redact(typeof content === 'string' ? content : JSON.stringify(content)));
} catch (error) {
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    console.error('LLM call timed out after 30 seconds.');
  } else {
    const cause = error.cause;
    const detail = cause?.code ? `${cause.code}: ${cause.message}` : error.message;
    console.error(`Could not reach the LLM endpoint: ${redact(detail)}`);
  }
  process.exit(1);
}
