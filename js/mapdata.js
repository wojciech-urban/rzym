// Prepares one day of data/routes.json for drawing: numbered stops, waypoints and labelled legs. Pure — no DOM.
import { stripInline } from './inline.js';

// Colours and dashes live in CSS (.map-leg--<mode>) so they follow the light/dark palette.
export const MODES = {
  walk: { label: 'pieszo' },
  metro: { label: 'metro' },
  taxi: { label: 'taxi / bus' },
  flight: { label: 'samolot' },
};

export function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(meters / 10) * 10} m`;
}

function legLabel(leg, item) {
  const head = `${item.time.start} · ${stripInline(item.name)}`;
  if (!leg.distance) return `${head} · ${stripInline(item.transport) || MODES[leg.mode].label}`;
  return `${head} · ${MODES[leg.mode].label} ${formatDistance(leg.distance)}, ~${leg.minutes} min`;
}

export function dayMapData(routes, plan, dayKey) {
  const items = new Map(plan.days.find((d) => d.key === dayKey).items.map((i) => [i.id, i]));
  const { stops, legs } = routes.days[dayKey];
  const point = (key) => ({ key, ...routes.points[key] });
  const baseKey = Object.keys(routes.points).find((k) => routes.points[k].kind === 'base');

  const stopKeys = new Set(stops.map((s) => s.point));
  const waypointKeys = new Set(legs.flatMap((l) => [l.from, l.to]).filter((k) => !stopKeys.has(k) && k !== baseKey));
  const drawnLegs = legs.map((leg) => ({ mode: leg.mode, path: leg.path, itemId: leg.item, label: legLabel(leg, items.get(leg.item)) }));

  // The airport is 30 km out: on the arrival and departure days it would zoom the city off the map,
  // so it keeps its pin but stays out of the initial view when there is anything else to show.
  const inCity = (key) => routes.points[key].kind !== 'airport';
  const cityLegs = legs.filter((leg) => inCity(leg.from) && inCity(leg.to));
  const all = (cityLegs.length ? cityLegs : legs).flatMap((l) => l.path);
  const lats = all.map(([lat]) => lat);
  const lons = all.map(([, lon]) => lon);

  return {
    base: point(baseKey),
    stops: stops.map((s, i) => ({ ...point(s.point), number: i + 1, itemId: s.item, time: items.get(s.item).time.start })),
    waypoints: [...waypointKeys].map(point),
    legs: drawnLegs,
    bounds: [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]],
  };
}
