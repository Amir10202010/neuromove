import { ArrowLeft, ArrowRight, Bluetooth, FileUp, FlaskConical, Microscope, Stethoscope, Usb, UserRound } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { navigate } from '../../website/router';
import { BodyMap } from '../../charts/BodyMap';
import { CalibrationFigure } from '../../figures/CalibrationFigure';
import { EmptyArt } from '../../figures/EmptyArt';
import { Hair, InkLayer } from '../../figures/Ink';
import type { Role } from '../../data/models';
import { isWebBluetoothSupported } from '../../devices/BleDevice';
import { isWebSerialSupported } from '../../devices/SerialDevice';
import { PLACEMENTS, type DeviceKind } from '../../devices/types';
import { useI18n } from '../../i18n';
import { LanguageSwitch } from '../../layout/LanguageSwitch';
import { useAppStore } from '../../state/appStore';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Logo } from '../../ui/Logo';

const TOTAL = 4;

function Choice({ selected, onClick, icon, title, text, disabled, badge }: { selected: boolean; onClick: () => void; icon: ReactNode; title: string; text: string; disabled?: boolean; badge?: string }) {
  return (
    <button type="button" className="choice" aria-pressed={selected} onClick={onClick} disabled={disabled}>
      <span className="choice__icon">{icon}</span>
      <span className="choice__body">
        <span className="choice__title">
          {title}
          {badge && <span className="badge" style={{ marginLeft: 8 }}>{badge}</span>}
        </span>
        <span className="choice__text">{text}</span>
      </span>
    </button>
  );
}

/** Рисунок к шагу знакомства: ребёнок с датчиками, лист отчёта, «данные здесь», подключение. */
function OnboardingArt({ step }: { step: number }) {
  const all = PLACEMENTS.map((placement) => ({ placement, online: step !== 4, battery: null, lowBattery: false, link: 1 }));
  if (step === 1) return <CalibrationFigure progress={1} moved={false} size={230} />;
  if (step === 2) return <EmptyArt kind="sessions" size={150} />;
  if (step === 3) return <LocalData />;
  return <BodyMap sensors={all} required={[]} phase="connecting" size={240} showLabels={false} />;
}

/** «Данные остаются на этом компьютере»: ноутбук, на экране — лист отчёта; сеть перечёркнута. */
function LocalData() {
  return (
    <svg viewBox="0 0 200 150" width={220} height={165} className="empty-art" aria-hidden>
      <InkLayer d="M40,22 L160,22 Q166,22 166,28 L166,104 L34,104 L34,28 Q34,22 40,22 Z" fill="var(--surface)" />
      <InkLayer d="M18,108 L182,108 L176,120 Q174,124 168,124 L32,124 Q26,124 24,120 Z" />
      <InkLayer d="M78,36 L114,36 L124,46 L124,92 L78,92 Z" fill="var(--fig-fill)" />
      <Hair d="M86,52 L114,52 M86,60 L108,60 M86,68 L112,68" color="var(--fig-muted)" width={2} />
      <Hair d="M136,40 Q150,52 136,64 M146,34 Q166,52 146,70" color="var(--fig-muted)" width={1.5} />
      <Hair d="M134,32 L160,74" color="var(--critical)" width={2} />
    </svg>
  );
}

export function OnboardingPage() {
  const { t } = useI18n();
  const existing = useAppStore((s) => s.profile);
  const saveProfile = useAppStore((s) => s.saveProfile);
  const setWorkspace = useAppStore((s) => s.setWorkspace);
  const setPreferredDevice = useAppStore((s) => s.setPreferredDevice);
  const toast = useAppStore((s) => s.toast);

  const [step, setStep] = useState(1);
  const [role, setRole] = useState<Role>(existing?.role ?? 'physician');
  const [name, setName] = useState(existing?.name ?? '');
  const [clinic, setClinic] = useState(existing?.clinic ?? '');
  const [consents, setConsents] = useState([!!existing, !!existing, !!existing]);
  const [device, setDevice] = useState<DeviceKind | 'later'>('later');
  const [nameError, setNameError] = useState(false);

  const serial = isWebSerialSupported();
  const ble = isWebBluetoothSupported();

  const next = () => {
    if (step === 2 && !name.trim()) {
      setNameError(true);
      return;
    }
    if (step < TOTAL) {
      setStep(step + 1);
      return;
    }
    saveProfile({ name: name.trim(), role, clinic: clinic.trim(), createdAt: existing?.createdAt ?? new Date().toISOString() });
    setPreferredDevice(device === 'later' ? null : device);
    setWorkspace('clinic');
    toast('good', t('workspace.switchedClinic'));
    navigate({ name: 'overview' });
  };

  const canNext = step === 3 ? consents.every(Boolean) : true;

  return (
    <div className="onboarding">
      <header className="onboarding__top">
        <a href="#/" aria-label="NeuroMove">
          <Logo subtitle={t('onboarding.title')} />
        </a>
        <LanguageSwitch className="onboarding__lang" />
      </header>
      <main className="onboarding__main" id="main">
        <div className="card onboarding__card">
          {/* Рисунок к шагу — из той же системы, что в приложении: человек видит, о чём шаг */}
          <div className="onboarding__art" aria-hidden>
            <OnboardingArt step={step} />
          </div>
          <div className="card__body stack onboarding__body" style={{ gap: 20 }}>
            <div>
              <span className="eyebrow">{t('onboarding.stepOf', { step, total: TOTAL })}</span>
              <div className="onboarding__rail" aria-hidden>
                {Array.from({ length: TOTAL }, (_, i) => (
                  <span key={i} className={i < step - 1 ? 'is-done' : i === step - 1 ? 'is-current' : undefined} />
                ))}
              </div>
            </div>

            {step === 1 && (
              <section className="stack" aria-labelledby="ob-h">
                <div>
                  <h1 id="ob-h" className="onboarding__title">{t('onboarding.roleTitle')}</h1>
                  <p className="secondary" style={{ marginTop: 6 }}>{t('onboarding.roleText')}</p>
                </div>
                <div className="stack" style={{ gap: 8 }}>
                  <Choice selected={role === 'physician'} onClick={() => setRole('physician')} icon={<Stethoscope />} title={t('role.physician')} text={t('role.physicianText')} />
                  <Choice selected={role === 'therapist'} onClick={() => setRole('therapist')} icon={<UserRound />} title={t('role.therapist')} text={t('role.therapistText')} />
                  <Choice selected={role === 'researcher'} onClick={() => setRole('researcher')} icon={<Microscope />} title={t('role.researcher')} text={t('role.researcherText')} />
                </div>
              </section>
            )}

            {step === 2 && (
              <section className="stack" aria-labelledby="ob-h">
                <div>
                  <h1 id="ob-h" className="onboarding__title">{t('onboarding.profileTitle')}</h1>
                  <p className="secondary" style={{ marginTop: 6 }}>{t('onboarding.profileText')}</p>
                </div>
                <Field label={t('onboarding.nameLabel')} error={nameError ? t('onboarding.nameRequired') : undefined}>
                  <input
                    className="input"
                    value={name}
                    autoComplete="name"
                    placeholder={t('onboarding.namePlaceholder')}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameError(false);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && next()}
                    data-autofocus
                  />
                </Field>
                <Field label={t('onboarding.clinicLabel')} optional={t('common.optional')}>
                  <input className="input" value={clinic} placeholder={t('onboarding.clinicPlaceholder')} onChange={(e) => setClinic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && next()} />
                </Field>
              </section>
            )}

            {step === 3 && (
              <section className="stack" aria-labelledby="ob-h">
                <div>
                  <h1 id="ob-h" className="onboarding__title">{t('onboarding.consentTitle')}</h1>
                  <p className="secondary" style={{ marginTop: 6 }}>{t('onboarding.consentText')}</p>
                </div>
                {(['consentMeasure', 'consentPrivacy', 'consentSafety'] as const).map((k, i) => (
                  <label key={k} className="checkbox consent">
                    <input type="checkbox" checked={consents[i]} onChange={(e) => setConsents(consents.map((c, j) => (j === i ? e.target.checked : c)))} />
                    <span>{t(`onboarding.${k}`)}</span>
                  </label>
                ))}
              </section>
            )}

            {step === 4 && (
              <section className="stack" aria-labelledby="ob-h">
                <div>
                  <h1 id="ob-h" className="onboarding__title">{t('onboarding.deviceTitle')}</h1>
                  <p className="secondary" style={{ marginTop: 6 }}>{t('onboarding.deviceText')}</p>
                </div>
                <div className="stack" style={{ gap: 8 }}>
                  <Choice selected={device === 'usb'} onClick={() => setDevice('usb')} icon={<Usb />} title={t('device.usb')} text={t('device.kinds.usbText')} disabled={!serial} badge={serial ? t('device.kinds.needsHardware') : t('device.kinds.notSupported')} />
                  <Choice selected={device === 'ble'} onClick={() => setDevice('ble')} icon={<Bluetooth />} title={t('device.ble')} text={t('device.kinds.bleText')} disabled={!ble} badge={ble ? t('device.kinds.needsHardware') : t('device.kinds.notSupported')} />
                  <Choice selected={device === 'replay'} onClick={() => setDevice('replay')} icon={<FileUp />} title={t('device.replay')} text={t('device.kinds.replayText')} />
                  <Choice selected={device === 'later'} onClick={() => setDevice('later')} icon={<FlaskConical />} title={t('overview.tryDemo')} text={t('device.kinds.notInDemo')} />
                </div>
              </section>
            )}

            <div className="row row--between" style={{ paddingTop: 4 }}>
              <Button variant="ghost" icon={<ArrowLeft />} onClick={() => (step === 1 ? navigate({ name: 'welcome' }) : setStep(step - 1))}>
                {t('common.back')}
              </Button>
              <Button variant="primary" iconRight={<ArrowRight />} onClick={next} disabled={!canNext}>
                {step === TOTAL ? t('onboarding.finish') : t('common.next')}
              </Button>
            </div>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 'var(--fs-xs)', textAlign: 'center', maxWidth: 520 }}>
          {t('app.disclaimer')}
        </p>
      </main>
    </div>
  );
}
