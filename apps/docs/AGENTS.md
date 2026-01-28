# AgentRig Docs App

TanStack Start on Cloudflare Workers via Alchemy.

## Quick commands
```sh
pnpm deploy   # alchemy deploy
pnpm dev      # alchemy dev
pnpm destroy  # alchemy destroy
```

## Alchemy CLI (core)
```sh
alchemy deploy [script] [--stage <name>] [--profile <name>] [--env-file <path>] [--watch] [--force] [--adopt]
alchemy dev [script]    [--stage <name>] [--profile <name>] [--env-file <path>] [--force] [--adopt]
alchemy run [script]    [--stage <name>] [--profile <name>] [--env-file <path>] [--watch]
alchemy destroy [script] [--stage <name>] [--profile <name>] [--env-file <path>]
```

## Runtime equivalent
```sh
bun|tsx ./alchemy.run.ts [--dev|--read|--destroy|--stage <name>]
```

## Required env (.env.local)
`VITE_BASE_URL`, `SITE_URL`, `ALCHEMY_PASSWORD`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `STAGE`

## Cloudflare auth
`npx wrangler login` or `alchemy login`

## Infra entrypoint
`alchemy.run.ts` (TanStackStart + KV + prod domains)
