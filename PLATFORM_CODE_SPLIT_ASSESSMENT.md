# تقييم P2.5 — Code Splitting لـ app.js

**التاريخ:** 2026-05-06
**الحالة:** تقييم فقط — التنفيذ مؤجَّل بانتظار قرار المالك
**المرجع:** `PLATFORM_FIX_PLAN_2026_05_06.md` — البند P2.5

---

## 1. لماذا تقييم بدلاً من تنفيذ؟

`app.js` يحتوي **6,684 سطراً** و **267 declaration** (`var` + `function`) في scope مشترك واحد. كل التبعيات بين الميزات تمرّ عبر globals (لا modules، لا imports). تقسيمه إلى chunks محمَّلة بـ `import()` ديناميكياً يستلزم:

1. كشف كل dependency خفية بين "الوحدات" المنطقية
2. تحويل globals الحرجة إلى exports/imports صريحة
3. إعادة كتابة سلسلة التحميل في `index.html` و `sw.js` لتدعم module/chunk loading
4. اختبار يدوي كامل لكل تدفق يعبر أكثر من chunk (scanner → modal → trade → portfolio → notifications)

**الجهد التقديري:** 4-5 أيام عمل + مراجعة بشرية لكل عبور. **خطر الانكسار:** عالٍ.

التقييم الحالي **لا يعدّل أي كود إنتاج**.

---

## 2. تشريح app.js (الحدود المنطقية المحتملة)

| Chunk المحتمل | المحتوى | تقدير الحجم |
|---------------|---------|--------------|
| `core.js` | init/config/T/WL/state عام/loadTk/loadDash/init() | ~120 KB |
| `scanner.js` | quickScan, scoring, signals, qualityFilter, tagPerf | ~140 KB |
| `whale.js` | whale waves engine, calcWhalePnL, whaleWaves | ~50 KB |
| `portfolio.js` | predictions, portfolio render، tracking | ~40 KB |
| `notifications.js` | (موجود فعلاً في src/) — لا يحتاج split | — |
| `market.js` | market overview, sectors, FG, dominance | ~40 KB |
| `analytics.js` | VPIN, CVD, supervisor, fail patterns | ~70 KB |
| `live-trading.js` | (موجود فعلاً في src/) — لا يحتاج split | — |
| `init.js` | init(), DOMContentLoaded, page wiring | ~30 KB |

**ملاحظة مهمة:** الأرقام تقديرية. الحدود ليست واضحة — معظم الدوال تستدعي بعضها عبر globals.

---

## 3. مصفوفة التبعيات الخطيرة (Globals المشتركة)

| Global | يكتبها | يقرأها | الخطر |
|--------|---------|--------|--------|
| `T` (tickers) | `loadTk`, `applyTicker` | كل scanner/whale/portfolio/render | 🔴 جذرية — موجودة في كل chunk |
| `WL` (watchlist) | `updateTop100`, `init` | كل خرائط الرسم | 🔴 |
| `lang` | `setLang` | كل t() helpers | 🟠 |
| `tagPerf` | scanner | render scanner | 🟠 |
| `obiHistory` | `sampleOBI` | `rollingOBI` | 🟠 |
| `whaleWaves` | proxy ingest | scanner + render | 🟠 |
| `predictions` | scanner | portfolio | 🟠 |
| `connMetrics` | `loadTk`, ws | header status | 🟡 |
| `chartData` | modal load | chart render | 🟡 |
| `supervisorData` | analytics | reports | 🟡 |

**التبعية الجذرية:** `T` (tickers map) — كل chunk تقريباً يقرأها. لا يمكن تفكيك `T` بسهولة دون wrapper مركزي.

---

## 4. اقتراح First Split الآمن (proof of concept)

بدلاً من تقسيم كل شيء، ابدأ بـ **chunk واحد منفصل** لميزة محدودة الـ surface area:

### المرشح الأقل خطراً: `analytics.js`
- VPIN, calcVPIN, updateVPIN, pruneVPINBuckets
- supervisorCollect, supervisorDailyReport, renderDailyReport
- detectFailPatterns, autoTuneWeights
- captureFactorSnapshot
- ~3,000 سطر، لا يُستدعى إلا من scanner داخلياً

**خطوات التنفيذ المقترحة:**
1. استخراج إلى `src/analytics.js` (script tag عادي، ليس module — لا حاجة لتعديل sw.js)
2. الـ globals تظل globals (لا تغيير في الـ API)
3. اختبار يدوي: تشغيل scanner pass كامل، فتح Daily Report، التأكد من ظهور البيانات
4. **النتيجة المتوقعة:** -45 KB من app.js، -250ms في زمن parse على mid-range موبايل
5. إذا نجح: نكرر النمط مع `whale.js`، ثم `portfolio.js`، ثم `market.js`
6. **التأجيل:** dynamic `import()` و SW chunking نتركه للمرحلة الأخيرة

### الفائدة الحقيقية (المرحلية):
| النموذج | حجم app.js | جهد | مخاطرة |
|---------|------------|------|--------|
| الحالي | 502 KB | — | — |
| بعد analytics | ~457 KB (-45) | يوم واحد | منخفضة |
| + whale | ~407 KB (-50) | يوم آخر | منخفضة |
| + portfolio | ~367 KB | يوم آخر | متوسطة |
| + market | ~327 KB | يوم آخر | متوسطة |
| + scanner (الأخير) | ~187 KB | 2 يوم | **عالية** — قلب التطبيق |
| + dynamic import + SW | + service worker rewrite | 2 يوم | **عالية** |

---

## 5. توصية المدير

**لا أنفّذ P2.5 في هذه الجلسة.** الأسباب:
1. الخطر التشغيلي عالٍ والاختبار البشري ضروري بعد كل خطوة
2. الأرباح التراكمية من P2.1 + P2.2 + P2.3 + P2.4 + P2.6 (مدموجة فعلاً) كافية لإيقاف نزيف الذاكرة وتحسين الأداء على الجلسات الطويلة قبل أن نلجأ لإعادة هيكلة هرمية
3. التحليل أعلاه يظهر أن **تقسيم analytics.js وحده يقطع 9 % من حجم الحزمة بمخاطرة منخفضة** — يمكن البدء به في PR منفصل بعد مراجعة هذا التقييم

**ما الذي يحتاجه المالك للقرار:**
- موافقة على ترتيب التقسيم (analytics → whale → portfolio → market → scanner)
- نافذة وقت لاختبار يدوي بعد كل خطوة (≤ 30 دقيقة لكل chunk)
- قرار: متى ننتقل من plain `<script>` إلى dynamic `import()`؟ (مقترح: بعد إكمال الـ 5 chunks الأولى)

**القرار الافتراضي إن لم يتدخل المالك:** نكتفي بـ P2.1-P2.6 ونؤجل P2.5 حتى مرحلة P3 (المعمارية طويلة المدى).

---

## 6. مقاييس النجاح إذا تم التنفيذ

- حجم core.js < 200 KB
- First Contentful Paint على 3G من 8-12s إلى < 4s
- Lighthouse Performance score > 70 (الحالي ~30)
- لا انحدار في اختبارات Cypress/E2E (إن وُجدت)

---

**الخلاصة:** التقييم اكتمل، ولا تغيير في الكود. القرار التالي بيد المالك.
