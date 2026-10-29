// Переводы: русский (основной — язык работы клиник), казахский (обещан в питче), английский.
// Ключи проверяются TypeScript: нет строки в словаре — приложение не соберётся.

import type { Locale } from '../data/models';

export interface PluralForms {
  one: string;
  few?: string;
  many?: string;
  other: string;
}

type Leaf = string | PluralForms;
export interface Dictionary {
  [key: string]: Leaf | Dictionary;
}

/** Все пути к строкам словаря: 'nav.patients', 'session.phase.recording'… */
export type KeyPaths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : T[K] extends PluralForms
      ? `${P}${K}`
      : KeyPaths<T[K], `${P}${K}.`>;
}[keyof T & string];

export const INTL_LOCALE: Record<Locale, string> = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' };

export type Params = Record<string, string | number>;

function lookup(dict: Dictionary, key: string): Leaf | undefined {
  let node: Leaf | Dictionary | undefined = dict;
  for (const part of key.split('.')) {
    if (!node || typeof node === 'string' || isPlural(node)) return undefined;
    node = (node as Dictionary)[part];
  }
  return node as Leaf | undefined;
}

function isPlural(x: unknown): x is PluralForms {
  return typeof x === 'object' && x !== null && 'one' in x && 'other' in x && typeof (x as PluralForms).one === 'string';
}

function interpolate(s: string, params?: Params): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

const pluralRules = new Map<Locale, Intl.PluralRules>();

export function translate(dict: Dictionary, fallback: Dictionary, locale: Locale, key: string, params?: Params): string {
  const leaf = lookup(dict, key) ?? lookup(fallback, key);
  if (leaf === undefined) return key;
  if (typeof leaf === 'string') return interpolate(leaf, params);
  // Множественное число: «1 сеанс», «3 сеанса», «5 сеансов»
  const n = Number(params?.count ?? 0);
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(INTL_LOCALE[locale]);
    pluralRules.set(locale, rules);
  }
  const form = rules.select(n) as keyof PluralForms;
  const s = leaf[form] ?? leaf.other;
  return interpolate(s, params);
}
