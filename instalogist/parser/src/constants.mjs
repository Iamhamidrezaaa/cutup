/** @typedef {'instalogist-operational-state-1'} ContractId */

export const CONTRACT_ID = 'instalogist-operational-state-1';
export const PARSER_VERSION = '0.1.0';

export const LIFECYCLE = new Set([
  'intake',
  'triaged',
  'analyzing',
  'blocked',
  'in_progress',
  'review',
  'done',
  'cancelled'
]);

export const PRIORITY = new Set(['P0', 'P1', 'P2', 'P3']);
export const RISK = new Set(['C', 'H', 'M', 'L']);

export const AGENTS = new Set(['Dev-01', 'Audit-01', 'Ops-01', 'Support-01', 'Growth-01']);

/** Frontmatter keys kept in `fields`; anything else → `extras` */
export const KNOWN_FIELD_KEYS = new Set([
  'task_id',
  'incident_id',
  'title',
  'created_at',
  'updated_at',
  'owner_agent',
  'collaborators',
  'human_owner',
  'priority',
  'risk_class',
  'domains',
  'status',
  'escalation',
  'links',
  'tags',
  'blast_radius_summary',
  'entity_type'
]);

export const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
