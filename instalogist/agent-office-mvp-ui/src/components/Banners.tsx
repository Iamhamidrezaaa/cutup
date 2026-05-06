import type { AgentOfficeUiModel } from '@instalogist/agent-office-adapter';

export function ParserStatusBanner({ model }: { model: AgentOfficeUiModel }): JSX.Element {
  const snap = model.source.snapshot_status;
  const contractOk = model.source.contract_id === 'instalogist-operational-state-1';
  const warnCount = model.warnings.length;
  let level: 'ok' | 'degraded' | 'critical' = 'ok';
  if (!contractOk || warnCount > 0) level = 'degraded';
  if (snap === 'unknown' && model.views.summary.item_count === 0) level = 'critical';

  const parts = [
    `Parser snapshot: ${snap}`,
    model.source.parser_version ? `parser ${model.source.parser_version}` : null,
    model.source.contract_id ? `contract ${model.source.contract_id}` : 'contract (missing)',
    warnCount > 0 ? `${warnCount} adapter notice(s)` : null
  ].filter(Boolean);

  return (
    <div className={`parser-banner ${level}`} role="status" aria-live="polite">
      <strong>Parser / adapter</strong> — {parts.join(' · ')}
    </div>
  );
}

export function SummaryHealthBanner({ model }: { model: AgentOfficeUiModel }): JSX.Element {
  const b = model.views.summary.banner;
  const label =
    b === 'critical'
      ? 'Critical: scan errors, P0 validation issues, or empty invalid input.'
      : b === 'degraded'
        ? 'Degraded: snapshot or items have parse/validation issues.'
        : 'Operational snapshot within expected bounds.';
  return (
    <div className={`summary-banner ${b}`} role="status">
      {label}
    </div>
  );
}
