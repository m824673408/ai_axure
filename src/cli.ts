import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { Command } from 'commander';
import pc from 'picocolors';
import { formatCheck, runCheck } from './check.js';
import { createDiff, buildSemanticPrompt, formatDiff } from './diff.js';
import { ProtoError } from './errors.js';
import { changedFiles, currentBranch, currentFeature, ensureClean, git, isGitRepository } from './git.js';
import { findWorkspace, normalizePath } from './io.js';
import { formatLint, runLint } from './lint.js';
import { previewEnvironment } from './preview.js';
import { requestSemanticDiff } from './semantic.js';
import { startStudio } from './studio-server.js';
import { createFeature, initializeWorkspace, loadConfig, loadProduct, loadScope, updateYamlVersion } from './workspace.js';

const program = new Command();
program.name('proto').description('AI Product Prototype Workspace CLI').version('0.2.0-rc.1');

program.command('init')
  .argument('[directory]', '目标目录', '.')
  .option('--no-git', '不初始化 Git 仓库')
  .description('初始化 Prototype Workspace')
  .action((directory: string, options: { git: boolean }) => {
    const target = initializeWorkspace(directory, options.git);
    const product = loadProduct(target);
    const prototype = join(target, 'prototype');
    const run = process.platform === 'win32'
      ? `PowerShell:\nSet-Location -LiteralPath "${prototype}"\nnpm install\nnpm run dev\n\nCMD:\ncd /d "${prototype}"\nnpm install\nnpm run dev`
      : `cd "${prototype}"\nnpm install\nnpm run dev`;
    console.log(`Prototype Workspace initialized.\n\nProduct:\n${product.product.name}\n\nPath:\n${target}\n\nRun:\n${run}`);
  });

program.command('context')
  .option('--json', '输出 JSON')
  .description('输出当前产品与 Feature 上下文')
  .action((options: { json?: boolean }) => {
    const root = findWorkspace();
    const product = loadProduct(root);
    const feature = currentFeature(root);
    const scope = loadScope(root, feature);
    const output = {
      product: product.product,
      modules: product.modules,
      current_feature: scope?.feature ?? null,
      allowed_scope: scope?.allowed ?? null,
    };
    if (options.json) return console.log(JSON.stringify(output, null, 2));
    const lines = ['PRODUCT', '', product.product.name, '', 'MODULES', '', ...product.modules.map((module) => `- ${module.name}`), '', 'CURRENT FEATURE', ''];
    if (scope) lines.push(scope.feature.id, scope.feature.name);
    else lines.push('None');
    lines.push('', 'ALLOWED SCOPE', '', 'Pages:', ...(scope?.allowed.pages.map((page) => `- ${page}`) ?? ['None']), '', 'Shared Components:', ...(scope?.allowed.shared_components.map((item) => `- ${item}`) ?? ['None']), '', 'Product Model:', ...(scope?.allowed.product_model.map((item) => `- ${item}`) ?? ['None']));
    console.log(lines.join('\n'));
  });

const feature = program.command('feature').description('管理 Feature');
feature.command('create')
  .argument('<id>', 'Feature ID，例如 REQ-20260820-001')
  .requiredOption('--name <name>', 'Feature 名称')
  .option('--page <pageId>', '授权页面 ID（可重复；经 Page Registry 展开为真实实现文件与 spec）', (value: string, previous: string[]) => [...previous, value], [] as string[])
  .description('创建 Feature 分支与文件')
  .action((id: string, options: { name: string; page: string[] }) => {
    const root = findWorkspace();
    const authorization = createFeature(root, id, options.name, options.page ?? []);
    const lines = [`Feature created.`, ``, `Feature:`, id, options.name, ``, `Branch:`, `feature/${id}`];
    if (authorization.pages.length > 0) {
      lines.push(``, `Authorized pages (by Page Registry):`);
      for (const page of authorization.pages) lines.push(`- ${page}`);
      if (authorization.paths.length > 0) {
        lines.push(``, `Allowed paths (generated):`);
        for (const path of authorization.paths) lines.push(`- ${path}`);
      }
    }
    console.log(lines.join('\n'));
  });

feature.command('status')
  .option('--json', '输出 JSON')
  .description('显示当前 Feature 状态')
  .action((options: { json?: boolean }) => {
    const root = findWorkspace();
    const config = loadConfig(root);
    const id = currentFeature(root);
    if (!id) throw new ProtoError('L005 Invalid Feature：当前 Branch 不是 feature/*。');
    const lint = runLint(root);
    const output = { feature: id, branch: currentBranch(root), base: config.workspace.base_branch, changed_files: lint.changedFiles.length, scope: lint.pass ? 'PASS' : 'BLOCKED' };
    if (options.json) return console.log(JSON.stringify(output, null, 2));
    console.log(`Feature:\n${id}\n\nBranch:\n${output.branch}\n\nBase:\n${output.base}\n\nChanged Files:\n${output.changed_files}\n\nScope:\n${output.scope}`);
    if (!lint.pass) process.exitCode = 1;
  });

program.command('check')
  .option('--json', '输出 JSON')
  .option('--out <file>', '把 JSON 结果写入文件（供 CI 读取）')
  .option('--no-build', '跳过第 4 段 Prototype Build')
  .description('合并前一次性检查：Schema & Lint / Product Diff / Registry 冲突 / Prototype Build / 风险提示')
  .action((options: { json?: boolean; out?: string; build: boolean }) => {
    const root = findWorkspace();
    const outputPath = options.out ? resolve(options.out) : null;
    let ignoredPaths: string[] = [];
    if (outputPath) {
      if (existsSync(outputPath) && statSync(outputPath).isDirectory()) throw new ProtoError(`--out 必须是文件路径，不能是目录：${outputPath}`);
      const relativeOutput = normalizePath(relative(root, outputPath));
      const insideWorkspace = relativeOutput !== '..' && !relativeOutput.startsWith('../') && !isAbsolute(relativeOutput);
      if (insideWorkspace) {
        if (git(root, ['ls-files', '--error-unmatch', '--', relativeOutput], true)) {
          throw new ProtoError(`--out 不允许覆盖 Git 已跟踪文件：${relativeOutput}`);
        }
        ignoredPaths = [relativeOutput];
      }
    }
    const result = runCheck(root, { build: options.build, ignoredPaths });
    if (outputPath) {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    console.log(options.json ? JSON.stringify(result, null, 2) : formatCheck(result));
    if (!result.pass) process.exitCode = 1;
  });

program.command('lint')
  .option('--json', '输出 JSON')
  .description('执行确定性 Product Lint')
  .action((options: { json?: boolean }) => {
    const result = runLint(findWorkspace());
    console.log(options.json ? JSON.stringify(result, null, 2) : formatLint(result));
    if (!result.pass) process.exitCode = 1;
  });

program.command('diff')
  .option('--json', '输出 JSON')
  .option('--semantic', '生成 AI Semantic Diff')
  .option('--dry-run', '仅输出 Semantic Diff Prompt')
  .description('生成 Product Diff')
  .action(async (options: { json?: boolean; semantic?: boolean; dryRun?: boolean }) => {
    const root = findWorkspace();
    if (options.semantic || options.dryRun) {
      const prompt = buildSemanticPrompt(root);
      console.log(options.dryRun ? prompt : await requestSemanticDiff(prompt, root));
      return;
    }
    const diff = createDiff(root);
    console.log(options.json ? JSON.stringify(diff, null, 2) : formatDiff(diff, loadConfig(root).workspace.base_branch));
  });

program.command('preview')
  .option('--no-install', '跳过首次依赖安装')
  .description('启动当前 Feature Prototype')
  .action((options: { install: boolean }) => {
    const root = findWorkspace();
    const config = loadConfig(root);
    const prototype = join(root, config.paths.prototype);
    if (!existsSync(join(prototype, 'node_modules')) && options.install) {
      console.log('Installing prototype dependencies...');
      const install = spawnSync(config.preview.install_command, { cwd: prototype, shell: true, stdio: 'inherit' });
      if (install.status !== 0) throw new ProtoError(`依赖安装失败，退出码：${install.status ?? 'unknown'}`);
    }
    let featureName = 'main';
    try {
      featureName = currentFeature(root) ?? 'main';
    } catch {
      featureName = 'unknown (Git 状态不可读，Preview 仍继续)';
    }
    console.log(`Prototype running:\n\n${config.preview.url}\n\nFeature:\n${featureName}`);
    const child = spawn(config.preview.command, { cwd: prototype, shell: true, stdio: 'inherit', env: previewEnvironment(root) });
    child.on('exit', (code) => { process.exitCode = code ?? 0; });
  });

program.command('studio')
  .option('--port <port>', '管理台端口', '3210')
  .option('--no-open', '不自动打开浏览器')
  .description('启动本机 PM 管理面板（仅监听 127.0.0.1）')
  .action(async (options: { port: string; open: boolean }) => {
    await startStudio(findWorkspace(), Number(options.port), options.open);
  });

program.command('release')
  .argument('<version>', 'SemVer 版本，例如 0.2.0')
  .description('发布 main 版本并创建不可覆盖 Tag')
  .action((version: string) => {
    const root = findWorkspace();
    const config = loadConfig(root);
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new ProtoError(`无效 SemVer：${version}`);
    if (!isGitRepository(root)) throw new ProtoError('当前 Workspace 不是 Git 仓库。');
    if (currentBranch(root) !== config.workspace.base_branch) throw new ProtoError(`Release 只能在 ${config.workspace.base_branch} 执行。`);
    ensureClean(root);
    const lint = runLint(root);
    if (!lint.pass) throw new ProtoError(formatLint(lint));
    const tag = `prototype-v${version}`;
    if (git(root, ['tag', '--list', tag], true) === tag) throw new ProtoError(`版本已经存在，不允许覆盖：${tag}`);
    const productPath = join(root, 'product', 'product.yaml');
    const configPath = join(root, 'prototype.config.yaml');
    const changelogPath = join(root, 'CHANGELOG.md');
    const backups = new Map([[productPath, readFileSync(productPath, 'utf8')], [configPath, readFileSync(configPath, 'utf8')], [changelogPath, readFileSync(changelogPath, 'utf8')]]);
    try {
      updateYamlVersion(productPath, version);
      updateYamlVersion(configPath, version);
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
      appendFileSync(changelogPath, `\n## ${version} - ${date}\n\n- 发布 Prototype Workspace ${version}。\n`, 'utf8');
      git(root, ['add', '--', 'product/product.yaml', 'prototype.config.yaml', 'CHANGELOG.md']);
      git(root, ['-c', 'user.name=Prototype Workspace', '-c', 'user.email=prototype@local', 'commit', '-m', `chore(release): ${version}`]);
      git(root, ['tag', '-a', tag, '-m', `Prototype Workspace ${version}`]);
      console.log(`Release created.\n\nVersion:\n${version}\n\nTag:\n${tag}\n\nPush:\ngit push origin ${config.workspace.base_branch} ${tag}`);
    } catch (error) {
      for (const [path, content] of backups) writeFileSync(path, content, 'utf8');
      git(root, ['restore', '--staged', '--', 'product/product.yaml', 'prototype.config.yaml', 'CHANGELOG.md'], true);
      throw error;
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(pc.red(message));
  process.exitCode = error instanceof ProtoError ? error.exitCode : 1;
});
