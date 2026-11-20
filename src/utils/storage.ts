import type { Scenario } from '@/types';

export interface SavedScenario { id: string; name: string; createdAt: number; scenario: Scenario }
const KEY = 'domino-sky:scenarios:v1';

export function loadSaved(): SavedScenario[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedScenario[];
    return Array.isArray(parsed) ? parsed.filter((s) => s && typeof s.id === 'string' && s.scenario && Array.isArray(s.scenario.closures)) : [];
  } catch { return []; }
}
export function persistSaved(list: SavedScenario[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}
