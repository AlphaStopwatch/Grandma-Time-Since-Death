# DADI — Eternal Memorial

A memorial website for my beloved DADI: seven independent elapsed-time counters, authentic duas (Arabic, transliteration, English, Bengali), and three calendars, in English, Arabic and Bengali.

**Permanent original timestamp:** `2026-10-31T17:12:00+06:00` (Saturday, 5:12 PM, Asia/Dhaka, UTC+06:00). It is set once in `script.js` (`ORIGIN_ISO`) and never replaced by the current date.

## Files
`index.html`, `style.css`, `script.js`, `sw.js` (offline cache), `duas.json` (dua library). No backend, login, tracking or paid API. Deploy by uploading all files to a GitHub Pages folder.

## How the counters work
Every update computes *current time − original timestamp* with BigInt, so refreshing, closing the browser or restarting the phone never loses time. Years and months are calendar-aware (BigInt Gregorian arithmetic); days, hours, minutes, seconds and nanoseconds each have their own function.

## Honest notes
- Browsers cannot measure true nanoseconds. The nanosecond card is an exact conversion of the best available timestamp; digits finer than the clock resolution (shown on the page) are zero, never random.
- Online, time is checked against several HTTPS sources and the median is used; otherwise the device clock is used and labelled OFFLINE — DEVICE TIME. These are not official Bangladesh government clocks.
- Hijri dates use the Umm al-Qura calculation and may differ from locally announced moon-sighting dates. Bangla dates follow the Bangladesh revised calendar.
- Dua texts, references and gradings should be checked by the owner against quran.com and sunnah.com (and ideally a scholar) before publishing. The collection does not claim to include every dua.
