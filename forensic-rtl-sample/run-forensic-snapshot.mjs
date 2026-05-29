import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateAssContent } from '../api/video-render/ass-generator.js';
import { buildTimelineBurnPlan, buildAlignedVideoFilter } from '../api/video-render/ffmpeg-timeline.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const segs = [
  { start: 0.5, end: 3.2, text: 'برای اولین بار در باشگاه ورزشی', isFinal: true },
  { start: 3.5, end: 6, text: 'من آماده هستم', isFinal: true }
];

const ass = generateAssContent(segs, 'cleanSrt', {
  playResX: 1080,
  playResY: 1920,
  captionMode: 'accurate'
});
const content = String(ass.content || '');

function srtTime(t) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const whole = Math.floor(s);
  const ms = Math.round((s % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(whole).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

const srt = segs
  .map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`)
  .join('\n');

writeFileSync(join(__dir, 'sample-source.srt'), srt, 'utf8');
writeFileSync(join(__dir, 'cutup-generated.ass'), content, 'utf8');

const [styleBlock, eventsBlock = ''] = content.split('[Events]');
const dialogues = eventsBlock.split(/\r?\n/).filter((l) => l.startsWith('Dialogue:')).slice(0, 20);

const plan = buildTimelineBurnPlan(
  { video: { start_time: 0 }, audio: { start_time: 0 }, format: { start_time: 0 } },
  segs,
  { inputAlreadyNormalized: true, preferMinimalCorrection: true, firstSpeechSec: null }
);
const vf = buildAlignedVideoFilter('subtitles.ass', plan, {
  skipTimelineFilters: true,
  playResX: 1080,
  playResY: 1920
});

const cutupCmd = [
  'ffmpeg -hide_banner -y',
  '-i INPUT.mp4',
  `-vf "${vf}"`,
  '-c:v libx264 -preset fast -crf 23',
  '-c:a aac',
  'OUT_cutup_ass.mp4'
].join(' ');

const srtCmd = [
  'ffmpeg -hide_banner -y',
  '-i INPUT.mp4',
  "-vf \"subtitles=sample-source.srt:force_style='Fontname=Vazirmatn,Alignment=2'\"",
  '-c:v libx264 -preset fast -crf 23',
  '-c:a aac',
  'OUT_srt_direct.mp4'
].join(' ');

const report = {
  playResX: ass.playResX,
  playResY: ass.playResY,
  exportRtlFlag: ass.rtl,
  fontsInStyles: [...content.matchAll(/^Style: ([^,]+),([^,]+),/gm)].map((m) => ({
    styleName: m[1],
    fontName: m[2]
  })),
  dialogueLineCount: (content.match(/^Dialogue:/gm) || []).length,
  first20DialogueLines: dialogues,
  fullStyleSection: styleBlock.trim(),
  cutupSubtitleFilterString: vf,
  cutupFfmpegCommand: cutupCmd,
  srtFfmpegCommand: srtCmd,
  timelinePlan: {
    assShiftSec: plan.assShiftSec,
    videoPtsShiftSec: plan.videoPtsShiftSec,
    skipTimelineCorrection: plan.skipTimelineCorrection
  }
};

writeFileSync(join(__dir, 'forensic-report.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(join(__dir, 'ffmpeg-cutup-command.sh'), cutupCmd + '\n', 'utf8');
writeFileSync(join(__dir, 'ffmpeg-srt-command.sh'), srtCmd + '\n', 'utf8');
console.log(JSON.stringify({ ok: true, dir: __dir, dialogues: dialogues.length }, null, 2));
