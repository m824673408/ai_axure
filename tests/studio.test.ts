import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createStudioServer } from '../src/studio-server.js';
import { initializeWorkspace } from '../src/workspace.js';

const roots: string[] = [];
const studios: Array<ReturnType<typeof createStudioServer>> = [];

async function studio() {
  const root = mkdtempSync(join(tmpdir(), 'proto-studio-'));
  roots.push(root);
  initializeWorkspace(root, true);
  const instance = createStudioServer({ root });
  studios.push(instance);
  await new Promise<void>((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  const address = instance.server.address();
  if (!address || typeof address === 'string') throw new Error('server address unavailable');
  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, init);
    return { response, body: await response.json() as any };
  };
  return { root, request };
}

afterEach(async () => {
  for (const instance of studios.splice(0)) await instance.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Studio local API', () => {
  it('reads status and creates a current Feature without accepting paths', async () => {
    const { request } = await studio();
    const before = await request('/api/status');
    expect(before.body.feature).toBeNull();
    const created = await request('/api/features', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'REQ-STUDIO-001', name: 'Studio 管理' }) });
    expect(created.response.status).toBe(201);
    expect(created.body.feature).toBe('REQ-STUDIO-001');
    expect(created.body.scopeLock.status).toBe('MISSING');
    const frozen = await request('/api/features/REQ-STUDIO-001/scope-lock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(frozen.body.status).toBe('LOCKED');
    const features = await request('/api/features');
    expect(features.body.features.some((item: any) => item.id === 'REQ-STUDIO-001')).toBe(true);
  });

  it('saves structured Feature records and blocks unauthorized Product Model writes', async () => {
    const { request } = await studio();
    await request('/api/features', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'REQ-STUDIO-002', name: '范围检查' }) });
    expect((await request('/api/features/REQ-STUDIO-002/scope-lock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).body.status).toBe('LOCKED');
    const requirement = await request('/api/features/REQ-STUDIO-002/requirement');
    const savedRequirement = await request('/api/features/REQ-STUDIO-002/requirement', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...requirement.body, goal: '在管理台维护需求。', notes: '仅用于测试。' }) });
    expect(savedRequirement.body.lint.feature).toBe('REQ-STUDIO-002');
    const model = await request('/api/product-model');
    const payload = { product: { name: '新版归因平台' }, modules: model.body.product.modules, navigation: model.body.navigation, routes: model.body.routes.routes, terms: model.body.terminology.terms };
    const blocked = await request('/api/product-model', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    expect(blocked.response.status).toBe(422);
    expect(blocked.body.error).toContain('未授权');
    const scope = await request('/api/features/REQ-STUDIO-002/scope');
    scope.body.allowed.product_model = ['product', 'navigation', 'routes', 'terminology'];
    const savedScope = await request('/api/features/REQ-STUDIO-002/scope', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allowed: scope.body.allowed, forbidden: [] }) });
    expect(savedScope.response.status).toBe(200);
    expect(savedScope.body.scopeLock.status).toBe('STALE');
    const allowed = await request('/api/product-model', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    expect(allowed.response.status).toBe(200);
    expect(allowed.body.product.name).toBe('新版归因平台');
    // V0.2 起 Studio 的 status/lint/diff 端点做的工作显著变多（Page Registry 解析、git log、blob 批量读取），
    // 该用例单独运行实测 11.9 s（V0.1 时代约 5 s），在 20 s 默认预算下全量并发运行会偶发超时。
    // 断言未做任何放松，只把该用例的墙钟预算显式放宽到 60 s。
  }, 60_000);

  it('exposes lint, diff, missing semantic configuration, and Studio-owned Preview lifecycle', async () => {
    const { root, request } = await studio();
    await request('/api/features', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'REQ-STUDIO-003', name: '检查' }) });
    expect((await request('/api/features/REQ-STUDIO-003/scope-lock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).body.status).toBe('LOCKED');
    expect((await request('/api/lint', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).body.pass).toBe(true);
    expect((await request('/api/diff')).body.featureFiles.length).toBeGreaterThan(0);
    const semantic = await request('/api/semantic-diff', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(semantic.body.configured).toBe(false);
    const { writeYaml } = await import('../src/io.js');
    writeYaml(join(root, 'prototype.config.yaml'), {
      workspace: { name: 'test', version: '0.1.0', base_branch: 'main' },
      paths: { product: 'product', features: 'features', prototype: 'prototype', components: 'components' },
      preview: { install_command: 'node -e ""', command: 'node -e "setInterval(() => {}, 1000)"', url: 'http://127.0.0.1:5173' },
    });
    const started = await request('/api/preview/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(started.body.running).toBe(true);
    const stopped = await request('/api/preview/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(stopped.body.running).toBe(false);
  });
});
