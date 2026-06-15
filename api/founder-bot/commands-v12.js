/**
 * Founder Bot V1.2 — slash commands and formatters.
 */
import {
  getExportsMetrics,
  getErrorsMetrics,
  getProvidersMetrics,
  getQueueMetrics,
  formatDurationSec
} from './metrics-v12.js';

export const founderBotHelpExtension = [
  '/exports — export stats',
  '/errors — top errors (24h)',
  '/providers — API health',
  '/queue — render queue'
].join('\n');

function formatExports(m) {
  if (!m.ok) return `⚠️ Exports\n\n${m.error || 'Unavailable'}`;
  return [
    '🎬 Exports',
    '',
    `Exports Today: ${m.today}`,
    `Exports This Week: ${m.week}`,
    '',
    `Success Rate: ${m.successRate}%`,
    `Average Processing Time: ${formatDurationSec(m.avgProcessingSec)}`,
    '',
    `Most Used Style: ${m.topStyle}`,
    `Most Used Language: ${m.topLanguage}`
  ].join('\n');
}

function formatErrors(m) {
  if (!m.ok) return `⚠️ Errors\n\n${m.error || 'Unavailable'}`;
  const lines = ['🚨 Errors (24h)', ''];

  if (!m.top?.length) {
    lines.push('No errors recorded in the last 24 hours.');
    return lines.join('\n');
  }

  lines.push('Top 10');
  m.top.forEach((item, i) => {
    lines.push(`${i + 1}. [${item.category}] ${item.message} (${item.count}×)`);
  });

  const groups = ['FFmpeg', 'Transcription', 'Translation', 'Billing', 'Auth'];
  lines.push('');
  for (const group of groups) {
    const items = m.buckets[group] || [];
    lines.push(group);
    if (!items.length) {
      lines.push('—');
    } else {
      for (const item of items.slice(0, 3)) {
        lines.push(`• ${item.message} (${item.count}×)`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function formatProviders(m) {
  if (!m.ok) return `⚠️ Providers\n\nUnavailable`;
  const lines = ['🔌 Providers', ''];
  for (const p of m.providers) {
    const rt = p.responseMs != null ? `${p.responseMs}ms` : '—';
    lines.push(p.name);
    lines.push(`Status: ${p.status}`);
    lines.push(`Response Time: ${rt}`);
    lines.push(`Last Failure: ${p.lastFailure}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function formatQueue(m) {
  if (!m.ok) return `⚠️ Queue\n\nUnavailable`;
  return [
    '⏳ Queue',
    '',
    `Pending Jobs: ${m.pending}`,
    `Running Jobs: ${m.running}`,
    `Failed Jobs: ${m.failed}`,
    '',
    `Average Queue Time: ${formatDurationSec(m.avgQueueSec)}`
  ].join('\n');
}

export async function dispatchCommandV12(command) {
  switch (command) {
    case '/exports':
      return formatExports(await getExportsMetrics());
    case '/errors':
      return formatErrors(await getErrorsMetrics());
    case '/providers':
      return formatProviders(await getProvidersMetrics());
    case '/queue':
      return formatQueue(await getQueueMetrics());
    default:
      return null;
  }
}
