import { useEffect, useState } from 'react';
import { cloudDelete, cloudList, cloudLoad, cloudSave, cloudUser, getToken, setToken, type CloudSave } from '../engine/cloud';
import type { GameState } from '../engine/types';

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new?name=airline-manager-save&description=%E8%88%AA%E7%A9%BA%E4%BC%9A%E7%A4%BE%E9%81%8B%E5%96%B6%E3%82%B2%E3%83%BC%E3%83%A0%E3%81%AE%E3%82%BB%E3%83%BC%E3%83%96&gists=write';

/** Save to / load from the player's GitHub account (secret Gists, one per airline) */
export function CloudPanel({ state, onLoad, onClose, flash }: { state: GameState | null; onLoad: (s: GameState) => void; onClose: () => void; flash: (m: string) => void }) {
  const [token, setTok] = useState(getToken());
  const [draft, setDraft] = useState('');
  const [user, setUser] = useState<string | null>(null);
  const [saves, setSaves] = useState<CloudSave[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (f: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await f(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const refresh = (t = token) => run(async () => { setUser(await cloudUser(t)); setSaves(await cloudList(t)); });
  useEffect(() => { if (token) refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><strong>GitHubに保存</strong><button className="small secondary" onClick={onClose}>閉じる</button></div>
        {!token ? (
          <>
            <p className="small-text">自分のGitHubアカウントの「Gist」（非公開）に、航空会社ごとにセーブできます。別のパソコンやブラウザからも続きを遊べます。</p>
            <ol className="small-text">
              <li><a href={TOKEN_URL} target="_blank" rel="noreferrer">GitHubのトークン作成ページ</a>を開く（Gistの書き込み権限が選ばれた状態で開きます）</li>
              <li>有効期限を選んで「Generate token」を押す</li>
              <li>表示された <code>github_pat_…</code> をここに貼り付ける</li>
            </ol>
            <div className="row">
              <input type="password" placeholder="github_pat_..." value={draft} onChange={(e) => setDraft(e.target.value)} style={{ flex: 1 }} />
              <button disabled={!draft || busy} onClick={() => run(async () => {
                const t = draft.trim();
                setUser(await cloudUser(t));
                setToken(t); setTok(t); setDraft('');
                setSaves(await cloudList(t));
              })}>接続</button>
            </div>
            <p className="muted small-text">トークンはこのブラウザの中にだけ保存され、GitHub以外には送られません。</p>
          </>
        ) : (
          <>
            <div className="row small-text">
              <span>{user ? `${user} さんのGitHubに接続中` : '接続を確認しています…'}</span>
              <span className="spacer" />
              <button className="small secondary" onClick={() => { setToken(''); setTok(''); setUser(null); setSaves(null); }}>接続を解除</button>
            </div>
            {state && (
              <button disabled={busy} onClick={() => run(async () => {
                await cloudSave(token, state);
                setSaves(await cloudList(token));
                flash(`「${state.companyName}」をGitHubに保存しました`);
              })}>「{state.companyName}」を保存（同じ会社名のセーブは上書き）</button>
            )}
            <h4>保存してある会社</h4>
            {saves === null ? <p className="muted small-text">読み込み中…</p> : saves.length === 0 ? <p className="muted small-text">まだありません。</p> : (
              <div className="list">
                {saves.map((c) => (
                  <div key={c.id} className="slot-row">
                    <span className="small-text"><strong>{c.company}</strong>　{c.label}<span className="muted">（{new Date(c.updatedAt).toLocaleString('ja-JP')} 保存）</span></span>
                    <button className="small" disabled={busy} onClick={() => run(async () => {
                      if (!confirm(`「${c.company}」を読み込みますか？ 今のゲームは自動保存から消えます。`)) return;
                      onLoad(await cloudLoad(token, c.id));
                      onClose();
                    })}>読込</button>
                    <button className="small danger" disabled={busy} onClick={() => run(async () => {
                      if (!confirm(`GitHub上の「${c.company}」のセーブを削除しますか？`)) return;
                      await cloudDelete(token, c.id);
                      setSaves(await cloudList(token));
                    })}>削除</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {busy && <p className="muted small-text">通信中…</p>}
        {err && <p className="neg small-text">{err}</p>}
      </div>
    </div>
  );
}
