import { createServer, get } from 'node:http'
import { openSync } from 'node:fs'
import { spawn } from 'node:child_process'

const root = process.cwd()
const log = openSync('.dev-server.log', 'a')

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 4315
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function isReady(url) {
  return new Promise((resolve) => {
    const request = get(url, (response) => {
      response.resume()
      resolve(response.statusCode === 200)
    })
    request.once('error', () => resolve(false))
    request.setTimeout(300, () => { request.destroy(); resolve(false) })
  })
}

function openBrowser(url) {
  const browser = spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' })
  browser.unref()
}

const port = await findFreePort()
const url = `http://127.0.0.1:${port}`
const command = process.platform === 'win32'
  ? { executable: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', `npm.cmd run dev -- --host 127.0.0.1 --port ${port} --strictPort`] }
  : { executable: 'npm', args: ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'] }
const server = spawn(command.executable, command.args, {
  cwd: root,
  detached: true,
  stdio: ['ignore', log, log],
})
server.unref()

for (let attempt = 0; attempt < 24; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 250))
  if (await isReady(url)) {
    console.log(`Prototype started: ${url}`)
    openBrowser(url)
    process.exit(0)
  }
}

console.error('Prototype did not start. Check .dev-server.log for details.')
process.exit(1)
