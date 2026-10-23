// Rome wall-clock helpers and "where are we in the plan" logic. Pure — no DOM.

export const TIME_ZONE = 'Europe/Rome';

const romeClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function nowInRome(date = new Date()) {
  const p = Object.fromEntries(romeClock.formatToParts(date).map((part) => [part.type, part.value]));
  return { dateKey: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function parseNowOverride(value) {
  const m = value?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
  return m ? { dateKey: m[1], minutes: Number(m[2]) * 60 + Number(m[3]) } : null;
}

// Minutes on a linear wall-clock axis (UTC used only as a calendar, not a timezone).
function absolute(dateKey, minutes) {
  const [y, mo, d] = dateKey.split('-').map(Number);
  return Date.UTC(y, mo - 1, d) / 60000 + minutes;
}

export function findStatus(days, now) {
  const entries = days.flatMap((day) => day.items.map((item) => {
    const start = absolute(day.key, toMinutes(item.time.start));
    let end = item.time.end ? absolute(day.key, toMinutes(item.time.end)) : null;
    if (end !== null && end <= start) end += 24 * 60;
    return { item, start, end };
  }));
  entries.forEach((entry, i) => {
    if (entry.end === null) entry.end = entries[i + 1]?.start ?? entry.start + 60;
  });

  const t = absolute(now.dateKey, now.minutes);
  const current = entries.findLast((e) => e.start <= t && t < e.end) ?? null;
  const next = entries.find((e) => e.start > t) ?? null;
  let phase = 'during';
  if (!entries.length || t >= entries.at(-1).end) phase = 'after';
  else if (t < entries[0].start) phase = 'before';

  return {
    now,
    phase,
    pastIds: new Set(entries.filter((e) => e.end <= t).map((e) => e.item.id)),
    current: current?.item ?? null,
    next: next?.item ?? null,
    minutesToNext: next ? next.start - t : null,
  };
}

export function formatDayLabel(dateKey, options = { weekday: 'long', day: 'numeric', month: 'long' }) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat('pl-PL', { ...options, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}
