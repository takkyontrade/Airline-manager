import type { GameState } from './types';

const KEY = 'airline-save-v2';

export function loadAutosave(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseSave(raw) : null;
  } catch {
    return null;
  }
}

export function writeAutosave(s: GameState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage full or blocked: the game keeps running without autosave
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function parseSave(raw: string): GameState | null {
  try {
    const s = JSON.parse(raw) as GameState;
    if (s && s.version === 2 && Array.isArray(s.planes) && Array.isArray(s.routes)) return s;
    return null;
  } catch {
    return null;
  }
}

export function downloadSave(s: GameState): void {
  const blob = new Blob([JSON.stringify(s)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${s.companyName}_${s.year}年${s.month}月.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
