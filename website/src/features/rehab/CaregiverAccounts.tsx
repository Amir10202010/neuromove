// Family access: admins create caregiver accounts and link them to specific children. A caregiver
// account then sees only those children's family pages (enforced by the server). Links are revoked,
// never deleted. Needs team cloud sync (a server) — without it, the family view on this device is used.

import { KeyRound, Link2, Unlink, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { href } from '../../app/router';
import { linkCaregiver, listCaregivers, suggestPassword, type CaregiverAccount } from '../../rehab/caregivers';
import { useAppStore } from '../../state/appStore';
import { fetchTransport, useSyncStore } from '../../sync/engine';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { useXT } from './common';

const ERRORS: Record<string, string> = {
  admin_only: 'Only a team administrator can manage family accounts.',
  invalid_input: 'Check the email, the name and the selected children.',
  unknown_participant: 'A selected child has not been synchronised to the team server yet. Sync first.',
  account_is_staff: 'This email belongs to a staff account. Use a separate email for the family.',
  password_required: 'A new family account needs an initial password.',
  password_too_short: 'The password needs at least 10 characters.',
  network: 'Server not reachable.',
  unavailable: 'The team server is not configured.',
};

export function CaregiverAccounts({ participantId }: { participantId?: string }) {
  const { xt } = useXT();
  const account = useSyncStore((s) => s.account);
  const enabled = useSyncStore((s) => s.config.enabled);
  const patients = useAppStore((s) => s.patients).filter((p) => p.workspace === 'clinic');
  const ws = useAppStore((s) => s.settings.workspace);
  const toast = useAppStore((s) => s.toast);
  const [accounts, setAccounts] = useState<CaregiverAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<null | { email: string; displayName: string; password: string; ids: string[] }>(null);
  const [shownPassword, setShownPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = enabled && account?.role === 'admin' && ws === 'clinic';

  const apply = useCallback((r: Awaited<ReturnType<typeof listCaregivers>>) => {
    if (r.ok) {
      setAccounts(r.accounts);
      setError(null);
    } else setError(r.error);
  }, []);
  const load = useCallback(() => listCaregivers(fetchTransport).then(apply), [apply]);
  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    void listCaregivers(fetchTransport).then((r) => live && apply(r));
    return () => {
      live = false;
    };
  }, [isAdmin, apply]);

  const code = (id: string) => patients.find((p) => p.id === id)?.code ?? id;
  const shown = participantId ? (accounts ?? []).filter((a) => a.active.includes(participantId) || a.revoked.includes(participantId)) : (accounts ?? []);

  const submit = async () => {
    if (!form) return;
    setBusy(true);
    const existing = accounts?.some((a) => a.email.toLowerCase() === form.email.trim().toLowerCase());
    const r = await linkCaregiver(fetchTransport, { email: form.email.trim(), displayName: form.displayName.trim(), participantIds: form.ids, ...(existing ? {} : { password: form.password }) });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    if (!existing) setShownPassword(form.password);
    setForm(null);
    toast('good', xt('Family access updated'));
    await load();
  };
  const revoke = async (a: CaregiverAccount, ids: string[]) => {
    const r = await linkCaregiver(fetchTransport, { email: a.email, displayName: a.displayName, participantIds: ids, revoke: true });
    if (!r.ok) return setError(r.error);
    toast('good', xt('Access revoked'));
    await load();
  };

  return (
    <section className="card" id="caregivers">
      <div className="card__header">
        <h2 className="card__title">
          <KeyRound size={18} aria-hidden /> {xt('Family access')}
        </h2>
        {isAdmin && (
          <Button size="sm" icon={<UserPlus />} onClick={() => setForm({ email: '', displayName: '', password: suggestPassword(), ids: participantId ? [participantId] : [] })}>
            {xt('Give a family access')}
          </Button>
        )}
      </div>
      <div className="card__body stack">
        {!isAdmin ? (
          <p className="muted small">
            {ws !== 'clinic'
              ? xt('Family accounts exist only in the clinic workspace with team sync. In the demo, use the family view on this device.')
              : xt('A team administrator with cloud sync enabled can create family accounts that see only their own child.')}{' '}
            {participantId && <a href={href({ name: 'familyHome', id: participantId })}>{xt('Family view on this device')}</a>}
          </p>
        ) : (
          <>
            <p className="muted small">{xt('A family account sees only the children linked here: their activities, goals, approved summaries and their own reports. Links are revoked, never deleted; the audit log records every change.')}</p>
            {error && (
              <div className="callout callout--warn" role="alert">
                {ERRORS[error] ? xt(ERRORS[error]) : error}
              </div>
            )}
            {shownPassword && (
              <div className="callout callout--info" role="status">
                <div>
                  {xt('Initial password (shown once — give it to the family in person):')} <code className="rh-secret">{shownPassword}</code>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setShownPassword(null)}>
                  {xt('Done')}
                </Button>
              </div>
            )}
            {accounts === null && !error ? (
              <p className="muted">{xt('Loading…')}</p>
            ) : shown.length === 0 ? (
              <p className="muted">{xt('No family accounts yet.')}</p>
            ) : (
              <ul className="rh-plain-list">
                {shown.map((a) => (
                  <li key={a.userId} className="rh-access">
                    <div>
                      <strong>{a.displayName}</strong> <span className="muted small">{a.email}</span>
                    </div>
                    <div className="row row--wrap">
                      {a.active.map((id) => (
                        <span key={id} className="badge badge--good">
                          <Link2 aria-hidden className="rh-inline-icon" /> {code(id)}
                          <button type="button" className="rh-access__revoke" aria-label={xt('Revoke access to {c}', { c: code(id) })} onClick={() => void revoke(a, [id])}>
                            <Unlink aria-hidden className="rh-inline-icon" />
                          </button>
                        </span>
                      ))}
                      {a.revoked.filter((id) => !a.active.includes(id)).map((id) => (
                        <span key={id} className="badge badge--outline" title={xt('revoked')}>
                          {code(id)} · {xt('revoked')}
                        </span>
                      ))}
                      {participantId && !a.active.includes(participantId) && (
                        <Button size="sm" onClick={() => void linkCaregiver(fetchTransport, { email: a.email, displayName: a.displayName, participantIds: [participantId] }).then(load)}>
                          {xt('Link again')}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {form && (
          <form
            className="stack rh-access-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="grid grid--2">
              <Field label={xt('Family member email')}>
                <input className="input" type="email" autoComplete="off" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label={xt('Name shown in the app')} hint={xt('For example “Mother of P07”. No surnames needed.')}>
                <input className="input" required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
              </Field>
            </div>
            {!accounts?.some((a) => a.email.toLowerCase() === form.email.trim().toLowerCase()) && (
              <Field label={xt('Initial password')} hint={xt('At least 10 characters. Shown once after saving; the family can keep it or you can set another later.')}>
                <input className="input" autoComplete="new-password" minLength={10} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </Field>
            )}
            <fieldset className="chips">
              <legend className="field__label">{xt('Children this account may see')}</legend>
              {patients.map((p) => (
                <label key={p.id} className={`chip rh-chip${form.ids.includes(p.id) ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={form.ids.includes(p.id)} onChange={(e) => setForm({ ...form, ids: e.target.checked ? [...form.ids, p.id] : form.ids.filter((x) => x !== p.id) })} />
                  {p.code}
                </label>
              ))}
            </fieldset>
            <div className="row row--wrap">
              <Button onClick={() => setForm(null)}>{xt('Cancel')}</Button>
              <Button type="submit" variant="primary" loading={busy} disabled={!form.email.trim() || !form.displayName.trim() || !form.ids.length}>
                {xt('Save family access')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
