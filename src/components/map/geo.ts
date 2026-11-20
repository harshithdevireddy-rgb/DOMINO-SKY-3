/** Equirectangular projection tuned for the Indian subcontinent. Airport positions are the dataset's lat/lng. */
export const MAP_W = 820; export const MAP_H = 780;
const LNG0 = 66.5; const LAT0 = 36.5; const KY = 24.5; const KX = KY * Math.cos((20 * Math.PI) / 180);
export const project = (lat: number, lng: number): [number, number] => [34 + (lng - LNG0) * KX, 24 + (LAT0 - lat) * KY];

/** Schematic outline (decorative only; not used for any calculation). [lng, lat] */
const OUTLINE: [number, number][] = [
  [68.2, 23.6], [69.0, 22.3], [70.3, 20.8], [72.6, 21.0], [72.8, 19.0], [73.4, 17.0], [73.8, 15.4], [74.5, 13.5], [74.9, 12.6], [75.6, 11.2],
  [76.3, 9.9], [77.0, 8.3], [77.6, 8.1], [78.2, 8.8], [79.3, 9.3], [79.9, 10.5], [80.2, 13.1], [80.1, 14.8], [81.2, 15.9], [82.3, 16.9],
  [83.3, 17.8], [84.8, 19.2], [86.6, 20.3], [87.0, 21.5], [88.4, 21.8], [89.0, 22.3], [88.7, 24.0], [89.0, 26.0], [90.0, 26.2], [91.7, 25.2],
  [92.4, 24.1], [93.0, 22.5], [93.3, 24.2], [94.6, 25.6], [95.2, 27.1], [97.3, 28.2], [96.0, 29.3], [94.0, 28.2], [92.0, 27.8], [89.8, 28.2],
  [88.3, 27.3], [86.0, 27.6], [84.0, 27.4], [81.9, 28.4], [80.1, 29.5], [79.0, 31.0], [78.7, 32.5], [79.4, 34.0], [77.8, 35.4], [75.8, 35.6],
  [74.4, 34.6], [74.6, 32.9], [74.5, 31.5], [74.0, 30.3], [72.5, 29.3], [71.0, 27.8], [70.0, 26.4], [69.5, 24.8],
];
export const OUTLINE_PATH = OUTLINE.map(([lng, lat], i) => { const [x, y] = project(lat, lng); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ') + ' Z';

/** Quadratic bezier control point offset perpendicular to the chord (same for both directions of a pair). */
export function curve(a: [number, number], b: [number, number], bend = 0.14) {
  const mx = (a[0] + b[0]) / 2; const my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const c: [number, number] = [mx - dy * bend, my + dx * bend];
  return { c, d: `M${a[0].toFixed(1)},${a[1].toFixed(1)} Q${c[0].toFixed(1)},${c[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}` };
}
export function pointOn(a: [number, number], c: [number, number], b: [number, number], t: number): [number, number] {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
}
