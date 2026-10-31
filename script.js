(function () {
'use strict';

/* ================================================================
   PERMANENT MEMORIAL TIMESTAMP — never modified, never replaced
   ================================================================ */
var ORIGIN_ISO = '2026-10-31T17:12:00+06:00';
var ORIGIN_MS = Date.parse(ORIGIN_ISO);
var ORIGIN_NS = BigInt(ORIGIN_MS) * 1000000n;
var NS = 1000000000n;
var DAY_NS = 86400n * NS;
var TZ_NS = 6n * 3600n * NS;           // Asia/Dhaka = UTC+06:00 (no DST)
var TZ_NAME = 'Asia/Dhaka';

/* ================================================================
   CLOCK — online (synced) or device
   ================================================================ */
var clock = { offsetMs: 0, synced: false, sources: 0, uncertaintyMs: null, failed: false };

function perfEpochMs() { return performance.timeOrigin + performance.now(); }

function currentMs() { return perfEpochMs() + clock.offsetMs; }

// Nanosecond value derived from the browser's performance clock (microsecond granularity at best).
// Digits finer than the real clock resolution are zero — never random.
function nowNs() {
  return BigInt(Math.floor(currentMs() * 1000)) * 1000n;
}

function useDeviceClock() {
  clock.offsetMs = Date.now() - perfEpochMs();
}

useDeviceClock();

var resolutionUs = null;
function estimateResolution() {
  var min = Infinity, prev = performance.now();
  for (var i = 0; i < 3000; i++) {
    var t = performance.now();
    var d = t - prev;
    if (d > 0 && d < min) min = d;
    prev = t;
  }
  resolutionUs = isFinite(min) ? min * 1000 : null;
}
estimateResolution();

/* ---------- Time synchronisation (multi-source, validated) ---------- */
function timeoutFetch(url, opts, ms) {
  var ctl = new AbortController();
  var id = setTimeout(function () { ctl.abort(); }, ms);
  opts = opts || {};
  opts.signal = ctl.signal;
  opts.cache = 'no-store';
  return fetch(url, opts).finally(function () { clearTimeout(id); });
}

function srcWorldTime() {
  return timeoutFetch('https://worldtimeapi.org/api/timezone/Etc/UTC', {}, 7000)
    .then(function (r) { if (!r.ok) throw new Error('bad'); return r.json(); })
    .then(function (j) {
      var s = String(j.utc_datetime || '').replace(/(\.\d{3})\d+/, '$1');
      var ms = Date.parse(s);
      if (!isFinite(ms)) ms = j.unixtime * 1000 + 500;
      return ms;
    });
}
function srcTimeApi() {
  return timeoutFetch('https://timeapi.io/api/Time/current/zone?timeZone=UTC', {}, 7000)
    .then(function (r) { if (!r.ok) throw new Error('bad'); return r.json(); })
    .then(function (j) {
      return Date.UTC(j.year, j.month - 1, j.day, j.hour, j.minute, j.seconds, j.milliSeconds || 0);
    });
}
function srcOrigin() {
  return timeoutFetch('./?timesync=' + Date.now(), { method: 'HEAD' }, 7000)
    .then(function (r) {
      var h = r.headers.get('Date');
      var ms = Date.parse(h);
      if (!isFinite(ms)) throw new Error('nodate');
      return ms + 500; // header has 1-second resolution
    });
}

function wrap(fn, extra) {
  var t0 = perfEpochMs();
  return fn().then(function (srvMs) {
    var t1 = perfEpochMs();
    return { offset: srvMs - (t0 + t1) / 2, err: (t1 - t0) / 2 + extra };
  });
}

var syncing = false;
function syncTime() {
  if (syncing) return Promise.resolve();
  syncing = true;
  var jobs = [wrap(srcWorldTime, 5), wrap(srcTimeApi, 5), wrap(srcOrigin, 500)];
  return Promise.all(jobs.map(function (p) { return p.then(function (v) { return v; }, function () { return null; }); }))
    .then(function (res) {
      var good = res.filter(function (x) { return x && isFinite(x.offset); });
      if (!good.length) throw new Error('none');
      var sorted = good.map(function (g) { return g.offset; }).sort(function (a, b) { return a - b; });
      var med = sorted[Math.floor(sorted.length / 2)];
      var agree = good.filter(function (g) { return Math.abs(g.offset - med) <= 2500; });
      if (!agree.length) throw new Error('disagree');
      var best = agree.slice().sort(function (a, b) { return a.err - b.err; })[0];
      var offset = agree.length > 1 ? agree.reduce(function (s, g) { return s + g.offset; }, 0) / agree.length : best.offset;
      var candidateMs = perfEpochMs() + offset;
      if (candidateMs < Date.parse('2026-01-01T00:00:00Z')) throw new Error('implausible');
      clock.offsetMs = offset;
      clock.synced = true;
      clock.failed = false;
      clock.sources = agree.length;
      clock.uncertaintyMs = Math.round(best.err);
    })
    .catch(function () {
      clock.synced = false;
      clock.failed = true;
      useDeviceClock();
    })
    .then(function () { syncing = false; dirty = true; });
}

/* ================================================================
   CALENDAR MATH — BigInt Gregorian (no Date range limit)
   ================================================================ */
function fdiv(a, b) {
  var q = a / b;
  if ((a % b !== 0n) && ((a < 0n) !== (b < 0n))) q -= 1n;
  return q;
}
function civilFromDays(z) {
  z += 719468n;
  var era = fdiv(z, 146097n);
  var doe = z - era * 146097n;
  var yoe = (doe - doe / 1460n + doe / 36524n - doe / 146096n) / 365n;
  var y = yoe + era * 400n;
  var doy = doe - (365n * yoe + yoe / 4n - yoe / 100n);
  var mp = (5n * doy + 2n) / 153n;
  var d = doy - (153n * mp + 2n) / 5n + 1n;
  var m = mp < 10n ? mp + 3n : mp - 9n;
  if (m <= 2n) y += 1n;
  return { y: y, m: Number(m), d: Number(d) };
}
function isLeapBig(y) { return (y % 4n === 0n && y % 100n !== 0n) || y % 400n === 0n; }
function dim(y, m) { return [31, isLeapBig(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }
function localParts(ns) {
  var l = ns + TZ_NS;
  var dn = fdiv(l, DAY_NS);
  var tod = l - dn * DAY_NS;
  var c = civilFromDays(dn);
  return { y: c.y, m: c.m, d: c.d, tod: tod, dayNum: dn };
}
var O = localParts(ORIGIN_NS);   // 2026-10-31 17:12:00 Dhaka

function elapsed(now) { var d = now - ORIGIN_NS; return d < 0n ? 0n : d; }

/* ---------- Seven independent calculation functions ---------- */
function calculateYears(now) {
  var L = localParts(now);
  var yrs = L.y - O.y;
  var anchorDay = Math.min(O.d, dim(L.y, O.m));
  var before = L.m < O.m ||
    (L.m === O.m && (L.d < anchorDay || (L.d === anchorDay && L.tod < O.tod)));
  if (before) yrs -= 1n;
  return yrs < 0n ? 0n : yrs;
}
function calculateMonths(now) {
  var L = localParts(now);
  var total = (L.y - O.y) * 12n + BigInt(L.m - O.m);
  var anchorDay = Math.min(O.d, dim(L.y, L.m));
  if (L.d < anchorDay || (L.d === anchorDay && L.tod < O.tod)) total -= 1n;
  return total < 0n ? 0n : total;
}
function calculateDays(now)    { return elapsed(now) / DAY_NS; }
function calculateHours(now)   { return elapsed(now) / (3600n * NS); }
function calculateMinutes(now) { return elapsed(now) / (60n * NS); }
function calculateSeconds(now) { return elapsed(now) / NS; }
function calculateNanoseconds(now) { return elapsed(now); }

var COUNTERS = [
  ['years', calculateYears], ['months', calculateMonths], ['days', calculateDays],
  ['hours', calculateHours], ['minutes', calculateMinutes], ['seconds', calculateSeconds]
];

/* ================================================================
   LANGUAGES
   ================================================================ */
var STR = {
  en: {
    title: 'DADI',
    main_h: 'ETERNAL MEMORIAL',
    tagline: 'A Lifetime of Love. A Forever of Duas.',
    kicker: 'FOREVER REMEMBERED. ALWAYS IN OUR DUAS.',
    origin_h: 'Original memorial date and time',
    origin_tz: 'BANGLADESH STANDARD TIME (UTC+06:00) · Asia/Dhaka · 2026-10-31T17:12:00+06:00',
    now_h: 'Current Bangladesh date and time',
    sw_title: 'DADI — ETERNAL MEMORIAL STOPWATCH',
    sw_sub: 'Counting Every Moment Since Her Departure.',
    u_years: 'TOTAL YEARS', u_months: 'TOTAL MONTHS', u_days: 'TOTAL DAYS', u_hours: 'TOTAL HOURS',
    u_minutes: 'TOTAL MINUTES', u_seconds: 'TOTAL SECONDS', u_nanos: 'TOTAL NANOSECONDS',
    on: 'ONLINE — BANGLADESH TIME', off: 'OFFLINE — DEVICE TIME',
    on_detail: 'Synchronized with {n} time source(s), uncertainty about ±{u} ms.',
    off_detail: 'Using this device\'s clock. Accuracy depends on the device clock being correct. Sync resumes when the connection returns.',
    precision: 'Clock resolution here is about {r}. Nanoseconds are an exact conversion of the best available timestamp; digits finer than the clock can measure are shown as zero, never invented.',
    precision_unknown: 'Clock resolution could not be measured. Nanoseconds are an exact conversion of the best available timestamp; digits finer than the clock can measure are shown as zero, never invented.',
    hijri_m: 'Hijri (Umm al-Qura calculation; may differ from locally sighted dates): ',
    bangla_m: 'Bangla (Bangladesh revised calendar): ',
    pr_title: 'YEAR {y}',
    pr_text: '{p}% of this calendar year has passed. This is a calendar visual only.',
    duas_title: 'DUAS FOR MY BELOVED DADI',
    duas_sub: 'Authentic Supplications from the Qur\'an and Sunnah.',
    accuracy_note: 'Each entry shows its source. This collection does not claim to contain every dua in the Qur\'an and Hadith. Where wording is adapted for a woman, it is marked as an adaptation.',
    daily_title: 'Daily dua',
    another: 'READ ANOTHER DUA',
    hl_title: 'HOW LONG SHOULD I READ A DUA?',
    hl_en: 'There is no prescribed minimum number of seconds or minutes that guarantees a dua will be accepted. Make sincere supplication regularly, with humility and hope in Allah\'s mercy. No particular duration or repetition should be presented as a guaranteed way to obtain forgiveness or Jannah.',
    hl_bn: 'দোয়া কবুল হওয়ার জন্য নির্দিষ্ট কোনো সর্বনিম্ন সেকেন্ড বা মিনিট নির্ধারিত নেই। আন্তরিকতা, বিনয় ও আল্লাহর রহমতের প্রতি আশা নিয়ে নিয়মিত দোয়া করুন। নির্দিষ্ট সময় বা নির্দিষ্ট সংখ্যকবার পড়লেই ক্ষমা বা জান্নাত নিশ্চিত হবে—এমন দাবি ইসলামে নেই।',
    hl_add: 'Even a short, sincere dua is valuable. Remember DADI regularly in your prayers.',
    vp_title: 'PLEASE REMEMBER DADI IN YOUR DUAS',
    vp_text: 'If you have visited this memorial, please take a moment to pray for my beloved DADI.\n\nMay Allah forgive her, shower her with mercy, make her grave spacious and filled with light, protect her from the punishment of the grave and the Fire, and grant her Jannatul Firdaus.\n\nAmeen.',
    ameen: 'Ameen',
    ameen_msg: 'Ameen. May Allah accept every sincere dua. Allah knows best.',
    final_title: 'FOREVER IN OUR HEARTS.<br>ALWAYS IN OUR DUAS.',
    final_1: 'O Allah, forgive her and have mercy upon her.',
    final_2: 'O Allah, admit her into the highest level of Paradise.',
    sc_deceased: 'Directly intended for the deceased', sc_general: 'General supplication (not specific to the deceased)', sc_bereaved: 'For those who grieve', sc_self: 'Taught for oneself (general)', l_scope: 'Type',
    l_ar: 'Arabic', l_orig: 'Original narrated wording (masculine)', l_adapt: 'Adapted feminine wording for personal dua',
    l_tr: 'Transliteration', l_en: 'English', l_bn: 'বাংলা', l_src: 'Source', l_grade: 'Grading', l_note: 'Meaning and notes',
    l_adapted: 'Adapted wording', l_pm: 'AM', loading_err: 'The dua collection could not be loaded. Please open this page from its web address or reload.'
  },
  ar: {
    title: 'دادي',
    main_h: 'الذكرى الأبدية',
    tagline: 'حب العمر. ودعاء إلى الأبد.',
    kicker: 'لن تُنسى أبدًا. وفي دعائنا دائمًا.',
    origin_h: 'تاريخ ووقت الوفاة الأصلي',
    origin_tz: 'توقيت بنغلاديش القياسي (UTC+06:00) · آسيا/دكا · 2026-10-31T17:12:00+06:00',
    now_h: 'التاريخ والوقت الحاليان في بنغلاديش',
    sw_title: 'دادي — العدّاد التذكاري الأبدي',
    sw_sub: 'نعدّ كل لحظة منذ رحيلها.',
    u_years: 'إجمالي السنوات', u_months: 'إجمالي الشهور', u_days: 'إجمالي الأيام', u_hours: 'إجمالي الساعات',
    u_minutes: 'إجمالي الدقائق', u_seconds: 'إجمالي الثواني', u_nanos: 'إجمالي النانو ثانية',
    on: 'متصل — توقيت بنغلاديش', off: 'غير متصل — توقيت الجهاز',
    on_detail: 'تمت المزامنة مع {n} من مصادر الوقت، بهامش خطأ يقارب ±{u} مللي ثانية.',
    off_detail: 'يُستخدم توقيت هذا الجهاز، ودقته تعتمد على صحة ساعة الجهاز. ستُستأنف المزامنة عند عودة الاتصال.',
    precision: 'دقة الساعة هنا نحو {r}. النانو ثانية تحويل دقيق لأفضل طابع زمني متاح؛ الأرقام الأدق مما تقيسه الساعة تظهر أصفارًا ولا تُختلق.',
    precision_unknown: 'تعذّر قياس دقة الساعة. النانو ثانية تحويل دقيق لأفضل طابع زمني متاح؛ الأرقام الأدق مما تقيسه الساعة تظهر أصفارًا ولا تُختلق.',
    hijri_m: 'الهجري (حساب أم القرى؛ قد يختلف عن التواريخ المعلنة محليًا): ',
    bangla_m: 'التقويم البنغالي (المعدّل في بنغلاديش): ',
    pr_title: 'سنة {y}',
    pr_text: 'مضى {p}% من هذه السنة الميلادية. هذا عرض تقويمي فقط.',
    duas_title: 'أدعية لدادي الحبيبة',
    duas_sub: 'أدعية صحيحة من القرآن والسنة.',
    accuracy_note: 'لكل دعاء مصدره. لا تدّعي هذه المجموعة أنها تضم كل دعاء في القرآن والحديث. وحيث عُدّلت الصيغة للمرأة فقد وُسمت بأنها صيغة معدّلة.',
    daily_title: 'دعاء اليوم',
    another: 'اقرأ دعاءً آخر',
    hl_title: 'كم ينبغي أن أقرأ الدعاء؟',
    hl_en: 'لا يوجد حدٌّ أدنى محدد من الثواني أو الدقائق يضمن قبول الدعاء. ادعُ بإخلاص وانتظام، بتواضع ورجاء في رحمة الله. ولا ينبغي تقديم مدة معينة أو عدد معين من التكرار على أنه طريق مضمون للمغفرة أو الجنة.',
    hl_bn: 'দোয়া কবুল হওয়ার জন্য নির্দিষ্ট কোনো সর্বনিম্ন সময় বা সেকেন্ডের শর্ত নেই। আন্তরিকতা, বিনয় ও আল্লাহর প্রতি পূর্ণ আশা নিয়ে নিয়মিত দোয়া করুন। নির্দিষ্ট সময় বা নির্দিষ্ট সংখ্যকবার পড়লেই দোয়া অবশ্যই কবুল হবে—এমন নিশ্চয়তা ইসলামে নেই।',
    hl_add: 'حتى الدعاء القصير الصادق له قيمته. اذكروا دادي في دعائكم باستمرار.',
    vp_title: 'نرجو أن تذكروا دادي في دعائكم',
    vp_text: 'إن زرتَ هذه الصفحة التذكارية، فنرجو أن تتوقف لحظة وتدعو لدادي الحبيبة.\n\nاللهم اغفر لها وأغدق عليها رحمتك، ووسّع قبرها واملأه نورًا، وأجرها من عذاب القبر وعذاب النار، وارزقها جنة الفردوس.\n\nآمين.',
    ameen: 'آمين',
    ameen_msg: 'آمين. تقبّل الله كل دعاء صادق. والله أعلم.',
    final_title: 'في قلوبنا للأبد.<br>وفي دعائنا دائمًا.',
    final_1: 'اللهم اغفر لها وارحمها.',
    final_2: 'اللهم أدخلها الفردوس الأعلى.',
    sc_deceased: 'مقصود به المتوفى مباشرة', sc_general: 'دعاء عام (ليس خاصًّا بالمتوفى)', sc_bereaved: 'لمن أصابه الحزن', sc_self: 'مشروع للمرء لنفسه (عام)', l_scope: 'النوع',
    l_ar: 'النص العربي', l_orig: 'اللفظ الأصلي المروي (بصيغة المذكر)', l_adapt: 'صيغة مؤنثة معدّلة للدعاء الشخصي',
    l_tr: 'النطق بالحروف اللاتينية', l_en: 'English', l_bn: 'বাংলা', l_src: 'المصدر', l_grade: 'الدرجة', l_note: 'المعنى وملاحظات',
    l_adapted: 'صيغة معدّلة', loading_err: 'تعذّر تحميل مجموعة الأدعية. افتح الصفحة من عنوانها على الويب أو أعد التحميل.'
  },
  bn: {
    title: 'দাদী',
    main_h: 'চিরস্মরণীয় স্মৃতি',
    tagline: 'জীবনভর ভালোবাসা। চিরকালের দোয়া।',
    kicker: 'চিরস্মরণীয়। আমাদের দোয়ায় সবসময়।',
    origin_h: 'স্মৃতির মূল তারিখ ও সময়',
    origin_tz: 'বাংলাদেশ স্ট্যান্ডার্ড টাইম (UTC+06:00) · এশিয়া/ঢাকা · 2026-10-31T17:12:00+06:00',
    now_h: 'বাংলাদেশের বর্তমান তারিখ ও সময়',
    sw_title: 'দাদী — চিরস্মরণীয় স্মৃতি-স্টপওয়াচ',
    sw_sub: 'তাঁর বিদায়ের পর থেকে প্রতিটি মুহূর্ত গুনে চলেছি।',
    u_years: 'মোট বছর', u_months: 'মোট মাস', u_days: 'মোট দিন', u_hours: 'মোট ঘণ্টা',
    u_minutes: 'মোট মিনিট', u_seconds: 'মোট সেকেন্ড', u_nanos: 'মোট ন্যানোসেকেন্ড',
    on: 'অনলাইন — বাংলাদেশ সময়', off: 'অফলাইন — ডিভাইসের সময়',
    on_detail: '{n}টি সময়ের উৎসের সাথে সিঙ্ক করা হয়েছে, অনিশ্চয়তা প্রায় ±{u} মিলিসেকেন্ড।',
    off_detail: 'এই ডিভাইসের ঘড়ি ব্যবহার করা হচ্ছে। নির্ভুলতা ডিভাইসের ঘড়ি সঠিক থাকার উপর নির্ভর করে। সংযোগ ফিরলে আবার সিঙ্ক হবে।',
    precision: 'এখানে ঘড়ির নির্ভুলতা প্রায় {r}। ন্যানোসেকেন্ড হলো সর্বোত্তম পাওয়া টাইমস্ট্যাম্পের সঠিক রূপান্তর; ঘড়ি যা মাপতে পারে না তার চেয়ে সূক্ষ্ম অঙ্ক শূন্য দেখানো হয়, কখনো বানানো হয় না।',
    precision_unknown: 'ঘড়ির নির্ভুলতা মাপা যায়নি। ন্যানোসেকেন্ড হলো সর্বোত্তম পাওয়া টাইমস্ট্যাম্পের সঠিক রূপান্তর; ঘড়ি যা মাপতে পারে না তার চেয়ে সূক্ষ্ম অঙ্ক শূন্য দেখানো হয়, কখনো বানানো হয় না।',
    hijri_m: 'হিজরি (উম্মুল কুরা গণনা; স্থানীয়ভাবে চাঁদ দেখার তারিখ থেকে ভিন্ন হতে পারে): ',
    bangla_m: 'বাংলা (বাংলাদেশের সংশোধিত পঞ্জিকা): ',
    pr_title: '{y} সাল',
    pr_text: 'এই ইংরেজি বছরের {p}% পার হয়েছে। এটি শুধু ক্যালেন্ডারের একটি চিত্র।',
    duas_title: 'আমার প্রিয় দাদীর জন্য দোয়া',
    duas_sub: 'কুরআন ও সহিহ সুন্নাহ থেকে সংগৃহীত দোয়া।',
    accuracy_note: 'প্রতিটি দোয়ার উৎস উল্লেখ আছে। এই সংকলন দাবি করে না যে কুরআন ও হাদিসের প্রতিটি দোয়া এতে আছে। নারীর জন্য শব্দ পরিবর্তন করা হলে তা "রূপান্তরিত" বলে চিহ্নিত করা হয়েছে।',
    daily_title: 'আজকের দোয়া',
    another: 'আরেকটি দোয়া পড়ুন',
    hl_title: 'দোয়া কতক্ষণ পড়া উচিত?',
    hl_en: 'There is no prescribed minimum number of seconds or minutes that guarantees a dua will be accepted. Make sincere supplication regularly, with humility and hope in Allah\'s mercy. No particular duration or repetition should be presented as a guaranteed way to obtain forgiveness or Jannah.',
    hl_bn: 'দোয়া কবুল হওয়ার জন্য নির্দিষ্ট কোনো সর্বনিম্ন সেকেন্ড বা মিনিট নির্ধারিত নেই। আন্তরিকতা, বিনয় ও আল্লাহর রহমতের প্রতি আশা নিয়ে নিয়মিত দোয়া করুন। নির্দিষ্ট সময় বা নির্দিষ্ট সংখ্যকবার পড়লেই ক্ষমা বা জান্নাত নিশ্চিত হবে—এমন দাবি ইসলামে নেই।',
    hl_add: 'ছোট কিন্তু আন্তরিক দোয়াও মূল্যবান। দাদীকে নিয়মিত আপনার দোয়ায় স্মরণ করুন।',
    vp_title: 'অনুগ্রহ করে তাঁকে আপনার দোয়ায় স্মরণ করুন',
    vp_text: 'আপনি যদি আমার দাদীর এই স্মৃতির পাতায় এসে থাকেন, অনুগ্রহ করে তাঁর জন্য একটি দোয়া করবেন।\n\nআল্লাহ যেন তাঁর সকল গুনাহ ক্ষমা করে দেন, তাঁর প্রতি অসীম রহম করেন, তাঁর কবর প্রশস্ত ও নূরে আলোকিত করে দেন, কবরের আজাব ও জাহান্নামের আগুন থেকে রক্ষা করেন এবং তাঁকে জান্নাতুল ফেরদাউস দান করেন।\n\nআমিন।',
    ameen: 'আমিন',
    ameen_msg: 'আমিন। আল্লাহ প্রতিটি আন্তরিক দোয়া কবুল করুন। আল্লাহই ভালো জানেন।',
    final_title: 'আমাদের হৃদয়ে চিরদিন।<br>আমাদের দোয়ায় সবসময়।',
    final_1: 'হে আল্লাহ! আমার দাদীকে ক্ষমা করুন এবং তাঁর প্রতি রহম করুন।',
    final_2: 'হে আল্লাহ! তাঁকে জান্নাতুল ফেরদাউস দান করুন।',
    sc_deceased: 'সরাসরি মৃতের জন্য', sc_general: 'সাধারণ দোয়া (বিশেষভাবে মৃতের জন্য নয়)', sc_bereaved: 'শোকগ্রস্তদের জন্য', sc_self: 'নিজের জন্য শেখানো (সাধারণ)', l_scope: 'ধরন',
    l_ar: 'আরবি', l_orig: 'বর্ণিত মূল শব্দ (পুরুষবাচক)', l_adapt: 'ব্যক্তিগত দোয়ার জন্য রূপান্তরিত নারীবাচক শব্দ',
    l_tr: 'উচ্চারণ (ইংরেজি হরফে)', l_en: 'English', l_bn: 'বাংলা', l_src: 'উৎস', l_grade: 'মান', l_note: 'অর্থ ও টীকা',
    l_adapted: 'রূপান্তরিত', loading_err: 'দোয়ার সংকলন লোড করা যায়নি। ওয়েব ঠিকানা থেকে পাতাটি খুলুন বা রিলোড করুন।'
  }
};

var lang = 'en';
try { var saved = localStorage.getItem('memorial-lang'); if (saved && STR[saved]) lang = saved; } catch (e) {}
function T(k) { return STR[lang][k] != null ? STR[lang][k] : STR.en[k]; }
function fill(s, o) { return s.replace(/\{(\w+)\}/g, function (_, k) { return o[k]; }); }

function digits(s) {
  if (lang === 'ar') return s.replace(/\d/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[d]; });
  if (lang === 'bn') return s.replace(/\d/g, function (d) { return '০১২৩৪৫৬৭৮৯'[d]; });
  return s;
}
function fmtBig(b) {
  var s = b.toString().replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'ar' ? '٬' : ',');
  return digits(s);
}

/* ================================================================
   DATE DISPLAY (Intl + Bangladesh revised Bangla calendar)
   ================================================================ */
function loc(extra) {
  var base = lang === 'ar' ? 'ar-u-ca-gregory-nu-arab' : lang === 'bn' ? 'bn-BD-u-ca-gregory-nu-beng' : 'en-GB';
  return base + (extra || '');
}
function fmtIntl(ms, opts, extra) {
  try {
    opts.timeZone = TZ_NAME;
    return new Intl.DateTimeFormat(loc(extra), opts).format(new Date(ms));
  } catch (e) { return '—'; }
}
function gDate(ms) {
  var s = fmtIntl(ms, { day: 'numeric', month: 'long', year: 'numeric' });
  return lang === 'bn' ? s.replace(/,/g, '') : s;
}
function gDay(ms) { return fmtIntl(ms, { weekday: 'long' }); }
function bnPeriod(h) {
  if (h >= 4 && h < 6) return 'ভোর';
  if (h >= 6 && h < 12) return 'সকাল';
  if (h >= 12 && h < 15) return 'দুপুর';
  if (h >= 15 && h < 18) return 'বিকাল';
  if (h >= 18 && h < 20) return 'সন্ধ্যা';
  return 'রাত';
}
function gTime(ms, secs) {
  if (lang === 'bn') {
    var L = localParts(BigInt(Math.floor(ms)) * 1000000n);
    var h24 = Number(L.tod / 3600000000000n);
    var mi = Number(L.tod % 3600000000000n / 60000000000n);
    var se = Number(L.tod % 60000000000n / 1000000000n);
    var h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    var txt = h12 + ':' + (mi < 10 ? '0' : '') + mi + (secs ? ':' + (se < 10 ? '0' : '') + se : '');
    return bnPeriod(h24) + ' ' + digits(txt);
  }
  var o = { hour: 'numeric', minute: '2-digit', hour12: true };
  if (secs) o.second = '2-digit';
  try {
    o.timeZone = TZ_NAME;
    var l = lang === 'en' ? 'en-US' : loc();
    return new Intl.DateTimeFormat(l, o).format(new Date(ms));
  } catch (e) { return '—'; }
}
function hijri(ms) {
  try {
    var base = lang === 'ar' ? 'ar-u-ca-islamic-umalqura-nu-arab' : lang === 'bn' ? 'bn-BD-u-ca-islamic-umalqura-nu-beng' : 'en-GB-u-ca-islamic-umalqura';
    var parts = new Intl.DateTimeFormat(base, { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ_NAME }).formatToParts(new Date(ms));
    var s = parts.filter(function (p) { return p.type !== 'era'; }).map(function (p) { return p.value; }).join('').replace(/[\s,]+$/, '');
    return s + ' ' + (lang === 'ar' ? 'هـ' : lang === 'bn' ? 'হিজরি' : 'AH');
  } catch (e) { return '—'; }
}

var BN_MONTHS = {
  bn: ['বৈশাখ', 'জ্যৈষ্ঠ', 'আষাঢ়', 'শ্রাবণ', 'ভাদ্র', 'আশ্বিন', 'কার্তিক', 'অগ্রহায়ণ', 'পৌষ', 'মাঘ', 'ফাল্গুন', 'চৈত্র'],
  en: ['Boishakh', 'Joishtho', 'Asharh', 'Srabon', 'Bhadro', 'Ashwin', 'Kartik', 'Ogrohayon', 'Poush', 'Magh', 'Falgun', 'Choitro'],
  ar: ['بويشاخ', 'جويشتو', 'آشارح', 'شرابون', 'بهادرو', 'أشوين', 'كارتيك', 'أوغرهايون', 'بوش', 'ماغ', 'فالغون', 'تشويترو']
};
function leapN(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
// Bangladesh revised calendar: year starts 14 April; first five months 31 days,
// then 30-day months; Falgun is 29 days (30 in a leap year); Chaitra 30.
function banglaDate(ms) {
  var L = localParts(BigInt(Math.floor(ms)) * 1000000n);
  if (L.y > 270000n) return null;
  var y = Number(L.y), m = L.m, d = L.d;
  var t = Date.UTC(y, m - 1, d);
  var start = Date.UTC(y, 3, 14), by = y;
  if (t < start) { by = y - 1; start = Date.UTC(by, 3, 14); }
  var doy = Math.round((t - start) / 86400000);
  var lens = [31, 31, 31, 31, 31, 30, 30, 30, 30, 30, leapN(by + 1) ? 30 : 29, 30];
  var i = 0;
  while (i < 11 && doy >= lens[i]) { doy -= lens[i]; i++; }
  return { year: by - 593, month: i, day: doy + 1 };
}
function banglaText(ms) {
  var b = banglaDate(ms);
  if (!b) return '—';
  var names = BN_MONTHS[lang] || BN_MONTHS.en;
  var s = b.day + ' ' + names[b.month] + ' ' + b.year;
  return lang === 'bn' ? digits(s) : lang === 'ar' ? digits(s) : s;
}

/* ================================================================
   RENDERING — counters
   ================================================================ */
var dirty = true;
var lastSec = -1n;
var lastNsPaint = 0;
var lastLen = {};

function $(id) { return document.getElementById(id); }

function fit(el) {
  var box = el.parentElement;
  el.style.fontSize = '';
  var size = parseFloat(getComputedStyle(el).fontSize);
  var guard = 40;
  while (guard-- > 0 && size > 10 && el.scrollWidth > box.clientWidth * 0.97) {
    size = size * 0.94;
    el.style.fontSize = size + 'px';
  }
}
function setNum(id, text) {
  var el = $(id);
  if (el.textContent !== text) {
    var prevLen = lastLen[id];
    el.textContent = text;
    if (prevLen !== text.length) { lastLen[id] = text.length; fit(el); }
  }
}

function renderCounters(now) {
  for (var i = 0; i < COUNTERS.length; i++) {
    setNum('v-' + COUNTERS[i][0], fmtBig(COUNTERS[i][1](now)));
  }
}
function paintNanos(now) { setNum('v-nanos', fmtBig(calculateNanoseconds(now))); }

function renderClockInfo() {
  var ms = currentMs();
  $('c-day').textContent = gDay(ms);
  $('c-date').textContent = gDate(ms);
  $('c-time').textContent = digits(gTime(ms, true));
  $('c-hijri').textContent = T('hijri_m') + hijri(ms);
  $('c-bangla').textContent = T('bangla_m') + banglaText(ms);

  var st = $('status');
  st.textContent = clock.synced ? T('on') : T('off');
  st.classList.toggle('off', !clock.synced);
  $('status-detail').textContent = clock.synced
    ? fill(T('on_detail'), { n: digits(String(clock.sources)), u: digits(String(clock.uncertaintyMs)) })
    : T('off_detail');

  // Year progress (calendar visual only)
  var L = localParts(nowNs());
  if (L.y < 270000n) {
    var y = Number(L.y);
    var s = Date.UTC(y, 0, 1) - 6 * 3600000, e = Date.UTC(y + 1, 0, 1) - 6 * 3600000;
    var p = Math.min(100, Math.max(0, (ms - s) / (e - s) * 100));
    var pf = p.toFixed(2);
    $('pfill').style.width = pf + '%';
    $('pbar').setAttribute('aria-valuenow', pf);
    $('pr-h').textContent = fill(T('pr_title'), { y: digits(String(y)) });
    $('pr-text').textContent = fill(T('pr_text'), { p: digits(pf) });
  }

  var r;
  if (resolutionUs == null) { $('precision').textContent = T('precision_unknown'); }
  else {
    r = resolutionUs >= 1000 ? (resolutionUs / 1000).toFixed(1) + ' ms' : resolutionUs.toFixed(resolutionUs < 10 ? 1 : 0) + ' µs';
    $('precision').textContent = fill(T('precision'), { r: digits(r) });
  }
}

function renderOrigin() {
  $('o-date').textContent = gDate(ORIGIN_MS);
  $('o-day').textContent = gDay(ORIGIN_MS);
  $('o-time').textContent = digits(gTime(ORIGIN_MS, false));
  $('o-hijri').textContent = T('hijri_m') + hijri(ORIGIN_MS);
  $('o-bangla').textContent = T('bangla_m') + banglaText(ORIGIN_MS);
}

function tick(ts) {
  var now = nowNs();
  var sec = now / NS;
  if (sec !== lastSec || dirty) {
    lastSec = sec;
    if (!clock.synced) useDeviceClock();
    now = nowNs();
    renderCounters(now);
    renderClockInfo();
    dirty = false;
  }
  if (ts - lastNsPaint > 60) { paintNanos(nowNs()); lastNsPaint = ts; }
  if (!document.hidden) requestAnimationFrame(tick);
}

/* ================================================================
   i18n application
   ================================================================ */
function applyLang() {
  var h = document.documentElement;
  h.lang = lang;
  h.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.title = lang === 'ar' ? 'دادي — الذكرى الأبدية' : lang === 'bn' ? 'দাদী — চিরস্মরণীয় স্মৃতি' : 'DADI — Eternal Memorial';
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    var k = el.getAttribute('data-i18n');
    var v = T(k);
    if (k === 'final_title') el.innerHTML = v; else el.textContent = v;
  });
  document.querySelectorAll('[data-i18n-paras]').forEach(function (el) {
    var parts = T(el.getAttribute('data-i18n-paras')).split('\n\n');
    el.textContent = '';
    parts.forEach(function (p) { var n = document.createElement('p'); n.textContent = p; el.appendChild(n); });
  });
  // "How long" message: Bengali copy is always Bengali; English copy stays English except in Arabic mode
  var hl = document.querySelector('[data-i18n="hl_en"]');
  if (hl) { hl.lang = lang === 'ar' ? 'ar' : 'en'; if (lang === 'bn') hl.lang = 'en'; }
  document.querySelectorAll('.langbar button').forEach(function (b) {
    b.setAttribute('aria-pressed', b.getAttribute('data-lang') === lang ? 'true' : 'false');
  });
  $('ameen-msg').textContent = '';
  renderOrigin();
  lastLen = {};
  dirty = true;
  renderDuas();
}

/* ================================================================
   DUAS
   ================================================================ */
var DATA = null;
var dailyIdx = 0;

function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function lt(o) { return o[lang] || o.en; }
function noteOf(o) { return lang === 'bn' ? o.bn : o.en; }

function labelled(parent, label, node) {
  parent.appendChild(el('p', 'lbl', label));
  parent.appendChild(node);
}

function duaCard(d, featured) {
  var a = el('article', 'dua' + (featured ? ' featured' : ''));
  a.appendChild(el(featured ? 'h4' : 'h4', featured ? 'big' : '', lt(d.title)));
  if (d.orig_ar) {
    a.appendChild(el('p', 'lbl', T('l_orig')));
    var o = el('p', 'ar orig', d.orig_ar); o.lang = 'ar'; o.dir = 'rtl'; a.appendChild(o);
  }
  if (d.adapted || (featured && d.orig_ar)) {
    var ad = el('div', 'adapt', T('l_adapt')); a.appendChild(ad);
  } else {
    a.appendChild(el('p', 'lbl', T('l_ar')));
  }
  var ar = el('p', 'ar', d.ar); ar.lang = 'ar'; ar.dir = 'rtl'; a.appendChild(ar);
  var tr = el('p', 'tr', d.tr); tr.lang = 'en'; labelled(a, T('l_tr'), tr);
  var en = el('p', 'en', d.en); en.lang = 'en'; labelled(a, T('l_en'), en);
  var bn = el('p', 'bn', d.bn); bn.lang = 'bn'; labelled(a, T('l_bn'), bn);
  if (d.note) { var nt = el('p', 'note', noteOf(d.note)); nt.lang = lang === 'bn' ? 'bn' : 'en'; labelled(a, T('l_note'), nt); }
  var meta = el('div', 'meta');
  if (d.scope) meta.appendChild(el('span', 'tag', T('l_scope') + ': ' + T('sc_' + d.scope)));
  var s = el('span', 'tag', T('l_src') + ': ' + d.src); s.lang = 'en'; meta.appendChild(s);
  meta.appendChild(el('span', 'tag grade', T('l_grade') + ': ' + lt(d.grade)));
  if (d.adapted) meta.appendChild(el('span', 'tag', T('l_adapted')));
  a.appendChild(meta);
  return a;
}

function renderDuas() {
  var feat = $('featured'), cats = $('categories'), daily = $('daily-card');
  if (!DATA) return;
  var open = {};
  cats.querySelectorAll('details').forEach(function (d) { open[d.getAttribute('data-id')] = d.open; });
  feat.textContent = ''; cats.textContent = ''; daily.textContent = '';
  feat.appendChild(duaCard(DATA.featured, true));
  var byId = {};
  DATA.duas.forEach(function (d) { byId[d.id] = d; });
  DATA.categories.forEach(function (c) {
    var det = el('details', 'cat'); det.setAttribute('data-id', c.id);
    if (open[c.id]) det.open = true;
    det.appendChild(el('summary', '', lt(c.title)));
    var body = el('div', 'cat-body');
    c.ids.forEach(function (id) { if (byId[id]) body.appendChild(duaCard(byId[id], false)); });
    det.appendChild(body);
    cats.appendChild(det);
  });
  daily.appendChild(duaCard(DATA.duas[dailyIdx % DATA.duas.length], false));
}

function loadDuas() {
  return fetch('duas.json').then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
    .then(function (j) {
      DATA = j;
      var dn = localParts(nowNs()).dayNum;
      dailyIdx = Number(dn % BigInt(DATA.duas.length));
      renderDuas();
    })
    .catch(function () { $('categories').textContent = T('loading_err'); });
}

/* ================================================================
   Events
   ================================================================ */
document.querySelectorAll('.langbar button').forEach(function (b) {
  b.addEventListener('click', function () {
    lang = b.getAttribute('data-lang');
    try { localStorage.setItem('memorial-lang', lang); } catch (e) {}
    applyLang();
  });
});
$('another').addEventListener('click', function () {
  if (!DATA) return;
  var n = DATA.duas.length, next;
  do { next = Math.floor(Math.random() * n); } while (n > 1 && next === dailyIdx % n);
  dailyIdx = next;
  var daily = $('daily-card'); daily.textContent = '';
  daily.appendChild(duaCard(DATA.duas[dailyIdx], false));
});
$('ameen').addEventListener('click', function () { $('ameen-msg').textContent = T('ameen_msg'); });

var rsz;
window.addEventListener('resize', function () {
  clearTimeout(rsz);
  rsz = setTimeout(function () { lastLen = {}; dirty = true; }, 150);
});
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) { dirty = true; if (!clock.synced) useDeviceClock(); requestAnimationFrame(tick); syncTime(); }
});
window.addEventListener('online', function () { syncTime(); });
window.addEventListener('offline', function () { clock.synced = false; useDeviceClock(); dirty = true; });
setInterval(function () { if (!document.hidden && navigator.onLine !== false) syncTime(); }, 10 * 60 * 1000);

/* ================================================================
   Start
   ================================================================ */
applyLang();
loadDuas();
requestAnimationFrame(tick);
if (navigator.onLine !== false) syncTime();

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
}
})();
