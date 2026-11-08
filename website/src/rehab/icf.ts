// ICF-CY tagging (WHO International Classification of Functioning, Disability and Health — Children and
// Youth version, 2007; merged into ICF in 2012). Tags make the level of each piece of information visible:
//   b = body functions (e.g. joint mobility — what the IMU measures)
//   d = activities and participation (e.g. hand and arm use — what goals and GAS/COPM are about)
//   s = body structures, e = environmental factors (not used by NeuroMove today)
//
// The catalogue holds only the category codes and their official short titles used here. Suggestions
// from a goal category are SUGGESTIONS: the professional confirms or changes them. NeuroMove never
// infers an ICF qualifier (severity) — those are clinical judgements and are not recorded.

import type { GoalCategory, InstrumentId } from './model';
import type { MetricId } from './movement';

export type IcfComponent = 'b' | 's' | 'd' | 'e';

export interface IcfCategory {
  code: string;
  component: IcfComponent;
  /** Official English short title of the category. */
  title: string;
}

export const ICF_CATALOG: IcfCategory[] = [
  { code: 'b710', component: 'b', title: 'Mobility of joint functions' },
  { code: 'b735', component: 'b', title: 'Muscle tone functions' },
  { code: 'b755', component: 'b', title: 'Involuntary movement reaction functions' },
  { code: 'b760', component: 'b', title: 'Control of voluntary movement functions' },
  { code: 'd410', component: 'd', title: 'Changing basic body position' },
  { code: 'd415', component: 'd', title: 'Maintaining a body position' },
  { code: 'd430', component: 'd', title: 'Lifting and carrying objects' },
  { code: 'd440', component: 'd', title: 'Fine hand use' },
  { code: 'd445', component: 'd', title: 'Hand and arm use' },
  { code: 'd450', component: 'd', title: 'Walking' },
  { code: 'd460', component: 'd', title: 'Moving around in different locations' },
  { code: 'd520', component: 'd', title: 'Caring for body parts' },
  { code: 'd540', component: 'd', title: 'Dressing' },
  { code: 'd550', component: 'd', title: 'Eating' },
  { code: 'd560', component: 'd', title: 'Drinking' },
  { code: 'd820', component: 'd', title: 'School education' },
  { code: 'd880', component: 'd', title: 'Engagement in play' },
];

export const ICF_CODES = ICF_CATALOG.map((c) => c.code);
const BY_CODE = new Map(ICF_CATALOG.map((c) => [c.code, c]));
export const icfCategory = (code: string): IcfCategory | undefined => BY_CODE.get(code);

/** Suggested categories per goal category (the professional confirms). */
export const GOAL_ICF_SUGGESTIONS: Record<GoalCategory, string[]> = {
  reaching: ['d445'],
  object_manipulation: ['d440', 'd445'],
  bilateral_hand_use: ['d440', 'd445'],
  maintaining_position: ['d415'],
  movement_coordination: ['b760'],
  functional_mobility: ['d450', 'd460'],
  balance: ['d415', 'b755'],
  daily_activity: ['d540', 'd550', 'd560'],
  other: [],
};

/** IMU-derived metrics are body-function descriptors: never an activity or participation outcome. */
export const METRIC_ICF: Record<MetricId, string> = {
  rom: 'b710',
  min_angle: 'b710',
  excursion: 'b710',
  peak_velocity: 'b760',
  rep_duration: 'b760',
  time_to_peak: 'b760',
  sparc: 'b760',
  rom_cv: 'b760',
  rom_sd: 'b760',
  rep_interval_cv: 'b760',
  trunk: 'b760',
  rep_count: 'b760',
};

/** ICF component an instrument mainly addresses ('goal' = the components of the goals it scores). */
export const INSTRUMENT_ICF: Record<InstrumentId, IcfComponent | 'goal' | null> = {
  gas: 'goal',
  copm: 'd',
  gmfm66: 'd',
  gmfm88: 'd',
  other: null,
};

/** Tags of a goal: what the professional confirmed, else the suggestion for its category (marked as such). */
export function goalIcf(g: { category: GoalCategory; icf?: string[] }): { codes: string[]; confirmed: boolean } {
  return g.icf && g.icf.length ? { codes: g.icf, confirmed: true } : { codes: GOAL_ICF_SUGGESTIONS[g.category], confirmed: false };
}
