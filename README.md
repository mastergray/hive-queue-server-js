# hive-queue-server

`hive-queue-server` is a minimalist HTTP server built on
[hive-queue](https://github.com/mastergray/hive-queue-js) where every request
is a task and every stage is a worker. Routes and middleware bind HTTP entry
points to handlers, given inline or as registered worker IDs.

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

Source is laid out one folder per class under `src/`, each with its
`types.ts` beside it, with a manifest-based conformance suite under
`tests/spec/` and fixtures and host doubles under `tests/support/`.
