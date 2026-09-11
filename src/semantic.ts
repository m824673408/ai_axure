import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ProtoError } from './errors.js';
import { findWorkspace, readYaml } from './io.js';

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

interface SemanticConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeout: number;
}

const semanticFileSchema = z.object({
  base_url: z.string().trim().min(1).optional(),
  api_key: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  timeout_ms: z.coerce.number().int().positive().optional(),
});

const semanticResolvedSchema = z.object({
  base_url: z.string().trim().min(1),
  api_key: z.string().trim().min(1),
  model: z.string().trim().min(1),
  timeout_ms: z.coerce.number().int().positive(),
});

function configuration(root?: string): SemanticConfig {
  const environment = {
    base_url: process.env.PROTO_LLM_BASE_URL?.trim() || undefined,
    api_key: process.env.PROTO_LLM_API_KEY?.trim() || undefined,
    model: process.env.PROTO_LLM_MODEL?.trim() || undefined,
    timeout_ms: process.env.PROTO_LLM_TIMEOUT_MS?.trim() || undefined,
  };
  let file: z.infer<typeof semanticFileSchema> = {};
  let workspaceRoot = root;
  if (!workspaceRoot && (!environment.base_url || !environment.api_key || !environment.model)) {
    try { workspaceRoot = findWorkspace(); } catch { workspaceRoot = undefined; }
  }
  if (workspaceRoot) {
    const path = join(workspaceRoot, '.proto.llm.yaml');
    if (existsSync(path)) {
      try {
        file = semanticFileSchema.parse(readYaml(path));
      } catch (error) {
        if (error instanceof ProtoError) throw error;
        throw new ProtoError(`Semantic Diff 配置无效：${path}\n${String(error)}`);
      }
    }
  }
  const merged = {
    base_url: environment.base_url ?? file.base_url,
    api_key: environment.api_key ?? file.api_key,
    model: environment.model ?? file.model,
    timeout_ms: environment.timeout_ms ?? file.timeout_ms ?? 60000,
  };
  if (!merged.base_url || !merged.api_key || !merged.model) {
    throw new ProtoError('Semantic Diff 未配置。请在 Workspace 根目录复制 .proto.llm.example.yaml 为 .proto.llm.yaml，并填写 base_url、api_key、model；可先使用 --dry-run 审查 Prompt。');
  }
  let parsed: z.infer<typeof semanticResolvedSchema>;
  try {
    parsed = semanticResolvedSchema.parse(merged);
  } catch (error) {
    throw new ProtoError(`Semantic Diff 配置无效：${String(error)}`);
  }
  return { baseUrl: parsed.base_url.replace(/\/$/, ''), apiKey: parsed.api_key, model: parsed.model, timeout: parsed.timeout_ms };
}

export function semanticConfigured(root?: string): boolean {
  try { configuration(root); return true; } catch { return false; }
}

export async function requestSemanticDiff(prompt: string, root?: string): Promise<string> {
  const { baseUrl, apiKey, model, timeout } = configuration(root);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 0.2, messages: [{ role: 'system', content: '输出准确、可审查的中文 Product Diff。' }, { role: 'user', content: prompt }] }),
      signal: controller.signal,
    });
    const body = await response.json() as ChatCompletion;
    if (!response.ok) throw new ProtoError(`Semantic Diff 请求失败 (${response.status})：${body.error?.message ?? response.statusText}`);
    const content = body.choices?.[0]?.message?.content?.trim();
    if (!content) throw new ProtoError('Semantic Diff 服务返回空内容。');
    return content;
  } catch (error) {
    if (error instanceof ProtoError) throw error;
    if ((error as Error).name === 'AbortError') throw new ProtoError(`Semantic Diff 请求超时（${timeout}ms）。`);
    throw new ProtoError(`Semantic Diff 请求失败：${String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}
