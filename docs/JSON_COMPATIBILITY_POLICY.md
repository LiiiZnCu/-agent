# JSON compatibility policy

Canvas Relay treats mural snapshots, recordings, artifacts, and exported bundles as durable public contracts.

- Additive fields must be optional and old JSON must continue to load with safe defaults.
- Existing fields and enum values cannot be removed, renamed, or assigned a new meaning in place.
- Unknown additive fields must survive a load/save or import/export round trip.
- Breaking changes require a new `schemaVersion`, an explicit migration, and legacy fixtures before release.
- Portable exports never include owner, user, invite, or agent capability tokens.

The executable policy marker lives in `src/lib/compatibility.ts`. During prototyping we keep version `1.0` and add optional fields only. The release migration registry and long-lived compatibility fixtures will be added at release time.
