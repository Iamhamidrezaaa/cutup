import type {
  CommandCenterAgent,
  CommandCenterAuditEntry,
  CommandCenterDecision,
  CommandCenterExecution,
  CommandCenterEscalation,
  CommandCenterRecommendation,
  CommandCenterRiskSignal,
  CommandCenterTokenBudget
} from '../../types/command-center';
import type { AgentKind, AgentWorkerStatus } from '../../types/command-center';
import type { OperationalItem } from '../../types/operational-state';

function statusBadge(status: string): string {
  if (status === 'running') return 'cc-badge cc-badge--ok';
  if (status === 'awaiting_approval' || status === 'awaiting_human') return 'cc-badge cc-badge--warn';
  if (status === 'error' || status === 'failed') return 'cc-badge cc-badge--bad';
  return 'cc-badge cc-badge--neutral';
}

export function PollStatusBar(props: {
  pollIntervalMs: number;
  lastLoadedAt: string | null;
  snapshotGeneratedAt: string;
}) {
  return (
    <div className="cc-poll-bar muted small">
      <span>
        Snapshot: <time dateTime={props.snapshotGeneratedAt}>{props.snapshotGeneratedAt}</time>
      </span>
      {props.pollIntervalMs > 0 ? (
        <span>Polling every {props.pollIntervalMs / 1000}s (HTTP)</span>
      ) : (
        <span>Polling off</span>
      )}
      {props.lastLoadedAt ? (
        <span title="Last client fetch">
          Fetched: <time dateTime={props.lastLoadedAt}>{props.lastLoadedAt}</time>
        </span>
      ) : null}
    </div>
  );
}

export function ActiveAgentList(props: {
  agents: CommandCenterAgent[];
  parserOwners: { id: string; label: string }[];
}) {
  const ccIds = new Set(props.agents.map((a) => a.id));
  const fallback: CommandCenterAgent[] = props.parserOwners
    .filter((o) => !ccIds.has(o.id))
    .map((o) => ({
      id: o.id,
      kind: 'other' as AgentKind,
      label: `${o.label} (task owner)`,
      status: 'offline' as AgentWorkerStatus,
      current_task_hint: 'No live agent heartbeat — derived from parser graph'
    }));

  const rows = [...props.agents, ...fallback];

  return (
    <section className="cc-section">
      <h2>Active agents</h2>
      <p className="muted small">
        Live rows from <code>command_center.agents</code>; additional rows show task owners when no agent
        heartbeat exists.
      </p>
      {rows.length === 0 ? (
        <p className="muted">No agents. Populate <code>command_center</code> in the snapshot.</p>
      ) : (
        <ul className="cc-agent-grid">
          {rows.map((a) => (
            <li key={a.id} className="cc-agent-card">
              <div className="cc-agent-card__head">
                <strong>{a.label}</strong>
                <span className={statusBadge(a.status)}>{a.status}</span>
              </div>
              <div className="muted small">id: {a.id}</div>
              <div className="small">kind: {a.kind}</div>
              {a.session_id ? <div className="small">session: {a.session_id}</div> : null}
              {a.last_heartbeat_at ? (
                <div className="small">heartbeat: {a.last_heartbeat_at}</div>
              ) : null}
              {a.current_task_hint ? <p className="small cc-agent-card__hint">{a.current_task_hint}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ExecutionTimeline(props: { executions: CommandCenterExecution[] }) {
  const sorted = [...props.executions].sort((a, b) => b.started_at.localeCompare(a.started_at));
  return (
    <section className="cc-section">
      <h2>Execution timeline</h2>
      {sorted.length === 0 ? (
        <p className="muted">No executions recorded.</p>
      ) : (
        <ol className="cc-timeline">
          {sorted.map((ex) => (
            <li key={ex.id} className="cc-timeline__item">
              <div className="cc-timeline__meta">
                <span className={statusBadge(ex.status)}>{ex.status}</span>
                <time dateTime={ex.started_at}>{ex.started_at}</time>
              </div>
              <div className="cc-timeline__body">
                <strong>{ex.headline ?? ex.id}</strong>
                <div className="muted small">
                  agent {ex.agent_id} · in {ex.tokens_input} / out {ex.tokens_output} tok · tools{' '}
                  {ex.tool_calls}
                  {ex.requires_human ? ' · needs human' : ''}
                </div>
                {ex.finished_at ? (
                  <div className="small">finished: {ex.finished_at}</div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function EscalationFeed(props: { items: CommandCenterEscalation[] }) {
  return (
    <section className="cc-section">
      <h2>Escalation feed</h2>
      <p className="muted small">Merged: snapshot feed + task frontmatter escalations.</p>
      {props.items.length === 0 ? (
        <p className="muted">No escalations.</p>
      ) : (
        <ul className="cc-feed">
          {props.items.map((e) => (
            <li key={e.id} className="cc-feed__item">
              <time dateTime={e.ts}>{e.ts}</time>
              <div>
                <strong>{e.reason}</strong>
                <div className="muted small">
                  from {e.from_agent}
                  {e.task_ref ? (
                    <>
                      {' '}
                      · task <code>{e.task_ref}</code>
                    </>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TokenBudgetPanel(props: { budget: CommandCenterTokenBudget; executions: CommandCenterExecution[] }) {
  const b = props.budget;
  const sessionPct = b.session_soft_cap > 0 ? Math.min(100, (b.used_session / b.session_soft_cap) * 100) : 0;
  const runPct = b.per_run_cap > 0 ? Math.min(100, (b.used_tick / b.per_run_cap) * 100) : 0;
  const recentTok = props.executions
    .filter((e) => e.status === 'completed' || e.status === 'running')
    .slice(0, 8)
    .reduce(
      (acc, e) => ({
        in: acc.in + e.tokens_input,
        out: acc.out + e.tokens_output
      }),
      { in: 0, out: 0 }
    );

  return (
    <section className="cc-section">
      <h2>Token budget</h2>
      <dl className="cc-dl">
        <dt>Per-run cap</dt>
        <dd>{b.per_run_cap.toLocaleString()}</dd>
        <dt>Session soft cap</dt>
        <dd>{b.session_soft_cap.toLocaleString()}</dd>
        <dt>Used (session)</dt>
        <dd>
          {b.used_session.toLocaleString()} ({sessionPct.toFixed(1)}% of soft cap)
        </dd>
        <dt>Used (current tick)</dt>
        <dd>
          {b.used_tick.toLocaleString()} ({runPct.toFixed(1)}% of per-run cap)
          {b.tick_label ? ` · ${b.tick_label}` : ''}
        </dd>
        <dt>Recent executions (sample)</dt>
        <dd>
          Σ in {recentTok.in.toLocaleString()} · Σ out {recentTok.out.toLocaleString()}
        </dd>
      </dl>
      <div className="cc-meter">
        <div className="cc-meter__label">Session utilization</div>
        <div className="cc-meter__track">
          <div className="cc-meter__fill" style={{ width: `${sessionPct}%` }} />
        </div>
      </div>
    </section>
  );
}

export function IncidentAlerts(props: { items: OperationalItem[] }) {
  return (
    <section className="cc-section">
      <h2>Incident alerts</h2>
      <p className="muted small">Derived from tasks with P0/P1 priority or high risk class.</p>
      {props.items.length === 0 ? (
        <p className="muted">No incidents flagged.</p>
      ) : (
        <ul className="cc-alerts">
          {props.items.map((it) => (
            <li key={it.source_path} className="cc-alerts__item cc-alerts__item--hot">
              <div>
                <strong>{String(it.fields?.title ?? it.source_path)}</strong>
                <div className="muted small">
                  {String(it.fields?.priority ?? '')} · risk {String(it.fields?.risk_class ?? '')} ·{' '}
                  {String(it.fields?.status ?? '')}
                </div>
              </div>
              <code className="small cc-break">{it.source_path}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RecommendationsList(props: { items: CommandCenterRecommendation[] }) {
  return (
    <section className="cc-section">
      <h2>Operational recommendations</h2>
      {props.items.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ol className="cc-reco">
          {props.items.map((r) => (
            <li key={r.id}>
              <span className="cc-reco__src">{r.source}</span>
              {r.priority ? <span className="cc-badge cc-badge--neutral">{r.priority}</span> : null}{' '}
              {r.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function AuditLogTable(props: { entries: CommandCenterAuditEntry[] }) {
  const sorted = [...props.entries].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 100);
  return (
    <section className="cc-section">
      <h2>Tool audit visibility</h2>
      <p className="muted small">Latest 100 entries from <code>command_center.audit_log</code>.</p>
      {sorted.length === 0 ? (
        <p className="muted">No audit rows.</p>
      ) : (
        <div className="cc-table-wrap">
          <table className="cc-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Principal</th>
                <th>Tool</th>
                <th>OK</th>
                <th>Code</th>
                <th>Dry</th>
                <th>Appr.</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a, i) => (
                <tr key={`${a.ts}-${i}`}>
                  <td>{a.ts}</td>
                  <td className="cc-break">{a.principal_id}</td>
                  <td>
                    <code>{a.tool_id}</code>
                  </td>
                  <td>{a.ok ? '✓' : '✗'}</td>
                  <td>{a.code ?? '—'}</td>
                  <td>{a.dry_run ? 'Y' : 'N'}</td>
                  <td>{a.approval_granted ? 'Y' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function OperationalDecisionsTable(props: { decisions: CommandCenterDecision[] }) {
  const sorted = [...props.decisions].sort((a, b) => b.ts.localeCompare(a.ts));
  return (
    <section className="cc-section">
      <h2>Operational decisions</h2>
      <p className="muted small">Human-supervised checkpoints (no autonomous deploy).</p>
      {sorted.length === 0 ? (
        <p className="muted">No pending decisions in snapshot.</p>
      ) : (
        <ul className="cc-decisions">
          {sorted.map((d) => (
            <li key={d.id} className="cc-decisions__row">
              <div className="cc-decisions__head">
                <span className={statusBadge(d.status)}>{d.status}</span>
                <time dateTime={d.ts}>{d.ts}</time>
              </div>
              <strong>{d.title}</strong>
              <div className="muted small">
                proposed by {d.proposed_by}
                {d.risk ? ` · risk ${d.risk}` : ''}
              </div>
              {d.detail ? <p className="small">{d.detail}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RiskSignalsPanel(props: { signals: CommandCenterRiskSignal[] }) {
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...props.signals].sort(
    (a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9)
  );
  return (
    <section className="cc-section">
      <h2>Risk signals</h2>
      {sorted.length === 0 ? (
        <p className="muted">No signals in snapshot.</p>
      ) : (
        <ul className="cc-risk">
          {sorted.map((s) => (
            <li key={s.id} className={`cc-risk__item cc-risk__item--${s.severity}`}>
              <span className="cc-badge cc-badge--neutral">{s.severity}</span>
              <div>
                <strong>{s.title}</strong>
                {s.detail ? <p className="small muted">{s.detail}</p> : null}
                {s.related_task ? (
                  <div className="small">
                    task <code>{s.related_task}</code>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
