// Кто на рисунках: мальчик или девочка — по полу пациента на открытом экране.
// Экран пациента, сеанса и отчёта оборачивает содержимое в <FigureLook sex={…}>; там, где пациента
// нет (датчики, знакомство, пустые состояния), — мальчик, как в рисунках по умолчанию.

import { createContext, useContext, type ReactNode } from 'react';
import type { Sex } from '../data/models';

export type Look = 'boy' | 'girl';

const LookContext = createContext<Look>('boy');

export function FigureLook({ sex, children }: { sex: Sex | null | undefined; children: ReactNode }) {
  return <LookContext.Provider value={sex === 'female' ? 'girl' : 'boy'}>{children}</LookContext.Provider>;
}

export const useLook = () => useContext(LookContext);
