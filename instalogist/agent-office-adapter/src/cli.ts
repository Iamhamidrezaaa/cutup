#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { adaptOperationalToAgentOffice } from './adapt.js';

function usage(): void {
  console.error(`Usage: instalogist-agent-office-adapt <path-to-operational-state.json>

  Reads JSON from disk, prints Agent Office UI model JSON to stdout.
  Read-only; no writes, no network.`);
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file || file === '-h' || file === '--help') {
    usage();
    process.exit(file ? 0 : 1);
  }

  const abs = path.resolve(file);
  let text: string;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    console.error(`[agent-office-adapter] Cannot read file: ${abs}`, e);
    process.exit(1);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    console.warn('[agent-office-adapter] JSON parse failed — emitting empty degraded model');
    const model = adaptOperationalToAgentOffice(null);
    console.log(JSON.stringify(model, null, 2));
    process.exit(0);
  }

  const model = adaptOperationalToAgentOffice(raw);
  console.log(JSON.stringify(model, null, 2));
  process.exit(0);
}

void main();
