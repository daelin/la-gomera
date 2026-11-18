// Minimal evaluator for the common subset of OSM opening_hours used on La Gomera:
// "Mo-Fr 08:00-14:00,17:00-20:00; Sa 09:00-13:00; Su off; PH off", "24/7", "Mo-Su,PH 06:45-21:00".
// Returns null for anything it can't parse confidently (the UI then shows only the text).

const DAY = { Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6, Su: 0 };
const ORDER = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

// Spanish national holidays in/around the trip window
export const HOLIDAYS = new Set(['2026-12-08', '2026-12-25', '2027-01-01', '2027-01-06']);
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const isHoliday = (d) => HOLIDAYS.has(isoDate(d));

function parseDays(sel) {
  const days = new Set();
  let ph = false;
  for (const part of sel.split(',')) {
    const p = part.trim();
    if (p === 'PH') { ph = true; continue; }
    const m = p.match(/^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/);
    if (!m) return null;
    const a = ORDER.indexOf(m[1]), b = m[2] ? ORDER.indexOf(m[2]) : a;
    for (let i = a; ; i = (i + 1) % 7) { days.add(DAY[ORDER[i]]); if (i === b) break; }
  }
  return { days, ph };
}

function parseTimes(s) {
  if (/^(off|closed)$/.test(s)) return [];
  const out = [];
  for (const r of s.split(',')) {
    const m = r.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})\+?$/);
    if (!m) return null;
    const a = +m[1] * 60 + +m[2];
    let b = +m[3] * 60 + +m[4];
    if (b <= a) b += 24 * 60;
    out.push([a, b]);
  }
  return out;
}

const DAYSEL = '(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?';
const RULE_RE = new RegExp(`^(${DAYSEL}(?:,${DAYSEL})*)\\s+(.+)$`);

export function parseOH(str) {
  if (!str) return null;
  str = str.trim().replace(/,\s+/g, ',');
  if (str === '24/7') return { always: true };
  const rules = [];
  for (const raw of str.split(';')) {
    const rule = raw.trim();
    if (!rule) continue;
    const m = rule.match(RULE_RE);
    let sel, times;
    if (m) { sel = parseDays(m[1]); times = parseTimes(m[2].trim()); }
    else if ((times = parseTimes(rule))) sel = { days: new Set([0, 1, 2, 3, 4, 5, 6]), ph: false };
    if (!sel || !times) return null;
    rules.push({ ...sel, times });
  }
  return rules.length ? { rules } : null;
}

// opening intervals (minutes since midnight) for a date; later rules override earlier ones (OSM semantics)
export function intervalsFor(oh, date) {
  if (!oh) return null;
  if (oh.always) return [[0, 24 * 60]];
  const ph = isHoliday(date);
  const hasPh = oh.rules.some((r) => r.ph);
  const wd = date.getDay();
  let res = [];
  for (const r of oh.rules) {
    if (ph && hasPh) { if (r.ph) res = r.times; continue; }
    if (r.days.has(wd)) res = r.times;
  }
  return res;
}

const fmt = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// { state: 'open'|'closed'|'unknown', label }
export function status(ohStr, date = new Date()) {
  const oh = parseOH(ohStr);
  if (!oh) return { state: 'unknown', label: 'Zeiten unklar' };
  if (oh.always) return { state: 'open', label: 'Durchgehend offen' };
  const now = date.getHours() * 60 + date.getMinutes();
  const y = new Date(date); y.setDate(y.getDate() - 1);
  const overnight = intervalsFor(oh, y).filter(([, b]) => b > 1440).map(([a, b]) => [a - 1440, b - 1440]);
  const ints = [...overnight, ...intervalsFor(oh, date)];
  const cur = ints.find(([a, b]) => now >= a && now < b);
  if (cur) {
    const left = cur[1] - now;
    return { state: 'open', label: left <= 60 ? `Offen – schließt ${fmt(cur[1])}` : `Offen bis ${fmt(cur[1])}` };
  }
  const next = ints.filter(([a]) => a > now).sort((a, b) => a[0] - b[0])[0];
  if (next) return { state: 'closed', label: `Zu – öffnet ${fmt(next[0])}` };
  for (let i = 1; i <= 7; i++) {
    const d = new Date(date); d.setDate(d.getDate() + i);
    const ii = intervalsFor(oh, d);
    if (ii.length) {
      const wd = d.toLocaleDateString('de-DE', { weekday: 'short' });
      return { state: 'closed', label: `Zu – öffnet ${i === 1 ? 'morgen' : wd} ${fmt(ii[0][0])}` };
    }
  }
  return { state: 'closed', label: 'Geschlossen' };
}

// opening hours on a specific date as short text (for the day plan)
export function dayLabel(ohStr, date) {
  const oh = parseOH(ohStr);
  if (!oh) return null;
  if (oh.always) return 'durchgehend geöffnet';
  const ints = intervalsFor(oh, date);
  if (!ints.length) return 'geschlossen';
  return ints.map(([a, b]) => `${fmt(a)}–${fmt(b)}`).join(', ');
}
