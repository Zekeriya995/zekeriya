# خطة إصلاح منصة NEXUS PRO
**المرجع:** `PLATFORM_AUDIT_2026_05_06.md`
**معدّ بواسطة:** مدير الفريق الهندسي
**التاريخ:** 2026-05-06
**الفرع:** `claude/platform-audit-investigation-vURCA`

---

## 0. مبادئ التنفيذ

1. **لا إصلاح بلا اختبار:** كل بند يجب أن يثبت قبل/بعد بسلوك مرئي قابل للقياس.
2. **PRs صغيرة مستقلة:** لا تجميع — كل إصلاح في PR منفصل قابل للتراجع.
3. **ترتيب صارم بحسب الجذر:** نبدأ بالمشكلات التي تسبب أعراضاً متعددة، لا بالأعراض نفسها.
4. **عدم التجميل:** ممنوع إعادة هيكلة استباقية — فقط ما يحل المشكلة الموثقة.
5. **مراقبة بعد النشر:** كل إصلاح يضيف عدّاد/سجل يثبت أنه فعّال في الإنتاج.

---

## 1. المراحل والمواعيد

| المرحلة | المدة | الهدف | المخاطر إن لم تنفذ |
|---------|------|--------|---------------------|
| **P0** | يوم واحد | إيقاف نزيف المستخدمين الحاليين | تستمر شكاوى "offline" والأسعار الوهمية |
| **P1** | 5 أيام | معالجة الجذور الأربعة الحرجة 🔴 | المنصة تبقى غير موثوقة في القرارات |
| **P2** | 10 أيام | الأداء والذاكرة 🟠 | الجلسات الطويلة تتدهور، تسرب ذاكرة |
| **P3** | 3 أسابيع | التحديثات المعمارية | ديون تقنية تتراكم، صعوبة الصيانة |

---

## 2. المرحلة P0 — إيقاف النزيف (خلال 24 ساعة)

### P0.1 — توحيد عنوان البروكسي مع CSP
- **المرجع:** Audit 5.1
- **المهندس:** #5 (PWA)
- **الجهد:** 30 دقيقة
- **الملفات:** `src/constants.js:29` ↔ `index.html` (CSP `connect-src`)
- **العمل:**
  1. تحديد المصدر الرسمي (cloudflare worker `jolly-bush-9254` أم tunnel؟)
  2. توحيد الاثنين على المصدر الرسمي
  3. إضافة fallback chain: production → staging → tunnel
- **معيار القبول:**
  - لا أي خطأ `Refused to connect ... CSP` في console المتصفح
  - `fetch(PROXY + '/api/health')` يعيد 200
- **اختبار التحقق:** فتح المنصة في تبويب خاص (بدون `nxProxyOverride` بـ localStorage) ومراقبة Network/Console.

### P0.2 — إخطار تحديث Service Worker
- **المرجع:** Audit 5.2
- **المهندس:** #5
- **الجهد:** 30 دقيقة
- **الملفات:** `app.js` (مكان `navigator.serviceWorker.register`)
- **العمل:** إضافة listener على `updatefound` يعرض prompt للمستخدم بعد install النسخة الجديدة.
- **معيار القبول:** نشر CACHE_VERSION جديدة → المستخدم يرى prompt خلال 60 ثانية من فتح التبويب.

### P0.3 — Health endpoint حقيقي
- **المرجع:** Audit 4.1
- **المهندس:** #4 (Backend)
- **الجهد:** 1 ساعة
- **الملفات:** `server.js`
- **العمل:** `/api/health` يعيد 503 إذا `Date.now() - cache.lastUpdate.tickers > 60000`، ويفصّل عمر كل cache.
- **معيار القبول:** قطع upstream → `/api/health` يعيد 503 خلال دقيقة (وليس 200 مع كاش فارغ).

---

## 3. المرحلة P1 — الجذور الحرجة (الأيام 2-6)

### P1.1 — فحص freshness على كل سعر يُرسم
- **المرجع:** Audit 3.1، 1.3
- **المهندس:** #3 (Phantom Data) + #1 (Streams) — مراجعة متبادلة
- **الجهد:** يوم كامل
- **الملفات:**
  - `src/utils.js`: إضافة دالة `getPriceWithAge(sym)` ترجع `{price, ageMs, stale}`
  - `src/live-ticker.js:789-821`: استخدام الدالة وإضافة class `.lt-stale` إذا `ageMs > 30000`
  - `app.js`: استبدال كل قراءة `T[s].p` المباشرة في render hotpaths
  - `style.css`: إضافة قاعدة `.lt-stale { opacity:0.5; filter:grayscale(1); }` + tooltip
- **معيار القبول:**
  - قطع شبكة لمدة 90 ثانية → كل الأسعار تتحول رمادية
  - عودة الشبكة → تعود ملونة خلال tick واحد
- **اختبار آلي:** unit test في `tests/utils.test.js` يتأكد أن `getPriceWithAge` ترجع `stale=true` لـ timestamp قديم.

### P1.2 — فصل freshness الإشارة عن freshness السعر
- **المرجع:** Audit 3.2
- **المهندس:** #3
- **الجهد:** 4 ساعات
- **الملفات:** `app.js:2632-2634`
- **العمل:** متغيران منفصلان `signalAgeMs` و `priceAgeMs`؛ شارة الـ scanner تعكس الأسوأ بينهما + tooltip يفسّر السبب.
- **معيار القبول:** صف scanner ببيانات سعر عمرها 2 دقيقة لا يحمل شارة 🆕 حتى لو الإشارة جديدة.
- **يعتمد على:** P1.1

### P1.3 — Watchdog حقيقي للـ WebSocket
- **المرجع:** Audit 1.1، 1.2
- **المهندس:** #1
- **الجهد:** يوم كامل
- **الملفات:** `src/price-stream.js:87-101`، `src/depth-stream.js`، `src/kline-stream.js`
- **العمل:**
  1. تقليص نافذة الصمت من 90s إلى 20s
  2. الاستماع لـ Binance ping frame والرد بـ pong
  3. عند `onclose` في `depth-stream.js`: تفريغ `st.last`
  4. في `kline-stream.js` cached candle replay: تمرير `isFinal=true` بدلاً من `false` للقطع المخزنة
- **معيار القبول:**
  - ضخ packet loss 100% في devtools throttling → reconnect خلال 25s كحد أقصى
  - مدة zombie window ≤ 25 ثانية
- **مخاطر:** قد يزيد reconnect storm في حالات عابرة → نضيف jitter 0-3s.

### P1.4 — إصلاح صمت الخادم + retries
- **المرجع:** Audit 4.1، 4.2
- **المهندس:** #4
- **الجهد:** يوم كامل
- **الملفات:** `server.js:189-208`، `server.js:294-302`
- **العمل:**
  1. `safeFetch(url, label, { retries=3 })` مع exponential backoff `[1s, 2s, 4s]`
  2. تتبع `lastError[label]` و `failureCount[label]` في object منفصل
  3. تسجيل HTTP status صراحةً (`err.response?.status ?? 'NETWORK'`)
  4. عداد `metrics.upstream429`, `metrics.upstreamTimeout`, `metrics.upstreamSuccess`
  5. كشف هذه العدادات في `/api/health`
- **معيار القبول:**
  - mock 429 على Binance → السجل يحتوي 3 محاولات ثم رسالة فشل واضحة
  - `metrics.upstream429` يزداد ولا يضيع
- **اختبار:** `tests/server.test.js` يضيف اختبار retry-on-429.

### P1.5 — رفض البيانات بلا timestamp
- **المرجع:** Audit 3.3، 3.4، 3.5
- **المهندس:** #3
- **الجهد:** نصف يوم
- **الملفات:** `app.js:1885-1906`
- **العمل:**
  - liquidation events بدون `time` → لا تُحقن `Date.now()`، بل تُرفض مع log
  - whale engine state يضاف له `refreshedAt: Date.now()`
  - FR/OI: قيمة `null` بدل 0 عند الفقدان، والـ render يعرض ⚠️ بدلاً من رقم
- **معيار القبول:** سيناريو upstream فاشل → الواجهة تعرض ⚠️ بدل أرقام مفترضة.

---

## 4. المرحلة P2 — الأداء وتسرب الذاكرة (الأيام 7-16)

### P2.1 — Event delegation في live-trading
- **المرجع:** Audit 2.1، 2.3
- **المهندس:** #2 (Performance)
- **الجهد:** يومان
- **الملفات:** `src/live-trading.js:728-734`، حقول الـ listeners الأخرى (~18 موضع)
- **العمل:** listener واحد على الحاوية الأم + `event.target.closest('.lv-mini-card')` لاستنباط الرمز.
- **معيار القبول:**
  - بعد 6 ساعات من الجلسة، عدد الـ listeners الكلي على الـ document لا يتجاوز 30
  - Chrome DevTools Memory Profiler: لا تظهر `Detached <button>` بأكثر من 50 عقدة
- **قياس قبل/بعد:** snapshot heap قبل وبعد تشغيل لساعة.

### P2.2 — DocumentFragment بدل innerHTML في الـ ticker
- **المرجع:** Audit 2.2
- **المهندس:** #2
- **الجهد:** يومان
- **الملفات:** `src/live-trading.js:693-727 + 740+`
- **العمل:**
  - أول render: ينشئ DOM فعلي
  - التحديثات اللاحقة: تعدل `textContent` فقط بدون إعادة بناء
  - استخدام `requestAnimationFrame` لتجميع التحديثات
- **معيار القبول:**
  - measurement: render time per tick على iPhone SE ينخفض من 40-60ms إلى < 8ms
  - Performance panel: لا "Forced reflow" warnings كل 600ms

### P2.3 — تخفيف ضغط localStorage
- **المرجع:** Audit 2.4
- **المهندس:** #2
- **الجهد:** نصف يوم
- **الملفات:** `app.js:940-970`
- **العمل:**
  - debounce كتابة `obiHistory` إلى 5 ثوانٍ بدلاً من 2
  - دفع الكتابة إلى `requestIdleCallback`
- **معيار القبول:** main-thread blocking time < 100ms/min في حال نشاط whales.

### P2.4 — حماية quota للـ localStorage
- **المرجع:** Audit 5.3
- **المهندس:** #5
- **الجهد:** نصف يوم
- **الملفات:** `src/storage.js`، `app.js:1138-1144`، `app.js:1401-1405`
- **العمل:**
  - `safeSetJSON` يقيس الحجم الإجمالي قبل الكتابة
  - عند تجاوز 4MB: تقليم `tagPerf._pending` لأقدم 100 إدخال + إنذار للمستخدم
  - `sectorHistory` بسقف عام 50 قطاع × 144 = 7200 إدخال
- **معيار القبول:** محاكاة 60 يوم استخدام مكثف → لا حدوث `QuotaExceededError`.

### P2.5 — Code splitting لـ app.js
- **المرجع:** Audit 2.5
- **المهندس:** #2
- **الجهد:** 4-5 أيام (المرحلة الأكبر في P2)
- **الملفات:** `app.js` → تقسيم إلى chunks: `core.js`, `scanner.js`, `whale.js`, `portfolio.js`, `trading.js`
- **التحميل:** dynamic `import()` عند تفعيل التبويب
- **معيار القبول:**
  - حجم core.js < 150KB
  - First Contentful Paint على 3G: من 8-12s إلى < 4s
- **مخاطر:** قد يكشف اعتماديات خفية بين الوحدات → نضع PR explorer قبل refactor.

### P2.6 — تنظيف flickerEls
- **المرجع:** Audit 1.6
- **المهندس:** #1
- **الجهد:** ساعتان
- **الملفات:** `src/live-ticker.js:35-69`
- **العمل:** `WeakRef` للعناصر، حذف تلقائي عند فقدان المرجع.
- **معيار القبول:** بعد إغلاق modal الذي حقن flicker، طول `flickerEls` يعود لصفر خلال tick.

---

## 5. المرحلة P3 — التحسينات المعمارية (الأسابيع 3-6)

### P3.1 — Web Worker للـ scanner
- **المرجع:** Audit 2.* (scanner-helpers.js 40KB)
- **المهندس:** #2
- **الجهد:** أسبوع
- **النتيجة المتوقعة:** main thread لا يُحجب أثناء تحليل 500 رمز.

### P3.2 — Drift detection لـ VPS
- **المرجع:** Audit 4.7، 4.8
- **المهندس:** #4
- **الجهد:** 3 أيام
- **العمل:**
  - إضافة `nexus_notifier.py` للريبو (أو نسخة canonical منه)
  - سكربت `vps/verify_drift.sh` يحسب checksum ويقارن قبل أي wiring
  - استبدال regex anchors بـ AST-based injection (Python `ast` module)

### P3.3 — Strict CSP
- **المرجع:** Audit 5.6
- **المهندس:** #5
- **الجهد:** 2-3 أيام
- **العمل:** إزالة `'unsafe-inline'`، استخدام nonces، نقل inline styles لـ external CSS.

### P3.4 — Observability كاملة
- **المهندسون:** الفريق كله
- **الجهد:** أسبوع
- **العمل:**
  - dashboard على `/api/metrics` يعرض: cache ages، upstream success rates، tunnel latency، عدد العملاء النشطين
  - تنبيهات Telegram عند: cache > 60s، failure rate > 20%، tunnel down

---

## 6. مصفوفة الاعتمادية

```
P0.1 (proxy/CSP) ─┐
P0.2 (SW prompt) ─┤── independent
P0.3 (health)    ─┘
                    │
                    ↓
P1.1 (freshness)  ──┬─→ P1.2 (signal vs price)
                    └─→ P1.5 (timestamps)
P1.3 (watchdog)   ── independent ──→ P2.6 (flickerEls cleanup)
P1.4 (server)     ── needs P0.3 ───→ P3.4 (metrics)
                                      │
P2.1 (delegation) ─┬── independent    │
P2.2 (fragment)   ─┤                  │
P2.3 (debounce)   ─┘                  │
P2.4 (quota)      ── independent      │
P2.5 (splitting)  ── needs P2.1+P2.2  │
                                      ↓
                                    P3.* (long-term)
```

---

## 7. توزيع الفريق

| المهندس | الأسبوع 1 | الأسبوع 2 | الأسبوع 3+ |
|---------|------------|------------|-------------|
| #1 Streams | P1.3 watchdog | P2.6 flickerEls | دعم P3 |
| #2 Performance | استكشاف P2.5 | P2.1 + P2.2 | P2.5 + P3.1 |
| #3 Phantom Data | P1.1 + P1.2 | P1.5 | المراجعات |
| #4 Backend | P0.3 → P1.4 | P2.3 | P3.2 |
| #5 PWA | P0.1 + P0.2 | P2.4 | P3.3 |
| **المدير** | متابعة P0/P1 | code reviews | retrospective |

---

## 8. معايير "تم" (Definition of Done) لكل PR

- [ ] الإصلاح موثق بسطر/أسطر مرجعية للـ audit
- [ ] اختبار آلي يثبت السلوك (إن أمكن)
- [ ] معيار قبول يدوي يمكن لمختبر تنفيذه في 5 دقائق
- [ ] ميتريك جديد أو سجل يثبت الفعالية في الإنتاج
- [ ] لا تغيير في سلوك آخر غير المعنيّ (no scope creep)
- [ ] حجم الـ diff < 300 سطر (إلا P2.5)
- [ ] مراجعة من مهندس آخر غير صاحب الـ PR
- [ ] CI أخضر (lint + format + test)

---

## 9. مؤشرات نجاح المرحلة (KPIs)

| المؤشر | قبل | الهدف بعد P1 | الهدف بعد P2 |
|--------|-----|--------------|---------------|
| نسبة المستخدمين برسالة "offline" زائفة | غير مقاس | < 1% | < 0.1% |
| متوسط عمر السعر المعروض | غير مقاس | < 15s p95 | < 5s p95 |
| Memory leak/8h جلسة | +8-12MB | < +5MB | < +1MB |
| First Contentful Paint (3G) | 8-12s | 8-12s | < 4s |
| نافذة WebSocket Zombie | 90s | ≤ 25s | ≤ 25s |
| upstream 429 retries success rate | 0% | > 80% | > 80% |

---

## 10. خطة التراجع (Rollback)

كل PR يُنشر خلف flag في localStorage يمكن تعطيله من الـ console:
```js
localStorage.setItem('nxFix_<PR-NUMBER>', 'off'); location.reload();
```
للإصلاحات على الخادم: متغير بيئة `DISABLE_FIX_<NUMBER>=1` يعيد السلوك القديم.

---

**الخلاصة الإدارية:** ست مهندسين-أيام (P0+P1) تكفي لإيقاف الشكاوى الحرجة. باقي الخطة (P2+P3) يستثمر في صحة المنصة طويلة الأمد. لا أرى مبرراً لتأجيل P0 ولو ساعة واحدة بعد اعتماد الخطة.
