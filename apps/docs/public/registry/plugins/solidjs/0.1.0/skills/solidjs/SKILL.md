# SolidJS

Use this skill when working on SolidJS codebases.

## Guardrails

- Prefer fine-grained reactivity: `createSignal`, `createMemo`, `createResource`
- Avoid unnecessary state duplication
- Keep effects small and deterministic
- Use `onCleanup` for subscriptions

## Project hygiene

- Keep components pure and small
- Prefer colocating styles with components when reasonable
- Add `type` safety for component props

## Useful commands

```sh
pnpm test
pnpm lint
pnpm build
```
