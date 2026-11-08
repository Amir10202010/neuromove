// Pictograms for visual activity steps (child and family screens). Decorative: the step text is
// always next to them, so screen readers read the words, not the picture.

import { Armchair, ArrowUpFromLine, Blocks, CupSoda, Hand, HandGrab, HandHelping, Hourglass, Moon, PersonStanding, RotateCw, Star, Volleyball, Wind, type LucideIcon } from 'lucide-react';
import type { StepIcon } from '../../rehab/model';

const ICONS: Record<StepIcon, LucideIcon> = {
  sit: Armchair,
  stand: PersonStanding,
  reach: Hand,
  grasp: HandGrab,
  two_hands: HandHelping,
  lift: ArrowUpFromLine,
  turn: RotateCw,
  hold: Hourglass,
  rest: Moon,
  breathe: Wind,
  cup: CupSoda,
  ball: Volleyball,
  blocks: Blocks,
  star: Star,
};

export function StepIconView({ icon, size = 48 }: { icon: StepIcon; size?: number }) {
  const I = ICONS[icon] ?? Star;
  return <I aria-hidden width={size} height={size} strokeWidth={1.75} />;
}
