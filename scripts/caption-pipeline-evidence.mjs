/**
 * Offline evidence: segmentation split + sample pipeline timing (no export).
 * Run: node scripts/caption-pipeline-evidence.mjs
 */
import { proveSegmentationSplit, collectStyleEvidence } from '../api/video-render/caption-forensics.js';
import { auditSourceAlignedPipelineStages } from '../api/video-render/subtitle-pipeline.js';

const sampleText = 'این بچه تو یه چالش شرکت کرده بود...';

const segmentation = proveSegmentationSplit(sampleText);
const styles = collectStyleEvidence('hormozi', 'hormozi');

const mockWhisperLate = [
  { start: 2.14, end: 4.02, text: 'Hey everyone welcome' },
  { start: 4.1, end: 6.2, text: 'to the challenge' }
];
const pipeline = auditSourceAlignedPipelineStages(mockWhisperLate);

console.log(JSON.stringify({ segmentation, styles, pipelineSample: pipeline }, null, 2));
