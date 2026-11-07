import type { FaceObs, ManObs, Role, RosterObs } from '../obs/crew';
import { Rng } from './rng';

/**
 * The crew (chunk 5.1): 44 men drawn up for the boat from her seed when she is put to sea.
 * Each has a role and a post, a rank, a watch section (or day work), one skill value, fatigue
 * and morale, a home town and trade, patrols behind him and a few lines of history, and what
 * the photographer saw for his card. Fatigue and morale are held here; watches (5.2) and the
 * patrol's events move them later.
 */

export interface Man {
  id: number;
  first: string;
  last: string;
  rank: number;
  role: Role;
  post: string;
  section: 0 | 1 | 2 | null;
  skill: number;
  fatigue: number;
  morale: number;
  born: number;
  home: string;
  trade: string;
  patrols: number;
  line: string;
  story: string[];
  face: FaceObs;
}

export interface CrewState {
  men: Man[];
  /** Bumped on any change (the roster is published again). */
  rev: number;
}

/** Rating ranks, senior first; officers have their own. */
const RANKS = [
  ['CHIEF PETTY OFFICER', 'CPO'],
  ['PETTY OFFICER', 'PO'],
  ['LEADING SEAMAN', 'LDG'],
  ['ABLE SEAMAN', 'AB'],
  ['ORDINARY SEAMAN', 'OS'],
] as const;
const CPO = 0, PO = 1, LDG = 2, AB = 3, OS = 4;
/** Officers' ranks sit before the ratings' (rank index 10.. in Man.rank). */
const OFFICER_RANKS = [
  ['LIEUTENANT', 'LT'],
  ['SUB-LIEUTENANT', 'SUB-LT'],
  ['ENGINEER LIEUTENANT', 'ENG-LT'],
] as const;

/** The boat's complement: role, rank, post; 44 in all. */
const BILLETS: [Role, number, string][] = [
  ['officer', 10, 'FIRST OFFICER'],
  ['officer', 11, 'SECOND OFFICER'],
  ['officer', 12, 'CHIEF ENGINEER'],
  ['officer', CPO, 'NAVIGATOR'],
  ['helmsman', CPO, 'COXSWAIN'],
  ['helmsman', PO, 'HELMSMAN'],
  ['helmsman', PO, 'PLANESMAN'],
  ['helmsman', LDG, 'HELMSMAN'],
  ['helmsman', LDG, 'PLANESMAN'],
  ['helmsman', AB, 'LOOKOUT'],
  ['helmsman', AB, 'LOOKOUT'],
  ['helmsman', AB, 'PLANESMAN'],
  ['helmsman', OS, 'LOOKOUT'],
  ['sound', PO, 'SOUND MAN'],
  ['sound', AB, 'SOUND MAN'],
  ['radio', PO, 'RADIOMAN AND SICK BAY'],
  ['radio', LDG, 'RADIOMAN'],
  ['torpedo', CPO, 'TORPEDO CHIEF'],
  ['torpedo', PO, 'TORPEDO MATE'],
  ['torpedo', PO, 'TORPEDO MATE'],
  ['torpedo', LDG, 'TORPEDO HAND'],
  ['torpedo', LDG, 'TORPEDO HAND'],
  ['torpedo', AB, 'TORPEDO HAND'],
  ['torpedo', AB, 'TORPEDO HAND'],
  ['torpedo', AB, 'TORPEDO HAND'],
  ['torpedo', OS, 'TORPEDO HAND'],
  ['torpedo', OS, 'TORPEDO HAND'],
  ['machinist', CPO, 'DIESEL CHIEF'],
  ['machinist', PO, 'MACHINIST'],
  ['machinist', PO, 'MACHINIST'],
  ['machinist', LDG, 'STOKER'],
  ['machinist', LDG, 'STOKER'],
  ['machinist', AB, 'STOKER'],
  ['machinist', AB, 'STOKER'],
  ['machinist', AB, 'STOKER'],
  ['machinist', OS, 'STOKER'],
  ['machinist', OS, 'STOKER'],
  ['electrician', PO, 'MOTOR CHIEF'],
  ['electrician', PO, 'ELECTRICIAN'],
  ['electrician', LDG, 'ELECTRICIAN'],
  ['electrician', AB, 'ELECTRICIAN'],
  ['electrician', AB, 'ELECTRICIAN'],
  ['electrician', OS, 'ELECTRICIAN'],
  ['cook', LDG, 'COOK'],
];
export const COMPLEMENT = BILLETS.length;

const FIRST = [
  'KARL', 'OTTO', 'EMIL', 'FRITZ', 'HEINZ', 'WILLI', 'ERNST', 'KURT', 'PAUL', 'WALTER', 'BRUNO', 'HANS', 'RUDI', 'GUSTAV',
  'ALFRED', 'ERICH', 'HERBERT', 'GERHARD', 'HELMUT', 'KLAUS', 'AUGUST', 'ANTON', 'EWALD', 'JOSEF', 'FRANZ', 'LUDWIG', 'MAX',
  'OSKAR', 'ROLF', 'ARNO', 'EDGAR', 'HUGO', 'THEO', 'KONRAD', 'BERND', 'ERWIN', 'GUENTER', 'HORST', 'ALBERT', 'EGON', 'ARTUR',
  'LOTHAR', 'RICHARD', 'VIKTOR', 'WILHELM', 'EBERHARD', 'DIETER', 'ULRICH', 'GEORG', 'MARTIN',
];
const PRE = [
  'BRAND', 'HOLL', 'KESS', 'LANG', 'MOHR', 'RIEM', 'SCHAR', 'STECK', 'TRAUT', 'WEND', 'ALB', 'BOEH', 'DORN', 'FALK', 'GERL',
  'HASS', 'KNAPP', 'LOEB', 'NEID', 'PFAL', 'RASCH', 'SEEB', 'THAL', 'URB', 'VOSS', 'ZELL', 'HARM', 'KRAH', 'BEHR', 'LUEB',
  'MERK', 'OST', 'PRELL', 'ROHL', 'SCHLEP', 'TESS', 'WOLL', 'BRECK', 'FROHN', 'GRAB',
];
const SUF = ['ER', 'MANN', 'KE', 'LING', 'HOLD', 'ECK', 'ING', 'OW', 'BERG', 'FELD', 'HAGEN', 'STEIN', 'RICH', 'WALD', 'ERT', 'EL', 'KAMP', 'ROTH', 'SEN', 'HORST'];
/** Names that are taken: real wartime figures and the characters of films and games about boats like this one. */
const TAKEN = new Set([
  'HESS', 'BORMANN', 'DOENITZ', 'PRIEN', 'KRETSCHMER', 'SCHEPKE', 'LUETH', 'TOPP', 'HIMMLER', 'HEYDRICH', 'KEITEL', 'RAEDER',
  'THOMSEN', 'WERNER', 'ULLMANN', 'PILGRIM', 'HINRICH', 'KRIECHBAUM', 'FRENSSEN', 'SCHWALLE', 'DUFTE', 'HACKER', 'BOCKSTIEGEL',
  'LAMPRECHT', 'HASSER', 'LANGER', 'VOSSER', 'LANGSDORFF',
]);

/** Home towns (invented): where they are, which trades they give the navy. */
const TOWNS: [name: string, kind: 'port' | 'city' | 'works' | 'farm'][] = [
  ['HARNSTEDT', 'port'], ['ELMHAFEN', 'port'], ['BRAKMUNDE', 'port'], ['RIEMSHAFEN', 'port'], ['OSTERWICK', 'port'],
  ['KOLBRUECK', 'city'], ['HOLMSTADT', 'city'], ['KESSELBURG', 'city'],
  ['NEUSTALL', 'works'], ['GRONFELD', 'works'], ['WENDBERG', 'works'],
  ['DORNAU', 'farm'], ['SALLMOOR', 'farm'], ['TANNRODE', 'farm'], ['VARNHEIDE', 'farm'], ['ALTMARSCH', 'farm'], ['ILMSHEIDE', 'farm'], ['MARRENDORF', 'farm'],
];

const TRADES: Record<'port' | 'city' | 'works' | 'farm', string[]> = {
  port: ['FISHERMAN', 'DOCKER', 'SHIPWRIGHT', 'NET MENDER', 'FERRYMAN', 'LIGHTERMAN', 'RIGGER'],
  city: ['CLERK', 'TRAM DRIVER', 'WAITER', 'POSTMAN', 'PRINTER', 'BAKER', 'STUDENT', 'SHOP BOY'],
  works: ['FITTER', 'TURNER', 'MINER', 'WELDER', 'FOUNDRY HAND', 'LINESMAN'],
  farm: ['FARMHAND', 'MILLER', 'CARPENTER', 'BUTCHER', 'SMITH', 'CARTER'],
};
/** What each role likes to have done before. */
const ROLE_TRADES: Partial<Record<Role, string[]>> = {
  machinist: ['FITTER', 'TURNER', 'MOTOR MECHANIC', 'TRACTOR MECHANIC', 'BOILERMAN', 'LOCO FITTER'],
  electrician: ['LINESMAN', 'ELECTRICIAN', 'WIRELESS REPAIRMAN', 'TRAM FITTER'],
  radio: ['WIRELESS REPAIRMAN', 'TELEGRAPH CLERK', 'POSTMAN', 'STUDENT'],
  sound: ['PIANO TUNER', 'CHOIRBOY', 'ORGAN BUILDER', 'TELEPHONIST', 'STUDENT'],
  cook: ['BAKER', 'BUTCHER', 'HOTEL COOK', 'SHIP COOK'],
};

/** Home: [text, youngest age it fits]. */
const FAMILY: [string, number][] = [
  ['MARRIED, TWO DAUGHTERS.', 25], ['MARRIED LAST LEAVE.', 20], ['ENGAGED TO A NURSE IN {PORT}.', 19], ['WRITES TO HIS MOTHER EVERY WEEK.', 0],
  ['ELDEST OF SIX.', 0], ['HIS FATHER WAS LOST AT SEA.', 0], ['A WIFE AND A SON HE HAS NOT SEEN.', 21], ['HIS BROTHER IS WITH THE ARMY.', 0],
  ['NO ONE AT HOME BUT AN AUNT.', 0], ['A GIRL IN EVERY PORT, HE SAYS.', 19], ['MARRIED, ONE BOY.', 23], ['HIS TWIN IS IN THE AIR FORCE.', 0],
  ['SENDS HIS PAY HOME TO THE FARM.', 0], ['WIDOWER. A DAUGHTER WITH HIS SISTER.', 27], ['YOUNGEST OF FOUR BROTHERS, ALL AT SEA.', 0],
];
const HABITS = [
  'PLAYS THE MOUTH ORGAN.', 'KEEPS THE GRAMOPHONE RECORDS.', 'CARVES CHESSMEN FROM BROOM HANDLES.', 'WILL NOT HEAR ANYONE WHISTLE ABOARD.',
  'NEVER LOSES AT CARDS.', 'SNORES. EVERYONE SAYS SO.', 'SEASICK FOR TWO DAYS EVERY PATROL.', 'READS COWBOY STORIES TO PIECES.',
  'CUTS HAIR FOR CIGARETTES.', 'COLLECTS PICTURE POSTCARDS.', 'SINGS WHERE THE DIESELS DROWN HIM OUT.', 'WON A SWIMMING CUP BEFORE THE WAR.',
  'KEEPS A LUCKY COIN IN HIS BOOT.', 'DRAWS CARTOONS OF THE OFFICERS.', 'TALKS IN HIS SLEEP.', 'CAN SPLICE ANYTHING.',
  'FEEDS THE BOAT ON A BET.', 'HAS READ THE SAME NOVEL FOUR TIMES.', 'GROWS CRESS ON A WET RAG.', 'CANNOT SWIM.',
];
/** The first officer's word on him, by skill. */
const NOTE_HI = ['STEADY UNDER CHARGES.', 'THE BEST HANDS ABOARD FOR THE JOB.', 'NEEDS NO TELLING.', 'COOL. THE MEN LOOK TO HIM.'];
const NOTE_MID = ['DOES WHAT IS ASKED.', 'RELIABLE ON WATCH.', 'GOOD, WHEN HE IS AWAKE.', 'CAREFUL. NOT QUICK.'];
const NOTE_LO = ['STILL LEARNING THE BOAT.', 'SLOW, BUT HE TRIES.', 'KEEP AN EYE ON HIM.', 'GREEN AS GRASS.'];

/** Skill and age by rank (officers by post). */
const SKILL: Record<number, [number, number]> = { [CPO]: [0.72, 0.95], [PO]: [0.58, 0.85], [LDG]: [0.45, 0.72], [AB]: [0.3, 0.6], [OS]: [0.12, 0.38], 10: [0.6, 0.88], 11: [0.42, 0.7], 12: [0.7, 0.95] };
const AGE: Record<number, [number, number]> = { [CPO]: [27, 36], [PO]: [23, 30], [LDG]: [21, 26], [AB]: [19, 23], [OS]: [18, 20], 10: [24, 28], 11: [21, 24], 12: [27, 34] };

const between = (r: Rng, [a, b]: [number, number]) => a + r.next() * (b - a);
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r.next() * xs.length)];
const ORD = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH', 'NINTH', 'TENTH', 'ELEVENTH', 'TWELFTH'];
const NUM = ['NO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE'];

/** Roster line width budget, art px in the Plate face (the face card takes the rest of the row). */
const LINE_W = 110;
/** Width in the Plate face (src/core/font.ts): narrow I T Y 1 and space, wide M W, dots and commas thin. */
const plateW = (t: string) => [...t].reduce((w, ch) => w + ('ITY1 '.includes(ch) ? 4 : 'MW%'.includes(ch) ? 6 : '.,:\'!'.includes(ch) ? 2 : 5), -1);

/** Draw up the crew for a boat put to sea on `dateMs`. */
export function newCrew(seed: number, dateMs: number): CrewState {
  const r = new Rng((seed ^ 0x6a09e667) >>> 0 || 29);
  const year = new Date(dateMs).getUTCFullYear();
  // Patrols a man can have behind him by now: the war began in the autumn of 1939.
  const warYears = Math.max(0, year - 1939 + new Date(dateMs).getUTCMonth() / 12 - 0.7);
  const maxPatrols = Math.max(1, Math.round(warYears * 2.5) + 1);
  const used = new Set<string>();
  const firsts = new Map<string, number>();
  const sec = { n: 0 };
  const port = TOWNS[0][0];
  const men: Man[] = BILLETS.map(([role, rank, post], id) => {
    const officer = rank >= 10 || post === 'NAVIGATOR';
    let last = '';
    for (let k = 0; k < 40 && (!last || used.has(last) || TAKEN.has(last) || /(.)\1\1/.test(last)); k++) last = pick(r, PRE) + pick(r, SUF);
    used.add(last);
    let first = pick(r, FIRST);
    // Not too many of one name: a third Karl becomes someone else.
    while ((firsts.get(first) ?? 0) >= 2) first = pick(r, FIRST);
    firsts.set(first, (firsts.get(first) ?? 0) + 1);
    const ageR = post === 'NAVIGATOR' ? ([30, 38] as [number, number]) : role === 'cook' ? ([22, 40] as [number, number]) : AGE[rank];
    const age = Math.round(between(r, ageR));
    const [home, kind] = pick(r, TOWNS);
    const own = ROLE_TRADES[role];
    const trade = officer && rank >= 10 ? 'CADET' : own && r.next() < 0.65 ? pick(r, own) : pick(r, TRADES[kind]);
    const green = rank === OS;
    // Patrols behind him: no more than the war and his years at sea allow (he joined at seventeen or so).
    const cap = officer ? maxPatrols : Math.min(maxPatrols, Math.max(1, Math.round((age - 18) * 2) + 1));
    const patrols = green ? 0 : Math.min(cap, Math.max(1, Math.round(between(r, [rank === CPO || rank === 12 ? 0.5 : 0.15, 1]) * maxPatrols * (officer ? 0.8 : 1))));
    let skill = between(r, SKILL[post === 'NAVIGATOR' ? CPO : rank]);
    skill = Math.min(0.97, skill + Math.min(0.08, patrols * 0.01));
    // Watches: the chief engineer and the cook are day men; the rest stand one of three.
    let section: 0 | 1 | 2 | null;
    if (post === 'CHIEF ENGINEER' || role === 'cook') section = null;
    else if (post === 'FIRST OFFICER') section = 0;
    else if (post === 'SECOND OFFICER') section = 1;
    else if (post === 'NAVIGATOR') section = 2;
    else section = (sec.n++ % 3) as 0 | 1 | 2;
    const face: FaceObs = {
      seed: Math.floor(r.next() * 2 ** 31),
      age,
      hat: officer && rank >= 10 ? 'peaked' : post === 'NAVIGATOR' || rank === CPO ? (r.next() < 0.6 ? 'peaked' : 'side') : role === 'cook' ? 'none' : pick(r, ['none', 'none', 'side', 'knit', 'knit'] as const),
      kit: role === 'cook' ? 'whites' : officer ? 'jacket' : role === 'machinist' || role === 'electrician' ? (r.next() < 0.7 ? 'leather' : 'sweater') : pick(r, ['sweater', 'sweater', 'jacket'] as const),
      hair: age > 33 && r.next() < 0.5 ? 3 : (pick(r, [0, 1, 1, 1, 2, 2] as const) as 0 | 1 | 2),
      glasses: (role === 'radio' || post === 'NAVIGATOR' || role === 'officer') && r.next() < 0.3 ? true : r.next() < 0.05,
    };
    const m: Man = {
      id, first, last, rank, role, post, section, skill,
      fatigue: between(r, [0.02, 0.15]),
      morale: between(r, [0.55, 0.85]),
      born: year - age,
      home, trade, patrols,
      line: '', story: [], face,
    };
    m.line = lineFor(m, r);
    m.story = storyFor(m, r, year, port);
    return m;
  });
  return { men, rev: 1 };
}

/** The one line under his name: where he comes from, or what he was, or how long he has been at it. */
function lineFor(m: Man, r: Rng): string {
  const t = m.trade;
  const options = m.patrols === 0
    ? [`FIRST PATROL. EX-${t}`, `FIRST PATROL. ${m.home}`, `FIRST PATROL`]
    : m.trade === 'CADET'
      ? [`NAVAL COLLEGE. ${nth(m.patrols + 1)} PATROL`, `${nth(m.patrols + 1)} PATROL. ${m.home}`]
      : [`${t}, ${m.home}`, `EX-${t}. ${nth(m.patrols + 1)} PATROL`, `${nth(m.patrols + 1)} PATROL. ${m.home}`];
  const fit = options.filter((o) => plateW(o) <= LINE_W);
  return fit.length ? pick(r, fit) : `EX-${t}`;
}

const a = (t: string) => (/^[AEIOU]/.test(t) ? `AN ${t}` : `A ${t}`);
/** 1ST, 2ND, 3RD, 4TH... */
const nth = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'TH' : (['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH')}`;

function storyFor(m: Man, r: Rng, year: number, port: string): string[] {
  const out: string[] = [];
  const age = year - m.born;
  if (m.trade === 'CADET') out.push(`NAVAL COLLEGE, CLASS OF ${year - Math.max(1, Math.round(age - 19))}.`);
  else if (m.trade === 'SHIP COOK' || m.trade === 'FISHERMAN') out.push(`WENT TO SEA FROM ${m.home} AT FIFTEEN AS ${a(m.trade)}.`);
  else out.push(`WAS ${a(m.trade)} IN ${m.home} BEFORE THE NAVY.`);
  if (m.patrols === 0) out.push(pick(r, ['FIRST PATROL. STRAIGHT FROM THE TRAINING FLOTILLA.', 'FIRST PATROL. CALLED UP LAST YEAR.', 'FIRST PATROL. VOLUNTEERED AT EIGHTEEN.']));
  else if (m.patrols < ORD.length) {
    const boats = m.patrols > 3 && r.next() < 0.5 ? ' ON HIS SECOND BOAT' : '';
    out.push(`HIS ${ORD[m.patrols]} PATROL${boats}.`);
  } else out.push(`${NUM[Math.min(12, m.patrols)]} PATROLS BEHIND HIM. HE STOPPED COUNTING.`);
  out.push(pick(r, FAMILY.filter(([, min]) => age >= min))[0].replace('{PORT}', port));
  out.push(pick(r, HABITS));
  out.push(pick(r, m.skill > 0.72 ? NOTE_HI : m.skill > 0.45 ? NOTE_MID : NOTE_LO));
  return out;
}

/** The roster as published (ages on the date given). */
export function rosterOf(c: CrewState, dateMs: number): RosterObs {
  const year = new Date(dateMs).getUTCFullYear();
  return {
    rev: c.rev,
    men: c.men.map((m): ManObs => {
      const [rank, rankShort] = m.rank >= 10 ? OFFICER_RANKS[m.rank - 10] : RANKS[m.rank];
      return {
        id: m.id,
        short: `${rankShort} ${m.last}`,
        first: m.first,
        last: m.last,
        rank,
        rankShort,
        role: m.role,
        post: m.post,
        section: m.section,
        skill: m.skill,
        fatigue: m.fatigue,
        morale: m.morale,
        born: m.born,
        age: year - m.born,
        home: m.home,
        line: m.line,
        story: [...m.story],
        face: { ...m.face, age: year - m.born },
      };
    }),
  };
}
