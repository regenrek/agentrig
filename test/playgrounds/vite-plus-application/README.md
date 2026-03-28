# Vite+ Application Playground

This fixture is the canonical Vite+ consumer-project playground for AgentRig CLI E2E tests.

It is derived from a real `vp create vite:application` scaffold and then normalized so tests can copy it into temporary directories quickly.

Current scaffold baseline: `vite-plus latest` with `npm:@voidzero-dev/vite-plus-core@latest`.

Use the refresh/check script to compare this fixture against the latest normalized Vite+ scaffold:

```bash
pnpm playground:vite-plus:check
pnpm playground:vite-plus:refresh
```
