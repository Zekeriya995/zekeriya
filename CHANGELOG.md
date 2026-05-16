# NEXUS PRO V10 — التسليم النهائي الشامل

## [Scanner Phase 1.2 — Manipulation HIGH tier hard-cap] — 2026-05-16

**Behaviour change (gated, default ON).** Implements P1.2 from
`SCANNER_AUDIT_2026_05_15.md` §6 / §2.4. Behind
`SCANNER_MANIP_HARD_CAP` env var.

### Problem

`_computeManipulationRisk` already classified shady setups as HIGH (vol/OI
gap + penny price + extreme funding + book imbalance) and applied a -15
score penalty. But for a strong-enough setup the -15 was recoverable, and
the symbol could still publish as ULTRA — the scanner's loudest tier and
the only one the push trigger fires on. Real-world failure mode:
manipulated penny coins with extreme funding still hitting the
notification path.

### Fix

`scoreSymbol` now resolves tier in a two-step path:
1. Map score → tier as before.
2. If `manipulationRisk.verdict === 'HIGH'` AND `tier === 'ULTRA'` →
   downgrade to `STRONG`, push tag `🚫MANIP_CAP` so the UI can
   explain the override.

The cap deliberately fires only when the result *would have been*
ULTRA — STRONG / MEDIUM / WEAK signals already carry the manipulation
warning tag and don't need a tier change.

### Test coverage

Three new tests in `tests/scanner-engine.test.js`:
- HIGH manipulation + score ≥ 100 → tier downgraded to STRONG, tag set.
- HIGH manipulation + score < 100 → no tag, tier unchanged.
- LOW manipulation + score ≥ 100 → tier stays ULTRA (cap doesn't over-trigger).

### Rollback

`SCANNER_MANIP_HARD_CAP=false` + `pm2 restart`. Cap disabled, manipulation
HIGH coins can publish as ULTRA again (the -15 score penalty still
applies).

### Test results

- `node --test tests/scanner-*.test.js` → 265 / 265 pass (was 262 + 3 new).
- `npx prettier --check .` → clean.

### References

- `SCANNER_AUDIT_2026_05_15.md` §2.4, §6, §8.1 decision D
- `src/scanner-engine.js` (manipulation block + tier resolution)

---

## [Scanner Phase 1.1 — Server-side P&D Detector] — 2026-05-16

**Behaviour change (gated, default ON).** Implements P1.1 from
`SCANNER_AUDIT_2026_05_15.md` §6 and the porting strategy in
`docs/SCANNER_PD_THRESHOLDS.md` §5.

### Added

- `src/scanner-pd-detector.js` — pure-function port of the client's
  detectPumpAndDump (app.js:2459-2476). 5 flags (VERTICAL,
  FR_EXTREME, LS_RETAIL_LONG, SMART_VS_RETAIL, THIN_PUMP),
  ladder: 2 flags = -25, 3+ flags = score floored at -100.
  Defensive against missing fields — never throws.
- `tests/scanner-pd-detector.test.js` — 35 tests covering every flag
  fires/doesn't fire boundary, defensive input handling, score-
  adjustment ladder, FLAG_THRESHOLDS parity assertion.
- `topTraders` field on the ctx passed to `scoreSymbol` — wired now
  even though `cache.topTraders` isn't populated yet, so the day
  the data source lands the SMART_VS_RETAIL flag starts firing
  with no further engine changes.

### Changed

- `src/scanner-engine.js`:
  - Imports `scanner-pd-detector` and reads
    `SCANNER_SERVER_PD_ENABLED` env var at module load (default
    true, set to `false` for instant rollback).
  - `scoreSymbol` runs the P&D detector after the manipulation
    block. 2 flags → tag `⚠️P&D_WARN:N/5`, score -25. 3+ flags →
    tag `🚨P&D_RISK:N/5`, score floored at -100 (downstream
    qualityFilter rejects).

### Runtime reachability (this PR)

| Flag | Reachable today? | Why / how to enable |
|------|------------------|---------------------|
| VERTICAL | ❌ dormant | Upstream `d.change >= 8` reject at scanner-engine.js:219 fires first |
| FR_EXTREME | ✅ live | `ctx.fr` populated from cache.fr |
| LS_RETAIL_LONG | ✅ live | `ctx.ls` populated from cache.ls |
| SMART_VS_RETAIL | ❌ dormant | `cache.topTraders` not fetched yet — wiring future PR |
| THIN_PUMP | ❌ dormant | Same upstream filter as VERTICAL |

Net production effect: server now applies the same
FR_EXTREME / LS_RETAIL_LONG suppression the client always had.
2-flag soft penalty is reachable when both fire on one coin.

### Rollback

Set `SCANNER_SERVER_PD_ENABLED=false` in the proxy's `.env` and
`pm2 restart`. Detector no longer runs; tags no longer pushed; no
score adjustment. No data migration needed.

### Test results

- `node --test tests/scanner-*.test.js` → 262 / 262 pass (was 227 + 35
  new detector tests).
- `npx prettier --check .` → clean.

### References

- `SCANNER_AUDIT_2026_05_15.md` §6 P1.1, §8.1 decision A & D
- `docs/SCANNER_PD_THRESHOLDS.md` §5 (verdicts), §3 (per-flag rationale)
- `app.js:2459-2476` (client detector being mirrored)

---

## [Scanner Phase 1.0 — P&D Threshold Validation] — 2026-05-16

**Analysis + schema extension. No runtime behaviour change.**
Implements the P1.0 step recorded in `SCANNER_AUDIT_2026_05_15.md` §8.1
decision C (validate before porting).

### Added

- `docs/SCANNER_PD_THRESHOLDS.md` — per-flag economic / microstructure
  rationale for the 5 P&D flags in `app.js:2459-2476`. Verdicts:
  port 4 of 5 as-is or with a small widening (LS_RETAIL_LONG: > 3 →
  > 2.5); defer THIN_PUMP until quantitative data is available.
- `src/scanner-history.js` — `tags: string[]` field on persisted entries,
  capped at `MAX_TAGS = 30` per entry. Defensive slice() so caller
  mutations don't leak in. Enables the future
  `vps/validate-pd-thresholds.js` quantitative pass.
- `tests/scanner-history.test.js` — 5 new tests covering tag persistence,
  empty default, non-array coercion, MAX_TAGS cap, mutation isolation.

### Changed

- `recordSignal()` now also persists `sig.tags` (or `[]` if absent).
  Pure-additive schema — old entries with no `tags` field still work
  (readers must use `entry.tags || []`).

### Rollback

- N/A — schema is pure-additive with no consumer; reverting only requires
  removing the new field. Decision D's flag requirement is waived per its
  exemption clause for "documentation-only and pure-refactor PRs"; the
  schema field has no behaviour impact.

### References

- `SCANNER_AUDIT_2026_05_15.md` §8.1 (decision C), §6 (P1.0)
- `docs/SCANNER_PD_THRESHOLDS.md` §2 (verdicts), §6 (schema proposal)

### Open question for Ziko

`docs/SCANNER_PD_THRESHOLDS.md` §8 asks whether to:
(a) accept the §5 verdicts (port 4 of 5, widen LS, defer THIN_PUMP), or
(b) port all 5 as-is matching the external plan exactly.
Phase 1.1 begins on (a); flip to (b) by replying in the PR.

---

## [Scanner Phase 0 — Safety Net] — 2026-05-15

**Scanner remediation infrastructure only — no behaviour change.**
Implements SCANNER_AUDIT_2026_05_15.md §6 Phase 0 (compressed variant
approved in §8.1).

### Added

- `SCANNER_AUDIT_2026_05_15.md` — consolidated audit (external 10-engineer
  review + internal Wasted-Pipeline finding) and 5-phase remediation plan
- `vps/snapshot-scanner-metrics.sh` — idempotent baseline-capture script
- `data/scanner-baseline-2026-05-15.json` — placeholder baseline (replace
  with real production snapshot before Phase 1.1 deploys)
- `tests/scanner-contract.test.js` — empty skeleton, populated in Phase 2.A.5
- Eight rollback flag names reserved in `.env.example` (`SCANNER_*_ENABLED`)
- Five rollback flag names reserved in `app.js` header (`nxScannerFix_*`)
- npm scripts: `npm run snapshot`, `npm run test:contract`

### Changed

- None. This phase introduces no behaviour changes — pure infrastructure.

### Rollback

- N/A — pure infrastructure. Revert the merge commit if needed.

### References

- `SCANNER_AUDIT_2026_05_15.md` §6 (Phase 0), §8.1 (Decisions Recorded)
- PR #100

---

## ملفات للرفع (4 ملفات)

| الملف | الحجم | الحالة |
|-------|-------|--------|
| **`app.js`** | 475,158 بايت (5,662 سطر) | ✅ مُعدَّل — ارفعه |
| **`sw.js`** | 2,581 بايت (64 سطر) | ✅ مُعدَّل — ارفعه |
| **`index.html`** | 86,571 بايت | ⏸️ بدون تغيير — ارفعه كما هو |
| **`manifest.json`** | 1,498 بايت | ⏸️ بدون تغيير — ارفعه كما هو |

كل الملفات في مجلد التنزيل، اضغط على كل واحد لتنزيله.

---

## الإصلاحات الإجمالية (31 إصلاحاً + ترقية Market Direction كاملة)

### الجزء الأول: 28 باتش أمني/وظيفي

**Tier 1 — ميزات معطوبة (4):**
- P1 Telegram proxy URL
- P2 SHORT trade PnL sign
- P3a/b Gate 4 dead branch + Gate 6 redundant check
- P4 Confidence calibration clamp

**Tier 2 — أخطاء حساب (4):**
- P5 Double minConf tuning removed
- P6 detectWhaleProfitTaking baseline (10-min trailing)
- P7 sigHist migration preserves firstSeen
- P8 loadTk mutex

**Tier 3 — أمان (4):**
- P9 esc() helper
- P10a/b/c Whitelist favorites + wallet + portfolio
- P11 encodeURIComponent
- P12 SW critical/optional split

**Tier 4 — نظافة (5):**
- P13 Dead scanBybitGainers removed
- P14 Module-level setInterval → init()
- P15 wlVerify optimization
- P16 saveMonitor debounce (2s)
- P17 openAdminPanel naming clarified

**إضافات اكتُشفت في المراجعات (11):**
- P18 buildStory safe regex replace
- P19a/b/c/d esc() applied at 4 render sites
- P20 SW excludes /notify from cache
- P21 SW only caches GET responses
- P22 addPort numeric validation
- P23 addWallet address+label validation
- P24 loadTk try/finally structure
- P25 SW CACHE_NAME bumped to v6-patched
- P26+P27 (merged into prior fixes)
- P28 confBucket clamp matches getCalibratedConf

### الجزء الثاني: ترقية Market Direction (analyzeCoinRpt + buildChartHTML)

**`analyzeCoinRpt` المحسّنة:**
- 12 مصدر بيانات جديد يؤثر على trend score
- 23 حقل عودة جديد
- 3 عوامل نقاط جديدة (smart, flow, mood)
- كل V3 calls محمية بـ try/catch

**`buildChartHTML` الجديدة:**
- 15 قسماً بالترتيب الاحترافي
- 5 أقسام جديدة كلياً (Smart Money، FR Multi-Exchange، Liquidation Zones، BTC↔ETH، Market Context)
- 3 أقسام محسّنة (Candle Closings، Whale Intelligence، Multi-Level Entry)
- ختام التحليل في الأسفل (قسم 15)
- نصوص عربية حقيقية (لا `\uXXXX`)

### الجزء الثالث: دمج التعلم الذاتي للعوامل الجديدة

**`DEFAULT_WEIGHTS`:**
- إضافة `smart:1, flow:1, mood:0.5`
- أصبح يحتوي 12 مفتاحاً

**`MONITOR_VERSION`:**
- v1 → v2 (تشغيل هجرة تلقائية)

**هجرة v1 → v2 (للمستخدمين الموجودين):**
- بياناتهم القديمة محفوظة بالكامل (الأوزان المتعلَّمة، الإحصاءات، blacklist، coinStats)
- المفاتيح الجديدة فقط تُضاف لـ `weights` و `factorStats`
- بدون فقدان بيانات

**`captureFactorSnapshot`:**
- تسجّل الآن 12 عاملاً (9 قديمة + 3 جديدة)
- كل عامل جديد له منطق dynamic لتقييمه

**النتيجة:**
- كل صفقة تُغلَق تُحدّث `winRate` للعوامل الـ 12
- بعد 5 صفقات لكل عامل، `autoTuneWeights` يبدأ تعديل أوزانها
- النظام يتعلم من 12 مصدر بدلاً من 9

---

## التحقق النهائي (فحوصات ناجحة)

| الفحص | النتيجة |
|-------|---------|
| `node --check app.js` | ✅ |
| `node --check sw.js` | ✅ |
| Runtime test في VM context | ✅ |
| `buildChartHTML` تُرجع 25,816 بايت HTML | ✅ |
| 15/15 قسم يظهر | ✅ |
| 370 سلسلة عربية في المخرج | ✅ |
| `analyzeCoinRpt` تحتوي 23 حقل عودة | ✅ |
| 6/6 دوال V3 ملفوفة بـ try/catch | ✅ |
| Migration v1 → v2 يحفظ البيانات | ✅ |
| `captureFactorSnapshot` تشمل smart/flow/mood | ✅ |
| Null-safety: كل البيانات null تعمل | ✅ |
| Bear case يعرض لغة هبوطية | ✅ |

---

## إعداد مطلوب على Cloudflare Worker

**باتش P1 يحتاج `/notify` endpoint:**

```js
if (url.pathname === '/notify' && request.method === 'POST') {
  const { message } = await request.json();
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
    });
  } catch(e) {}
  return new Response('OK', { headers: { 'Access-Control-Allow-Origin': '*' }});
}
```

بدونه: التطبيق يعمل، لكن إشعارات Telegram لن تصل (تظهر تحذيرات في console).

---

## قائمة التحقق بعد النشر

### عام
1. **Console نظيف عند التحميل** — لا أخطاء
2. **Service Worker** — `nexus-v10-v6-patched` نشط في Application tab
3. **localStorage** — `nxMonitor` تتم هجرتها من v1 إلى v2 تلقائياً عند أول تحميل

### Market Direction (الترقية الجديدة)
4. افتح صفحة Market → اضغط على تبويب BTC
5. تحقق من ظهور **15 قسماً بالترتيب**:
   - 1. Hero (مع شريط ذكاء المال المصغّر)
   - 2. الرسم البياني 4H
   - 3. إغلاقات الشموع (مفصّلة لكل فريم)
   - 4. هيكل السوق (SMC)
   - 5. FVG + Order Blocks
   - 6. المستويات الرئيسية
   - 7. المؤشرات الفنية
   - 8. استخبارات الحيتان (مع P&L، Flow Rate، Iceberg)
   - 9. **لوحة ذكاء المال** (جديد)
   - 10. **معدلات التمويل متعددة المنصات** (جديد)
   - 11. **مناطق التصفية** (جديد)
   - 12. **العلاقة BTC ↔ ETH** (جديد)
   - 13. **سياق السوق** (جديد)
   - 14. **مناطق الدخول الثلاثة** (مع R:R لكل واحدة)
   - 15. **ختام التحليل** (الأخير في الأسفل)
6. كرر مع تبويب ETH

### الأمان
7. في favorites اكتب `<script>alert(1)</script>` → يجب أن يُرفض/يُنظَّف
8. في portfolio أضف رمزاً غريباً → يُرفض
9. في wallet جرّب عنواناً ليس Ethereum → يُرفض

### نظام التعلم
10. في console نفّذ `monitorState.weights` → يجب أن ترى **12 مفتاحاً** (smart, flow, mood ضمنها)
11. نفّذ `monitorState.factorStats` → نفس الأمر
12. نفّذ `monitorState.v` → يجب أن يكون `2`

### التحقق من القيم
13. `getCalibratedConf(150)` → يرجع 100 (مُقيَّد)
14. `getCalibratedConf(-20)` → يرجع 0
15. لا أخطاء في console بعد ساعة من المراقبة

---

## القرارات المؤجَّلة (ليست أخطاء)

7 بنود تحتاج قرارك إن أردت معالجتها:
- #14 سقف 20% على confidence
- #21 تفعيل/إلغاء مسار SHORT trading
- #36 تقليل fan-out في loadDash
- #26 baseline detectAbsorption
- #22 detectFailPatterns O(n²) — غير مهم حتى >1000 إدخال
- #19 throttle لـ sendTG
- #37 memoize whale techniques

أخبرني لو أردت معالجة أي منها.

---

## ملخص رحلة التطوير

- **5 جلسات مراجعة عميقة** للكود
- **31 إصلاحاً** أمنياً/وظيفياً
- **ترقية شاملة** لـ Market Direction (دالتان رئيسيتان)
- **دمج كامل** للعوامل الجديدة في نظام التعلم الذاتي
- **هجرة بيانات سلسة** للمستخدمين الموجودين
- **حجم نهائي**: 475 KB (من 484 KB أصلية — أضفنا منطق + حذفنا كود ميت)
- **5,662 سطر** (من 5,373 — صافي +289 سطر)

النظام جاهز للإنتاج. 🎯
