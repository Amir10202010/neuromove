// Entry card for the motor-learning lab on the Research home page. Deliberately tiny: it lives in the main bundle,
// so it must not import the lab's dictionaries or engine (they load with the lab's own chunk).

import { Network } from 'lucide-react';
import { href } from '../../app/router';
import { useAppStore } from '../../state/appStore';
import { LinkButton } from '../../ui/Button';

const TEXT = {
  en: { title: 'Motor learning lab', lead: 'Learning trajectories, model comparison, uncertainty, performance vs learning.', open: 'Open' },
  ru: { title: 'Лаборатория двигательного научения', lead: 'Траектории научения, сравнение моделей, неопределённость, выполнение и научение.', open: 'Открыть' },
  kk: { title: 'Қозғалысты үйрену зертханасы', lead: 'Үйрену траекториялары, модельдерді салыстыру, белгісіздік, орындау және үйрену.', open: 'Ашу' },
} as const;

export function LabEntry() {
  const locale = useAppStore((s) => s.settings.locale);
  const t = TEXT[locale] ?? TEXT.ru;
  return (
    <section className="card card__body mlrow">
      <Network aria-hidden />
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <strong>{t.title}</strong>
        <p className="mlmuted">{t.lead}</p>
      </div>
      <LinkButton href={href({ name: 'labOverview' })}>{t.open}</LinkButton>
    </section>
  );
}
