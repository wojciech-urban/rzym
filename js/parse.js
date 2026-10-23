// Parses the itinerary Markdown (the single source of truth) into plain data. Pure — no DOM.

export const COLUMNS = ['time', 'name', 'fromPrev', 'transport', 'why', 'attr', 'safety', 'crowd', 'price', 'ticket', 'maps', 'tips', 'status'];

// Columns are matched by header text, so the table may use either wording and any order.
// Unknown headers are ignored; only time and name are required.
const HEADERS = [
  ['time', /godzina|data/i],
  ['name', /atrakcja|miejsce|lokalizacja|czynno/i],
  ['fromPrev', /od poprzedniego/i],
  ['transport', /transport|dojazd/i],
  ['why', /dlaczego|warto/i],
  ['attr', /atr/i],
  ['safety', /bezp/i],
  ['crowd', /t[łl]ok/i],
  ['price', /cena|koszt/i],
  ['ticket', /bilet/i],
  ['maps', /maps|mapa/i],
  ['tips', /wskaz|uwag/i],
  ['status', /status/i],
];

export function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

export function cleanCell(cell) {
  return cell === '—' || cell === '-' ? '' : cell;
}

export function parseTimeCell(cell, year) {
  const text = cell.replace(/\*\*/g, '').trim();
  const dateMatch = text.match(/^(\d{1,2})\.(\d{1,2})\s+/);
  const rest = dateMatch ? text.slice(dateMatch[0].length) : text;
  const times = [...rest.matchAll(/(\d{1,2}):(\d{2})/g)].map((m) => `${m[1].padStart(2, '0')}:${m[2]}`);
  if (times.length === 0) throw new Error(`Brak godziny w komórce: "${cell}"`);
  const dash = rest.search(/[–-]/);
  return {
    dateKey: dateMatch ? `${year}-${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}` : null,
    start: times[0],
    end: times.length > 1 ? times[times.length - 1] : null,
    endLabel: dash >= 0 ? rest.slice(dash + 1).trim() : '',
    approx: /\bok\./.test(rest),
  };
}

// "9,5/10", "**8/10**" or a bare "9,5" — anything else (prose, "—") is no score.
export function parseScore(cell) {
  const m = cell.replace(/\*\*/g, '').trim().match(/^(\d+(?:[.,]\d+)?)\s*(?:\/\s*10)?$/);
  return m ? Number(m[1].replace(',', '.')) : null;
}

export function classifyRow(name, { scored = false } = {}) {
  if (/→|przejście|powrót/i.test(name)) return 'transit';
  if (scored || name.includes('**')) return 'sight';
  return 'stop';
}

// Header cell → our key. The first pattern that matches wins, and each key is taken only once.
export function mapHeader(header) {
  const taken = new Set();
  return header.map((cell) => {
    const hit = HEADERS.find(([key, re]) => !taken.has(key) && re.test(cell));
    if (hit) taken.add(hit[0]);
    return hit?.[0] ?? null;
  });
}

function parseSections(lines) {
  const sections = [];
  for (const line of lines) {
    const text = line.trim();
    const heading = text.match(/^##\s+(.+)$/);
    if (heading) {
      sections.push({ title: heading[1], ordered: false, items: [], paragraphs: [] });
      continue;
    }
    if (!sections.length || !text) continue;
    const section = sections.at(-1);
    const item = text.match(/^(?:[-*]|(\d+)\.)\s+(.+)$/);
    if (item) {
      if (item[1]) section.ordered = true;
      section.items.push(item[2]);
    } else if (!text.startsWith('#') && !text.startsWith('|') && !text.startsWith('>')) {
      section.paragraphs.push(text);
    }
  }
  return sections;
}

export function parsePlan(md) {
  const lines = md.split(/\r?\n/);
  const title = (lines.find((l) => l.startsWith('# ')) ?? '# Plan').slice(2).trim();
  const year = Number(title.match(/\b(\d{4})\b/)?.[1] ?? new Date().getFullYear());

  const tableStart = lines.findIndex((l) => l.trim().startsWith('|'));
  if (tableStart < 0) throw new Error('Nie znaleziono tabeli planu');
  let tableEnd = tableStart;
  while (tableEnd < lines.length && lines[tableEnd].trim().startsWith('|')) tableEnd++;

  const meta = lines.slice(0, tableStart)
    .map((l) => l.trim().match(/^\*\*(.+?):\*\*\s*(.*)$/))
    .filter(Boolean)
    .map((m) => ({ label: m[1], value: m[2] }));

  const header = splitRow(lines[tableStart]);
  const keys = mapHeader(header);
  for (const required of ['time', 'name']) {
    if (!keys.includes(required)) throw new Error(`Tabela nie ma kolumny "${required}" (nagłówki: ${header.join(' | ')})`);
  }

  const days = [];
  const usedIds = new Set();
  for (const line of lines.slice(tableStart + 2, tableEnd)) {
    const cells = splitRow(line);
    if (cells.length !== keys.length) throw new Error(`Wiersz ma ${cells.length} kolumn, nagłówek ${keys.length}: ${line}`);
    const raw = Object.fromEntries(COLUMNS.map((key) => [key, cleanCell(cells[keys.indexOf(key)] ?? '')]));
    const time = parseTimeCell(raw.time, year);
    if (time.dateKey) {
      days.push({ key: time.dateKey, label: `${time.dateKey.slice(8, 10)}.${time.dateKey.slice(5, 7)}`, items: [] });
    }
    const day = days.at(-1);
    if (!day) throw new Error('Pierwszy wiersz tabeli musi zawierać datę');

    const baseId = `${day.key}-${time.start.replace(':', '')}`;
    let id = baseId;
    for (let n = 2; usedIds.has(id); n++) id = `${baseId}-${n}`;
    usedIds.add(id);

    const attr = parseScore(raw.attr);
    const safety = parseScore(raw.safety);
    const crowd = parseScore(raw.crowd);

    day.items.push({
      id,
      kind: classifyRow(raw.name, { scored: attr !== null }), // only Atr. marks an attraction; Bezp. is given for transit rows too
      optional: /—\s*opcjonalnie/i.test(raw.name),
      time,
      name: raw.name,
      fromPrev: raw.fromPrev,
      transport: raw.transport,
      why: raw.why,
      attr,
      safety,
      crowd,
      price: raw.price,
      ticket: raw.ticket,
      maps: raw.maps,
      tips: raw.tips,
      status: /^plan$/i.test(raw.status) ? '' : raw.status, // "Plan" is the default, not worth a badge
    });
  }

  return { title, year, meta, days, sections: parseSections(lines.slice(tableEnd)) };
}
