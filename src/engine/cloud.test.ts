import { describe, expect, test, vi } from 'vitest';
import { cloudList, cloudLoad, cloudSave } from './cloud';
import { newGame } from './sim';

/** A tiny in-memory stand-in for the GitHub Gist API */
function fakeGitHub() {
  const gists = new Map<string, { id: string; description: string; files: Record<string, { content: string }>; updated_at: string }>();
  let n = 0;
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://api.github.com', '');
    const json = (b: unknown, status = 200) => ({ ok: status < 300, status, json: async () => b, text: async () => JSON.stringify(b) });
    const body = init.body ? JSON.parse(init.body as string) : null;
    if (path.startsWith('/gists?')) return json([...gists.values()]);
    if (path === '/gists' && init.method === 'POST') {
      const g = { id: 'g' + ++n, description: body.description, files: body.files, updated_at: `2026-01-0${n}T00:00:00Z` };
      gists.set(g.id, g);
      return json(g, 201);
    }
    const id = path.split('/')[2];
    const g = gists.get(id);
    if (!g) return json({}, 404);
    if (init.method === 'PATCH') { g.description = body.description; g.files = body.files; g.updated_at = '2026-02-01T00:00:00Z'; }
    return json(g);
  });
}

describe('cloud saves', () => {
  test('one gist per company: save, overwrite, list, load', async () => {
    vi.stubGlobal('fetch', fakeGitHub());
    const a = newGame('青空航空', 'HND', 1);
    const b = newGame('北風エア', 'CTS', 2);
    await cloudSave('t', a);
    await cloudSave('t', b);
    await cloudSave('t', { ...a, month: 5 });
    const list = await cloudList('t');
    expect(list.map((c) => c.company).sort()).toEqual(['北風エア', '青空航空']);
    const loaded = await cloudLoad('t', list.find((c) => c.company === '青空航空')!.id);
    expect(loaded.month).toBe(5);
    vi.unstubAllGlobals();
  });
});
