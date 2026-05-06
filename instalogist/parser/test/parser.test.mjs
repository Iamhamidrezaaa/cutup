import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runParser } from '../src/run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'workspace');

test('runParser: produces contract and sorts items by path', async () => {
  const now = new Date('2026-05-15T12:00:00Z');
  const state = await runParser({
    workspaceRootAbsolute: FIXTURE_ROOT,
    now,
    lite: true
  });

  assert.equal(state.contract_id, 'instalogist-operational-state-1');
  assert.equal(state.parser_version, '0.1.0');
  assert.ok(state.workspace_root.includes('fixtures'));
  assert.equal(state.snapshot_status, 'degraded');
  assert.ok(state.items.length >= 6);
  assert.ok(state.summary.item_count >= 6);
  assert.ok(state.summary.unparsed_count >= 1);
  assert.ok(Array.isArray(state.graph.nodes));
  assert.ok(Array.isArray(state.graph.edges));

  const paths = state.items.map((i) => i.source_path);
  const sorted = [...paths].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(paths, sorted);

  const valid = state.items.find((i) => i.source_path.endsWith('fixture-valid.md'));
  assert.ok(valid);
  assert.equal(valid.parse_status, 'ok');
  assert.equal(valid.fields.task_id, 'CUTUP-FIX-00001');
  assert.equal(valid.derived.stale, false);

  const missingDate = state.items.find((i) => i.source_path.endsWith('fixture-missing-updated.md'));
  assert.ok(missingDate);
  assert.equal(missingDate.parse_status, 'degraded');
  assert.ok(missingDate.validation.errors.some((e) => e.rule === 'V-DATE'));

  const badYaml = state.items.find((i) => i.source_path.endsWith('fixture-bad-yaml.md'));
  assert.ok(badYaml);
  assert.equal(badYaml.parse_status, 'unparsed_frontmatter');

  const noFm = state.items.find((i) => i.source_path.endsWith('fixture-no-frontmatter.md'));
  assert.ok(noFm);
  assert.equal(noFm.parse_status, 'degraded');

  const incident = state.items.find((i) => i.source_path.includes('fixture-incident.md'));
  assert.ok(incident);
  assert.equal(incident.entity_type, 'incident');
});

test('derive stale: old analyzing task is stale', async () => {
  const now = new Date('2026-07-01T00:00:00Z');
  const state = await runParser({
    workspaceRootAbsolute: FIXTURE_ROOT,
    now,
    lite: true
  });
  const valid = state.items.find((i) => i.source_path.endsWith('fixture-valid.md'));
  assert.ok(valid);
  assert.equal(valid.derived.stale, true);
  assert.ok((valid.derived.days_since_update ?? 0) > 14);
});

test('derive blocked_stale', async () => {
  const now = new Date('2026-07-01T00:00:00Z');
  const { deriveStale } = await import('../src/derive.mjs');
  const d = deriveStale('2026-05-01T00:00:00Z', 'blocked', now);
  assert.equal(d.blocked_stale, true);
});
