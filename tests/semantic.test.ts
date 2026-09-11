import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { requestSemanticDiff, semanticConfigured } from '../src/semantic.js';

const original = { ...process.env };
const roots: string[] = [];
afterEach(() => {
  process.env = { ...original };
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'proto-semantic-'));
  roots.push(value);
  return value;
}

describe('semantic diff client', () => {
  it('fails with actionable configuration guidance', async () => {
    delete process.env.PROTO_LLM_BASE_URL;
    delete process.env.PROTO_LLM_API_KEY;
    delete process.env.PROTO_LLM_MODEL;
    const workspace = root();
    expect(semanticConfigured(workspace)).toBe(false);
    await expect(requestSemanticDiff('test', workspace)).rejects.toThrow('.proto.llm.yaml');
  });

  it('reads workspace configuration and calls an OpenAI-compatible endpoint', async () => {
    const server = createServer((request, response) => {
      expect(request.url).toBe('/v1/chat/completions');
      expect(request.headers.authorization).toBe('Bearer test-key');
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { content: '# Product Diff\n\n通过' } }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address unavailable');
    const workspace = root();
    writeFileSync(join(workspace, '.proto.llm.yaml'), `base_url: http://127.0.0.1:${address.port}/v1\napi_key: test-key\nmodel: test-model\ntimeout_ms: 5000\n`, 'utf8');
    expect(semanticConfigured(workspace)).toBe(true);
    await expect(requestSemanticDiff('test prompt', workspace)).resolves.toContain('Product Diff');
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('lets environment variables override workspace configuration', async () => {
    const server = createServer((request, response) => {
      expect(request.headers.authorization).toBe('Bearer environment-key');
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { content: 'environment configuration used' } }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address unavailable');
    const workspace = root();
    writeFileSync(join(workspace, '.proto.llm.yaml'), 'base_url: https://file.example/v1\napi_key: file-key\nmodel: file-model\n', 'utf8');
    process.env.PROTO_LLM_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
    process.env.PROTO_LLM_API_KEY = 'environment-key';
    process.env.PROTO_LLM_MODEL = 'environment-model';
    await expect(requestSemanticDiff('test prompt', workspace)).resolves.toContain('environment configuration used');
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
});
