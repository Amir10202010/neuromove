import { NotebookPen, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { href } from '../../website/router';
import type { Patient } from '../../data/models';
import { useI18n } from '../../i18n';
import { currentClinician, useAppStore, useWorkspaceData } from '../../state/appStore';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';

export function NotesPanel({ patient }: { patient: Patient }) {
  const { t, f } = useI18n();
  const { notes, sessions } = useWorkspaceData();
  const addNote = useAppStore((s) => s.addNote);
  const deleteNote = useAppStore((s) => s.deleteNote);
  const toast = useAppStore((s) => s.toast);
  const [text, setText] = useState('');
  const list = notes.filter((n) => n.patientId === patient.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const submit = () => {
    if (!text.trim()) return;
    addNote({ patientId: patient.id, sessionId: null, author: currentClinician(), text: text.trim(), kind: 'clinical' });
    setText('');
    toast('good', t('notes.added'));
  };

  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">{t('notes.title')}</h2>
      </div>
      <div className="card__body stack">
        <div className="stack" style={{ gap: 8 }}>
          <label className="sr-only" htmlFor="note-input">
            {t('notes.add')}
          </label>
          <textarea id="note-input" className="textarea" placeholder={t('notes.placeholder')} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && submit()} />
          <div>
            <Button variant="primary" size="sm" onClick={submit} disabled={!text.trim()} icon={<NotebookPen />}>
              {t('notes.add')}
            </Button>
          </div>
        </div>
        {list.length === 0 ? (
          <EmptyState compact title={t('notes.empty')} />
        ) : (
          <ol className="notes">
            {list.map((n) => {
              const s = n.sessionId ? sessions.find((x) => x.id === n.sessionId) : null;
              return (
                <li key={n.id} className="note">
                  <div className="note__meta">
                    <span className={`badge ${n.kind === 'summary' ? 'badge--info' : ''}`}>{n.kind === 'summary' ? t('notes.summaryKind') : t('notes.clinicalKind')}</span>
                    <span>{f.dateTime(n.createdAt)}</span>
                    <span>· {n.author}</span>
                    {s && (
                      <a href={href({ name: 'session', id: s.id, complete: false })}>· {t('notes.fromSession', { date: f.dateShort(s.startedAt) })}</a>
                    )}
                    <span className="spacer" />
                    <Button variant="ghost" size="sm" iconOnly icon={<Trash2 />} aria-label={t('common.delete')} onClick={() => deleteNote(n.id)} />
                  </div>
                  <p className="note__text">{n.text}</p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
