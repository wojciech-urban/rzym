// Turns plan data into HTML strings. Pure — no DOM access, so it runs under node --test.
import { escapeHtml, renderInline, stripInline, extractLinks } from './inline.js';
import { formatDayLabel } from './time.js';

const TRANSPORT_ICONS = [[/metro/i, '🚇'], [/taxi/i, '🚕'], [/bus/i, '🚌'], [/winda|schody/i, '🛗'], [/pieszo/i, '🚶']];

export function transportIcon(transport) {
  return TRANSPORT_ICONS.find(([re]) => re.test(transport))?.[1] ?? '➜';
}

export function ticketTone(md) {
  if (md.includes('✅')) return 'ok';
  if (md.includes('🔴')) return 'warn';
  return '';
}

export function formatIn(minutes) {
  if (minutes < 60) return `za ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `za ${h} h ${m} min` : `za ${h} h`;
}

const formatScore = (value) => String(value).replace('.', ',');
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function meter(kind, label, value) {
  if (value === null) return '';
  return `<div class="meter meter--${kind}" role="img" aria-label="${label}: ${formatScore(value)} na 10">`
    + `<span class="meter__label" aria-hidden="true">${label}</span>`
    + `<span class="meter__track" aria-hidden="true"><span class="meter__fill" style="--v:${value / 10}"></span></span>`
    + `<span class="meter__value" aria-hidden="true">${formatScore(value)}</span></div>`;
}

function fact(label, md) {
  if (!md) return '';
  const tone = ticketTone(md);
  return `<div class="fact${tone ? ` fact--${tone}` : ''}"><dt>${label}</dt><dd>${renderInline(md)}</dd></div>`;
}

function route(item) {
  const parts = [];
  if (item.transport) {
    parts.push(`<span class="route__item"><span aria-hidden="true">${transportIcon(item.transport)}</span> ${renderInline(item.transport)}</span>`);
  }
  if (item.fromPrev) {
    parts.push(`<span class="route__item"><span class="route__label">Od poprzedniego:</span> ${renderInline(item.fromPrev)}</span>`);
  }
  return parts.length ? `<p class="route">${parts.join('')}</p>` : '';
}

function photo(image) {
  if (!image) return '';
  return `<figure class="card__photo">`
    + `<img class="card__img" src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}" loading="lazy" decoding="async">`
    + `<figcaption class="card__credit">Fot. ${escapeHtml(image.credit)}</figcaption>`
    + `</figure>`;
}

function card(item, image) {
  const scores = meter('attr', 'Atr.', item.attr) + meter('safety', 'Bezp.', item.safety) + meter('crowd', 'Tłok', item.crowd);
  const facts = fact('Cena / os.', item.price) + fact('Bilet', item.ticket);
  const maps = extractLinks(item.maps)
    .map((link) => `<a class="btn-map" href="${escapeHtml(link.url)}" target="_blank" rel="noopener">📍 ${escapeHtml(link.text.replace(/^📍\s*/u, ''))}</a>`)
    .join('');
  const done = item.kind === 'sight'
    ? `<label class="done"><input type="checkbox" data-done="${item.id}"> Zaliczone</label>`
    : '';
  return `<article class="card">`
    + photo(image)
    + `<header class="card__head"><h3 class="card__title">${renderInline(item.name)}</h3>`
    + (item.optional ? '<span class="badge">opcjonalnie</span>' : '')
    + (item.status ? `<span class="badge">${escapeHtml(item.status)}</span>` : '')
    + `</header>`
    + (item.why ? `<p class="card__why">${renderInline(item.why)}</p>` : '')
    + route(item)
    + (scores ? `<div class="scores">${scores}</div>` : '')
    + (facts ? `<dl class="facts">${facts}</dl>` : '')
    + (item.tips ? `<p class="card__tip"><span aria-hidden="true">💡</span> ${renderInline(item.tips)}</p>` : '')
    + (maps || done ? `<div class="card__actions">${maps}${done}</div>` : '')
    + `</article>`;
}

function timeColumn(time) {
  return `<div class="tl-time">`
    + (time.approx ? '<span class="tl-time__approx">ok.</span>' : '')
    + `<span class="tl-time__start">${time.start}</span>`
    + (time.endLabel ? `<span class="tl-time__end">${escapeHtml(time.endLabel).replace(/\//g, '/<wbr>')}</span>` : '')
    + `</div>`;
}

function itemHtml(item, images) {
  return `<li class="tl-item tl-item--${item.kind}" id="item-${item.id}" data-id="${item.id}">`
    + timeColumn(item.time)
    + `<span class="tl-dot" aria-hidden="true"></span>`
    + card(item, item.kind === 'sight' ? images[stripInline(item.name)] : undefined)
    + `</li>`;
}

const WEEKDAYS = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];

// Paragraphs of a "Demonstracje…" section that open with a weekday and a date ("**Sobota 24.10:** …").
// data-from/data-to let app.js mark the alert while the march is on; without a range it is just a notice.
export function dayAlerts(plan, dayKey) {
  const section = plan.sections.find((s) => /demonstracj|ryzyk|ostrzeż/i.test(s.title));
  if (!section) return [];
  const [, month, dayOfMonth] = dayKey.split('-');
  const label = `${Number(dayOfMonth)}.${Number(month)}`;
  return [...section.paragraphs, ...section.items].filter((text) => {
    const head = stripInline(text).match(/^(\p{Lu}\p{L}+)\s+(\d{1,2})\.(\d{1,2})/u);
    return head && `${Number(head[2])}.${Number(head[3])}` === label;
  });
}

function alertHtml(text) {
  const range = stripInline(text).match(/(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/);
  const span = range ? ` data-from="${range[1]}" data-to="${range[2]}"` : '';
  return `<aside class="alert"${span}><span class="alert__icon" aria-hidden="true">⚠️</span>`
    + `<div class="alert__body">${renderInline(text)}</div></aside>`;
}

function dayHtml(day, index, images, alerts = []) {
  return `<section class="day" id="day-${day.key}" aria-labelledby="day-${day.key}-title">`
    + `<div class="day__head">`
    + `<h2 class="day__title" id="day-${day.key}-title"><span class="day__num">Dzień ${index + 1}</span>${escapeHtml(capitalize(formatDayLabel(day.key)))}</h2>`
    + `<button class="day__map" type="button" data-action="map" data-day="${day.key}"><span aria-hidden="true">🗺️</span> Mapa dnia</button>`
    + `</div>`
    + alerts.map(alertHtml).join('')
    + `<ol class="timeline">${day.items.map((item) => itemHtml(item, images)).join('')}</ol>`
    + `</section>`;
}

// Licence attribution for the photos, one link per distinct image (Monti appears twice in the plan).
function photoCreditsHtml(images) {
  const unique = [...new Map(Object.values(images).map((image) => [image.src, image])).values()];
  if (!unique.length) return '';
  const items = unique
    .map((image) => `<li><a href="${escapeHtml(image.source)}" target="_blank" rel="noopener">${escapeHtml(image.alt)}</a>: ${escapeHtml(image.credit)}</li>`)
    .join('');
  return `<section class="extra"><h2 class="extra__title">Źródła zdjęć (Wikimedia Commons)</h2><ul class="extra__list">${items}</ul></section>`;
}

function heroHtml(plan) {
  const meta = plan.meta
    .map((m) => `<li><span class="hero__label">${escapeHtml(m.label)}</span>${renderInline(m.value)}</li>`)
    .join('');
  return `<header class="hero"><h1 class="hero__title">${escapeHtml(plan.title)}</h1><ul class="hero__meta">${meta}</ul></header>`;
}

function dayNavHtml(plan) {
  const days = plan.days.map((day) => `<a class="daynav__day" href="#day-${day.key}" data-day="${day.key}">`
    + `<span class="daynav__wd">${escapeHtml(formatDayLabel(day.key, { weekday: 'short' }))}</span>`
    + `<span class="daynav__date">${day.label}</span></a>`).join('');
  return `<nav class="daynav" aria-label="Dni wyjazdu"><div class="daynav__inner">${days}`
    + `<span class="offline-pill" hidden>offline</span>`
    + `<button class="daynav__now" type="button" data-action="now">Teraz</button></div></nav>`;
}

function sectionHtml(section) {
  const tag = section.ordered ? 'ol' : 'ul';
  return `<section class="extra"><h2 class="extra__title">${escapeHtml(section.title)}</h2>`
    + section.paragraphs.map((text) => `<p class="extra__text">${renderInline(text)}</p>`).join('')
    + (section.items.length ? `<${tag} class="extra__list">${section.items.map((i) => `<li>${renderInline(i)}</li>`).join('')}</${tag}>` : '')
    + `</section>`;
}

// images: { [attraction name without Markdown]: { src, alt, credit, source } } from data/images.json.
export function renderPlan(plan, images = {}) {
  return heroHtml(plan)
    + dayNavHtml(plan)
    + `<main id="main">${plan.days.map((day, i) => dayHtml(day, i, images, dayAlerts(plan, day.key))).join('')}${plan.sections.map(sectionHtml).join('')}${photoCreditsHtml(images)}</main>`;
}

export function renderNowBar(status) {
  const { phase, current, next, minutesToNext } = status;
  if (phase === 'after') return '';
  if (phase === 'before') {
    const label = minutesToNext < 24 * 60
      ? `<strong>${formatIn(minutesToNext)}</strong>`
      : (() => {
        const days = Math.ceil(minutesToNext / (24 * 60));
        return `<strong>${days} ${days === 1 ? 'dzień' : 'dni'}</strong>`;
      })();
    return `<a class="nowbar__row" href="#item-${next.id}"><span class="nowbar__label">Do wyjazdu</span>`
      + `${label}<span class="nowbar__meta">start ${next.time.start}</span></a>`;
  }
  let html = '';
  if (current) {
    html += `<a class="nowbar__row" href="#item-${current.id}"><span class="nowbar__label">Teraz</span>`
      + `<strong>${escapeHtml(stripInline(current.name))}</strong>`
      + (current.time.end ? `<span class="nowbar__meta">do ${current.time.end}</span>` : '<span></span>')
      + `</a>`;
  }
  if (next) {
    html += `<a class="nowbar__row" href="#item-${next.id}"><span class="nowbar__label">Dalej</span>`
      + `<strong>${escapeHtml(stripInline(next.name))}</strong>`
      + `<span class="nowbar__meta">${next.time.start} · ${formatIn(minutesToNext)}</span></a>`;
  }
  return html;
}
