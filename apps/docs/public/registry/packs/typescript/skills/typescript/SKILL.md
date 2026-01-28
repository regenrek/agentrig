# TypeScript

Use this skill when working on TypeScript codebases.

## Guardrails

- Prefer explicit types at module boundaries
- Avoid `any` in shared code
- Use narrow unions instead of boolean flags when it clarifies intent
- Validate untrusted inputs (for example with zod)

## Project hygiene

- Run typecheck and tests before merging
- Keep tsconfig strict mode on
