# تقييم البنود المؤجلة من P3

**التاريخ:** 2026-05-06
**الحالة:** تقييم فقط — التنفيذ مؤجَّل بانتظار قرار المالك
**المرجع:** `PLATFORM_FIX_PLAN_2026_05_06.md` — البنود P3.1 و P3.3

---

## P3.1 — Web Worker لـ scanner

### وضع المصدر

| الملف | الحجم | declarations | اعتماد على DOM/window/localStorage |
|-------|------|---------------|--------------------------------------|
| `src/scanner-helpers.js` | 978 سطر | 25 | **0** — pure compute فقط |

نتيجة جيدة: الملف نقي تماماً من المتصفح. هذا يجعله أقرب المرشحين لـ Web Worker.

### ما يحتاجه الانتقال

1. **postMessage interface:** كل دالة عامة تتحول إلى رسالة request/response مع id فريد للربط
2. **Inputs المطلوبة:** الـ scanner يقرأ `T`، `OI`، `FR`، `LS`، `whaleWaves`، `obiHistory`... كلها globals في app.js. يجب ضخّها للـ worker عبر postMessage في كل tick
3. **Output:** نتائج الـ scoring تعود وتُحقن في الـ scanner table render
4. **حلقة التزامن:** الـ scanner حالياً يعمل sync داخل tick. التحويل لـ async يحتاج إعادة تنظيم

### المخاطر

- 🔴 **حجم الـ payload:** نسخ `T` (50-300 رمز × 8 حقول) إلى worker عبر postMessage في كل scan = 100-500 KB serialization. قد يبلع المكاسب.
- 🟠 **خفّة structuredClone:** الـ worker boundary ينسخ الـ object كاملاً ما لم نستخدم Transferable. لكن `T` ليس ArrayBuffer.
- 🟠 **State drift:** worker يعمل على snapshot، لكن المستخدم يتفاعل مع latest state. نحتاج merge logic.
- 🟡 **Debugging:** stack traces داخل worker تُكسر sourcemaps في DevTools.

### مقترح First PoC (لو تقرر التنفيذ)

**هدف محدود جداً:** نقل دالة واحدة ثقيلة (`isConfirmedBreakout` أو `qualityFilter`) إلى worker كـ off-thread evaluator مع نفس interface.

```js
// scanner-worker.js
self.onmessage = function(e) {
  var { id, fn, args } = e.data;
  var result;
  try { result = self[fn].apply(null, args); }
  catch (err) { result = { error: err.message }; }
  self.postMessage({ id, result });
};

// app.js (caller)
function offThreadCall(fn, args) {
  return new Promise((resolve) => {
    var id = ++_workerCallId;
    _pendingCalls[id] = resolve;
    _scannerWorker.postMessage({ id, fn, args });
  });
}
```

**خطوات التنفيذ المقترحة (إن قرر المالك):**
1. تحويل `scanner-helpers.js` إلى ES module + script-with-importScripts hybrid
2. إنشاء `scanner-worker.js` يحمّله عبر `importScripts`
3. تحويل دالة واحدة قياسية في scanner main loop إلى `await offThreadCall(...)`
4. قياس قبل/بعد على iPhone SE
5. إن نفع: نوسّع. إن لم ينفع: نتراجع بحكم الـ payload cost

**الجهد:** 5-7 أيام. **الفائدة المتوقعة:** غير محسومة قبل قياس فعلي.

### توصية

**انتظر.** الفائدة المتوقعة من Web Worker على scanner مشكوك بها قبل قياس واقعي على mid-range mobile. P2.1 و P2.2 قطعت المعظم من jank الفعلي. اقتراحي:

1. أضف Performance Marks حول scanner pass الحالي (PR صغير، يوم واحد)
2. اقس على iPhone SE / Galaxy A50 — هل scanner > 50ms يحدث فعلاً؟
3. لو نعم → ابدأ PoC المحدود
4. لو لا → P3.1 لا قيمة منه ويُسقط من الخطة

---

## P3.3 — Strict CSP (إزالة `'unsafe-inline'`)

### حجم العمل

| المصدر | عدد الحالات | الأثر إن أُزيل `'unsafe-inline'` |
|--------|------------|-----------------------------------|
| `index.html` — `style="..."` | 81 | تتعطّل الـ inline styles |
| `index.html` — `onclick=` / `onchange=` / `onsubmit=` | 47 | تتعطّل event handlers بالكامل |
| `app.js` — أوتار HTML تحتوي `style="..."` | 526 | كل العناصر المُولَّدة dynamicاً تخسر styling |
| `app.js` — `el.style.X = ...` | 31 | لا تتأثر بـ CSP |
| `app.js` — `innerHTML` setters | 60 | لا تتأثر إلا إذا كان النص يحوي `<script>` |
| `index.html` — inline `<script>` blocks | 0 | لا حاجة nonce |

**المُلخّص:** 654 موقعاً إجمالاً يستخدم inline style. إزالة `'unsafe-inline'` من `style-src` بدون تغيير هذه = شاشة بدون أي تنسيق.

### استراتيجية الانتقال

#### المرحلة A — Inline event handlers (47 حالة)
- استبدال `onclick="foo()"` بـ `data-action="foo"` + listener delegated مرة واحدة على `document`
- جهد: يوم واحد (حالات معدودة)

#### المرحلة B — index.html static inline styles (81 حالة)
- نقلها إلى classes في style.css
- جهد: 2-3 أيام (الكثير منها مرتبط بـ visual states)

#### المرحلة C — app.js dynamic style strings (526 حالة) — الأصعب
- استبدال نمط `'<div style="color:'+c+'">'` بـ:
  - استخدام classList.add مع classes معرّفة في style.css
  - أو data-* attributes + CSS attribute selectors
  - أو `el.style.X = Y` (لا يخضع لـ style-src)
- بعض الحالات (ألوان diluted من API) تحتاج ربط CSS variable على element root
- جهد: 5-7 أيام، يصعب تجميعه في PR واحد

#### المرحلة D — تشديد الـ CSP فعلياً
- بعد إكمال A+B+C، إزالة `'unsafe-inline'` من `style-src`
- الإبقاء على `'unsafe-inline'` في `script-src` ما لم نضف nonces (سكربت Telegram خارجي يحتاجه)
- جهد: نصف يوم اختبار

### المخاطر

- 🔴 **Regression عرضياً:** أي element منسي بدون class سيخسر تنسيقه فجأة عند تشديد CSP
- 🟠 **App.js refactor كبير:** 526 موقع. يصعب اختباره بدون snapshot tests للـ DOM
- 🟡 **CSS bundle bloat:** classes جديدة تكبّر style.css (62KB حالياً → ~80KB)

### توصية

**ابدأ بالمرحلة A فقط.** هي:
- خطر منخفض (47 حالة، scope واضح)
- فائدة قابلة للقياس (يقطع مسار XSS attribute-injection)
- قابلة للإنجاز في يوم واحد كـ PR مستقل

المراحل B+C+D استثمار 7-10 أيام إضافية يصعب تبريره الآن مقابل ربح أمني هامشي على PWA لا تقبل إدخال مستخدم خام في DOM.

---

## ملخص المدير

| البند | حجم العمل | الفائدة | التوصية |
|-------|-----------|--------|---------|
| **P3.1** Web Worker | 5-7 أيام + PoC | غير محسومة | **قياس قبل التنفيذ** — أضف Performance Marks، اقِس، ثم قرّر |
| **P3.3** Strict CSP | 7-10 أيام إجمالاً | أمني هامشي على PWA | **افعل المرحلة A فقط** (47 حالة inline events). أرجئ B+C+D |

كلا البندين لا يشكّل blocker للمستخدم. مكاسب P0+P1+P2 المدموجة بالفعل تغطي 90% من شكاوى المستخدم. P3.4 و P3.2 (الـ observability + drift detection) هي التحسينات المعمارية الفعلية في P3.

**القرار النهائي بيد المالك.** التنفيذ الآلي غير مناسب لأي من P3.1 أو P3.3 الكاملين.
