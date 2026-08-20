import { ProtoError } from './errors.js';

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

export async function requestSemanticDiff(prompt: string): Promise<string> {
  const baseUrl = process.env.PROTO_LLM_BASE_URL?.replace(/\/$/, '');
  const apiKey = process.env.PROTO_LLM_API_KEY;
  const model = process.env.PROTO_LLM_MODEL;
  if (!baseUrl || !apiKey || !model) {
    throw new ProtoError('Semantic Diff 未配置。请设置 PROTO_LLM_BASE_URL、PROTO_LLM_API_KEY、PROTO_LLM_MODEL；可先使用 --dry-run 审查 Prompt。');
  }
  const controller = new AbortController();
  const timeout = Number(process.env.PROTO_LLM_TIMEOUT_MS ?? 60000);
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
