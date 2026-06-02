/**
 * Compare first-caption ASS syncStart: 804d86b (LKG) vs HEAD (current).
 */
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dir, '..');
const lkgRoot = join(repoRoot, '..', 'cutup-lkg-timing');

const segs = [{ start: 1.79, end: 3.2, text: 'hello world test' }];

async function runGenerateAss(root, label) {
  const mod = await import(pathToFileURL(join(root, 'api/video-render/ass-generator.js')).href);
  const isLkg = label === 'lastKnownGood';
  process.env.RENDER_BURN_USE_SOURCE_TIMINGS = isLkg ? '1' : process.env.RENDER_BURN_USE_SOURCE_TIMINGS || '1';
  const ass = mod.generateAssContent(segs, 'mrBeast', {
    captionMode: 'viral',
    playResX: 1080,
    playResY: 1920,
    durationSec: 10
  });
  const row = ass.timingAudit?.assDialogues?.[0] || {};
  const audit = ass.timingAudit || {};
  return {
    label,
    commit: isLkg ? '804d86b' : 'HEAD',
    assTimingPathNote: isLkg ? 'RENDER_BURN_USE_SOURCE_TIMINGS=1 → buildSourceAlignedSubtitles' : 'viral → buildPhraseBurnSubtitles',
    assDialogueSyncStart: row.assStart,
    assDialogueText: String(row.text || '').slice(0, 60),
    inputSegmentStart: segs[0].start,
    deltaFromInputSegmentMs: row.assStart != null ? Math.round((row.assStart - segs[0].start) * 1000) : null
  };
}

const lkg = await runGenerateAss(lkgRoot, 'lastKnownGood');
const cur = await runGenerateAss(repoRoot, 'current');

console.log(JSON.stringify({ lkg, cur, differenceMs: (cur.assDialogueSyncStart ?? 0) - (lkg.assDialogueSyncStart ?? 0) }, null, 2));
