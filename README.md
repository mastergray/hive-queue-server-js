# hive-queue-server

`hive-queue-server` is a minimalist HTTP server built on
[hive-queue](https://github.com/mastergray/hive-queue-js). Every request is a
task, every stage of handling it is a worker, and routes and middleware are
wiring that binds HTTP entry points to workers by ID.

The server owns the concerns the queue deliberately leaves out: per-request
failure isolation, per-request deadlines, admission by depth, and lifecycle.
It has no runtime dependency other than `hive-queue`.

## Status

Under construction. The design is complete and lives in
[the design document](./docs/hive-queue-server-design-doc.md). Implementation
follows that document's checklist, with a conformance test category per
section.

## Development

```sh
npm install
npm run check      # type-checks src/ and tests/
npm run build
npm test           # runs the spec suite through tests/run.ts
```

Source follows the CTG TypeScript style guides: one folder per class
under `src/` with its `types.ts` beside it, and a manifest-based
conformance suite under `tests/spec/` with fixtures and host doubles
under `tests/support/`.
