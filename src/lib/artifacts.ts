import type { ArtifactField, ArtifactSpec, ArtifactValue } from '../types'

const fieldTypes = ['text', 'number', 'status', 'tag', 'boolean', 'date', 'url'] as const
const artifactTypes = ['table', 'cards', 'checklist', 'matrix', 'custom'] as const
const layouts = ['table', 'grid', 'list'] as const

function hasValue(value: unknown): value is ArtifactValue {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

export function validateArtifactSpec(candidate: unknown): ArtifactSpec {
  if (!candidate || typeof candidate !== 'object') throw new Error('Artifact spec must be an object.')
  const spec = candidate as Partial<ArtifactSpec>
  if (spec.specVersion !== '1.0') throw new Error('specVersion must be 1.0.')
  if (!artifactTypes.includes(spec.artifactType as (typeof artifactTypes)[number])) {
    throw new Error(`artifactType must be one of: ${artifactTypes.join(', ')}.`)
  }
  if (typeof spec.title !== 'string' || !spec.title.trim()) throw new Error('Artifact title is required.')
  if (!Array.isArray(spec.fields) || spec.fields.length < 1 || spec.fields.length > 12) {
    throw new Error('Artifact fields must contain between 1 and 12 definitions.')
  }

  const seen = new Set<string>()
  const fields: ArtifactField[] = spec.fields.map((field) => {
    if (!field || typeof field !== 'object') throw new Error('Each artifact field must be an object.')
    if (!/^[a-z][a-z0-9_]*$/i.test(field.key)) throw new Error(`Invalid field key: ${field.key}.`)
    if (seen.has(field.key)) throw new Error(`Duplicate field key: ${field.key}.`)
    seen.add(field.key)
    if (!fieldTypes.includes(field.type as (typeof fieldTypes)[number])) throw new Error(`Invalid field type: ${field.type}.`)
    if (typeof field.label !== 'string' || !field.label.trim()) throw new Error(`Field ${field.key} needs a label.`)
    return {
      key: field.key,
      label: field.label.trim().slice(0, 60),
      type: field.type,
      required: Boolean(field.required),
      options: Array.isArray(field.options) ? field.options.filter((option) => typeof option === 'string').slice(0, 20) : undefined,
    }
  })

  if (!Array.isArray(spec.records) || spec.records.length > 100) throw new Error('Artifact records must be an array of at most 100 items.')
  const records = spec.records.map((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(`Record ${index + 1} must be an object.`)
    const clean: Record<string, ArtifactValue> = {}
    for (const field of fields) {
      const value = (record as Record<string, unknown>)[field.key]
      if (field.required && (value === undefined || value === null || value === '')) {
        throw new Error(`Record ${index + 1} is missing required field ${field.key}.`)
      }
      if (value !== undefined) {
        if (!hasValue(value)) throw new Error(`Record ${index + 1}, field ${field.key} must be a primitive value.`)
        clean[field.key] = value
      }
    }
    return clean
  })

  const presentation = spec.presentation
  if (!presentation || !layouts.includes(presentation.layout as (typeof layouts)[number])) {
    throw new Error(`presentation.layout must be one of: ${layouts.join(', ')}.`)
  }

  return {
    specVersion: '1.0',
    artifactType: spec.artifactType!,
    title: spec.title.trim().slice(0, 120),
    description: typeof spec.description === 'string' ? spec.description.trim().slice(0, 500) : undefined,
    fields,
    records,
    presentation: {
      layout: presentation.layout,
      density: presentation.density === 'compact' ? 'compact' : 'comfortable',
      visibleFields: Array.isArray(presentation.visibleFields)
        ? presentation.visibleFields.filter((key) => seen.has(key)).slice(0, 12)
        : fields.map((field) => field.key),
    },
  }
}

export function createArtifactTemplate(template: 'decision' | 'cards' | 'checklist'): ArtifactSpec {
  if (template === 'cards') {
    return {
      specVersion: '1.0',
      artifactType: 'cards',
      title: 'Concept cards',
      description: 'Reusable concepts with a promise and target audience.',
      fields: [
        { key: 'concept', label: 'Concept', type: 'text', required: true },
        { key: 'promise', label: 'Promise', type: 'text' },
        { key: 'audience', label: 'Audience', type: 'tag' },
      ],
      records: [
        { concept: 'Focus rooms', promise: 'Make deep work social without adding meetings.', audience: 'Hybrid teams' },
        { concept: 'Energy map', promise: 'Show where teammates need support today.', audience: 'Team leads' },
      ],
      presentation: { layout: 'grid', density: 'comfortable' },
    }
  }

  if (template === 'checklist') {
    return {
      specVersion: '1.0',
      artifactType: 'checklist',
      title: 'Experiment checklist',
      description: 'A lightweight plan for validating an idea.',
      fields: [
        { key: 'done', label: 'Done', type: 'boolean' },
        { key: 'task', label: 'Task', type: 'text', required: true },
        { key: 'owner', label: 'Owner', type: 'text' },
      ],
      records: [
        { done: true, task: 'Choose the riskiest assumption', owner: 'Team' },
        { done: false, task: 'Interview three participants', owner: 'Research' },
        { done: false, task: 'Share the result', owner: 'Facilitator' },
      ],
      presentation: { layout: 'list', density: 'comfortable' },
    }
  }

  return {
    specVersion: '1.0',
    artifactType: 'matrix',
    title: 'Decision matrix',
    description: 'Compare ideas using the same criteria.',
    fields: [
      { key: 'option', label: 'Option', type: 'text', required: true },
      { key: 'impact', label: 'Impact', type: 'status', options: ['High', 'Medium', 'Low'] },
      { key: 'effort', label: 'Effort', type: 'status', options: ['High', 'Medium', 'Low'] },
      { key: 'owner', label: 'Owner', type: 'text' },
    ],
    records: [
      { option: 'Walking stand-ups', impact: 'High', effort: 'Low', owner: 'People team' },
      { option: 'Energy map', impact: 'High', effort: 'Medium', owner: 'Product' },
      { option: 'Focus rooms', impact: 'Medium', effort: 'Low', owner: 'Operations' },
    ],
    presentation: { layout: 'table', density: 'compact' },
  }
}
