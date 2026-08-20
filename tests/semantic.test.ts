import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { requestSemanticDiff } from '../src/semantic.js';

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});

describe('semantic diff client', () => {
  it('fails with actionable configuration guidance', async () => {
    delete process.env.PROTO_LLM_BASE_URL;
    delete process.env.PROTO_LLM_API_KEY;
    delete process.env.PROTO_LLM_MODEL;
    await expect(requestSemanticDiff('test')).rejects.toThrow('PROTO_LLM_BASE_URL');
  });

  it('calls an OpenAI-compatible endpoint', async () => {
    const server = createServer((request, response) => {
      expect(request.url).toBe('/v1/chat/completions');
      expect(request.headers.authorization).toBe('Bearer test-key');
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { content: '# Product Diff\n\n通过' } }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address unavailable');
    process.env.PROTO_LLM_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
    process.env.PROTO_LLM_API_KEY = 'test-key';
    process.env.PROTO_LLM_MODEL = 'test-model';
    await expect(requestSemanticDiff('test prompt')).resolves.toContain('Product Diff');
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
});
