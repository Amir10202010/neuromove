// Two separate facts, never merged into one "saved" tick:
//   1. local:  every change is committed to IndexedDB on this device (confirmed by the transaction)
//   2. cloud:  the server acknowledged the change (outbox empty) — or why not (off, offline, sign-in…)

import { Cloud, CloudOff, HardDrive, LoaderCircle, TriangleAlert } from 'lucide-react';
import { href } from '../../app/router';
import { useI18n } from '../../i18n';
import { useResearchStore } from '../../research/store';
import { useAppStore } from '../../state/appStore';
import { useSyncStore } from '../../sync/engine';
import { useRT } from './i18n';

export function SaveStatus({ compact }: { compact?: boolean }) {
  const rt = useRT();
  const { f } = useI18n();
  const saving = useResearchStore((s) => s.saving);
  const lastSaved = useResearchStore((s) => s.lastSavedAt);
  const error = useResearchStore((s) => s.error);
  const pendingWrites = useAppStore((s) => s.pendingWrites);
  const storageKind = useAppStore((s) => s.storageKind);
  const sync = useSyncStore();
  const local = error ? (
    <span className="savestat is-critical" role="alert">
      <TriangleAlert aria-hidden /> {rt('Not saved on this device')}
    </span>
  ) : saving || pendingWrites > 0 ? (
    <span className="savestat">
      <LoaderCircle className="spinner" aria-hidden /> {rt('Saving…')}
    </span>
  ) : storageKind === 'memory' ? (
    <span className="savestat is-critical">
      <TriangleAlert aria-hidden /> {rt('Browser storage unavailable — data lives only in this tab')}
    </span>
  ) : (
    <span className="savestat is-good" title={lastSaved ? f.dateTime(lastSaved) : undefined}>
      <HardDrive aria-hidden /> {lastSaved ? `${rt('Saved on this device')} ${f.time(lastSaved)}` : rt('Saved on this device')}
    </span>
  );
  const cloudText = (() => {
    switch (sync.phase) {
      case 'off':
        return rt('Cloud sync off');
      case 'syncing':
        return rt('Syncing…');
      case 'offline':
        return rt('Offline — {n} waiting', { n: sync.pending });
      case 'unauthenticated':
        return rt('Sign in to sync — {n} waiting', { n: sync.pending });
      case 'unavailable':
        return rt('Server not configured — {n} waiting', { n: sync.pending });
      case 'error':
        return rt('Sync error — {n} waiting', { n: sync.pending });
      case 'idle':
        return sync.pending ? rt('{n} waiting to sync', { n: sync.pending }) : rt('Synced');
    }
  })();
  const cloudOk = sync.phase === 'idle' && sync.pending === 0 && !sync.conflicts.length;
  return (
    <span className={`savestats${compact ? ' is-compact' : ''}`} aria-live="polite">
      {local}
      <a className={`savestat${cloudOk ? ' is-good' : sync.phase === 'off' ? '' : ' is-warn'}`} href={href({ name: 'settings' })} title={sync.lastSyncAt ? `${rt('Last sync')} ${f.dateTime(sync.lastSyncAt)}` : undefined}>
        {sync.phase === 'syncing' ? <LoaderCircle className="spinner" aria-hidden /> : cloudOk ? <Cloud aria-hidden /> : <CloudOff aria-hidden />} {cloudText}
        {sync.conflicts.length > 0 && ` · ${rt('{n} conflicts', { n: sync.conflicts.length })}`}
      </a>
    </span>
  );
}
