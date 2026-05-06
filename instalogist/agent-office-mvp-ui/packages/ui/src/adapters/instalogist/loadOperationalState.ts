import {
  adaptOperationalToAgentOffice,
  type AgentOfficeUiModel,
  type OperationalStateLoose
} from '@instalogist/agent-office-adapter';

export const OPERATIONAL_STATE_CONTRACT_ID = 'instalogist-operational-state-1' as const;

export type LoadedOperational = {
  raw: OperationalStateLoose;
  model: AgentOfficeUiModel;
  contractValid: boolean;
  issues: string[];
  parseAnomalyCount: number;
  scanErrorCount: number;
};

function asState(raw: unknown): OperationalStateLoose {
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as OperationalStateLoose;
  }
  return {};
}

function collectIssues(state: OperationalStateLoose): string[] {
  const issues: string[] = [];
  if (state.contract_id !== OPERATIONAL_STATE_CONTRACT_ID) {
    issues.push(
      `contract_id mismatch: expected "${OPERATIONAL_STATE_CONTRACT_ID}", got ${JSON.stringify(state.contract_id)} — degraded projection`
    );
  }
  if (state.snapshot_status === 'degraded') {
    issues.push('snapshot_status is degraded');
  }
  const scan = state.errors;
  if (Array.isArray(scan)) {
    for (const e of scan) {
      const msg = typeof e?.message === 'string' ? e.message : JSON.stringify(e);
      const path = typeof e?.path === 'string' ? ` (${e.path})` : '';
      issues.push(`scan: ${msg}${path}`);
    }
  }
  const items = Array.isArray(state.items) ? state.items : [];
  let badParse = 0;
  for (const it of items) {
    const ps = typeof it.parse_status === 'string' ? it.parse_status : '';
    const errN = Array.isArray(it.validation?.errors) ? it.validation!.errors!.length : 0;
    if (ps !== 'ok' || errN > 0) badParse++;
  }
  if (badParse > 0) {
    issues.push(`${badParse} item(s) with parse or validation issues`);
  }
  return issues;
}

/**
 * Fetch and adapt operational-state.json. Always returns a model (adapter is best-effort);
 * `contractValid` and `issues` surface degraded / parse problems for the UI.
 */
export async function loadOperationalState(url: string): Promise<
  | { ok: true; data: LoadedOperational }
  | { ok: false; error: string; detail?: string }
> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    return { ok: false, error: 'Network error loading operational snapshot', detail: e instanceof Error ? e.message : String(e) };
  }
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}`, detail: url };
  }
  const text = await res.text();
  let rawUnknown: unknown;
  try {
    rawUnknown = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'Invalid JSON', detail: e instanceof Error ? e.message : String(e) };
  }
  const raw = asState(rawUnknown);
  const contractValid = raw.contract_id === OPERATIONAL_STATE_CONTRACT_ID;
  const issues = collectIssues(raw);
  const model = adaptOperationalToAgentOffice(rawUnknown);
  const items = Array.isArray(raw.items) ? raw.items : [];
  const parseAnomalyCount = items.filter((it) => {
    const ps = typeof it.parse_status === 'string' ? it.parse_status : '';
    const errN = Array.isArray(it.validation?.errors) ? it.validation!.errors!.length : 0;
    return ps !== 'ok' || errN > 0;
  }).length;
  const scanErrorCount = Array.isArray(raw.errors) ? raw.errors.length : 0;
  return {
    ok: true,
    data: { raw, model, contractValid, issues, parseAnomalyCount, scanErrorCount }
  };
}
