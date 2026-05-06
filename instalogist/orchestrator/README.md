# @instalogist/orchestrator

Operational orchestration layer (OpenClaw-inspired concepts): **task queue**, **agent registry**, **execution lifecycle**, **retries**, **escalation hints**, **token budget caps**, **structured audit logs**, and **human approval checkpoints**.

- **No** autonomous deployment, **no** self-modifying loops.
- **No** LLM calls in this package — implement `AgentRunner` elsewhere.
- Dangerous classes and action hints **always** route through `awaiting_approval` until a human calls `resolveApproval`.

## Quick use

```typescript
import {
  OrchestrationEngine,
  StubCtoRunner,
  StubDeveloperRunner,
  StubSupportRunner
} from '@instalogist/orchestrator';

const engine = new OrchestrationEngine();
engine.registerRunner(new StubCtoRunner());
engine.registerRunner(new StubDeveloperRunner());
engine.registerRunner(new StubSupportRunner());

engine.submitTask({
  id: 't1',
  kind: 'engineering',
  payload: { simulate_deploy: 'true' },
  priority: 10,
  dangerClass: 'safe'
});

await engine.tick(1);
const pending = engine.state.listPendingApprovals();
if (pending[0]) {
  engine.resolveApproval(pending[0].id, true, 'human:cto');
}
```

## Scripts

- `npm run build` — compile to `dist/`

## Agents

| ID | Role |
|----|------|
| `cto-agent` | CTO Agent |
| `developer-agent` | Developer Agent |
| `support-agent` | Support Agent |

Register custom runners with `engine.registerRunner(myRunner)`.
