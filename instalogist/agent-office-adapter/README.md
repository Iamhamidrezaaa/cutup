# @instalogist/agent-office-adapter

**Read-only** transform: `operational-state.json` (`instalogist-operational-state-1`) → **`instalogist-agent-office-ui-1`** (minimal Agent Office–styled views).

- No realtime, no persistence, no writes, no auth, no WebSocket.
- **Stateless** pure function + optional CLI file reader.
- **Degraded-safe:** bad/missing input → empty views + `warnings`; invalid JSON in CLI → stderr + empty model to stdout.
- **Preserves** parser `extras` on each card/row as `preserved_extras`.
- **Not coupled** to CutUp backend.

## Contract

See **[docs/ADAPTER_CONTRACT.md](./docs/ADAPTER_CONTRACT.md)**.

## Install & build

```bash
cd instalogist/agent-office-adapter
npm install
npm run build
```

## CLI

```bash
node dist/cli.js ../parser/example/operational-state.example.json
# or after npm link / global:
# instalogist-agent-office-adapt path/to/operational-state.json
```

Stdout: UI model JSON. Warnings may appear on stderr.

## Programmatic

```ts
import { readFileSync } from 'node:fs';
import { adaptOperationalToAgentOffice } from '@instalogist/agent-office-adapter';

const raw = JSON.parse(readFileSync('operational-state.json', 'utf8'));
const ui = adaptOperationalToAgentOffice(raw);
```

(Local path: `import { adaptOperationalToAgentOffice } from './dist/index.js'`.)

## Tests

```bash
npm test
```

## Pipeline

```text
instalogist/workspace/*.md → parser → operational-state.json → this adapter → views.{board,incidents,ownership,summary}
```

## Related repo docs

- `docs/architecture/instalogist-agent-office-data-mapping.md`
- `docs/architecture/instalogist-visualization-adapter.md`
