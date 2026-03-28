# Vite Basic Playground

This fixture is the canonical consumer-project playground for AgentRig CLI E2E tests.

It is intentionally small, but it is derived from the current `vanilla-ts` Vite starter created with:

```bash
npm create vite@latest -- --template vanilla-ts
```

Current scaffold baseline: `vite ^8.0.1`.

The fixture is trimmed down so tests can copy it into temporary directories quickly while still exercising AgentRig against a real Vite-shaped project.

Use the refresh/check script to compare this fixture against the latest Vite scaffold:

```bash
pnpm playground:vite:check
pnpm playground:vite:refresh
```
