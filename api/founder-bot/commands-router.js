/**
 * Resolve any founder bot slash command across V1–V1.3 + dashboard.
 */
export async function resolveFounderBotCommand(command) {
  const cmd = String(command || '').toLowerCase();
  if (!cmd.startsWith('/')) return null;

  if (cmd === '/dashboard') {
    const { buildDashboardText } = await import('./ui-dashboard.js');
    return buildDashboardText();
  }

  if (cmd === '/growth') {
    const { buildGrowthText } = await import('./ui-dashboard.js');
    return buildGrowthText();
  }

  if (cmd === '/about') {
    const { buildAboutText } = await import('./ui-dashboard.js');
    return buildAboutText();
  }

  if (cmd === '/telegram') {
    const { buildTelegramStatusText } = await import('./telegram-health.js');
    return buildTelegramStatusText();
  }

  const { dispatchCommand } = await import('./commands.js');
  let reply = await dispatchCommand(cmd);
  if (!reply) {
    const { dispatchCommandV12 } = await import('./commands-v12.js');
    reply = await dispatchCommandV12(cmd);
  }
  if (!reply) {
    const { dispatchCommandV13 } = await import('./commands-v13.js');
    reply = await dispatchCommandV13(cmd);
  }
  if (!reply) {
    const { dispatchCommandV14 } = await import('./commands-v14.js');
    reply = await dispatchCommandV14(cmd);
  }
  if (reply && cmd === '/help') {
    const { founderBotHelpExtension } = await import('./commands-v12.js');
    const { founderBotHelpExtensionV13 } = await import('./commands-v13.js');
    const { founderBotHelpExtensionV14 } = await import('./commands-v14.js');
    reply = `${reply}\n\n${founderBotHelpExtension}\n${founderBotHelpExtensionV13}\n${founderBotHelpExtensionV14}\n/telegram — Telegram connection status\n/dashboard — executive summary`;
  }
  return reply;
}
