import { expect, it } from 'vitest'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer } from 'node:net'

it('按生产镜像命令启动服务并通过健康检查', async () => {
  const root = resolve(import.meta.dirname, '..')
  const runtime = mkdtempSync(join(tmpdir(), 'mural-runtime-layout-'))
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
  let child: ChildProcessWithoutNullStreams | undefined
  try {
    for (const line of dockerfile.split('\n')) {
      const match = /^COPY (?!--from=)(\S+) (\S+)$/.exec(line.trim())
      if (!match || !match[1].startsWith('server') && !match[1].startsWith('src/')) continue
      const destination = join(runtime, match[2])
      mkdirSync(dirname(destination), { recursive: true })
      cpSync(join(root, match[1]), destination, { recursive: true })
    }
    cpSync(join(root, 'package.json'), join(runtime, 'package.json'))
    symlinkSync(join(root, 'node_modules'), join(runtime, 'node_modules'), 'dir')
    const commandLine = dockerfile.split('\n').find((line) => line.startsWith('CMD ['))
    expect(commandLine).toBeDefined()
    const command = JSON.parse(commandLine!.slice(4)) as string[]
    expect(command[0]).toBe('node')
    const reservation = createServer()
    await new Promise<void>((resolve, reject) => reservation.listen(0, '127.0.0.1', resolve).once('error', reject))
    const address = reservation.address()
    if (!address || typeof address === 'string') throw new Error('未取得测试端口。')
    const port = address.port
    await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()))
    child = spawn(process.execPath, command.slice(1), {
      cwd: runtime,
      env: { ...process.env, CANVAS_RELAY_DB_PATH: join(runtime, 'data.sqlite'), CANVAS_RELAY_PORT: String(port) },
    })
    const service = child
    let stderr = ''
    service.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`服务启动超时：${stderr}`)), 5000)
      service.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        if (chunk.includes('Canvas Relay API listening')) { clearTimeout(timeout); resolve() }
      })
      service.once('error', (error) => { clearTimeout(timeout); reject(error) })
      service.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`服务提前退出 ${code}：${stderr}`)) })
    })
    const health = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) })
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ ok: true, storage: 'drizzle-sqlite', databasePath: join(runtime, 'data.sqlite') })
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => child?.kill('SIGKILL'), 1000)
        child!.once('exit', () => { clearTimeout(timeout); resolve() })
        child!.kill('SIGTERM')
      })
    }
    rmSync(runtime, { recursive: true, force: true })
  }
})
