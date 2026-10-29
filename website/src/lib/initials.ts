// Буквы для кружка вместо фото: по имени, а не по картинке (фото детей не храним).

/** Инициалы человека: «Врач-реабилитолог» → «В», «А. Сейітова» → «АС». */
export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\s.-]/gu, '').split(/[\s.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'N';
}

/**
 * Буквы для значка пациента: два слова — первые буквы обоих («Алихан С.» → «АС»),
 * одно слово — первые две буквы («Алихан» → «Ал»): у Айши и Амины значки различаются.
 */
export function patientInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${[...(words[0] as string)][0] ?? ''}${[...(words[1] as string)][0] ?? ''}`.toUpperCase();
  const chars = [...(words[0] ?? '')].filter((c) => /[\p{L}\p{N}]/u.test(c));
  if (chars.length === 0) return '?';
  return (chars[0] as string).toUpperCase() + (chars[1] ?? '').toLowerCase();
}
