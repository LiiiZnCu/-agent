import { describe, expect, it } from 'vitest'
import { createArtifactTemplate, validateArtifactSpec } from './artifacts'

describe('Artifact Spec 1.0', () => {
  it.each(['decision', 'cards', 'checklist'] as const)('%s 模板保留结构但没有预设内容', (template) => {
    const artifact = createArtifactTemplate(template)
    expect(artifact.fields.length).toBeGreaterThan(0)
    expect(artifact.records).toEqual([])
  })
  it('creates reusable table, cards, and checklist templates', () => {
    expect(createArtifactTemplate('decision').presentation.layout).toBe('table')
    expect(createArtifactTemplate('cards').artifactType).toBe('cards')
    expect(createArtifactTemplate('checklist').fields[0].type).toBe('boolean')
  })

  it('accepts a custom primitive artifact', () => {
    const artifact = validateArtifactSpec({
      specVersion: '1.0',
      artifactType: 'custom',
      title: 'Risk register',
      fields: [
        { key: 'risk', label: 'Risk', type: 'text', required: true },
        { key: 'likelihood', label: 'Likelihood', type: 'number' },
      ],
      records: [{ risk: 'Low adoption', likelihood: 0.35 }],
      presentation: { layout: 'table' },
    })
    expect(artifact.records[0]).toEqual({ risk: 'Low adoption', likelihood: 0.35 })
  })

  it('rejects non-primitive values in records', () => {
    expect(() => validateArtifactSpec({
      specVersion: '1.0',
      artifactType: 'custom',
      title: 'Unsafe object',
      fields: [{ key: 'payload', label: 'Payload', type: 'text' }],
      records: [{ payload: { nested: true } }],
      presentation: { layout: 'table' },
    })).toThrow('primitive value')
  })

  it('rejects duplicate field keys', () => {
    expect(() => validateArtifactSpec({
      specVersion: '1.0',
      artifactType: 'table',
      title: 'Duplicate keys',
      fields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'name', label: 'Name again', type: 'text' },
      ],
      records: [],
      presentation: { layout: 'table' },
    })).toThrow('Duplicate field key')
  })
})
