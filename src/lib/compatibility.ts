/**
 * Compatibility contract for every persisted or exported Canvas Relay JSON shape.
 *
 * This is policy, not a release migration system yet. New capabilities must remain
 * additive while the app is in active prototyping, and release migrations will be
 * introduced before any breaking schema version is shipped.
 */
export const LEGACY_JSON_COMPATIBILITY_POLICY = Object.freeze({
  currentVersion: '1.0' as const,
  rules: Object.freeze([
    'New fields are optional and receive safe defaults when absent.',
    'Existing field meanings and enum values are never repurposed.',
    'Unknown additive fields survive load, save, import, and export round trips.',
    'A breaking change requires a new schema version and an explicit migration.',
    'Capabilities, access tokens, and other secrets are never included in portable exports.',
  ]),
})
