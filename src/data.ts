import type { BoardEdge, BoardNode, BoardSnapshot } from './types'
import { createArtifactTemplate } from './lib/artifacts'

const decisionArtifact = createArtifactTemplate('decision')

export const INITIAL_NODES: BoardNode[] = [
  {
    id: 'frame-opportunity',
    type: 'boardElement',
    position: { x: 70, y: 70 },
    data: {
      title: 'Opportunity space',
      body: 'Small rituals that make hybrid work feel more human.',
      kind: 'frame',
      color: 'paper',
      votes: 0,
    },
    style: { width: 820, height: 430 },
    zIndex: -1,
  },
  {
    id: 'idea-walk',
    type: 'boardElement',
    position: { x: 115, y: 165 },
    data: {
      title: 'Walking stand-ups',
      body: 'Audio-first check-ins that end with one clear commitment.',
      kind: 'idea',
      color: 'sun',
      votes: 6,
      cluster: 'Rituals',
    },
  },
  {
    id: 'idea-map',
    type: 'boardElement',
    position: { x: 385, y: 140 },
    data: {
      title: 'Team weather map',
      body: 'A low-friction way to signal energy, focus and support needs.',
      kind: 'insight',
      color: 'mint',
      votes: 9,
      cluster: 'Signals',
    },
  },
  {
    id: 'idea-room',
    type: 'boardElement',
    position: { x: 645, y: 190 },
    data: {
      title: 'Quiet co-working rooms',
      body: 'Drop-in sessions with a shared intention and no meeting agenda.',
      kind: 'idea',
      color: 'sky',
      votes: 4,
      cluster: 'Rituals',
    },
  },
  {
    id: 'question-belonging',
    type: 'boardElement',
    position: { x: 240, y: 355 },
    data: {
      title: 'What creates belonging?',
      body: 'Look for moments where teammates can contribute without performing.',
      kind: 'question',
      color: 'rose',
      votes: 3,
    },
  },
  {
    id: 'action-prototype',
    type: 'boardElement',
    position: { x: 535, y: 375 },
    data: {
      title: 'Prototype the top ritual',
      body: 'Test with one team for five working days.',
      kind: 'action',
      color: 'paper',
      votes: 0,
    },
  },
  {
    id: 'artifact-decision',
    type: 'boardElement',
    position: { x: 955, y: 90 },
    data: {
      title: decisionArtifact.title,
      body: decisionArtifact.description ?? '',
      kind: 'artifact',
      color: 'paper',
      votes: 0,
      artifact: decisionArtifact,
    },
    style: { width: 620 },
    zIndex: 1,
  },
]

export const INITIAL_EDGES: BoardEdge[] = [
  {
    id: 'edge-map-prototype',
    source: 'idea-map',
    target: 'action-prototype',
    label: 'test first',
    type: 'smoothstep',
    animated: true,
  },
  {
    id: 'edge-question-walk',
    source: 'question-belonging',
    target: 'idea-walk',
    type: 'smoothstep',
  },
]

export const INITIAL_SNAPSHOT: BoardSnapshot = {
  id: '84571348-85fd-4d40-8b9e-fac16fac2ecf',
  name: 'Better hybrid rituals',
  nodes: INITIAL_NODES,
  edges: INITIAL_EDGES,
  createdAt: '2026-09-03T12:00:00.000Z',
  updatedAt: '2026-09-03T12:00:00.000Z',
}

export const EMPTY_SNAPSHOT: BoardSnapshot = {
  id: '24aacdaa-53ec-4d20-b0ea-835dbb7c5f6c',
  name: 'Untitled brainstorm',
  nodes: [],
  edges: [],
  createdAt: '2026-09-03T12:00:00.000Z',
  updatedAt: '2026-09-03T12:00:00.000Z',
}
