import { expect, it } from 'vitest'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

it('运行镜像包含服务端相对导入的全部源码', () => {
  const root = resolve(import.meta.dirname, '..')
  const runtime = mkdtempSync(join(tmpdir(), 'mural-runtime-layout-'))
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
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
    const nodeFlags = command.slice(1, -1)
    const result = spawnSync(process.execPath, [...nodeFlags, '--input-type=module', '-e', `await import('./${command.at(-1)}')`], {
      cwd: runtime,
      encoding: 'utf8',
      env: { ...process.env, CANVAS_RELAY_DB_PATH: join(runtime, 'data.sqlite') },
    })
    expect(result.status, result.stderr).toBe(0)
  } finally {
    rmSync(runtime, { recursive: true, force: true })
  }
})
