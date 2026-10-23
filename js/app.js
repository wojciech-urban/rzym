// Bootstraps the app: loads the Markdown plan, renders it and keeps the "now" state fresh.
import { parsePlan } from './parse.js';
import { renderPlan, renderNowBar } from './render.js';
import { nowInRome, parseNowOverride, findStatus, toMinutes } from './time.js';
import { openDayMap } from './map.js';

const PLAN_URL = 'rzym_plan_24-27_pazdziernika_2026.md';
const IMAGES_URL = 'data/images.json';
const DONE_KEY = 'rome-planner:done';

const app = document.getElementById('app');
const nowbar = document.getElementById('nowbar');
const override = parseNowOverride(new URLSearchParams(location.search).get('now'));

function loadDone() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

function saveDone(done) {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
  } catch {
    // Storage unavailable (private mode) — progress just won't persist.
  }
}

function applyDone(done) {
  for (const input of app.querySelectorAll('input[data-done]')) {
    input.checked = done.has(input.dataset.done);
    input.closest('.tl-item').classList.toggle('is-done', input.checked);
  }
}

function applyStatus(plan) {
  const status = findStatus(plan.days, override ?? nowInRome());
  for (const el of app.querySelectorAll('.tl-item')) {
    const { id } = el.dataset;
    el.classList.toggle('is-past', status.pastIds.has(id));
    el.classList.toggle('is-current', status.current?.id === id);
    el.classList.toggle('is-next', status.next?.id === id);
  }
  // An alert marks itself while its march is on (its day is today and the clock is inside its range).
  for (const el of app.querySelectorAll('.alert[data-from]')) {
    const today = el.closest('.day').id === `day-${status.now.dateKey}`;
    const minutes = status.now.minutes;
    el.classList.toggle('is-live', today && minutes >= toMinutes(el.dataset.from) && minutes < toMinutes(el.dataset.to));
  }
  for (const el of app.querySelectorAll('.daynav__day')) {
    el.classList.toggle('is-today', el.dataset.day === status.now.dateKey);
  }
  const html = renderNowBar(status);
  nowbar.innerHTML = html;
  nowbar.hidden = !html;
  document.body.classList.toggle('has-nowbar', Boolean(html));
  return status;
}

function scrollToStatus(status) {
  const target = status.current ?? status.next;
  if (target) {
    document.getElementById(`item-${target.id}`)?.scrollIntoView({ block: 'start' });
    return;
  }
  const items = app.querySelectorAll('.tl-item');
  items[items.length - 1]?.scrollIntoView({ block: 'start' });
}

// Photos are optional: without data/images.json the plan still renders, just without pictures.
async function loadImages() {
  try {
    const res = await fetch(IMAGES_URL);
    return res.ok ? await res.json() : {};
  } catch {
    return {};
  }
}

function updateOnline() {
  for (const el of app.querySelectorAll('.offline-pill')) el.hidden = navigator.onLine;
}

async function start() {
  let text;
  try {
    const res = await fetch(PLAN_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    app.innerHTML = '<p class="error"></p>';
    app.firstChild.textContent = `Nie udało się wczytać planu (${err.message}). Otwórzcie aplikację raz z dostępem do internetu.`;
    return;
  }

  let plan;
  try {
    plan = parsePlan(text);
  } catch (err) {
    app.innerHTML = '<p class="error"></p>';
    app.firstChild.textContent = `Plan ma niepoprawny format (${err.message}).`;
    return;
  }

  app.innerHTML = renderPlan(plan, await loadImages());
  const done = loadDone();
  applyDone(done);
  const status = applyStatus(plan);
  // The hash is handled by the browser before this content exists, so honour it ourselves.
  const target = location.hash && document.getElementById(location.hash.slice(1));
  if (target) target.scrollIntoView({ block: 'start' });
  else if (status.phase === 'during') scrollToStatus(status);
  updateOnline();

  app.addEventListener('change', (event) => {
    const input = event.target.closest('input[data-done]');
    if (!input) return;
    if (input.checked) done.add(input.dataset.done);
    else done.delete(input.dataset.done);
    saveDone(done);
    applyDone(done);
  });
  app.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="now"]')) scrollToStatus(applyStatus(plan));
    const mapButton = event.target.closest('[data-action="map"]');
    if (mapButton) openDayMap(plan, mapButton.dataset.day);
  });
  setInterval(() => applyStatus(plan), 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') applyStatus(plan);
  });
  addEventListener('online', updateOnline);
  addEventListener('offline', updateOnline);
}

start();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // No SW (e.g. plain http on a LAN IP) — the app still works online.
  });
}
