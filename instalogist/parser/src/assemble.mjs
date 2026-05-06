import { CONTRACT_ID, KNOWN_FIELD_KEYS, PARSER_VERSION } from './constants.mjs';
import { buildGraph } from './graph.mjs';

/**
 * @param {Record<string, unknown>} obj
 * @returns {{ fields: Record<string, unknown>, extras: Record<string, unknown> }}
 */
export function splitFieldsAndExtras(obj) {
  /** @type {Record<string, unknown>} */
  const fields = {};
  /** @type {Record<string, unknown>} */
  const extras = {};

  for (const [k, v] of Object.entries(obj)) {
    if (KNOWN_FIELD_KEYS.has(k)) fields[k] = v;
    else extras[k] = v;
  }

  return { fields, extras };
}

/**
 * @param {object} params
 * @param {string} params.workspaceRootAbsolute
 * @param {string} params.generatedAtIso
 * @param {Array<object>} params.items
 * @param {Array<{ message: string, path?: string }>} params.scanErrors
 */
export function assembleOperationalState({ workspaceRootAbsolute, generatedAtIso, items, scanErrors }) {
  const graph = buildGraph(items);

  /** @type {Record<string, number>} */
  const countsByStatus = {};
  /** @type {Record<string, number>} */
  const countsByOwner = {};
  /** @type {Record<string, number>} */
  const countsByPriority = {};
  let staleCount = 0;
  let unparsedCount = 0;

  for (const item of items) {
    const st = item.fields?.status;
    if (typeof st === 'string') countsByStatus[st] = (countsByStatus[st] || 0) + 1;

    const ow = item.fields?.owner_agent;
    if (typeof ow === 'string') countsByOwner[ow] = (countsByOwner[ow] || 0) + 1;

    const pr = item.fields?.priority;
    if (typeof pr === 'string') countsByPriority[pr] = (countsByPriority[pr] || 0) + 1;

    if (item.derived?.stale || item.derived?.blocked_stale) staleCount += 1;
    if (item.parse_status === 'unparsed_frontmatter') unparsedCount += 1;
  }

  let itemErrors = 0;
  for (const item of items) {
    itemErrors += item.validation?.errors?.length || 0;
  }

  const snapshot_status =
    scanErrors.length === 0 && itemErrors === 0 && unparsedCount === 0 ? 'ok' : 'degraded';

  return {
    contract_id: CONTRACT_ID,
    generated_at: generatedAtIso,
    workspace_root: workspaceRootAbsolute,
    parser_version: PARSER_VERSION,
    snapshot_status,
    items,
    graph,
    summary: {
      counts_by_status: countsByStatus,
      counts_by_owner: countsByOwner,
      counts_by_priority: countsByPriority,
      stale_count: staleCount,
      unparsed_count: unparsedCount,
      item_count: items.length
    },
    errors: scanErrors
  };
}
