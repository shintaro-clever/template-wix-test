# Native Modules Runbook

## Purpose

Use this runbook when `doctor.json` reports native module issues for `better-sqlite3`.

## Diagnosis

Check `doctor.json`:

- Path: `doctor.json`
- Key: `native.better_sqlite3`

If `native.better_sqlite3.ok` is `false`, then the native module ABI does not match the current Node.js runtime.

The doctor output includes these fields:

- `nodeModules`: value from `node -p "process.versions.modules"` (current runtime ABI).
- `found`: ABI value found in the error message (compiled module ABI).
- `required`: ABI value required by the current runtime.

When `found` and `required` differ, the module was built for a different Node.js version.

## Recovery

Recommended (clean, stable):

1. `volta pin node@22`
2. `rm -rf node_modules`
3. `npm install`
4. `npm test`

Temporary (rebuild in place):

1. `npm rebuild better-sqlite3 --build-from-source`
2. `npm test`

## Notes

- Prefer the recommended path when the project runtime should stay on Node 22.
- Use the temporary path only when you cannot change the pinned Node version immediately.
