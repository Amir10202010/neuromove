// Вступление к демо: одна фраза — для чего NeuroMove — и три кадра пути в одной системе
// рисунков: пациент (какая рука слабее), тест (пять датчиков на ремешках), итог (на сколько
// градусов выше, по настоящим числам первого ребёнка демо). Подписи — одним словом: рисунки
// говорят сами. Одна главная кнопка «Начать»; можно осмотреться без гида. Пометок «демо»
// и «симуляция» здесь нет: об этом говорит тёмная полоса сверху.

import { ArrowRight } from 'lucide-react';
import { BodyMap } from '../../charts/BodyMap';
import { RaiseProgress } from '../../charts/MoveFigures';
import { PLACEMENTS } from '../../devices/types';
import { FrontScene, SIDE_COLOR } from '../../figures/scenes';
import { FIG } from '../../figures/Ink';
import { useI18n } from '../../i18n';
import { courseStory } from '../../session/story';
import { useAppStore } from '../../state/appStore';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { DEMO_PATIENT_ID } from './clinicDemo';

/** Пациент: правая рука (слева от зрителя) — цветом, она слабее; левая — обычная. */
function PatientPic() {
  return (
    <svg viewBox="-12 22 264 214" className="mfig" aria-hidden>
      <FrontScene
        center={{ x: 120, y: 178 }}
        pose={{ right: { upper: 58, fore: 70 }, left: { upper: 112, fore: 118 } }}
        fills={{ right: SIDE_COLOR.right.main, left: FIG.fill }}
        legs={false}
      />
    </svg>
  );
}

export function DemoIntro() {
  const { t } = useI18n();
  const setIntro = useAppStore((s) => s.setGuideIntro);
  const stop = useAppStore((s) => s.stopGuide);
  const patients = useAppStore((s) => s.patients);
  const sessions = useAppStore((s) => s.sessions);
  const p01 = patients.find((p) => p.id === DEMO_PATIENT_ID);
  const story = p01 ? courseStory(sessions, p01) : null;
  const sensors = PLACEMENTS.map((placement) => ({ placement, online: true, battery: null, lowBattery: false, link: 1 }));

  const frames = [
    { key: 'patient', pic: <PatientPic /> },
    { key: 'test', pic: <BodyMap sensors={sensors} required={[]} phase="streaming" size={150} showLabels={false} /> },
    {
      key: 'result',
      pic: story ? (
        <RaiseProgress was={story.first} now={story.last} goal={story.goal?.target} side={story.side} labels={{ was: t('simple.fig.picWas'), goal: t('simple.fig.picGoal') }} ariaLabel="" />
      ) : null,
    },
  ] as const;

  return (
    <Modal
      open
      wide
      className="intro"
      title={t('guide.intro.title')}
      onClose={() => setIntro(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => stop()}>
            {t('guide.intro.explore')}
          </Button>
          <Button variant="demo" size="lg" onClick={() => setIntro(false)} iconRight={<ArrowRight />} data-autofocus>
            {t('guide.intro.start')}
          </Button>
        </>
      }
    >
      <ol className="intro__frames">
        {frames.map((fr, i) => (
          <li key={fr.key} className="intro__frame" style={{ animationDelay: `${120 + i * 90}ms` }}>
            <div className="intro__pic">{fr.pic}</div>
            <span className="intro__num" aria-hidden>
              {i + 1}
            </span>
            <strong className="intro__title">{t(`guide.intro.steps.${fr.key}`)}</strong>
          </li>
        ))}
      </ol>
    </Modal>
  );
}
