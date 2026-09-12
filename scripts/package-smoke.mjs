import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repository = resolve(import.meta.dirname, '..');
const scratch = mkdtempSync(join(tmpdir(), 'proto-package-smoke-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const shell = process.platform === 'win32';
let studio;

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: command === npm && shell });
  if (result.status !== 0) {
    throw new Error([`Command failed: ${command} ${args.join(' ')}`, result.stdout, result.stderr].filter(Boolean).join('\n'));
  }
  return result;
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Unable to allocate a local port.'));
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

async function waitFor(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}: ${await response.text()}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

try {
  const packDir = join(scratch, 'pack');
  const workspace = join(scratch, 'workspace');
  mkdirSync(packDir);
  run(npm, ['pack', '--pack-destination', packDir], repository);
  const tarballName = readdirSync(packDir).find((name) => name.endsWith('.tgz'));
  if (!tarballName) throw new Error('npm pack did not produce a tarball.');
  const tarball = join(packDir, tarballName);

  run(npm, ['init', '-y'], scratch);
  run(npm, ['install', tarball, '--no-audit', '--no-fund'], scratch);
  const cli = join(scratch, 'node_modules', 'product-prototype-core', 'bin', 'proto.js');
  if (!existsSync(cli)) throw new Error('Installed package is missing bin/proto.js.');

  const initialized = run(process.execPath, [cli, 'init', workspace], scratch);
  if (initialized.stdout.includes('npm --prefix prototype')) throw new Error('init still prints the broken relative npm --prefix command.');
  if (process.platform === 'win32' && (!initialized.stdout.includes('Set-Location -LiteralPath') || !initialized.stdout.includes('cd /d'))) {
    throw new Error('init did not print both PowerShell and CMD instructions.');
  }
  if (!existsSync(join(workspace, '.gitignore')) || !existsSync(join(workspace, 'prototype.config.yaml'))) {
    throw new Error('Installed package did not initialize a complete Workspace.');
  }
  run(process.execPath, [cli, 'feature', 'create', 'REQ-PACKAGE-001', '--name', '安装包验收', '--page', 'attribution_rule'], workspace);
  if (existsSync(join(workspace, 'features', 'REQ-PACKAGE-001', 'changelog.md'))) {
    throw new Error('New Feature still contains the redundant changelog.md.');
  }
  const report = join(workspace, 'output', 'check-result.json');
  run(process.execPath, [cli, 'check', '--no-build', '--out', report], workspace);
  run(process.execPath, [cli, 'check', '--no-build', '--out', report], workspace);
  rmSync(report, { force: true });

  const port = await freePort();
  studio = spawn(process.execPath, [cli, 'studio', '--port', String(port), '--no-open'], {
    cwd: workspace,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  studio.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  studio.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  const page = await waitFor(`http://127.0.0.1:${port}/`);
  const html = await page.text();
  if (!html.includes('<div id="root"></div>')) throw new Error('Studio HTML did not contain the application root.');
  const status = await waitFor(`http://127.0.0.1:${port}/api/status`);
  const payload = await status.json();
  if (payload.branch !== 'feature/REQ-PACKAGE-001' || payload.feature !== 'REQ-PACKAGE-001' || payload.lint?.pass !== true) {
    throw new Error(`Unexpected Studio status: ${JSON.stringify(payload)}`);
  }

  console.log(`PACKAGE SMOKE PASS\nTarball: ${tarballName}\nStudio: HTTP 200\nWorkspace: initialized`);
} catch (error) {
  if (studio) studio.kill();
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
} finally {
  if (studio) {
    studio.kill();
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  rmSync(scratch, { recursive: true, force: true });
}
