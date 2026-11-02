import type { GameState } from './types';
import { autoSchedule, INITIAL_SLOTS } from './schedule';

const KEY = 'airline-save-v3';
const OLD_KEYS = ['airline-save-v2'];

export function loadAutosave(): GameState | null {
  try {
    for (const k of [KEY, ...OLD_KEYS]) {
      const raw = localStorage.getItem(k);
      const s = raw ? parseSave(raw) : null;
      if (s) return s;
    }
    return null;
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
    for (const k of [KEY, ...OLD_KEYS]) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Upgrade older saves to the current format */
function migrate(raw: any): GameState | null {
  if (!raw || !Array.isArray(raw.planes) || !Array.isArray(raw.routes)) return null;
  if (raw.version === 3) return raw as GameState;
  if (raw.version === 2) {
    const s: GameState = {
      ...raw,
      version: 3,
      crewBases: [raw.baseAirport],
      bufferMin: 15,
      opsLevel: 0,
      slots: { ...INITIAL_SLOTS },
      routes: raw.routes.map((r: any) => ({
        id: r.id, from: r.from, to: r.to, fareYen: r.fareYen, openedYear: r.openedYear, openedMonth: r.openedMonth,
        targetWeekly: r.weeklyFreq ?? 7, typeId: null, policy: 'pack',
      })),
      planes: raw.planes.map(({ routeId: _routeId, ...p }: any) => ({ ...p, base: raw.baseAirport, schedule: [], locked: false })),
      history: [],
    };
    return autoSchedule(s);
  }
  return null;
}

export function parseSave(text: string): GameState | null {
  try {
    return migrate(JSON.parse(text));
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

// ---- save slots ------------------------------------------------------------

export const SLOT_COUNT = 3;
const slotKey = (n: number) => `airline-slot-${n}`;

export interface SlotInfo { slot: number; label: string | null }

export function slotInfo(n: number): SlotInfo {
  try {
    const raw = localStorage.getItem(slotKey(n));
    if (!raw) return { slot: n, label: null };
    const s = parseSave(raw);
    return { slot: n, label: s ? `${s.companyName}・${s.year}年${s.month}月` : null };
  } catch {
    return { slot: n, label: null };
  }
}

export function saveToSlot(n: number, s: GameState): boolean {
  try {
    localStorage.setItem(slotKey(n), JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export function loadSlot(n: number): GameState | null {
  try {
    const raw = localStorage.getItem(slotKey(n));
    return raw ? parseSave(raw) : null;
  } catch {
    return null;
  }
}
