# @instalogist/memory

PostgreSQL operational memory for Instalogist (Prisma + TypeScript). **No AI logic** — persistence and repository APIs only.

## Setup

1. Copy `.env.example` → `.env` and set `DATABASE_URL`.
2. `npm install`
3. `npx prisma migrate deploy` (or `npm run db:migrate:dev` for local dev naming)
4. `npm run db:seed` (optional)

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run db:generate` | Regenerate Prisma Client |
| `npm run db:migrate` | Apply migrations (deploy) |
| `npm run db:migrate:dev` | Create/apply dev migration |
| `npm run db:seed` | Run `prisma/seed.ts` |
| `npm run build` | Compile `src/` to `dist/` |

## Design notes

- **Append-first:** Decisions, deployment events, and operational summaries are created, not mutated (except controlled fields like escalation resolution / conversation `endedAt`).
- **Tasks / incidents:** `upsert` by `(source, externalKey)` for idempotent ingestion from markdown/parser.
- **Provenance:** `source`, `sourceRef`, `generatedAt`, optional `sourceGeneratedAt`.

## Usage

```typescript
import { prisma, upsertTask, appendDecision, disconnectPrisma } from '@instalogist/memory';

await upsertTask(prisma, { externalKey: 'T-1', title: 'Example', source: 'markdown_workspace' });
await disconnectPrisma();
```

Package exports are defined from `src/index.ts` (use `dist/` after build, or wire `tsx`/bundler to `src` in monorepo).
