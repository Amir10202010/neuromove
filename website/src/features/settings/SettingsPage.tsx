import { Building2, Database, Download, ExternalLink, FlaskConical, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { navigate } from '../../app/router';
import { ALGORITHM_VERSION, APP_VERSION, BUILD_DATE } from '../../core/version';
import { previewBackup, type BackupPreview } from '../../data/backup';
import { downloadText, exportName, metricsCsv, stamp } from '../../data/export';
import type { Profile, Role } from '../../data/models';
import { useNow } from '../../hooks/useNow';
import { useI18n } from '../../i18n';
import { MAX_BACKUP_MB, readTextFile } from '../../lib/files';
import { LanguageSwitch } from '../../layout/LanguageSwitch';
import { PageHeader } from '../../layout/PageHeader';
import { useAppStore, useWorkspaceData } from '../../state/appStore';
import { useSessionStore } from '../../state/sessionStore';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { ConfirmDialog } from '../../ui/Modal';

export function SettingsPage() {
  const { t, f } = useI18n();
  const { ws, patients, sessions } = useWorkspaceData();
  const settings = useAppStore((s) => s.settings);
  const profile = useAppStore((s) => s.profile);
  const storageKind = useAppStore((s) => s.storageKind);
  const saveProfile = useAppStore((s) => s.saveProfile);
  const setAutoAdvance = useAppStore((s) => s.setAutoAdvance);
  const setWorkspace = useAppStore((s) => s.setWorkspace);
  const exportBackup = useAppStore((s) => s.exportBackup);
  const importBackup = useAppStore((s) => s.importBackup);
  const markBackup = useAppStore((s) => s.markBackup);
  const resetDemo = useAppStore((s) => s.resetDemo);
  const clearClinic = useAppStore((s) => s.clearClinic);
  const toast = useAppStore((s) => s.toast);
  const clearSession = useSessionStore((s) => s.clear);

  // Архив проверен и посчитан до вопроса: испорченный файл не доходит до «Заменить?»
  const [pendingImport, setPendingImport] = useState<{ text: string; preview: BackupPreview } | null>(null);
  const [confirm, setConfirm] = useState<'reset' | 'clear' | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const now = useNow();
  const backupOld = ws === 'clinic' && (!settings.lastBackupAt || now - new Date(settings.lastBackupAt).getTime() > 7 * 86400000) && patients.length > 0;

  return (
    <div className="page page--narrow">
      <PageHeader title={t('settings.title')} />

      <section className="card">
        <div className="card__header">
          <h2 className="card__title">{t('settings.language')}</h2>
        </div>
        <div className="card__body">
          <LanguageSwitch className="settings__lang" />
        </div>
      </section>

      <section className="card">
        <div className="card__header">
          <h2 className="card__title">{t('settings.workspace')}</h2>
        </div>
        <div className="card__body stack">
          <p className="secondary">{t('workspace.separated')}</p>
          <div className="row row--wrap">
            <Button variant={ws === 'demo' ? 'demo' : 'secondary'} icon={<FlaskConical />} onClick={() => setWorkspace('demo')} aria-pressed={ws === 'demo'}>
              {t('workspace.demo')}
            </Button>
            <Button
              variant={ws === 'clinic' ? 'primary' : 'secondary'}
              icon={<Building2 />}
              aria-pressed={ws === 'clinic'}
              onClick={() => (profile ? setWorkspace('clinic') : navigate({ name: 'onboarding' }))}
            >
              {t('workspace.clinic')}
            </Button>
          </div>
        </div>
      </section>

      {ws === 'clinic' && profile && <ProfileForm key={profile.createdAt} profile={profile} onSave={(p) => { saveProfile(p); toast('good', t('settings.profileSaved')); }} />}

      <section className="card">
        <div className="card__header">
          <h2 className="card__title">{t('settings.session')}</h2>
        </div>
        <div className="card__body">
          <label className="switch">
            <input type="checkbox" checked={settings.autoAdvance} onChange={(e) => setAutoAdvance(e.target.checked)} />
            <span>{t('setup.autoAdvance')}</span>
          </label>
        </div>
      </section>

      <section className="card">
        <div className="card__header">
          <h2 className="card__title">{t('settings.data')}</h2>
          <span className="badge">
            <Database size={12} aria-hidden />
            {storageKind === 'indexeddb' ? t('settings.storageIdb') : t('settings.storageMemory')}
          </span>
        </div>
        <div className="card__body stack">
          <p className="secondary">{t('settings.dataText')}</p>
          {backupOld && (
            <div className="callout callout--warn">
              <Download aria-hidden />
              <span>{t('settings.backupReminder')}</span>
            </div>
          )}
          <div className="settings__row">
            <div>
              <strong>{t('settings.backup')}</strong>
              <p className="field__hint">{t('settings.backupHint')}</p>
              <p className="field__hint">{settings.lastBackupAt ? t('settings.lastBackup', { date: f.dateTime(settings.lastBackupAt) }) : t('settings.neverBackup')}</p>
            </div>
            <div className="row row--wrap">
              <Button
                icon={<Download />}
                onClick={() => {
                  downloadText(exportName(ws === 'demo', ['backup', stamp()], 'json'), exportBackup(), 'application/json');
                  markBackup();
                }}
              >
                {t('settings.backup')}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  const text = await readTextFile(file, MAX_BACKUP_MB);
                  if (text === null) {
                    toast('critical', t('device.fileTooLarge', { mb: MAX_BACKUP_MB }));
                    return;
                  }
                  const preview = previewBackup(text, ws);
                  if (!preview) toast('critical', t('settings.restoreError'));
                  else setPendingImport({ text, preview });
                }}
              />
              <Button icon={<Upload />} onClick={() => fileInput.current?.click()}>
                {t('settings.restore')}
              </Button>
            </div>
          </div>
          <div className="settings__row">
            <div>
              <strong>{t('settings.exportMetrics')}</strong>
              <p className="field__hint">{t('common.sessionsCount', { count: sessions.length })}</p>
            </div>
            <Button icon={<Download />} disabled={!sessions.length} onClick={() => downloadText(exportName(ws === 'demo', ['metrics', stamp()], 'csv'), metricsCsv(sessions, patients), 'text/csv;charset=utf-8')}>
              CSV
            </Button>
          </div>
          <hr className="divider" />
          {ws === 'demo' ? (
            <div className="settings__row">
              <div>
                <strong>{t('settings.resetDemo')}</strong>
                <p className="field__hint">{t('settings.resetDemoHint')}</p>
              </div>
              <Button variant="danger" icon={<RotateCcw />} onClick={() => setConfirm('reset')}>
                {t('demoBanner.reset')}
              </Button>
            </div>
          ) : (
            <div className="settings__row">
              <div>
                <strong>{t('settings.clearClinic')}</strong>
                <p className="field__hint">{t('settings.clearClinicHint')}</p>
              </div>
              <Button variant="danger" icon={<Trash2 />} onClick={() => setConfirm('clear')}>
                {t('common.delete')}
              </Button>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card__header">
          <h2 className="card__title">{t('settings.about')}</h2>
        </div>
        <div className="card__body stack">
          <dl className="kv">
            <dt>{t('settings.version')}</dt>
            <dd className="mono">{APP_VERSION}</dd>
            <dt>{t('settings.algorithm')}</dt>
            <dd className="mono">{ALGORITHM_VERSION}</dd>
            <dt>{t('settings.dataFormat')}</dt>
            <dd className="mono">imu-csv v1 · 100 Hz</dd>
            {BUILD_DATE && (
              <>
                <dt>{t('settings.build')}</dt>
                <dd className="mono">{BUILD_DATE}</dd>
              </>
            )}
          </dl>
          <p className="secondary" style={{ fontSize: 'var(--fs-sm)' }}>
            {t('app.disclaimer')}
          </p>
          <div>
            <strong style={{ fontSize: 'var(--fs-sm)' }}>{t('settings.sources')}</strong>
            <p style={{ fontSize: 'var(--fs-sm)', marginTop: 4 }}>
              <a href="https://doi.org/10.1186/s12984-015-0090-9" target="_blank" rel="noreferrer">
                Balasubramanian S. et al. On the analysis of movement smoothness. J NeuroEng Rehabil 12, 112 (2015) <ExternalLink size={12} style={{ display: 'inline', verticalAlign: '-1px' }} aria-hidden />
              </a>
            </p>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={pendingImport !== null}
        danger
        title={t('settings.restoreConfirmTitle')}
        text={
          pendingImport
            ? t('settings.restorePreview', {
                workspace: ws === 'demo' ? t('workspace.demo') : t('workspace.clinic'),
                patients: pendingImport.preview.patients,
                sessions: pendingImport.preview.sessions,
                range: pendingImport.preview.from && pendingImport.preview.to ? t('settings.restoreRange', { from: f.date(pendingImport.preview.from), to: f.date(pendingImport.preview.to) }) : '',
                curPatients: patients.length,
                curSessions: sessions.length,
              })
            : ''
        }
        confirmLabel={t('settings.restore')}
        onCancel={() => setPendingImport(null)}
        onConfirm={async () => {
          const ok = pendingImport ? await importBackup(pendingImport.text) : false;
          setPendingImport(null);
          toast(ok ? 'good' : 'critical', ok ? t('settings.restored') : t('settings.restoreError'));
        }}
      />
      <ConfirmDialog
        open={confirm === 'reset'}
        danger
        title={t('demoBanner.resetConfirmTitle')}
        text={t('demoBanner.resetConfirmText')}
        confirmLabel={t('demoBanner.reset')}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          setConfirm(null);
          await clearSession();
          await resetDemo();
          toast('good', t('demoBanner.resetDone'));
        }}
      />
      <ConfirmDialog
        open={confirm === 'clear'}
        danger
        title={t('settings.clearConfirmTitle')}
        text={t('settings.clearConfirmText')}
        confirmLabel={t('common.delete')}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          setConfirm(null);
          await clearSession();
          await clearClinic();
          toast('good', t('settings.cleared'));
        }}
      />
    </div>
  );
}

/** Форма профиля: начальные значения — из профиля; при смене профиля форма создаётся заново (key). */
function ProfileForm({ profile, onSave }: { profile: Profile; onSave: (p: Profile) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(profile.name);
  const [role, setRole] = useState<Role>(profile.role);
  const [clinic, setClinic] = useState(profile.clinic);
  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">{t('settings.profile')}</h2>
      </div>
      <div className="card__body stack">
        <div className="form-grid">
          <Field label={t('onboarding.nameLabel')}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('onboarding.clinicLabel')} optional={t('common.optional')}>
            <input className="input" value={clinic} onChange={(e) => setClinic(e.target.value)} />
          </Field>
          <Field label={t('onboarding.roleTitle')}>
            <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {(['physician', 'therapist', 'researcher'] as Role[]).map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div>
          <Button variant="primary" disabled={!name.trim()} onClick={() => onSave({ ...profile, name: name.trim(), role, clinic: clinic.trim() })}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </section>
  );
}
