import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 测试夹具的文本读写辅助。
 *
 * 为什么必须统一换行为 LF：本仓库的开发机使用 `core.autocrlf=true`，同一份被跟踪文件
 * 在**全新克隆**里是 CRLF、在未重新检出的工作区里是 LF。测试用只含 `\n` 的字面量做补丁时，
 * CRLF 检出会全部「补丁未命中」而失败——干净检出验证曾因此暴露 10 个失败用例。
 *
 * 修正方式：读取时把 CRLF 归一为 LF，写入时按 LF 落盘。这样无论检出是什么行尾，
 * 夹具行为都一致；同时避免同一段辅助代码在多个测试文件里各写一份。
 */

/** 读取工作区内的文本，换行统一为 LF。 */
export function readText(root: string, relative: string): string {
  return readFileSync(join(root, relative), 'utf8').replace(/\r\n/g, '\n');
}

/** 替换文件内容；未命中即失败，避免测试因为「什么也没改」而假通过。 */
export function patch(root: string, relative: string, from: string, to: string): void {
  const before = readText(root, relative);
  const after = before.replace(from, to);
  if (after === before) {
    throw new Error(`补丁未命中：${relative} 中的 ${JSON.stringify(from.slice(0, 80))}`);
  }
  writeFileSync(join(root, relative), after, 'utf8');
}

/** 在文件末尾追加文本。 */
export function appendText(root: string, relative: string, text: string): void {
  writeFileSync(join(root, relative), `${readText(root, relative)}\n${text}\n`, 'utf8');
}

/** 写入文件（自动创建父目录）。 */
export function writeText(root: string, relative: string, content: string): void {
  const target = join(root, relative);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content.replace(/\r\n/g, '\n'), 'utf8');
}
