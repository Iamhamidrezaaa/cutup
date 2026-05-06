import type { LoadedOperational } from '@agent-office-ui/adapters/instalogist';

export function OperationalIssuesBanner({ operational }: { operational: LoadedOperational | null }): JSX.Element | null {
  if (operational == null) return null;
  const { contractValid, issues, model } = operational;
  if (contractValid && issues.length === 0 && model.warnings.length === 0) return null;
  return (
    <div className="issues-banner" role="status">
      {!contractValid && <strong>Contract warning — </strong>}
      <span>Operational data is shown in degraded mode. Review issues below.</span>
      <ul className="issues-list">
        {issues.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
        {model.warnings.map((t, i) => (
          <li key={`w-${i}`}>Adapter: {t}</li>
        ))}
      </ul>
    </div>
  );
}
