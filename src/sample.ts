/**
 * A synthetic HR dataset, generated in the page on demand.
 *
 * It ships as code rather than as a checked-in CSV for the same reason the rest
 * of this app exists: the demo should not require anyone to hand real people's
 * records to a stranger. It carries a deliberate, layered pay gap so there is
 * something true to find, and a long tail of tiny departments so the
 * k-anonymity suppression has something real to suppress.
 */

const DEPARTMENTS = [
  { name: 'Engineering', weight: 30, base: 128000 },
  { name: 'Sales', weight: 20, base: 96000 },
  { name: 'Marketing', weight: 12, base: 88000 },
  { name: 'Customer Support', weight: 15, base: 62000 },
  { name: 'Finance', weight: 8, base: 105000 },
  { name: 'People Ops', weight: 6, base: 79000 },
  { name: 'Legal', weight: 3, base: 142000 },
  { name: 'Data Science', weight: 4, base: 134000 },
  { name: 'Executive', weight: 1, base: 265000 },
  { name: 'Facilities', weight: 1, base: 54000 },
];

const LEVELS = [
  { name: 'IC1', weight: 14, mult: 0.62 },
  { name: 'IC2', weight: 24, mult: 0.82 },
  { name: 'IC3', weight: 26, mult: 1.0 },
  { name: 'IC4', weight: 16, mult: 1.28 },
  { name: 'IC5', weight: 8, mult: 1.62 },
  { name: 'M1', weight: 7, mult: 1.45 },
  { name: 'M2', weight: 4, mult: 1.9 },
  { name: 'M3', weight: 1, mult: 2.5 },
];

const REGIONS = [
  { name: 'North America', weight: 44, mult: 1.0 },
  { name: 'Western Europe', weight: 24, mult: 0.86 },
  { name: 'APAC', weight: 18, mult: 0.71 },
  { name: 'LATAM', weight: 9, mult: 0.58 },
  { name: 'MENA', weight: 5, mult: 0.66 },
];

const GENDERS = [
  { name: 'F', weight: 46 },
  { name: 'M', weight: 50 },
  { name: 'Non-binary', weight: 3 },
  { name: 'Undisclosed', weight: 1 },
];

const FIRST = 'Aria Ben Chen Dara Elif Farid Gita Hugo Ines Jonas Kaia Luis Mei Niko Omar Petra Quinn Rosa Sami Tara Umar Vera Wen Yara Zane Ada Bruno Cleo Dmitri Esme'.split(' ');
const LAST = 'Alvarez Bakker Costa Duarte Eriksen Fontaine Gruber Haddad Ibrahim Jensen Kowalski Lindqvist Moreau Novak Okafor Pereira Quiroga Rasmussen Silva Tanaka Ueda Vasquez Wojcik Xu Yilmaz Zhang Aoki Bergman Castillo Delgado'.split(' ');

/** Small deterministic PRNG so the demo is identical on every machine. */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function weightedPick<T extends { weight: number }>(items: T[], r: number): T {
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  let x = r * total;
  for (const item of items) {
    x -= item.weight;
    if (x <= 0) return item;
  }
  return items[items.length - 1];
}

/** Box-Muller, so salaries scatter like salaries rather than like dice. */
function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface SampleOptions {
  rows?: number;
  seed?: number;
}

export const SAMPLE_HEADER =
  'employee_id,full_name,email,department,level,region,gender,tenure_years,performance_rating,base_salary,bonus';

/**
 * Yields one CSV line at a time. The in-page sample is small enough to hold in
 * a string, but the files used for scale testing are not -- a gigabyte of text
 * is past what V8 will hand back as a single value.
 */
export function* generateSampleRows({ rows = 50000, seed = 20260903 }: SampleOptions = {}): Generator<string> {
  const rand = makeRandom(seed);
  yield SAMPLE_HEADER;

  for (let i = 0; i < rows; i++) {
    const dept = weightedPick(DEPARTMENTS, rand());
    const level = weightedPick(LEVELS, rand());
    const region = weightedPick(REGIONS, rand());
    const gender = weightedPick(GENDERS, rand());

    const first = FIRST[Math.floor(rand() * FIRST.length)];
    const last = LAST[Math.floor(rand() * LAST.length)];
    const id = `E${String(100000 + i)}`;
    const email = `${first.toLowerCase()}.${last.toLowerCase()}${i}@example-corp.com`;

    const tenure = Math.round(Math.min(22, Math.max(0, 4.5 + gaussian(rand) * 3.5)) * 10) / 10;
    const rating = Math.min(5, Math.max(1, Math.round((3.3 + gaussian(rand) * 0.75) * 10) / 10));

    // The finding the demo is meant to surface: a gap that is small in aggregate
    // but concentrated in the senior individual-contributor levels, and wider
    // outside North America. Aggregate-only analysis can still see this.
    const seniorIc = level.name === 'IC4' || level.name === 'IC5' || level.name.startsWith('M');
    let genderMult = 1;
    if (gender.name === 'F') genderMult = seniorIc ? 0.885 : 0.978;
    if (gender.name === 'Non-binary') genderMult = seniorIc ? 0.9 : 0.985;
    if (region.name !== 'North America' && gender.name === 'F') genderMult -= 0.025;

    const tenureMult = 1 + Math.min(tenure, 12) * 0.011;
    const perfMult = 1 + (rating - 3.3) * 0.06;
    const noise = 1 + gaussian(rand) * 0.085;

    const salary = Math.round(
      (dept.base * level.mult * region.mult * genderMult * tenureMult * perfMult * noise) / 100,
    ) * 100;
    const bonusRate = level.name.startsWith('M') ? 0.18 : dept.name === 'Sales' ? 0.22 : 0.11;
    const bonus = Math.round((salary * bonusRate * (0.5 + rating / 5) * (1 + gaussian(rand) * 0.15)) / 100) * 100;

    yield [
        id,
        `${first} ${last}`,
        email,
        dept.name,
        level.name,
        region.name,
        gender.name,
        tenure,
        rating,
        salary,
        Math.max(0, bonus),
      ].join(',');
  }
}

/** The whole file as one string. Fine for the in-page sample, not for a gigabyte. */
export function generateSampleCsv(options: SampleOptions = {}): string {
  return [...generateSampleRows(options)].join('\n');
}

export function sampleFile(options: SampleOptions = {}): File {
  const csv = generateSampleCsv(options);
  return new File([csv], 'employee_compensation_2026.csv', { type: 'text/csv' });
}
