// Переводы и форматирование чисел и дат для интерфейса.

import { useMemo } from 'react';
import type { Locale } from '../data/models';
import { useAppStore } from '../state/appStore';
import { INTL_LOCALE, translate, type Dictionary, type KeyPaths, type Params } from './core';
import { en } from './en';
import { kk } from './kk';
import { ru } from './ru';

export type Dict = typeof ru;
export type TKey = KeyPaths<Dict>;
export type TFunction = (key: TKey, params?: Params) => string;

const DICTS: Record<Locale, Dictionary> = {
  ru: ru as unknown as Dictionary,
  kk: kk as unknown as Dictionary,
  en: en as unknown as Dictionary,
};

export function makeT(locale: Locale): TFunction {
  const dict = DICTS[locale];
  const fallback = DICTS.ru;
  return (key, params) => translate(dict, fallback, locale, key, params);
}

export interface Formatters {
  /** 26 сентября 2026 */
  date(iso: string | Date): string;
  /** Дата в конце предложения: без точки сокращения «г.», чтобы не вышло «г..». */
  dateEnd(iso: string | Date): string;
  /** 26 сент. */
  dateShort(iso: string | Date): string;
  /** Для таблиц: «26 сент.» в этом году, «26 сент. 2025» — в другом. */
  dateCompact(iso: string | Date): string;
  /** 10:30 */
  time(iso: string | Date): string;
  /** 26 сент., 10:30 */
  dateTime(iso: string | Date): string;
  /** суббота, 26 сентября */
  weekdayDate(iso: string | Date): string;
  /** «3 дня назад», «вчера» */
  relative(iso: string | Date): string;
  /** 131° */
  deg(v: number | null | undefined, digits?: number): string;
  /** +6° / −4° */
  deltaDeg(v: number | null | undefined, digits?: number): string;
  /** 87% */
  pct(v: number | null | undefined, digits?: number): string;
  num(v: number | null | undefined, digits?: number): string;
  /** 08:42 */
  duration(seconds: number): string;
}

// Казахские названия — на случай, если в браузере нет казахской локали Intl
// (так бывает во встроенных браузерах с урезанным набором данных ICU).
const KK_MONTHS = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'];
const KK_MONTHS_SHORT = ['қаң.', 'ақп.', 'нау.', 'сәу.', 'мам.', 'мау.', 'шіл.', 'там.', 'қыр.', 'қаз.', 'қар.', 'жел.'];
const KK_WEEKDAYS = ['жексенбі', 'дүйсенбі', 'сейсенбі', 'сәрсенбі', 'бейсенбі', 'жұма', 'сенбі'];

/**
 * Есть ли в браузере настоящие казахские данные Intl. supportedLocalesOf этого не гарантирует:
 * встроенный браузер отвечает «kk-KZ поддерживается», а форматирует сентябрь как «M09».
 * Поэтому проверяем результат: сентябрь должен называться «қыркүйек».
 */
function kazakhIntlWorks(): boolean {
  try {
    const month = new Intl.DateTimeFormat(INTL_LOCALE.kk, { month: 'long' }).format(new Date(2026, 8, 1));
    return month.toLowerCase().includes('қыркүйек');
  } catch {
    return false;
  }
}

export function makeFormatters(locale: Locale): Formatters {
  const base = makeIntlFormatters(locale);
  if (locale !== 'kk' || kazakhIntlWorks()) return base;
  // Запасной вариант для казахского: свои названия месяцев, числа — по русским правилам
  const ruNumbers = makeIntlFormatters('ru');
  const d = (x: string | Date) => (typeof x === 'string' ? new Date(x) : x);
  const hm = (x: Date) => `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
  const date = (x: string | Date) => {
    const t = d(x);
    return `${t.getDate()} ${KK_MONTHS[t.getMonth()]} ${t.getFullYear()} ж.`;
  };
  const short = (x: string | Date) => {
    const t = d(x);
    return `${t.getDate()} ${KK_MONTHS_SHORT[t.getMonth()]}`;
  };
  return {
    ...ruNumbers,
    date,
    dateEnd: (x) => date(x).replace(/\.$/, ''),
    dateShort: short,
    dateCompact: (x) => (d(x).getFullYear() === new Date().getFullYear() ? short(x) : `${short(x)} ${d(x).getFullYear()}`),
    time: (x) => hm(d(x)),
    dateTime: (x) => `${short(x)}, ${hm(d(x))}`,
    weekdayDate: (x) => {
      const t = d(x);
      const w = KK_WEEKDAYS[t.getDay()] as string;
      return `${w.charAt(0).toUpperCase()}${w.slice(1)}, ${t.getDate()} ${KK_MONTHS[t.getMonth()]}`;
    },
    relative: (x) => {
      const now = new Date();
      const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const t = d(x);
      const b = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
      const days = Math.round((b - a) / 86400000);
      if (days === 0) return 'бүгін';
      if (days === -1) return 'кеше';
      if (days === 1) return 'ертең';
      const n = Math.abs(days);
      // Окончание — у слова «күн / апта / ай», а не у числа: так оно всегда верное
      if (days < 0) return n < 7 ? `${n} күн бұрын` : n < 31 ? `${Math.round(n / 7)} апта бұрын` : `${Math.round(n / 30)} ай бұрын`;
      return n < 7 ? `${n} күннен кейін` : n < 31 ? `${Math.round(n / 7)} аптадан кейін` : `${Math.round(n / 30)} айдан кейін`;
    },
  };
}

function makeIntlFormatters(locale: Locale): Formatters {
  const L = INTL_LOCALE[locale];
  const dFull = new Intl.DateTimeFormat(L, { day: 'numeric', month: 'long', year: 'numeric' });
  const dShort = new Intl.DateTimeFormat(L, { day: 'numeric', month: 'short' });
  const dShortY = new Intl.DateTimeFormat(L, { day: 'numeric', month: 'short', year: 'numeric' });
  const tm = new Intl.DateTimeFormat(L, { hour: '2-digit', minute: '2-digit' });
  const dt = new Intl.DateTimeFormat(L, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const wd = new Intl.DateTimeFormat(L, { weekday: 'long', day: 'numeric', month: 'long' });
  const rel = new Intl.RelativeTimeFormat(L, { numeric: 'auto' });
  const nf = new Map<number, Intl.NumberFormat>();
  const numFmt = (digits: number) => {
    let f = nf.get(digits);
    if (!f) {
      f = new Intl.NumberFormat(L, { minimumFractionDigits: digits, maximumFractionDigits: digits });
      nf.set(digits, f);
    }
    return f;
  };
  const d = (x: string | Date) => (typeof x === 'string' ? new Date(x) : x);
  const ok = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);
  // Настоящий минус «−», а не дефис: так пишут в медицинских отчётах
  const sign = (s: string) => s.replace('-', '−');

  return {
    date: (x) => dFull.format(d(x)),
    dateEnd: (x) => dFull.format(d(x)).replace(/\.$/, ''),
    dateShort: (x) => dShort.format(d(x)),
    dateCompact: (x) => (d(x).getFullYear() === new Date().getFullYear() ? dShort.format(d(x)) : dShortY.format(d(x))),
    time: (x) => tm.format(d(x)),
    dateTime: (x) => dt.format(d(x)),
    weekdayDate: (x) => {
      const s = wd.format(d(x));
      return s.charAt(0).toUpperCase() + s.slice(1);
    },
    relative: (x) => {
      const now = new Date();
      const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const t = d(x);
      const b = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
      const days = Math.round((b - a) / 86400000);
      if (Math.abs(days) < 7) return rel.format(days, 'day');
      if (Math.abs(days) < 31) return rel.format(Math.round(days / 7), 'week');
      return rel.format(Math.round(days / 30), 'month');
    },
    deg: (v, digits = 0) => (ok(v) ? `${sign(numFmt(digits).format(v))}°` : '–'),
    deltaDeg: (v, digits = 0) => {
      if (!ok(v)) return '–';
      const r = Number(v.toFixed(digits));
      if (r === 0) return `±0°`;
      return `${r > 0 ? '+' : '−'}${numFmt(digits).format(Math.abs(r))}°`;
    },
    pct: (v, digits = 0) => (ok(v) ? `${numFmt(digits).format(v)}%` : '–'),
    num: (v, digits = 0) => (ok(v) ? sign(numFmt(digits).format(v)) : '–'),
    duration: (seconds) => {
      const s = Math.max(0, Math.round(seconds));
      const m = Math.floor(s / 60);
      return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    },
  };
}

export interface I18n {
  t: TFunction;
  f: Formatters;
  locale: Locale;
}

export function useI18n(): I18n {
  const locale = useAppStore((s) => s.settings.locale);
  return useMemo(() => ({ t: makeT(locale), f: makeFormatters(locale), locale }), [locale]);
}
