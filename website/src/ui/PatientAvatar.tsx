import { patientInitials } from '../lib/initials';

// Значок пациента — буквы имени. Никаких фото: правило приватности (софт.md, раздел 4).
export function PatientAvatar({ name, demo, large }: { name: string; demo?: boolean; large?: boolean }) {
  return (
    <span className={`avatar${large ? ' avatar--lg' : ''}${demo ? ' avatar--demo' : ''}`} aria-hidden>
      {patientInitials(name)}
    </span>
  );
}
