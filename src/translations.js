/* NEXUS PRO — UI translations (ar / en).
   Loaded before app.js; t() reads the global `lang` from app.js at call
   time, so the load order is fine even though TR lives in a separate file.

   Each key maps to `{ ar: '...', en: '...' }`. Unknown keys fall back to
   the key itself. If a key is added here, the UI can reference it via
   the t() helper or the `data-t` attribute + retranslation on toggle. */

const TR = {
  nav_home: { ar: 'الرئيسية', en: 'Home' },
  nav_scan: { ar: 'السكانر', en: 'Scanner' },
  nav_whale: { ar: 'حيتان', en: 'Whales' },
  nav_ind: { ar: 'مؤشرات', en: 'Indicators' },
  nav_me: { ar: 'حسابي', en: 'Profile' },
  nav_market: { ar: 'حركة السوق', en: 'Market' },

  /* Signals & categories */
  breakout: { ar: 'بداية صعود', en: 'Rising' },
  whales: { ar: 'شراء حيتان', en: 'Whale Buying' },
  whale_sell: { ar: 'بيع حيتان', en: 'Whale Selling' },
  liquidity: { ar: 'سيولة', en: 'Liquidity' },
  confirmed: { ar: 'مؤكدة', en: 'Confirmed' },
  buy_strong: { ar: 'شراء قوي', en: 'Strong Buy' },
  buy: { ar: 'شراء', en: 'Buy' },
  sell: { ar: 'بيع', en: 'Sell' },
  hold: { ar: 'انتظار', en: 'Hold' },

  /* Profile / account tabs */
  my_trades: { ar: 'صفقاتي', en: 'My Trades' },
  my_stats: { ar: 'إحصائياتي', en: 'My Stats' },
  my_settings: { ar: 'إعداداتي', en: 'My Settings' },
  my_log: { ar: 'سجل', en: 'History' },
  notif_log: { ar: 'سجل الإشعارات', en: 'Notification History' },
  clear_log: { ar: 'مسح السجل', en: 'Clear History' },

  /* Generic actions */
  scanning: { ar: 'جاري المسح...', en: 'Scanning...' },
  all: { ar: 'الكل', en: 'All' },
  full_scan: { ar: 'مسح شامل', en: 'Full Scan' },
  refresh: { ar: 'تحديث', en: 'Refresh' },
  add: { ar: 'إضافة', en: 'Add' },
  add_coin: { ar: 'إضافة عملة', en: 'Add Coin' },
  add_coins: { ar: 'أضف عملات', en: 'Add coins' },
  cancel: { ar: 'إلغاء', en: 'Cancel' },
  back: { ar: 'رجوع', en: 'Back' },

  /* Stats */
  total: { ar: 'إجمالي', en: 'Total' },
  buying: { ar: 'شراء', en: 'Buying' },
  selling: { ar: 'بيع', en: 'Selling' },
  success: { ar: 'النجاح', en: 'Success' },

  /* Portfolio / risk calc */
  portfolio: { ar: 'المحفظة', en: 'Portfolio' },
  empty_port: { ar: 'فارغة', en: 'Empty' },
  risk_calc: { ar: 'حاسبة المخاطر', en: 'Risk Calc' },
  capital: { ar: 'رأس المال', en: 'Capital' },
  risk_pct: { ar: 'المخاطرة', en: 'Risk' },
  entry_price: { ar: 'سعر الدخول', en: 'Entry' },
  enter_data: { ar: 'ادخل البيانات', en: 'Enter data' },
  risk_amt: { ar: '💰 المخاطرة', en: '💰 Risk' },
  pos_size: { ar: '📦 الحجم', en: '📦 Size' },
  pos_val: { ar: '💵 القيمة', en: '💵 Value' },
  leverage: { ar: '📊 الرافعة', en: '📊 Leverage' },
  exp_profit: { ar: '🎯 الربح', en: '🎯 Profit' },
  sl_loss: { ar: '🛑 الخسارة', en: '🛑 Loss' },

  /* Alerts / search */
  alerts: { ar: 'تنبيهات', en: 'Alerts' },
  search_ph: { ar: 'ابحث عن أي عملة...', en: 'Search any coin...' },
  no_ultra: { ar: 'لا ULTRA حالياً', en: 'No ULTRA' },
  no_whale: { ar: 'لا تجميع حيتان', en: 'No whales' },
  no_data: { ar: 'لا بيانات', en: 'No data' },

  /* Market health */
  market_health: { ar: '🏥 صحة السوق', en: '🏥 Market Health' },
  smart_warn: { ar: 'تحذيرات ذكية', en: 'Smart Warnings' },
  sec_accuracy: { ar: '📈 نسبة النجاح', en: '📈 Accuracy' },

  /* Scanner */
  scan_desc: {
    ar: 'صيد مبكر — 6 فحوصات — 🏆 Top 100 Focus',
    en: 'Early detection — 6 checks — 🏆 Top 100 Focus',
  },
  scan_trade: { ar: 'صفقات مضاربة', en: 'Trading' },
  scan_trend: { ar: 'ترند القطاعات', en: 'Sector Trends' },
  scan_gems: { ar: 'صيد الجواهر', en: 'Gem Hunter' },
  scan_all: { ar: 'الكل', en: 'All' },
  scan_fast: { ar: '⚡ سريع', en: '⚡ Fast' },
  scan_daily: { ar: '📊 يومي', en: '📊 Daily' },
  scan_early: { ar: '🟢 مبكر', en: '🟢 Early' },
  scan_still: { ar: '🟡 فرصة', en: '🟡 Still' },
  scan_late: { ar: '🔴 متأخر', en: '🔴 Late' },
  scan_signals: { ar: 'إشارة', en: 'signals' },
  scan_sectors: { ar: 'قطاعات', en: 'sectors' },
  scan_gems_found: { ar: 'جواهر مكتشفة', en: 'gems found' },
  scan_updated: { ar: 'آخر تحديث', en: 'Updated' },
  scan_enter: { ar: '▶ ادخل', en: '▶ Enter' },
  scan_chart: { ar: '📈 شارت', en: '📈 Chart' },
  scan_duration: { ar: 'مدة متوقعة', en: 'Duration' },
  scan_warn_small: {
    ar: '⚠️ ربح عالي + مخاطرة عالية — لا تدخل أكثر من 5% من رأس مالك!',
    en: '⚠️ High profit + High risk — max 5% of capital!',
  },
  scan_coins_loaded: { ar: 'عملات', en: 'Coins' },
  scan_source: { ar: 'المصدر', en: 'Source' },

  /* Dates / timing */
  days: { ar: 'يوم', en: 'days' },
  today: { ar: 'اليوم!', en: 'Today!' },
  instant: { ar: 'فوري', en: 'Instant' },
  strong_signal: { ar: 'شراء/بيع قوي', en: 'Strong signal' },
  before_unlock: { ar: 'قبل الفك', en: 'Before unlock' },

  /* Gems / watchlist */
  gems: { ar: 'جواهر', en: 'Gems' },
  gem_desc: {
    ar: '💎 عملات صغيرة بحركة غير عادية — فرص أرباح كبيرة',
    en: '💎 Small caps with unusual moves — big profit potential',
  },
  wl_desc: {
    ar: '👁 أضف عملات لمراقبتها 24/7',
    en: '👁 Add coins to watch 24/7',
  },

  /* Stable flow */
  stable_flow: { ar: 'حركة الأموال', en: 'Money Flow' },
  sf_index: { ar: 'مؤشر التدفق', en: 'Flow Index' },
  sf_buy: { ar: 'شراء كريبتو', en: 'Buying Crypto' },
  sf_sell: { ar: 'بيع كريبتو', en: 'Selling Crypto' },
  sf_neutral: { ar: 'متوازن', en: 'Balanced' },

  /* Menu / settings */
  online: { ar: 'متصل', en: 'online' },
  settings: { ar: 'الإعدادات', en: 'Settings' },
  profile: { ar: '👤 الملف الشخصي', en: '👤 Profile' },
  general: { ar: '⚙️ عام', en: '⚙️ General' },
  language: { ar: 'اللغة', en: 'Language' },
  theme: { ar: 'الثيم', en: 'Theme' },
  sound: { ar: 'الصوت', en: 'Sound' },
  tone: { ar: '🔔 نغمة الإشعار', en: '🔔 Notification Tone' },
  t_bell: { ar: 'جرس', en: 'Bell' },
  t_horn: { ar: 'بوق', en: 'Horn' },
  t_pulse: { ar: 'نبض', en: 'Pulse' },
  t_silent: { ar: 'صامت', en: 'Silent' },
  about: { ar: 'عن المنصة', en: 'About' },
  clear_data: { ar: 'مسح البيانات', en: 'Clear Data' },
  data_sources: { ar: 'مصادر البيانات', en: 'Data Sources' },
  check_sources: { ar: 'فحص المصادر الآن', en: 'Check sources now' },
  checking: { ar: 'جاري الفحص...', en: 'Checking...' },
  critical_down: { ar: 'مصدر حرج معطّل', en: 'Critical source down' },
  all_sources_ok: { ar: 'كل المصادر متصلة', en: 'All sources reachable' },
  sources_reachable: { ar: 'متاح', en: 'reachable' },

  /* Market direction page */
  mkt_dir: { ar: 'اتجاه السوق', en: 'Market Direction' },
  mkt_dir_sub: {
    ar: 'تقرير مفصل — BTC & ETH — كل 4 ساعات',
    en: 'Detailed Report — BTC & ETH — Every 4h',
  },
  mkt_daily: { ar: 'تحليل يومي', en: 'Daily Analysis' },
  mkt_full: { ar: 'تقرير شامل', en: 'Full Report' },
  mkt_hourly: { ar: 'كل ساعة', en: 'Hourly' },
  mkt_4h: { ar: 'كل 4 ساعات — 12 طبقة', en: 'Every 4h — 12 layers' },
  mkt_fresh: { ar: 'بيانات طازجة', en: 'Fresh data' },
  mkt_stale: { ar: 'بيانات قديمة — حدّث!', en: 'Stale — Refresh!' },

  /* VIP */
  top3: { ar: '🏆 أقوى 3 صفقات مضاربة VIP', en: '🏆 Top 3 VIP Trades' },
};

/* Translate helper — resolves the current value of `lang` at call time
   (so it keeps working when the user toggles languages). Returns the key
   itself if no translation exists, which makes missing strings obvious. */
function t(k) {
  return TR[k] ? TR[k][lang] : k || '';
}
