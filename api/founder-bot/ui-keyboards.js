export const BTN = {
  BUSINESS: '📈 Business',
  USERS: '👥 Users',
  OPERATIONS: '🎬 Operations',
  SUPPORT: '🎫 Support',
  SYSTEM: '⚙️ System',
  BACK: '⬅ Back',
  REVENUE: '💰 Revenue',
  MRR: '📊 MRR',
  CONVERSIONS: '🔄 Conversions',
  TOP_COUNTRIES: '🌍 Top Countries',
  USERS_STATS: '👤 Users',
  GROWTH: '📈 Growth',
  EXPORTS: '📦 Exports',
  ERRORS: '⚠ Errors',
  QUEUE: '⏳ Queue',
  PROVIDERS: '🔌 Providers',
  TICKETS: '📬 Tickets',
  URGENT: '🚨 Urgent',
  SLA: '⏱ SLA',
  FEEDBACK: '💬 Feedback',
  HEALTH: '🖥 Health',
  REFRESH: '🔄 Refresh',
  ABOUT: 'ℹ About'
};

export const CB = {
  REVENUE: 'c:revenue',
  MRR: 'c:mrr',
  CONVERSIONS: 'c:conversions',
  TOP_COUNTRIES: 'c:topcountries',
  USERS: 'c:users',
  GROWTH: 'c:growth',
  EXPORTS: 'c:exports',
  ERRORS: 'c:errors',
  QUEUE: 'c:queue',
  PROVIDERS: 'c:providers',
  TICKETS: 'c:tickets',
  URGENT: 'c:urgent',
  SLA: 'c:sla',
  FEEDBACK: 'c:feedback',
  HEALTH: 'c:health',
  DASHBOARD: 'c:dashboard',
  REFRESH: 'a:refresh',
  ABOUT: 'a:about',
  MENU_MAIN: 'm:main',
  MENU_BUSINESS: 'm:business',
  MENU_USERS: 'm:users',
  MENU_OPS: 'm:ops',
  MENU_SUPPORT: 'm:support',
  MENU_SYSTEM: 'm:system'
};

export const MAIN_REPLY_KEYBOARD = {
  keyboard: [
    [{ text: BTN.BUSINESS }, { text: BTN.USERS }],
    [{ text: BTN.OPERATIONS }, { text: BTN.SUPPORT }],
    [{ text: BTN.SYSTEM }]
  ],
  resize_keyboard: true,
  is_persistent: true
};

function inline(rows) {
  return { inline_keyboard: rows };
}

export const INLINE_MENUS = {
  business: inline([
    [
      { text: BTN.REVENUE, callback_data: CB.REVENUE },
      { text: BTN.MRR, callback_data: CB.MRR }
    ],
    [
      { text: BTN.CONVERSIONS, callback_data: CB.CONVERSIONS },
      { text: BTN.TOP_COUNTRIES, callback_data: CB.TOP_COUNTRIES }
    ],
    [{ text: BTN.BACK, callback_data: CB.MENU_MAIN }]
  ]),
  users: inline([
    [
      { text: BTN.USERS_STATS, callback_data: CB.USERS },
      { text: BTN.GROWTH, callback_data: CB.GROWTH }
    ],
    [{ text: BTN.BACK, callback_data: CB.MENU_MAIN }]
  ]),
  operations: inline([
    [
      { text: BTN.EXPORTS, callback_data: CB.EXPORTS },
      { text: BTN.ERRORS, callback_data: CB.ERRORS }
    ],
    [
      { text: BTN.QUEUE, callback_data: CB.QUEUE },
      { text: BTN.PROVIDERS, callback_data: CB.PROVIDERS }
    ],
    [{ text: BTN.BACK, callback_data: CB.MENU_MAIN }]
  ]),
  support: inline([
    [
      { text: BTN.TICKETS, callback_data: CB.TICKETS },
      { text: BTN.URGENT, callback_data: CB.URGENT }
    ],
    [
      { text: BTN.SLA, callback_data: CB.SLA },
      { text: BTN.FEEDBACK, callback_data: CB.FEEDBACK }
    ],
    [{ text: BTN.BACK, callback_data: CB.MENU_MAIN }]
  ]),
  system: inline([
    [
      { text: BTN.HEALTH, callback_data: CB.HEALTH },
      { text: BTN.REFRESH, callback_data: CB.REFRESH }
    ],
    [
      { text: BTN.ABOUT, callback_data: CB.ABOUT },
      { text: BTN.BACK, callback_data: CB.MENU_MAIN }
    ]
  ])
};

export const REPLY_MENU_MAP = {
  [BTN.BUSINESS]: { menu: 'business', title: '📈 Business' },
  [BTN.USERS]: { menu: 'users', title: '👥 Users' },
  [BTN.OPERATIONS]: { menu: 'operations', title: '🎬 Operations' },
  [BTN.SUPPORT]: { menu: 'support', title: '🎫 Support' },
  [BTN.SYSTEM]: { menu: 'system', title: '⚙️ System' }
};

export const CALLBACK_COMMAND_MAP = {
  [CB.REVENUE]: '/revenue',
  [CB.MRR]: '/mrr',
  [CB.CONVERSIONS]: '/conversions',
  [CB.TOP_COUNTRIES]: '/topcountries',
  [CB.USERS]: '/users',
  [CB.EXPORTS]: '/exports',
  [CB.ERRORS]: '/errors',
  [CB.QUEUE]: '/queue',
  [CB.PROVIDERS]: '/providers',
  [CB.TICKETS]: '/tickets',
  [CB.URGENT]: '/urgent',
  [CB.SLA]: '/sla',
  [CB.FEEDBACK]: '/feedback',
  [CB.HEALTH]: '/health',
  [CB.DASHBOARD]: '/dashboard'
};
