import { AGENTS, LIFECYCLE, PRIORITY, RISK } from './constants.mjs';

/**
 * @param {Record<string, unknown>} obj
 * @returns {{ errors: { rule: string, message: string }[], warnings: { rule: string, message: string }[] }}
 */
export function validateFrontmatter(obj) {
  const errors = [];
  const warnings = [];

  const taskId = obj.task_id;
  const incidentId = obj.incident_id;
  const hasId =
    (typeof taskId === 'string' && taskId.trim() !== '') ||
    (typeof incidentId === 'string' && incidentId.trim() !== '');

  if (!hasId) {
    errors.push({ rule: 'V-ID', message: 'Missing task_id and incident_id' });
  }

  const title = obj.title;
  if (typeof title !== 'string' || title.trim() === '') {
    errors.push({ rule: 'V-TITLE', message: 'Missing or empty title' });
  }

  const updatedAt = obj.updated_at;
  if (updatedAt == null || (typeof updatedAt === 'string' && updatedAt.trim() === '')) {
    errors.push({ rule: 'V-DATE', message: 'Missing updated_at' });
  }

  const status = obj.status;
  if (status != null && typeof status === 'string' && status.trim() !== '') {
    if (!LIFECYCLE.has(status)) {
      warnings.push({ rule: 'V-STATUS', message: `Unknown status: ${status}` });
    }
  } else if (status != null) {
    warnings.push({ rule: 'V-STATUS', message: 'status must be a string' });
  }

  const priority = obj.priority;
  if (priority != null && typeof priority === 'string' && priority.trim() !== '') {
    if (!PRIORITY.has(priority)) {
      warnings.push({ rule: 'V-PRIORITY', message: `Unknown priority: ${priority}` });
    }
  } else if (priority != null) {
    warnings.push({ rule: 'V-PRIORITY', message: 'priority must be a string' });
  }

  const riskClass = obj.risk_class;
  if (riskClass != null && typeof riskClass === 'string' && riskClass.trim() !== '') {
    if (!RISK.has(riskClass)) {
      warnings.push({ rule: 'V-RISK', message: `Unknown risk_class: ${riskClass}` });
    }
  } else if (riskClass != null) {
    warnings.push({ rule: 'V-RISK', message: 'risk_class must be a string' });
  }

  const owner = obj.owner_agent;
  if (owner != null && typeof owner === 'string' && owner.trim() !== '') {
    if (!AGENTS.has(owner)) {
      warnings.push({ rule: 'V-OWNER', message: `Unknown owner_agent: ${owner}` });
    }
  } else if (owner != null) {
    warnings.push({ rule: 'V-OWNER', message: 'owner_agent must be a string' });
  }

  const esc = obj.escalation;
  if (esc != null && (typeof esc !== 'object' || Array.isArray(esc))) {
    warnings.push({ rule: 'V-ESC', message: 'escalation must be an object' });
  }

  return { errors, warnings };
}

/**
 * @param {{ errors: unknown[], warnings: unknown[] }} validation
 * @param {boolean} yamlFailed
 * @param {boolean} extractFailed
 * @param {boolean} emptyFile
 * @returns {'ok' | 'degraded' | 'unparsed_frontmatter' | 'empty'}
 */
export function computeParseStatus(validation, yamlFailed, extractFailed, emptyFile) {
  if (emptyFile) return 'empty';
  if (extractFailed || yamlFailed) return 'unparsed_frontmatter';
  if (validation.errors.length > 0) return 'degraded';
  return 'ok';
}
