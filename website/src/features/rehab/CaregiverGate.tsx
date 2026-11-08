// A caregiver account sees only the family workspace of the children it is linked to — never the
// professional screens (the server would not send their data anyway; this keeps the UI honest).

import type { ReactNode } from 'react';
import { href } from '../../app/router';
import { useSyncStore } from '../../sync/engine';
import { useAppStore } from '../../state/appStore';
import { useIsCaregiverAccount, useXT } from './common';

export function CaregiverGate({ children }: { children: ReactNode }) {
  const caregiver = useIsCaregiverAccount();
  const account = useSyncStore((s) => s.account);
  const patients = useAppStore((s) => s.patients);
  const { xt } = useXT();
  if (!caregiver) return <>{children}</>;
  const mine = patients.filter((p) => account?.participantIds?.includes(p.id));
  return (
    <main className="family-shell" tabIndex={-1}>
      <div className="family-card">
        <h1>{xt('Family workspace')}</h1>
        <p>{xt('This account is a family account. It opens only the family pages of your child.')}</p>
        <ul className="family-list">
          {mine.map((p) => (
            <li key={p.id}>
              <a className="btn btn--primary btn--lg" href={href({ name: 'familyHome', id: p.id })}>
                {p.code}
              </a>
            </li>
          ))}
        </ul>
        {!mine.length && <p className="muted">{xt('No child is linked to this account yet. Ask your therapist.')}</p>}
      </div>
    </main>
  );
}
