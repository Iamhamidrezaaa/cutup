/**
 * Founder Bot UI — ReplyKeyboard + InlineKeyboard navigation.
 */
import {
  sendTelegramMessage,
  editTelegramMessage,
  answerCallbackQuery,
  getFounderBotAdminChatId
} from './telegram.js';
import {
  BTN,
  CB,
  MAIN_REPLY_KEYBOARD,
  INLINE_MENUS,
  REPLY_MENU_MAP,
  CALLBACK_COMMAND_MAP
} from './ui-keyboards.js';
import { setLastAction, getLastAction, founderAdminDisplayName } from './ui-session.js';
import { resolveFounderBotCommand } from './commands-router.js';
import { buildAboutText } from './ui-dashboard.js';

function isAuthorizedChat(chatId) {
  const admin = getFounderBotAdminChatId();
  if (!admin) return false;
  return String(chatId) === String(admin);
}

function extractCommand(text) {
  const raw = String(text || '').trim();
  if (!raw.startsWith('/')) return null;
  const token = raw.split(/\s+/)[0].toLowerCase();
  return token.split('@')[0] || null;
}

function buildWelcomeText(from) {
  const name = founderAdminDisplayName(from);
  return ['🚀 CutUp Founder Bot', '', `Welcome ${name}.`, '', 'Use the menu below.'].join('\n');
}

async function sendMainMenuHint(chatId, text = '↩ Main menu') {
  await sendTelegramMessage(text, {
    chatId,
    replyMarkup: MAIN_REPLY_KEYBOARD
  });
}

async function sendSubMenuInline(chatId, menuKey, title) {
  const markup = INLINE_MENUS[menuKey];
  if (!markup) return;
  await sendTelegramMessage(title, { chatId, replyMarkup: markup });
}

async function deliverAction(chatId, action) {
  let text = null;
  if (action.kind === 'command') {
    text = await resolveFounderBotCommand(action.value);
  } else if (action.kind === 'growth') {
    text = await resolveFounderBotCommand('/growth');
  } else if (action.kind === 'about') {
    text = buildAboutText();
  } else if (action.kind === 'dashboard') {
    text = await resolveFounderBotCommand('/dashboard');
  }

  if (!text) return false;
  setLastAction(chatId, action);
  await sendTelegramMessage(text, { chatId, replyMarkup: MAIN_REPLY_KEYBOARD });
  return true;
}

async function handleRefresh(chatId) {
  const last = getLastAction(chatId);
  if (!last) {
    await sendTelegramMessage('Nothing to refresh yet. Open a metric from the menu.', {
      chatId,
      replyMarkup: MAIN_REPLY_KEYBOARD
    });
    return;
  }
  await deliverAction(chatId, last);
}

async function handleCallbackQuery(query) {
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  if (!isAuthorizedChat(chatId)) {
    await answerCallbackQuery(query.id, { text: 'Unauthorized' });
    return;
  }

  const data = String(query.data || '');
  await answerCallbackQuery(query.id);

  if (data === CB.MENU_MAIN) {
    if (messageId) {
      await editTelegramMessage(chatId, messageId, '↩ Main menu — use the keyboard below.');
    }
    await sendMainMenuHint(chatId);
    return;
  }

  if (data === CB.REFRESH) {
    await handleRefresh(chatId);
    return;
  }

  if (data === CB.ABOUT) {
    setLastAction(chatId, { kind: 'about', value: 'about' });
    await sendTelegramMessage(buildAboutText(), {
      chatId,
      replyMarkup: MAIN_REPLY_KEYBOARD
    });
    return;
  }

  if (data === CB.GROWTH) {
    await deliverAction(chatId, { kind: 'growth', value: '/growth' });
    return;
  }

  const command = CALLBACK_COMMAND_MAP[data];
  if (command) {
    await deliverAction(chatId, { kind: 'command', value: command });
    return;
  }

  const menuMap = {
    [CB.MENU_BUSINESS]: ['business', '📈 Business'],
    [CB.MENU_USERS]: ['users', '👥 Users'],
    [CB.MENU_OPS]: ['operations', '🎬 Operations'],
    [CB.MENU_SUPPORT]: ['support', '🎫 Support'],
    [CB.MENU_SYSTEM]: ['system', '⚙️ System']
  };
  const menu = menuMap[data];
  if (menu) {
    await sendSubMenuInline(chatId, menu[0], menu[1]);
  }
}

async function handleMessage(message) {
  const chatId = message.chat?.id;
  const text = String(message.text || '').trim();
  if (!text || !isAuthorizedChat(chatId)) return;

  const command = extractCommand(text);
  if (command === '/start') {
    await sendTelegramMessage(buildWelcomeText(message.from), {
      chatId,
      replyMarkup: MAIN_REPLY_KEYBOARD
    });
    setLastAction(chatId, { kind: 'dashboard', value: '/dashboard' });
    return;
  }

  if (command === '/dashboard') {
    await deliverAction(chatId, { kind: 'dashboard', value: '/dashboard' });
    return;
  }

  if (command) {
    const reply = await resolveFounderBotCommand(command);
    if (reply) {
      setLastAction(chatId, { kind: 'command', value: command });
      await sendTelegramMessage(reply, { chatId, replyMarkup: MAIN_REPLY_KEYBOARD });
    }
    return;
  }

  if (text === BTN.REFRESH) {
    await handleRefresh(chatId);
    return;
  }

  if (text === BTN.ABOUT) {
    setLastAction(chatId, { kind: 'about', value: 'about' });
    await sendTelegramMessage(buildAboutText(), {
      chatId,
      replyMarkup: MAIN_REPLY_KEYBOARD
    });
    return;
  }

  const menu = REPLY_MENU_MAP[text];
  if (menu) {
    await sendSubMenuInline(chatId, menu.menu, menu.title);
    return;
  }
}

export async function handleFounderBotUiUpdate(update) {
  if (update?.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }
  if (update?.message?.text) {
    await handleMessage(update.message);
  }
}
