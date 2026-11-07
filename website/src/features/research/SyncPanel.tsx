// Settings → Team cloud sync. Off by default: nothing leaves the browser until a team member signs in
// and enables sync on this device. Demo data never syncs.

import { Cloud, Download, LogOut, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { downloadText, exportName, stamp } from '../../data/export';
import { useI18n } from '../../i18n';
import { useAppStore } from '../../state/appStore';
import { useSyncStore } from '../../sync/engine';
import { Button } from '../../ui/Button';
import { useRT } from './i18n';
import { SaveStatus } from './SaveStatus';

export function SyncPanel() {
  const rt = useRT();
  const { f } = useI18n();
  const s = useSyncStore();
  const rejectedLocal = useAppStore((x) => x.storageRejected);
  const exportQuarantine = useAppStore((x) => x.exportQuarantine);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'bootstrap'>('login');
  const [team, setTeam] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const err = mode === 'login' ? await s.login(email.trim(), password) : await s.bootstrap({ setupCode: code.trim(), teamName: team.trim(), email: email.trim(), password, displayName: name.trim() });
    setBusy(false);
    if (err) setError(err === 'network' ? rt('Server not reachable.') : err === 'invalid_credentials' ? rt('Wrong email or password.') : err);
    else setPassword('');
  };

  return (
    <section className="card" id="sync">
      <div className="card__header">
        <h2 className="card__title">
          <Cloud size={18} aria-hidden /> {rt('Team cloud sync')}
        </h2>
        <SaveStatus compact />
      </div>
      <div className="card__body stack">
        <p className="secondary">
          {rt('Every change is saved on this device first. With sync enabled, clinic records are uploaded to the team PostgreSQL database and marked synced only after the server confirms. Demo data never leaves the browser.')}
        </p>
        {!s.account ? (
          <form
            className="vform"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {mode === 'bootstrap' && (
              <>
                <label className="field">
                  <span className="field__label">{rt('Setup code (from the server administrator)')}</span>
                  <input className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
                </label>
                <label className="field">
                  <span className="field__label">{rt('Team name')}</span>
                  <input className="input" value={team} onChange={(e) => setTeam(e.target.value)} />
                </label>
                <label className="field">
                  <span className="field__label">{rt('Your name')}</span>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
                </label>
              </>
            )}
            <label className="field">
              <span className="field__label">Email</span>
              <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">{rt('Password')}</span>
              <input className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {error && <div className="callout callout--critical vform__wide">{error}</div>}
            <div className="row row--wrap vform__wide">
              <Button type="submit" variant="primary" loading={busy} disabled={!email || !password}>
                {mode === 'login' ? rt('Sign in') : rt('Create team and admin account')}
              </Button>
              <Button variant="ghost" onClick={() => setMode(mode === 'login' ? 'bootstrap' : 'login')}>
                {mode === 'login' ? rt('First setup of a new team…') : rt('Back to sign in')}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div className="row row--between row--wrap">
              <span>
                {s.account.displayName} · {s.account.email} · <strong>{s.account.teamName}</strong> · {s.account.role}
              </span>
              <Button size="sm" variant="ghost" icon={<LogOut />} onClick={() => void s.logout()}>
                {rt('Sign out')}
              </Button>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={s.config.enabled} onChange={(e) => void s.setEnabled(e.target.checked)} />
              {rt('Sync clinic data of this device with the team database')}
            </label>
          </>
        )}
        <dl className="vdl">
          <dt>{rt('Waiting to upload')}</dt>
          <dd className="num">{s.pending}</dd>
          <dt>{rt('Last successful sync')}</dt>
          <dd>{s.lastSyncAt ? f.dateTime(s.lastSyncAt) : '—'}</dd>
          <dt>{rt('Device id')}</dt>
          <dd className="small">{s.config.deviceId}</dd>
          {s.lastError && (
            <>
              <dt>{rt('Last error')}</dt>
              <dd className="small">{s.lastError}</dd>
            </>
          )}
        </dl>
        <div className="row row--wrap">
          <Button icon={<RefreshCw />} disabled={!s.config.enabled} onClick={() => void s.syncNow()}>
            {rt('Sync now')}
          </Button>
        </div>
        {s.conflicts.length > 0 && (
          <div className="callout callout--warn">
            <div style={{ flex: 1 }}>
              <div className="callout__title">{rt('Conflicts — the record changed on the server since this device last saw it')}</div>
              {s.conflicts.map((op) => (
                <div key={op.opId} className="row row--between row--wrap">
                  <span className="small">
                    {op.entity} {op.entityId} · {rt('server revision')} {op.server?.rev}
                  </span>
                  <span className="row">
                    <Button size="sm" onClick={() => void s.resolveConflict(op.opId, 'server')}>
                      {rt('Use server version')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void s.resolveConflict(op.opId, 'mine')}>
                      {rt('Keep mine (overwrite)')}
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {s.rejected.length > 0 && (
          <div className="callout callout--critical">
            <div style={{ flex: 1 }}>
              <div className="callout__title">{rt('Rejected by the server (kept on this device)')}</div>
              {s.rejected.map((op) => (
                <div key={op.opId} className="row row--between row--wrap">
                  <span className="small">
                    {op.entity} {op.entityId}: {op.lastError}
                  </span>
                  <Button size="sm" onClick={() => void s.retryRejected(op.opId)}>
                    {rt('Retry')}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
        {rejectedLocal > 0 && (
          <div className="callout callout--warn">
            <div style={{ flex: 1 }}>
              <div className="callout__title">{rt('{n} stored records could not be read', { n: rejectedLocal })}</div>
              <div className="small">{rt('They are hidden but never deleted (also not by import or clearing). Download them for analysis.')}</div>
            </div>
            <Button size="sm" icon={<Download />} onClick={() => downloadText(exportName(false, ['quarantine', stamp()], 'json'), exportQuarantine(), 'application/json')}>
              {rt('Download')}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
