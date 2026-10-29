// Гид демонстрации: восемь шагов показа. На каждом шаге светлым остаётся только то,
// о чём он говорит, а рядом — карточка: заголовок и не больше одной короткой фразы.
// Если нужно что-то нажать, гид обводит настоящую кнопку приложения и своей не дублирует:
// заголовок говорит, что сделать («Начните тест»), обведённая кнопка — где. Если шаг
// только объясняет — в карточке «Далее».
//
// Шаги переключаются сами, когда человек делает нужное действие. Ушёл с шага на другой
// экран — гид так и говорит и возвращает кнопкой. В конце — итог и «Пройти ещё раз».
// Затемнение и карточка — Coach.tsx, цели шагов — spot.ts.

import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, MonitorPlay, RotateCcw, X, Zap } from 'lucide-react';
import { useEffect } from 'react';
import { navigate, useRoute, type Route } from '../../app/router';
import { useI18n, type TKey } from '../../i18n';
import { GUIDE_STEPS, useAppStore, type GuideStep } from '../../state/appStore';
import { useControllerState, useSessionStore } from '../../state/sessionStore';
import { Button } from '../../ui/Button';
import { DEMO_PATIENT_ID, startClinicDemo } from './clinicDemo';
import { CoachCard, PressRing, Scrim, useTargets } from './Coach';
import { DemoIntro } from './DemoIntro';
import { findTarget, STEP_TARGETS } from './spot';

/**
 * Фраза под заголовком — только там, где она что-то добавляет к экрану. На шагах-действиях
 * («Начните тест», «Наденьте датчики») фразы нет: заголовок и обведённая кнопка.
 */
const STEP_TEXT: Partial<Record<GuideStep, TKey>> = {
  patient: 'guide.steps.patient.text',
  connect: 'guide.steps.connect.text',
  test: 'guide.steps.test.text',
  result: 'guide.steps.result.text',
  progress: 'guide.steps.progress.text',
  analytics: 'guide.steps.analytics.text',
};

/** Тот ли экран открыт, о котором говорит шаг. */
function onStep(step: GuideStep, route: Route): boolean {
  switch (step) {
    case 'patient':
    case 'start':
    case 'progress':
      return route.name === 'patient' && route.id === DEMO_PATIENT_ID;
    case 'setup':
      return route.name === 'sessionNew' || route.name === 'sessionRun';
    case 'connect':
    case 'test':
      return route.name === 'sessionRun';
    case 'result':
      return route.name === 'session' || route.name === 'sessionPrint';
    case 'analytics':
      return route.name === 'analytics' || route.name === 'patient';
  }
}

function prefersReduced(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export function DemoGuide() {
  const { t } = useI18n();
  const guide = useAppStore((s) => s.guide);
  const setStep = useAppStore((s) => s.setGuideStep);
  const setMin = useAppStore((s) => s.setGuideMinimized);
  const finish = useAppStore((s) => s.finishGuide);
  const stop = useAppStore((s) => s.stopGuide);
  const lastSessionId = useAppStore((s) => s.lastDemoSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const route = useRoute();
  const controller = useSessionStore((s) => s.controller);
  const cstate = useControllerState(controller);

  const step = guide.step;
  const i = GUIDE_STEPS.indexOf(step);
  const total = GUIDE_STEPS.length;
  const here = onStep(step, route);
  const showCoach = guide.active && !guide.minimized && !guide.intro && !guide.done && here;
  const targets = STEP_TARGETS[step];
  const boxes = useTargets(targets.look, targets.press, showCoach);

  // Шаг следует за тем, что происходит на экране
  useEffect(() => {
    if (!guide.active || guide.done) return;
    const idx = GUIDE_STEPS.indexOf(guide.step);
    const at = (s: GuideStep) => GUIDE_STEPS.indexOf(s);
    let next: GuideStep | null = null;
    if (route.name === 'sessionNew' && idx < at('setup')) next = 'setup';
    if (route.name === 'sessionRun' && cstate?.stage === 'connect' && idx < at('connect')) next = 'connect';
    if (route.name === 'sessionRun' && cstate?.stage === 'test' && idx < at('test')) next = 'test';
    if (route.name === 'session' && route.complete && idx < at('result')) next = 'result';
    if (route.name === 'patient' && idx >= at('result') && idx < at('progress')) next = 'progress';
    if (route.name === 'analytics' && idx < at('analytics')) next = 'analytics';
    if (next) setStep(next);
  }, [route, cstate?.stage, guide.active, guide.done, guide.step, setStep]);

  // Новый шаг — цель в поле зрения: кнопка, если она есть, иначе блок. Цель может появиться
  // не сразу (экран ещё строится) — ищем её до полутора секунд
  useEffect(() => {
    if (!showCoach) return;
    const ids: string[] = [...(targets.press ? [targets.press] : []), ...targets.look];
    let tries = 0;
    let timer = 0;
    const look = () => {
      const el = ids.map(findTarget).find((x): x is HTMLElement => x !== null);
      if (!el) {
        if (tries++ < 15) timer = window.setTimeout(look, 100);
        return;
      }
      const r = el.getBoundingClientRect();
      const top = 60;
      const bottom = window.innerWidth < 721 ? window.innerHeight - 300 : window.innerHeight - 90;
      if (r.top >= top && r.bottom <= bottom) return;
      el.scrollIntoView({ block: r.height > bottom - top ? 'start' : 'center', behavior: prefersReduced() ? 'auto' : 'smooth' });
    };
    timer = window.setTimeout(look, 60);
    return () => window.clearTimeout(timer);
    // targets — по шагу, отдельно не меняются
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCoach, step]);

  if (!guide.active) return null;
  if (guide.intro) return <DemoIntro />;

  if (guide.minimized) {
    return (
      <button type="button" className="guide-pill" onClick={() => setMin(false)} aria-label={t('guide.title')}>
        <MonitorPlay size={16} aria-hidden />
        {t('guide.title')} · {guide.done ? <Check size={14} aria-hidden /> : `${i + 1}/${total}`}
        <ChevronUp size={16} aria-hidden />
      </button>
    );
  }

  const icons = (
    <span className="coach__icons">
      <button type="button" className="coach__icon" onClick={() => setMin(true)} aria-label={t('guide.minimize')} title={t('guide.minimize')}>
        <ChevronDown size={16} />
      </button>
      <button type="button" className="coach__icon" onClick={() => stop()} aria-label={t('common.close')} title={t('common.close')}>
        <X size={16} />
      </button>
    </span>
  );
  const dots = (
    <span className="coach__dots" aria-hidden>
      {GUIDE_STEPS.map((s, k) => (
        <span key={s} className={guide.done || k < i ? 'is-done' : k === i ? 'is-current' : undefined} />
      ))}
    </span>
  );

  // Итог пути: одна фраза и «пройти ещё раз»
  if (guide.done) {
    const saved = lastSessionId !== null && sessions.some((s) => s.id === lastSessionId);
    const text = t(saved ? 'guide.done.withSession' : 'guide.done.noSession');
    return (
      <CoachCard anchor={null} avoid={null} vw={boxes.vw || window.innerWidth} vh={boxes.vh || window.innerHeight} label={t('guide.title')} className="coach--done">
        <div className="coach__head">
          <span className="coach__badge" aria-hidden>
            <Check />
          </span>
          {dots}
          {icons}
        </div>
        <p className="coach__text" role="status">
          <strong className="coach__title">{t('guide.done.title')}</strong>
          {text}
        </p>
        <div className="coach__actions">
          <Button variant="ghost" size="sm" onClick={() => stop()}>
            {t('guide.done.close')}
          </Button>
          <Button variant="demo" icon={<RotateCcw />} onClick={() => void startClinicDemo()}>
            {t('guide.done.again')}
          </Button>
        </div>
      </CoachCard>
    );
  }

  const stepTitle = t(`guide.steps.${step}.title`);

  // Ушли с шага на другой экран: без затемнения, одна кнопка — вернуться
  if (!here) {
    const back = () => {
      switch (step) {
        case 'patient':
        case 'start':
        case 'progress':
          return navigate({ name: 'patient', id: DEMO_PATIENT_ID, tab: 'overview' });
        case 'setup':
          return navigate({ name: 'sessionNew', patientId: DEMO_PATIENT_ID, protocol: 'upper_quick' });
        case 'connect':
        case 'test':
          if (controller) return navigate({ name: 'sessionRun' });
          setStep('start');
          return navigate({ name: 'patient', id: DEMO_PATIENT_ID, tab: 'overview' });
        case 'result':
          return lastSessionId ? navigate({ name: 'session', id: lastSessionId, complete: false }) : navigate({ name: 'patient', id: DEMO_PATIENT_ID, tab: 'overview' });
        case 'analytics':
          return navigate({ name: 'analytics' });
      }
    };
    return (
      <CoachCard anchor={null} avoid={null} vw={window.innerWidth} vh={window.innerHeight} label={t('guide.title')} className="coach--away">
        <div className="coach__head">
          <span className="coach__step">
            {t('guide.stepLabel', { current: i + 1, total })}
          </span>
          {dots}
          {icons}
        </div>
        <p className="coach__text" aria-live="polite">
          <strong className="coach__title">{t('guide.away.title', { step: stepTitle })}</strong>
          {t('guide.away.text')}
        </p>
        <div className="coach__actions">
          <Button variant="demo" icon={<ArrowLeft />} onClick={back}>
            {(step === 'connect' || step === 'test') && !controller ? t('guide.away.restart') : t('guide.away.back')}
          </Button>
        </div>
      </CoachCard>
    );
  }

  const sim = controller?.simulator ?? null;
  const press = targets.press;
  // Кнопка нажатия ещё недоступна (датчики выходят на связь) — светлым остаётся блок, ждём
  const pressReady = !!press && !!boxes.press && !boxes.pressDisabled;
  const anchor = pressReady ? boxes.press : (boxes.look ?? boxes.press);
  const avoid = pressReady ? boxes.look : null;
  const holes = [boxes.look, pressReady ? boxes.press : null].filter((b): b is NonNullable<typeof b> => b !== null);

  // Во время калибровки — своя фраза: «три секунды неподвижно»
  const textKey: TKey | undefined = step === 'test' && boxes.lookId === 'calibration' ? 'guide.steps.test.calibrating' : STEP_TEXT[step];

  const next = (): void => {
    if (step === 'patient') setStep('start');
    else if (step === 'result') navigate({ name: 'patient', id: DEMO_PATIENT_ID, tab: 'overview' });
    else if (step === 'progress') navigate({ name: 'analytics' });
    else if (step === 'analytics') finish();
  };

  return (
    <>
      {/* Рамка вокруг блока — только когда его верх на экране: иначе линия легла бы на верхнюю панель */}
      {holes.length > 0 && <Scrim holes={holes} frame={boxes.look && boxes.look.y > 40 ? boxes.look : null} />}
      {pressReady && boxes.press && <PressRing key={`ring-${step}`} box={boxes.press} />}
      <CoachCard key={`card-${step}`} anchor={anchor} avoid={avoid} vw={boxes.vw} vh={boxes.vh} label={t('guide.title')}>
        <div className="coach__head">
          <span className="coach__step">{t('guide.stepLabel', { current: i + 1, total })}</span>
          {dots}
          {icons}
        </div>
        <p className="coach__text" aria-live="polite">
          <strong className="coach__title">{stepTitle}</strong>
          {textKey && t(textKey)}
        </p>
        {/* Шаг-действие: своей кнопки нет, нажимают обведённую кнопку приложения */}
        {press ? null : step === 'test' ? (
          sim && (
            <div className="coach__actions">
              <Button size="sm" variant="secondary" icon={<Zap />} onClick={() => sim.injectFault('disconnect')}>
                {t('guide.showFault')}
              </Button>
            </div>
          )
        ) : (
          <div className="coach__actions">
            <Button variant="demo" onClick={next} iconRight={<ArrowRight />}>
              {step === 'analytics' ? t('guide.finish') : t('guide.next')}
            </Button>
          </div>
        )}
      </CoachCard>
    </>
  );
}
