// services/internal/holidaysService.js
// Envoltorio ligero alrededor de `date-holidays` con cache en memoria.
import Holidays from 'date-holidays';

const DEFAULT_COUNTRY = process.env.DEFAULT_HOLIDAYS_COUNTRY || 'AR';
const SUPPORTED_TYPES = new Set(['public', 'bank', 'school']);

// Cache simple: key = `${country}:${year}`
const cache = new Map();

/**
 * Devuelve los feriados (tipo `public`) de un país y año, como array de
 * { date: 'YYYY-MM-DD', name: string, type: string }.
 * @param {string} country ISO 3166-1 alpha-2 (AR, UY, ES, US, CO, MX, CL, ...).
 * @param {number} year
 */
export function getHolidays(country = DEFAULT_COUNTRY, year = new Date().getFullYear()) {
  const c = String(country || DEFAULT_COUNTRY).toUpperCase();
  const y = Number(year) || new Date().getFullYear();
  const key = `${c}:${y}`;
  if (cache.has(key)) return cache.get(key);

  let out = [];
  try {
    const hd = new Holidays(c);
    const list = hd.getHolidays(y) || [];
    out = list
      .filter(h => SUPPORTED_TYPES.has(h.type))
      .map(h => {
        const d = new Date(h.date);
        return {
          date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
          name: h.name,
          type: h.type
        };
      });
  } catch (err) {
    console.warn(`[holidaysService] Failed for ${c}:${y}`, err?.message);
    out = [];
  }
  cache.set(key, out);
  return out;
}

/**
 * Mapa YYYY-MM-DD -> holiday (solo del año/país dado). Útil para joins rápidos.
 */
export function getHolidaysMap(country, year) {
  const list = getHolidays(country, year);
  const map = new Map();
  for (const h of list) map.set(h.date, h);
  return map;
}

/**
 * Devuelve los feriados comprendidos entre dos fechas (inclusive).
 */
export function getHolidaysInRange(country, from, to) {
  const start = new Date(from);
  const end = new Date(to);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return [];
  const out = [];
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
    for (const h of getHolidays(country, y)) {
      const d = new Date(h.date);
      if (d >= start && d <= end) out.push(h);
    }
  }
  return out;
}

export const DEFAULT_HOLIDAYS_COUNTRY = DEFAULT_COUNTRY;
export default { getHolidays, getHolidaysMap, getHolidaysInRange };
