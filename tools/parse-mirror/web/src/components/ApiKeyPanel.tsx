import { useEffect, useRef, useState } from 'react';

import { getQuota, type Quota } from '../api.ts';
import { OPEN_KEY_FORM, getApiKey, isApiKeyRemembered, setApiKey } from '../apiKey.ts';
import { game } from '../game.ts';

const KEY_FORMAT = /^[A-Za-z0-9]{32}$/;
const profileUrl = () => `https://${game.wclHost}/profile`;

/** Top-bar button: Warcraft Logs usage, and an optional personal API key. */
export function ApiKeyPanel() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(getApiKey() ?? '');
  const [remember, setRemember] = useState(isApiKeyRemembered());
  const [saved, setSaved] = useState(!!getApiKey());
  const [quota, setQuota] = useState<Quota>();
  const [error, setError] = useState<string>();
  const panel = useRef<HTMLDivElement>(null);

  const refresh = () =>
    getQuota()
      .then((q) => {
        setQuota(q);
        setError(undefined);
      })
      .catch((err: Error) => setError(err.message));

  useEffect(() => {
    if (!open) return;
    void refresh();
    const close = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_KEY_FORM, show);
    return () => window.removeEventListener(OPEN_KEY_FORM, show);
  }, []);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (!KEY_FORMAT.test(trimmed)) {
      setError('A v1 client key is 32 letters and digits.');
      return;
    }
    setApiKey(trimmed, remember);
    setSaved(true);
    void refresh();
  };

  const clear = () => {
    setApiKey(undefined, false);
    setKey('');
    setSaved(false);
    void refresh();
  };

  const low = quota?.windowLimit && quota.windowRemaining !== undefined && quota.windowRemaining < quota.windowLimit * 0.2;

  return (
    <div className="key-wrap" ref={panel}>
      <button className={`ghost key-btn ${saved ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Warcraft Logs API key and usage">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="7.5" cy="15.5" r="4.5" />
          <path d="M10.7 12.3 21 2M16 7l3 3M18.5 4.5l2 2" />
        </svg>
        <span className="key-label">{saved ? 'Your key' : 'API key'}</span>
      </button>
      {open && (
        <div className="picker popover key-panel">
          <div className="picker-head">
            <div className="eyebrow">Warcraft Logs API</div>
            <button className="ghost small" onClick={() => setOpen(false)} aria-label="Close">
              ✕
            </button>
          </div>
          <div className="quota-line">
            <span className={`pill ${low ? 'warn' : ''}`}>
              {quota?.windowLimit !== undefined && quota.windowRemaining !== undefined
                ? `${quota.windowRemaining} / ${quota.windowLimit} requests left this minute`
                : 'No requests sent yet'}
            </span>
            <span className="pill">{quota ? `${quota.requestsLastHour} requests in the last hour` : '…'}</span>
          </div>
          <p className="muted small">
            {saved ? 'Using your own key.' : 'Using the guild’s shared key.'} Warcraft Logs allows each key about 3,600 points an hour. If the tool slows down or you want to look
            through a lot of logs, use your own v1 client key from your{' '}
            <a href={profileUrl()} target="_blank" rel="noreferrer">
              Warcraft Logs profile
            </a>
            .
          </p>
          <form className="key-form" onSubmit={save}>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="V1 client key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label="Warcraft Logs v1 client key"
            />
            <button type="submit" className="primary" disabled={!key.trim()}>
              Use key
            </button>
          </form>
          <label className="check">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => {
                setRemember(e.target.checked);
                // Move a key that's already in use to the chosen storage.
                if (saved) setApiKey(getApiKey(), e.target.checked);
              }}
            />
            Remember on this device
          </label>
          {saved && (
            <button className="ghost small" onClick={clear}>
              Forget my key and use the shared one
            </button>
          )}
          {error && <div className="banner error">{error}</div>}
          <p className="muted small">
            The key stays in your browser{remember ? '' : ' (this tab only)'}. It’s sent with each request and the server uses it for that request only; it isn’t stored or logged.
          </p>
        </div>
      )}
    </div>
  );
}
