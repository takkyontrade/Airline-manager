import type { GameState } from './types';
import { parseSave } from './save';

/**
 * Cloud saves in the player's own GitHub account, as secret Gists.
 * One Gist per airline; its description carries the company name so the
 * list shows which save is which. Needs a personal access token with the
 * "gist" permission, kept only in this browser.
 */
const TOKEN_KEY = 'airline-github-token';
const PREFIX = '航空会社運営ゲーム: ';
const FILE = 'airline-save.json';
const API = 'https://api.github.com';

export function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}
export function setToken(t: string): void {
  try { if (t) localStorage.setItem(TOKEN_KEY, t.trim()); else localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

export interface CloudSave { id: string; company: string; label: string; updatedAt: string }

async function gh(token: string, path: string, init: RequestInit = {}): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await fetch(API + path, {
    ...init,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (res.status === 401) throw new Error('トークンが正しくないか、期限が切れています');
  if (res.status === 403 || res.status === 404) throw new Error('トークンに「Gist」の権限がありません');
  if (!res.ok) throw new Error(`GitHubとの通信に失敗しました（${res.status}）`);
  return res.json();
}

/** Who the token belongs to (also checks the token works) */
export async function cloudUser(token: string): Promise<string> {
  return (await gh(token, '/user')).login;
}

export async function cloudList(token: string): Promise<CloudSave[]> {
  const out: CloudSave[] = [];
  for (let page = 1; page <= 5; page++) {
    const gists = await gh(token, `/gists?per_page=100&page=${page}`);
    for (const g of gists) {
      if (!g.files?.[FILE] || !String(g.description ?? '').startsWith(PREFIX)) continue;
      const rest = g.description.slice(PREFIX.length);
      const [company, ...when] = rest.split('｜');
      out.push({ id: g.id, company, label: when.join('｜'), updatedAt: g.updated_at });
    }
    if (gists.length < 100) break;
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Save to the Gist for this company name, creating it the first time */
export async function cloudSave(token: string, s: GameState): Promise<CloudSave> {
  const existing = (await cloudList(token)).find((c) => c.company === s.companyName);
  const label = `${s.year}年${s.month}月・資金${Math.round(s.cash / 1e8)}億円`;
  const body = JSON.stringify({
    description: `${PREFIX}${s.companyName}｜${label}`,
    files: { [FILE]: { content: JSON.stringify(s) } },
    ...(existing ? {} : { public: false }),
  });
  const g = existing
    ? await gh(token, `/gists/${existing.id}`, { method: 'PATCH', body })
    : await gh(token, '/gists', { method: 'POST', body });
  return { id: g.id, company: s.companyName, label, updatedAt: g.updated_at };
}

export async function cloudLoad(token: string, id: string): Promise<GameState> {
  const g = await gh(token, `/gists/${id}`);
  const f = g.files?.[FILE];
  if (!f) throw new Error('セーブデータが見つかりません');
  // big files come back truncated: fetch the raw text instead
  const text: string = f.truncated ? await (await fetch(f.raw_url)).text() : f.content;
  const s = parseSave(text);
  if (!s) throw new Error('セーブデータを読み込めませんでした');
  return s;
}

export async function cloudDelete(token: string, id: string): Promise<void> {
  const res = await fetch(`${API}/gists/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok && res.status !== 404) throw new Error(`削除に失敗しました（${res.status}）`);
}
