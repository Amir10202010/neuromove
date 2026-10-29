// Главное словами: те же цифры, что на карточке пациента, слова — по порогам,
// разница в простом виде — по показанным числам. Проверка на настоящем демо:
// история курса сгенерирована теми же алгоритмами, что и живой тест.

import { describe, expect, it } from 'vitest';
import { generateDemoWorkspace } from '../data/seed/demo';
import type { Patient, Session } from '../data/models';
import { makeT } from '../i18n';
import { isPlateau } from './alerts';
import { courseStory, patientTrend, sessionStory, shownDelta, shownTrend, trendOf } from './story';
import { patientSessions } from './compare';

describe('пороги и округление', () => {
  it('разница по показанным числам: 126.6 → 146.4 — это +19, а не +20', () => {
    expect(shownDelta(146.4, 126.6)).toBe(19);
    expect(Math.round(146.4 - 126.6)).toBe(20);
  });

  it('слово по показанным числам: «9° · было 11°» — это «меньше»', () => {
    expect(trendOf(9.45, 11.4, 2)).toBe('same');
    expect(shownTrend(9.45, 11.4, 2)).toBe('down');
  });

  it('меньше порога — «без изменений», нет данных — нет слова', () => {
    expect(trendOf(141, 139, 3)).toBe('same');
    expect(trendOf(143, 139, 3)).toBe('up');
    expect(trendOf(null, 139, 3)).toBeNull();
  });
});

describe('плато — одно правило для наблюдений и списка «как идут дела»', () => {
  it('4 замера в пределах 6° без тренда — плато', () => {
    expect(isPlateau([130, 133, 129, 132])).toBe(true);
  });
  it('ровный рост на 2° за сеанс — не плато, хотя размах всего 6°', () => {
    expect(isPlateau([126, 128, 130, 132])).toBe(false);
  });
  it('меньше 4 замеров — не плато', () => {
    expect(isPlateau([130, 131, 130])).toBe(false);
  });
});

describe('главное о курсе и о сеансе — на демо-данных', async () => {
  const data = await generateDemoWorkspace({ now: new Date('2026-09-26T12:00:00'), t: makeT('ru'), clinician: 'Тест' });
  // Дети демо — по внутреннему ключу P01–P06: на экране у них имена (Алихан, …), числа от имени не зависят
  const patient = (key: string) => data.patients.find((p) => p.demoProfile === key) as Patient;
  const last = (p: Patient) => patientSessions(data.sessions, p.id).at(-1) as Session;

  it('дети демо названы по именам, а не кодами P01–P06', () => {
    expect(patient('P01').code).toBe('Алихан');
    expect(data.patients.every((p) => !/^P\d+$/.test(p.code))).toBe(true);
  });

  it('P01: рука поднимается выше, симметрия выше, корпус помогает меньше, цель врача — 150°', () => {
    const s = courseStory(data.sessions, patient('P01'));
    expect(s).not.toBeNull();
    expect(s!.side).toBe('right');
    expect(s!.sessions).toBe(9);
    expect(shownDelta(s!.last, s!.first)).toBeGreaterThanOrEqual(3);
    expect(s!.symNow!).toBeGreaterThan(s!.symWas!);
    expect(s!.trunkNow!).toBeLessThan(s!.trunkWas!);
    expect(s!.goal?.target).toBe(150);
  });

  it('P01: картинка «правая и левая» — те же две руки, из которых посчитана симметрия', () => {
    const s = courseStory(data.sessions, patient('P01'))!;
    expect(s.pairNow).not.toBeNull();
    // Поражена правая: левая поднимается выше, симметрия = правая / левая
    expect(s.pairNow!.other).toBeGreaterThan(s.pairNow!.main);
    expect((s.pairNow!.main / s.pairNow!.other) * 100).toBeCloseTo(s.symNow!, 6);
  });

  it('один сеанс (P05) или ни одного (P06) — сравнивать не с чем', () => {
    expect(courseStory(data.sessions, patient('P05'))).toBeNull();
    expect(courseStory(data.sessions, patient('P06'))).toBeNull();
  });

  it('сеанс P01: главная строка — подъём вперёд правой рукой, левая выше, есть прошлый сеанс', () => {
    const st = sessionStory(data.sessions, last(patient('P01')), patient('P01'));
    expect(st.lead?.exercise).toBe('shoulder_flexion');
    expect(st.lead!.main).not.toBeNull();
    expect(st.lead!.other!).toBeGreaterThan(st.lead!.main!);
    expect(st.lead!.prev).not.toBeNull();
    // Стандартная оценка — все четыре движения
    expect(st.rows.map((r) => r.exercise)).toEqual(['shoulder_flexion', 'shoulder_abduction', 'elbow_flexion', 'forearm_rotation']);
    // Для картинки поворота — супинация и пронация каждой рукой по отдельности
    const rot = st.rows.find((r) => r.exercise === 'forearm_rotation')!;
    expect(rot.split.main?.sup).toBeGreaterThan(0);
    expect(rot.split.main?.pro).toBeGreaterThan(0);
  });

  it('первый сеанс (P05): прошлого замера нет ни у одного движения; поражена левая рука', () => {
    const p = patient('P05');
    const st = sessionStory(data.sessions, last(p), p);
    expect(st.side).toBe('left');
    expect(st.rows.length).toBeGreaterThan(0);
    for (const r of st.rows) expect(r.prev).toBeNull();
  });

  it('как идут дела: у P01 рост за курс, у P04 откат к прошлому сеансу, у P05 один замер, у P06 ни одного', () => {
    const p01 = patientTrend(data.sessions, patient('P01'));
    expect(p01.course!).toBeGreaterThanOrEqual(3);
    const p04 = patientTrend(data.sessions, patient('P04'));
    expect(p04.drop!).toBeLessThanOrEqual(-10);
    const p05 = patientTrend(data.sessions, patient('P05'));
    expect(p05.count).toBe(1);
    expect(p05.course).toBeNull();
    expect(patientTrend(data.sessions, patient('P06')).count).toBe(0);
  });

  it('P03: пометка «плечо не было прижато» попадает в простой вид', () => {
    const p = patient('P03');
    const flags = sessionStory(data.sessions, last(p), p).rows.flatMap((r) => r.flags.map((f) => f.flag));
    expect(flags).toContain('upper_not_pinned');
  });
});
