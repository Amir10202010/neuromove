// Текст по словам — фраза «Сегодня» темнеет слово за словом вместе с прокруткой, как текст
// на страницах Apple. «Слова из-под шторки» у заголовков (MaskWords) убраны 18 октября:
// у Apple заголовок появляется целиком — подъём и прозрачность (landing.css, «Появление»).
// Экранный диктор слышит фразу целиком: разбитая копия скрыта от него (aria-hidden),
// а рядом лежит обычный текст для чтения (sr-only).

import type { CSSProperties } from 'react';

/** CSS-переменные в style: { '--i': 3 } — TypeScript не знает их имён заранее. */
export function vars(v: Record<string, string | number>): CSSProperties {
  return v as CSSProperties;
}

/**
 * Абзац, который «проявляется» при прокрутке: слова светлеют одно за другим по мере
 * того, как растёт --p у родителя (0 → 1). Каждое слово знает свой номер --i из --n.
 */
export function ScrollWords({ text }: { text: string }) {
  const words = text.split(' ');
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden style={vars({ '--n': words.length })}>
        {words.map((w, i) => (
          <span key={i} className="lp-w" style={vars({ '--i': i })}>
            {w}
            {i < words.length - 1 ? ' ' : ''}
          </span>
        ))}
      </span>
    </>
  );
}
