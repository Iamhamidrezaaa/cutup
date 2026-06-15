/**
 * Founder Bot V1.4 — daily executive briefing command.
 */
import { buildBriefingText } from './metrics-v14.js';

export const founderBotHelpExtensionV14 = '/briefing — daily executive briefing';

export async function dispatchCommandV14(command) {
  if (command === '/briefing') {
    return buildBriefingText();
  }
  return null;
}
