import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { adaptOperationalToAgentOffice } from '../dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('adapt: empty input yields empty views and warnings', () => {
  const m = adaptOperationalToAgentOffice(null);
  assert.equal(m.agent_office_ui_contract_id, 'instalogist-agent-office-ui-1');
  assert.ok(m.warnings.length > 0);
  assert.equal(m.views.summary.item_count, 0);
});

test('adapt: fixture operational state', () => {
  const jsonPath = join(__dirname, '../../parser/example/operational-state.example.json');
  const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const m = adaptOperationalToAgentOffice(raw);
  assert.equal(m.source.contract_id, 'instalogist-operational-state-1');
  assert.ok(m.views.board.columns.length >= 8);
  assert.ok(m.views.summary.item_count > 0);
  assert.ok(Array.isArray(m.views.ownership.agents));
});
