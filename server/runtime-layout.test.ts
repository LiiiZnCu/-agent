import { expect, it } from 'vitest'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

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
    const visited = new Set<string>()
    function visit(file: string) {
      expect(existsSync(file), `运行镜像缺少 ${file.slice(runtime.length + 1)}`).toBe(true)
      if (visited.has(file)) return
      visited.add(file)
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        const imported = resolve(dirname(file), match[1])
        const target = imported.endsWith('.ts') ? imported : `${imported}.ts`
        visit(target)
      }
    }
    visit(join(runtime, 'server/index.ts'))
  } finally {
    rmSync(runtime, { recursive: true, force: true })
  }
})
