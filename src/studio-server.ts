import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { z } from 'zod';
import { createDiff, buildSemanticPrompt } from './diff.js';
import { ProtoError } from './errors.js';
import { currentBranch, currentFeature, git } from './git.js';
import { readYaml, writeYaml } from './io.js';
import { runLint } from './lint.js';
import { previewEnvironment } from './preview.js';
import { authorizePath } from './scope.js';
import { requestSemanticDiff, semanticConfigured } from './semantic.js';
import { createFeature, listFeatures, loadConfig, loadNavigation, loadProduct, loadScope } from './workspace.js';
import type { ScopeModel } from './types.js';

const jsonLimit = 1_000_000;
const mime: Record<string, string> = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png',
};

const featureInput = z.object({ id: z.string(), name: z.string().min(1).max(120) });
const requirementInput = z.object({ background: z.string().max(20_000).default(''), goal: z.string().max(20_000).default(''), userBehavior: z.string().max(20_000).default(''), pageChanges: z.string().max(20_000).default(''), coreRules: z.string().max(20_000).default(''), notes: z.string().max(20_000).default('') });
const textList = z.array(z.string().min(1).max(300)).max(100).default([]);
const scopeInput = z.object({ allowed: z.object({ pages: textList, shared_components: textList, product_model: textList, paths: textList }), forbidden: textList });
const scenarioInput = z.object({ scenarios: z.array(z.object({ id: z.string().min(1).max(100), given: z.string().max(5_000), when: z.string().max(5_000), then: z.string().max(5_000) })).max(100) });
const productInput = z.object({
  product: z.object({ name: z.string().min(1).max(160) }),
  modules: z.array(z.object({ id: z.string().min(1).max(80), name: z.string().min(1).max(120) })).max(60),
  navigation: z.array(z.unknown()).max(100),
  routes: z.record(z.string(), z.object({ path: z.string().min(1).max(240), module: z.string().min(1).max(80) })).refine((routes) => new Set(Object.values(routes).map((route) => route.path)).size === Object.keys(routes).length, '路由地址不能重复。'),
  terms: z.record(z.string().min(1).max(100), z.object({ zh_CN: z.string().min(1).max(120) })),
});

type PreviewState = { running: boolean; url: string; logs: string[] };
export interface StudioController { server: Server; close(): Promise<void>; status(): unknown; }
export interface StudioOptions { root: string; staticDir?: string; }

function featurePath(root: string, id: string, file: string): string {
  if (!/^REQ-[A-Z0-9][A-Z0-9-]*$/.test(id)) throw new ProtoError('无效的 Feature ID。');
  return join(root, 'features', id, file);
}

function section(source: string, title: string): string {
  const match = source.match(new RegExp(`## ${title}\\r?\\n([\\s\\S]*?)(?=\\r?\\n## |$)`));
  return match?.[1]?.trim() ?? '';
}

function readRequirement(root: string, id: string) {
  const source = readFileSync(featurePath(root, id, 'requirement.md'), 'utf8');
  return { background: section(source, '背景'), goal: section(source, '目标'), userBehavior: section(source, '用户行为'), pageChanges: section(source, '页面变化'), coreRules: section(source, '核心规则'), notes: section(source, '补充说明') };
}

function requirementMarkdown(name: string, value: z.infer<typeof requirementInput>): string {
  const rows: Array<[string, string]> = [['背景', value.background], ['目标', value.goal], ['用户行为', value.userBehavior], ['页面变化', value.pageChanges], ['核心规则', value.coreRules], ['补充说明', value.notes]];
  return `# ${name}\n\n${rows.map(([title, text]) => `## ${title}\n\n${text.trim()}`).join('\n\n')}\n`;
}

function body(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => { size += chunk.length; if (size > jsonLimit) { reject(new ProtoError('请求内容过大。')); request.destroy(); } else chunks.push(chunk); });
    request.on('end', () => { try { resolveBody(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new ProtoError('请求必须是 JSON。')); } });
    request.on('error', reject);
  });
}

function reply(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function errorReply(response: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof ProtoError || error instanceof z.ZodError ? 422 : 500;
  reply(response, code, { error: message });
}

function staticFile(staticDir: string, pathname: string): string | null {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = normalize(join(staticDir, relative));
  if (!target.startsWith(normalize(staticDir)) || !existsSync(target) || statSync(target).isDirectory()) return null;
  return target;
}

function studioStaticDir(): string {
  const candidates = [
    fileURLToPath(new URL('../studio/dist', import.meta.url)),
    fileURLToPath(new URL('../../studio/dist', import.meta.url)),
  ];
  return candidates.find((path) => existsSync(join(path, 'index.html'))) ?? candidates[0]!;
}

export function createStudioServer(options: StudioOptions): StudioController {
  const root = resolve(options.root);
  const staticDir = options.staticDir ?? studioStaticDir();
  let preview: ChildProcess | null = null;
  const logs: string[] = [];
  const addLog = (line: string) => { logs.push(line.trimEnd()); if (logs.length > 160) logs.splice(0, logs.length - 160); };
  const previewState = (): PreviewState => ({ running: Boolean(preview && preview.exitCode === null), url: loadConfig(root).preview.url, logs: [...logs] });
  const status = () => {
    const config = loadConfig(root); const lint = runLint(root); const diff = createDiff(root);
    return { product: loadProduct(root).product, branch: currentBranch(root), feature: currentFeature(root), clean: !git(root, ['status', '--porcelain']), lint, diff, preview: previewState(), semanticConfigured: semanticConfigured(root), baseBranch: config.workspace.base_branch };
  };
  const requireCurrentFeature = (): { id: string; scope: ScopeModel } => {
    const id = currentFeature(root);
    if (!id) throw new ProtoError('请先在 feature/* 分支创建或切换一个需求。');
    const scope = loadScope(root, id);
    if (!scope) throw new ProtoError('当前 Feature 缺少 Scope。');
    return { id, scope };
  };
  const checkFeature = (id: string) => { const current = requireCurrentFeature(); if (current.id !== id) throw new ProtoError('只能编辑当前分支对应的 Feature。'); return current; };
  const startPreview = () => {
    if (preview && preview.exitCode === null) return previewState();
    const config = loadConfig(root); const prototype = join(root, config.paths.prototype);
    if (!existsSync(join(prototype, 'node_modules'))) {
      addLog('正在安装 Prototype 依赖…');
      const install = spawnSync(config.preview.install_command, { cwd: prototype, shell: true, encoding: 'utf8' });
      if (install.stdout) addLog(install.stdout); if (install.stderr) addLog(install.stderr);
      if (install.status !== 0) throw new ProtoError(`Prototype 依赖安装失败，退出码：${install.status ?? 'unknown'}`);
    }
    addLog(`启动 Preview：${config.preview.command}`);
    preview = spawn(config.preview.command, { cwd: prototype, shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: previewEnvironment(root) });
    preview.stdout?.on('data', (chunk: Buffer) => addLog(chunk.toString('utf8')));
    preview.stderr?.on('data', (chunk: Buffer) => addLog(chunk.toString('utf8')));
    preview.on('exit', (code) => { addLog(`Preview 已停止，退出码：${code ?? 'unknown'}`); preview = null; });
    return previewState();
  };
  const stopPreview = () => {
    const running = preview;
    if (running && running.exitCode === null) {
      preview = null;
      running.kill();
      addLog('已停止本管理台启动的 Preview。');
    }
    return previewState();
  };

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) throw new ProtoError('仅接受同源请求。');
      const method = request.method ?? 'GET'; const path = url.pathname;
      if (path === '/api/status' && method === 'GET') return reply(response, 200, status());
      if (path === '/api/features' && method === 'GET') return reply(response, 200, { features: listFeatures(root), current: currentFeature(root) });
      if (path === '/api/features' && method === 'POST') { const data = featureInput.parse(await body(request)); createFeature(root, data.id, data.name.trim()); return reply(response, 201, status()); }
      const match = path.match(/^\/api\/features\/(REQ-[A-Z0-9-]+)\/(requirement|scope|scenarios)$/);
      if (match) {
        const [, id, resource] = match; if (!id || !resource) throw new ProtoError('无效请求。');
        if (method === 'GET') {
          if (resource === 'requirement') return reply(response, 200, readRequirement(root, id));
          if (resource === 'scope') return reply(response, 200, loadScope(root, id));
          return reply(response, 200, readYaml(featurePath(root, id, 'scenarios.yaml')));
        }
        checkFeature(id);
        if (method === 'PUT' && resource === 'requirement') { const data = requirementInput.parse(await body(request)); const feature = listFeatures(root).find((item) => item.id === id); writeFileSync(featurePath(root, id, 'requirement.md'), requirementMarkdown(feature?.name ?? id, data), 'utf8'); return reply(response, 200, status()); }
        if (method === 'PUT' && resource === 'scope') { const data = scopeInput.parse(await body(request)); const current = loadScope(root, id); if (!current) throw new ProtoError('Scope 不存在。'); writeYaml(featurePath(root, id, 'scope.yaml'), { feature: current.feature, allowed: data.allowed, forbidden: data.forbidden }); return reply(response, 200, status()); }
        if (method === 'PUT' && resource === 'scenarios') { const data = scenarioInput.parse(await body(request)); writeYaml(featurePath(root, id, 'scenarios.yaml'), data); return reply(response, 200, status()); }
      }
      if (path === '/api/product-model' && method === 'GET') return reply(response, 200, { product: loadProduct(root), navigation: loadNavigation(root), routes: readYaml(join(root, 'product', 'routes.yaml')), terminology: readYaml(join(root, 'product', 'terminology.yaml')), permissions: readYaml(join(root, 'product', 'permissions.yaml')) });
      if (path === '/api/product-model' && method === 'PUT') {
        const data = productInput.parse(await body(request)); const { scope } = requireCurrentFeature();
        const files: Array<[string, unknown]> = [
          ['product/product.yaml', { product: { ...loadProduct(root).product, name: data.product.name }, modules: data.modules }],
          ['product/navigation.yaml', { navigation: data.navigation }],
          ['product/routes.yaml', { routes: data.routes }],
          ['product/terminology.yaml', { terms: data.terms }],
        ];
        const changed = files.filter(([relative, value]) => JSON.stringify(readYaml(join(root, relative))) !== JSON.stringify(value));
        for (const [relative] of changed) if (!authorizePath(relative, scope).allowed) throw new ProtoError(`当前 Scope 未授权修改 ${relative}。请先在“需求”中主动更新 Product Model 授权。`);
        for (const [relative, value] of changed) writeYaml(join(root, relative), value);
        return reply(response, 200, status());
      }
      if (path === '/api/lint' && method === 'POST') return reply(response, 200, runLint(root));
      if (path === '/api/diff' && method === 'GET') return reply(response, 200, createDiff(root));
      if (path === '/api/semantic-diff' && method === 'POST') { if (!semanticConfigured(root)) return reply(response, 200, { configured: false, message: '未配置 Semantic Diff。请在 Workspace 根目录复制 .proto.llm.example.yaml 为 .proto.llm.yaml，并填写服务配置。' }); return reply(response, 200, { configured: true, result: await requestSemanticDiff(buildSemanticPrompt(root), root) }); }
      if (path === '/api/preview' && method === 'GET') return reply(response, 200, previewState());
      if (path === '/api/preview/start' && method === 'POST') return reply(response, 200, startPreview());
      if (path === '/api/preview/stop' && method === 'POST') return reply(response, 200, stopPreview());
      if (path.startsWith('/api/')) return reply(response, 404, { error: '未找到 API。' });
      const file = staticFile(staticDir, path) ?? staticFile(staticDir, '/');
      if (!file) throw new ProtoError('Studio 静态资源缺失。请在 CLI 包目录执行 npm run build。');
      response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600' });
      response.end(readFileSync(file));
    } catch (error) { errorReply(response, error); }
  });
  return { server, close: async () => { stopPreview(); await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())); }, status };
}

export async function startStudio(root: string, port: number, openBrowser: boolean): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ProtoError('端口必须在 1 到 65535 之间。');
  const studio = createStudioServer({ root });
  await new Promise<void>((resolveListen, reject) => { studio.server.once('error', reject); studio.server.listen(port, '127.0.0.1', resolveListen); });
  const url = `http://127.0.0.1:${port}`;
  console.log(`PM Studio 已启动：${url}\n当前 Workspace：${resolve(root)}\n按 Ctrl+C 停止 Studio。`);
  if (openBrowser) {
    const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    const opener = spawn(command, args, { detached: true, stdio: 'ignore' }); opener.unref();
  }
  const close = async () => { await studio.close(); process.exitCode = 0; };
  process.once('SIGINT', close); process.once('SIGTERM', close);
}
