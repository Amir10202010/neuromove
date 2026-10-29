import { useState } from 'react';
import { navigate } from '../../website/router';
import type { AffectedSide, CpForm, Level, Patient, PatientStatus } from '../../data/models';
import { useI18n } from '../../i18n';
import { newId } from '../../lib/ids';
import { useAppStore, useWorkspaceData } from '../../state/appStore';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Modal } from '../../ui/Modal';
import { Segmented } from '../../ui/Segmented';

const CP_FORMS: CpForm[] = ['hemiplegia', 'diplegia', 'tetraplegia', 'dyskinetic', 'ataxic', 'other'];
const LEVELS: (Level | 0)[] = [0, 1, 2, 3, 4, 5];
const ROMAN = ['–', 'I', 'II', 'III', 'IV', 'V'];

/**
 * Имя пациента: до 40 знаков, с буквы или цифры (не с «=», «+», «-», «@»: с них Excel
 * начинает формулу в выгрузке CSV), без служебных символов. Фамилию просим не вводить — подсказка у поля.
 */
const NAME_MAX = 40;
function cleanName(raw: string): string | null {
  const v = raw.trim().replace(/\s+/g, ' ');
  if (v.length > NAME_MAX || !/^[\p{L}\p{N}]/u.test(v) || /[\p{C}]/u.test(v)) return null;
  return v;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PatientFormModal(props: { open: boolean; onClose: () => void; patient?: Patient }) {
  // Форма создаётся заново при каждом открытии: начальные значения берутся из пациента
  if (!props.open) return null;
  return <PatientFormDialog key={props.patient?.id ?? 'new'} onClose={props.onClose} patient={props.patient} />;
}

function PatientFormDialog({ onClose, patient }: { onClose: () => void; patient?: Patient }) {
  const { t } = useI18n();
  const { ws, patients } = useWorkspaceData();
  const save = useAppStore((s) => s.savePatient);
  const toast = useAppStore((s) => s.toast);
  const year = new Date().getFullYear();

  const [code, setCode] = useState(() => patient?.code ?? '');
  const [birthYear, setBirthYear] = useState(patient?.birthYear ?? year - 8);
  const [cpForm, setCpForm] = useState<CpForm>(patient?.cpForm ?? 'hemiplegia');
  const [side, setSide] = useState<AffectedSide>(patient?.affectedSide ?? 'right');
  const [gmfcs, setGmfcs] = useState<Level | 0>(patient?.gmfcs ?? 0);
  const [macs, setMacs] = useState<Level | 0>(patient?.macs ?? 0);
  const [status, setStatus] = useState<PatientStatus>(patient?.status ?? 'active');
  const [nextVisit, setNextVisit] = useState(() => toLocalInput(patient?.nextVisit ?? null));
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const c = cleanName(code);
    if (c === null) {
      setError(t('patientForm.codeInvalid'));
      return;
    }
    if (patients.some((p) => p.code.toLocaleLowerCase() === c.toLocaleLowerCase() && p.id !== patient?.id)) {
      setError(t('patientForm.codeTaken'));
      return;
    }
    const base: Patient = patient ?? {
      id: newId('p'),
      workspace: ws,
      code: c,
      birthYear,
      cpForm,
      gmfcs: null,
      macs: null,
      affectedSide: side,
      status,
      courseStart: null,
      createdAt: new Date().toISOString(),
      goals: [],
      nextVisit: null,
      nextProtocol: null,
    };
    const next: Patient = {
      ...base,
      code: c,
      birthYear,
      cpForm,
      affectedSide: side,
      gmfcs: gmfcs === 0 ? null : gmfcs,
      macs: macs === 0 ? null : macs,
      status,
      nextVisit: nextVisit ? new Date(nextVisit).toISOString() : null,
      nextProtocol: nextVisit ? base.nextProtocol ?? 'upper_standard' : null,
    };
    save(next);
    toast('good', patient ? t('patientForm.updated') : t('patientForm.created', { code: c }));
    onClose();
    if (!patient) navigate({ name: 'patient', id: next.id, tab: 'overview' });
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={patient ? t('patientForm.titleEdit', { code: patient.code }) : t('patientForm.titleNew')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={t('patientForm.code')} hint={t('patientForm.codeHint')} error={error ?? undefined}>
          <input
            className="input"
            value={code}
            maxLength={NAME_MAX}
            autoComplete="off"
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
            data-autofocus
          />
        </Field>
        <Field label={t('patientForm.birthYear')}>
          <select className="select" value={birthYear} onChange={(e) => setBirthYear(Number(e.target.value))}>
            {Array.from({ length: 18 }, (_, i) => year - 1 - i).map((y) => (
              <option key={y} value={y}>
                {y} · {t('common.yearsOld', { count: year - y })}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('patientForm.form')}>
          <select className="select" value={cpForm} onChange={(e) => setCpForm(e.target.value as CpForm)}>
            {CP_FORMS.map((f) => (
              <option key={f} value={f}>
                {t(`cpForm.${f}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('patientForm.status')}>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as PatientStatus)}>
            {(['active', 'paused', 'discharged'] as PatientStatus[]).map((s) => (
              <option key={s} value={s}>
                {t(`patients.status.${s}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="field">
        <span className="field__label">{t('patientForm.side')}</span>
        <Segmented<AffectedSide>
          label={t('patientForm.side')}
          value={side}
          onChange={setSide}
          options={[
            { value: 'left', label: t('side.left') },
            { value: 'right', label: t('side.right') },
            { value: 'both', label: t('side.both') },
          ]}
        />
      </div>
      <div className="form-grid">
        <div className="field">
          <span className="field__label">{t('patientForm.gmfcs')}</span>
          <Segmented<Level | 0> label={t('patientForm.gmfcs')} value={gmfcs} onChange={setGmfcs} options={LEVELS.map((l) => ({ value: l, label: ROMAN[l] }))} />
          <span className="field__hint">{t('patientForm.gmfcsHint')}</span>
        </div>
        <div className="field">
          <span className="field__label">{t('patientForm.macs')}</span>
          <Segmented<Level | 0> label={t('patientForm.macs')} value={macs} onChange={setMacs} options={LEVELS.map((l) => ({ value: l, label: ROMAN[l] }))} />
          <span className="field__hint">{t('patientForm.macsHint')}</span>
        </div>
      </div>
      <Field label={t('patientForm.nextVisit')} optional={t('common.optional')}>
        <input className="input" type="datetime-local" value={nextVisit} onChange={(e) => setNextVisit(e.target.value)} style={{ maxWidth: 260 }} />
      </Field>
    </Modal>
  );
}
