#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { runParser } from './run.mjs';

function printUsage() {
  console.error(`Usage: node src/cli.mjs --root <path-to-instalogist/workspace> [--out <file.json>] [--lite] [--now ISO-8601] [--verbose]

  Read-only scan of active/tasks, active/incidents, active/growth.
  Exit 0: JSON snapshot written (stdout or --out), even if snapshot_status is degraded.
  Exit 1: fatal (missing root, invalid --now).`);
}

/**
 * @param {string[]} argv
 */
export async function main(argv) {
  let rootArg = null;
  let outPath = null;
  let lite = false;
  let verbose = false;
  let nowArg = null;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root' && argv[i + 1]) {
      rootArg = argv[++i];
    } else if (a === '--out' && argv[i + 1]) {
      outPath = argv[++i];
    } else if (a === '--lite') {
      lite = true;
    } else if (a === '--verbose') {
      verbose = true;
    } else if (a === '--now' && argv[i + 1]) {
      nowArg = argv[++i];
    } else if (a === '-h' || a === '--help') {
      printUsage();
      process.exit(0);
    }
  }

  if (!rootArg) {
    printUsage();
    process.exit(1);
  }

  const cwd = process.cwd();
  const workspaceRoot = path.isAbsolute(rootArg) ? path.resolve(rootArg) : path.resolve(cwd, rootArg);

  try {
    const stat = await fs.stat(workspaceRoot);
    if (!stat.isDirectory()) {
      console.error(`[instalogist-parser] Not a directory: ${workspaceRoot}`);
      process.exit(1);
    }
  } catch {
    console.error(`[instalogist-parser] Workspace root not found: ${workspaceRoot}`);
    process.exit(1);
  }

  let now = new Date();
  if (nowArg) {
    const d = Date.parse(nowArg);
    if (Number.isNaN(d)) {
      console.error(`[instalogist-parser] Invalid --now: ${nowArg}`);
      process.exit(1);
    }
    now = new Date(d);
  }

  let state;
  try {
    state = await runParser({
      workspaceRootAbsolute: workspaceRoot,
      now,
      lite,
      verbose
    });
  } catch (e) {
    console.error(`[instalogist-parser] Fatal: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }

  const json = JSON.stringify(state, null, 2);

  if (outPath) {
    const outAbs = path.isAbsolute(outPath) ? outPath : path.join(cwd, outPath);
    await fs.mkdir(path.dirname(outAbs), { recursive: true });
    await fs.writeFile(outAbs, json, 'utf8');
  } else {
    console.log(json);
  }

  process.exit(0);
}

main(process.argv).catch((e) => {
  console.error(`[instalogist-parser] Unhandled: ${e instanceof Error ? e.stack : e}`);
  process.exit(1);
});
