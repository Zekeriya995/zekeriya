# تقرير المراجعة الشامل لمنصة NEXUS PRO
**تاريخ المراجعة:** 2026-05-06
**الفرع:** `claude/platform-audit-investigation-vURCA`
**المنهجية:** خمسة مهندسين متخصصين، كل مهندس فحص قسماً مستقلاً ثم دمج النتائج
**نطاق الفحص:** انقطاع البيانات • ضعف السرعة • البيانات الوهمية • فشل توصيل البيانات

---

## 1. ملخص تنفيذي

المنصة تعتمد بنية معقولة (PWA + Express proxy + Python notifier على VPS)، لكن تعاني من **أربع مشكلات جذرية تتقاطع عبر كل الطبقات**:

1. **🔴 طبقة "البيانات الحيّة" ليست حيّة فعلاً** — الأسعار تُختم بـ `t = Date.now()` لكن لا توجد أي شيفرة تتحقق من العمر قبل العرض.
2. **🔴 الخادم الوسيط يبتلع الأخطاء بصمت** — استدعاءات `safeFetch` تعيد `null` ثم يخدّم `/api/all` رد 200 مع كاش فارغ، فيظهر للعميل أن الاتصال سليم.
3. **🔴 WebSocket يدخل حالة "Zombie"** لمدة 90 ثانية دون أن يكتشفها العميل، ومؤشر "LIVE" يبقى أخضر.
4. **🔴 رابط البروكسي المضمَّن في `constants.js` لا يطابق `connect-src` في الـ CSP**، فتفشل النداءات بصمت ويظن المستخدم أنه "offline".

كل واحدة من هذه الأربعة تفسر شكوى من شكاوى المستخدم بشكل مباشر:
- انقطاع البيانات → CSP mismatch + zombie sockets
- البيانات الوهمية → غياب التحقق من freshness قبل الرسم
- ضعف السرعة → حزمة 502KB غير مقسمة + `innerHTML` كل 600ms + listeners تتراكم
- عدم توصيل البيانات → بلع الأخطاء + غياب retries + 8 ثوانٍ timeout

---

## 2. النتائج حسب القسم

### 2.1 طبقة البث الحي (WebSockets & Streams)
**الملفات:** `src/price-stream.js`، `src/depth-stream.js`، `src/kline-stream.js`، `src/live-ticker.js`، `src/connection.js`

| # | الخطورة | الموقع | الوصف |
|---|---------|---------|-------|
| 1.1 | 🔴 | `src/price-stream.js:87-101` | watchdog يطلق فقط بعد 90 ثانية صمت، بينما Binance يبث كل ثانية. خلال هذه النافذة `wsUp = true` ومؤشر LIVE أخضر. |
| 1.2 | 🔴 | `src/kline-stream.js:116-122` | عند اشتراك جديد أثناء انقطاع، يُعاد بث آخر شمعة مخزنة كأنها حية بلا فحص عمرها. |
| 1.3 | 🟠 | `src/price-stream.js:56-71` | `T[sym].t` يُحدَّث فقط عند الرسالة، ولا يُقرأ أبداً في `live-ticker.js:789-821` قبل الرسم. |
| 1.4 | 🟠 | `src/depth-stream.js:38-83` | `st.last` لا يُمسح عند `onclose`، فيظل دفتر الأوامر "ميتاً" معروضاً كحي. |
| 1.5 | 🟠 | `src/connection.js:94-112` | `lastDataTime` يحدَّث من تيكر REST أيضاً، فيختلط بثٌ حي مع REST كاش 5s. |
| 1.6 | 🟡 | `src/live-ticker.js:35-69` | `flickerEls[]` يحتفظ بمراجع لعقد DOM منفصلة → تسرب ذاكرة في الجلسات الطويلة. |
| 1.7 | 🟡 | `src/kline-stream.js:109-125` | سباق بين subscribe و socket open: إذا فشل `_open()` لا يُخطر المشتركون. |
| 1.8 | 🟡 | `src/source-health.js:208-231` | فحوصات المصادر لا تختبر مسار "Proxy → Binance"، نقطة عمياء حقيقية. |

### 2.2 الأداء وسرعة الاستجابة
**الملفات:** `app.js`، `src/live-trading.js`، `src/scanner-helpers.js`، `style.css`

| # | الخطورة | الموقع | الوصف | التقدير الكمي |
|---|---------|---------|-------|------|
| 2.1 | 🔴 | `src/live-trading.js:728-734` | كل 600ms يُعاد بناء mini-grid عبر `innerHTML` ثم تُلصق listeners جديدة دون إزالة القديمة | ~144,000 listener يتيمة في 24 ساعة، +8-12MB/8h |
| 2.2 | 🔴 | `src/live-trading.js:693-727 + 740+` | `innerHTML` داخل setInterval 600ms مع reflows إجبارية | 40-60ms/cycle على iPhone SE |
| 2.3 | 🔴 | عبر `src/` | 18 `addEventListener` مقابل 0 `removeEventListener` | تسرب تراكمي |
| 2.4 | 🟠 | `app.js:940-970` | `obiHistory` يكتب إلى localStorage كل 2 ثانية متزامناً | ~900ms/min حجب thread رئيسي |
| 2.5 | 🟠 | `app.js` (الحجم) | 502KB غير مضغوط، بدون code splitting | 8-12s تحميل أول على 3G |
| 2.6 | 🟡 | `style.css:10,23,30...` | 25+ قاعدة `backdrop-filter` على عناصر مرئية | -5-10% FPS على الموبايلات الضعيفة |

### 2.3 البيانات الوهمية / الـ Phantom Data
**الملفات:** `app.js`، `src/whale-state.js`، `src/portfolio.js`، `sw.js`

| # | الخطورة | الموقع | الوصف |
|---|---------|---------|-------|
| 3.1 | 🔴 | `app.js:1883` | `T[s].t` يُحفظ ولا يُقرأ → السعر يبقى على الشاشة دقائق بلا أي مؤشر "stale". |
| 3.2 | 🔴 | `app.js:2632-2634` | شارة `freshness` تستخدم عمر **الإشارة** لا عمر **السعر**. شارة 🆕 على سعر عمره دقيقتان. |
| 3.3 | 🟠 | `app.js:1894-1898` | تواريخ التسييل والـ depth: `time:+x.time \|\| Date.now()` → اختلاق timestamp على بيانات قديمة. |
| 3.4 | 🟠 | `app.js:1906` | بيانات whale engine تُكتب بلا `refreshedAt`، وقد تبقى أسابيع. |
| 3.5 | 🟠 | `app.js:1885-1887` | `FR / OI` يرتدّان إلى 0 عند فقدان البيانات — يُفسَّر كحياد سوقي حقيقي. |
| 3.6 | 🟠 | `src/portfolio.js:119-128` | تقييم التوقعات يقارن بسعر `T[sym].p` بلا فحص staleness → دقّة وهمية. |
| 3.7 | 🟡 | `sw.js:132-154` | SWR يقدم `app.js` كاش قبل النسخة الجديدة. |
| 3.8 | 🟡 | `app.js` (متعدد) | `try { ... } catch(e) {}` فارغة → فشل حساب VPIN/CVD يمر صامتاً ويولد إشارات وهمية. |

**اختبار التحقق في المتصفح:**
```javascript
setInterval(() => {
  const stale = Object.keys(T).filter(s => T[s].t && Date.now() - T[s].t > 120000);
  if (stale.length) console.warn('[STALE]', stale.length, 'symbols >2min old');
}, 5000);
```

### 2.4 الخادم الوسيط (Express Proxy) و VPS
**الملفات:** `server.js`، `src/server-helpers.js`، `vps/v2_patch.py`، `vps/wire_v2.py`، `vps/wire_whale.py`

| # | الخطورة | الموقع | الوصف |
|---|---------|---------|-------|
| 4.1 | 🔴 | `server.js:189-208` | `safeFetch` يعيد `null` بصمت دون status code أو ميتريك صحة. |
| 4.2 | 🔴 | `server.js:294-302` | 50 طلب OI متوازية بلا backoff على 429 → كاش OI يبقى متجمداً ساعات. |
| 4.3 | 🔴 | `server.js:94` | `TIMEOUT: 8000` صارم، يقطع ردود سليمة على شبكات بطيئة. |
| 4.4 | 🟠 | `server.js:91` | `API_ALL_TTL_MS: 3000` قصير جداً → CPU يتأرجح تحت الحمل. |
| 4.5 | 🟠 | `server.js:42-44` | `TRUST_PROXY` شرطي؛ خلف CDN كل العملاء يشتركون في bucket واحد. |
| 4.6 | 🟠 | `vps/v2_patch.py:104-110` | rate-limit deque لا يُنظَّف بعد فترات الهدوء → رفض إشارات مشروعة. |
| 4.7 | 🔴 | `vps/V2_DEPLOY.md` | **انجراف نشر:** سكربتات Python تعدل `nexus_notifier.py` غير الموجود في الريبو، ولا يوجد أي ضمان لتطابق نسخة الإنتاج مع الريبو. |
| 4.8 | 🟡 | `vps/wire_v2.py:24-33` | حقن regex هش، أي تغيير في indentation يكسر الـ wiring بصمت. |

### 2.5 طبقة PWA / Service Worker / إعدادات العميل
**الملفات:** `sw.js`، `manifest.json`، `index.html`، `src/constants.js`، `src/storage.js`

| # | الخطورة | الموقع | الوصف |
|---|---------|---------|-------|
| 5.1 | 🔴 | `src/constants.js:29` vs `index.html` (CSP) | URL البروكسي الافتراضي (`screenshot-upgrading-boating-excellent.trycloudflare.com`) **لا يوجد** في `connect-src` بالـ CSP. كل مستخدم بدون `nxProxyOverride` يفشل صامتاً. |
| 5.2 | 🟠 | `sw.js:51 + 73` | `skipWaiting()` + `clientsClaim()` بدون أي إخطار للمستخدم → يبقى على شيفرة قديمة لأيام. |
| 5.3 | 🟠 | `app.js:1138-1144 + 1401-1405` | `sectorHistory` و `tagPerf._pending` بلا حد علوي إجمالي → استنفاد quota بعد 30-60 يوم. |
| 5.4 | 🟠 | `sw.js:120-155` | API requests شبكة-فقط؛ الفشل يرتد إلى `{error:'offline'}` ولا يميز بين انقطاع شبكة وحجب CSP. |
| 5.5 | 🟢 | `src/visibility-pause.js` | تصميم سليم — pause/resume + catch-up tick. |
| 5.6 | 🟡 | `index.html:14-15` | `'unsafe-inline'` في CSP + سكربت Telegram خارجي. |

---

## 3. ترتيب أولويات الإصلاح (Top 10)

| # | البند | الملف | الجهد | الأثر |
|---|--------|---------|--------|--------|
| 1 | **توحيد URL البروكسي مع CSP** | `src/constants.js:29` + `index.html` CSP | 5 دقائق | يعيد الاتصال للمستخدمين الفاقدين له فوراً |
| 2 | **التحقق من عمر `T[sym].t` قبل كل رسم** | `src/live-ticker.js`، `app.js` | 2-3 ساعات | يُلغي عرض البيانات الوهمية كحيّة |
| 3 | **فصل freshness الإشارة عن freshness السعر** | `app.js:2632-2634` | 1 ساعة | شارات صحيحة بدلاً من مضللة |
| 4 | **تقليص watchdog البث إلى 15-30 ثانية + heartbeat** | `src/price-stream.js:87-101` | 2 ساعات | يحدد zombie sockets قبل أن يتداول المستخدم على سعر متجمد |
| 5 | **إضافة retries مع backoff في `safeFetch`** | `server.js:189-208` | 1 ساعة | يحل أزمة 429 على Binance |
| 6 | **مسار صحة حقيقي `/api/health` يفرّق stale من down** | `server.js` | 1 ساعة | يخرج العميل من وهم "اتصال سليم" |
| 7 | **استبدال innerHTML+listeners الجدد كل 600ms بـ event delegation + DocumentFragment** | `src/live-trading.js:693-734` | 2-3 أيام | -40-60ms/tick، إيقاف تسرب الذاكرة |
| 8 | **flag تحديث SW + prompt للمستخدم** | `app.js` (تسجيل SW) | 10 دقائق | hotfixes تنتشر خلال جلسة واحدة لا أيام |
| 9 | **تواريخ صريحة على whale/liq/depth + رفض ما لا timestamp له** | `app.js:1894-1906` | 2 ساعات | يقطع طريق الإشارات المبنية على بيانات قديمة |
| 10 | **حماية quota للـ localStorage + تنظيف دوري لـ tagPerf._pending** | `app.js` + `src/storage.js` | 1 ساعة | يمنع موت التخزين في الجلسات الطويلة (>30 يوم) |

---

## 4. اختبارات تحقق سريعة (للمستخدم/المشغل)

### اختبار 1 — كشف الأسعار الوهمية
```js
// في console المتصفح:
setInterval(() => {
  const stale = Object.keys(T).filter(s => T[s].t && Date.now() - T[s].t > 120000);
  if (stale.length) console.warn('[STALE]', stale.length, 'symbols');
}, 5000);
```
إن ظهرت رموز > 0 ≡ يوجد سعر معروض عمره أكثر من دقيقتين بلا تحذير بصري.

### اختبار 2 — كشف WebSocket Zombie
- افتح DevTools → Network → WS
- اقطع الإنترنت لمدة 30 ثانية ثم أعده
- إن بقي شارة "LIVE" دون انقطاع لأكثر من 15s ≡ المشكلة 1.1 موجودة

### اختبار 3 — كشف CSP Mismatch
- DevTools → Console → ابحث عن `Refused to connect ... violates ... Content Security Policy`
- إن وُجد ≡ المشكلة 5.1 تضرب هذا المستخدم

### اختبار 4 — كشف صمت الخادم
```bash
curl -s https://<proxy>/api/all | jq '.tickers | keys | length'
```
إن أعاد 0 مع HTTP 200 ≡ الخادم يخفي فشل upstream (المشكلة 4.1)

---

## 5. تعليمات استرداد للمستخدمين العالقين

عند ظهور "offline" مع وجود إنترنت:
1. **Hard refresh:** `Ctrl+Shift+R` / `Cmd+Shift+R`
2. DevTools → Application → Service Workers → **Unregister**
3. DevTools → Application → Storage → **Clear site data**
4. F5

---

## 6. ملاحظات معمارية للمدى البعيد

- **Code splitting:** تقسيم `app.js` (502KB) إلى chunks: `scanner.js`، `trading.js`، `whale.js`، `portfolio.js` تحمَّل عند الحاجة.
- **Web Workers:** `scanner-helpers.js` (40KB حسابات) ينقل للـ worker لتفريغ thread رئيسي.
- **Drift detection:** سكربت يقارن `nexus_notifier.py` على VPS مع نسخة مرجعية قبل أي wiring.
- **Observability:** صفحة `/api/health` كاملة تكشف: عمر آخر تحديث لكل cache، نسبة نجاح upstream، عدد الرموز المحمَّلة، تأخر الـ tunnel.
- **CSP صارم:** الانتقال من `'unsafe-inline'` إلى nonces.

---

## 7. الفريق المسؤول عن المراجعة

| المهندس | التخصص | الحالة |
|---------|---------|--------|
| #1 | Streams & WebSocket Resilience | ✅ مكتمل |
| #2 | Performance & Memory | ✅ مكتمل |
| #3 | Phantom / Stale Data Detection | ✅ مكتمل |
| #4 | Proxy / Server / VPS | ✅ مكتمل |
| #5 | PWA / SW / Frontend Integration | ✅ مكتمل |

نُفّذت جميع الفحوصات بصلاحية read-only فقط. لم يُعدَّل أي ملف برمجي، فقط أُضيف هذا التقرير.
