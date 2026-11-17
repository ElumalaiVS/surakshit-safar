// Indicative motor-accident death compensation (Section 166, fault-based claims),
// following the method courts use: Sarla Verma (2009) as approved by the
// Constitution Bench in National Insurance Co. v. Pranay Sethi (2017).
//
// This is an EDUCATIONAL ESTIMATE so families know roughly what a tribunal looks at
// and do not accept a lowball settlement. It is not legal advice; real awards depend
// on evidence (income proof, age proof, dependants), negligence findings and the tribunal.

/** Sarla Verma multiplier table, by age of the deceased. */
export function multiplierFor(age) {
  if (age <= 25) return 18;
  if (age <= 30) return 17;
  if (age <= 35) return 16;
  if (age <= 40) return 15;
  if (age <= 45) return 14;
  if (age <= 50) return 13;
  if (age <= 55) return 11;
  if (age <= 60) return 9;
  if (age <= 65) return 7;
  return 5;
}

/**
 * Future prospects (Pranay Sethi): addition to income.
 * permanent: salaried with a permanent job; other: self-employed or fixed wage.
 */
export function futureProspects(age, employment) {
  const permanent = employment === "permanent";
  if (age < 40) return permanent ? 0.5 : 0.4;
  if (age < 50) return permanent ? 0.3 : 0.25;
  if (age <= 60) return permanent ? 0.15 : 0.1;
  return 0;
}

/** Deduction for the deceased's own personal and living expenses (Sarla Verma). */
export function personalDeduction(married, dependants) {
  if (!married) return 1 / 2;
  if (dependants >= 7) return 1 / 5;
  if (dependants >= 4) return 1 / 4;
  return 1 / 3;
}

/**
 * Conventional heads (Pranay Sethi): loss of estate Rs 15,000, funeral Rs 15,000,
 * consortium Rs 40,000 per dependant, as of 2017, enhanced 10% every three years
 * (first enhancement in 2020).
 */
export function conventionalHeads(accidentYear, dependants) {
  const steps = accidentYear >= 2020 ? Math.floor((accidentYear - 2017) / 3) : 0;
  const factor = Math.pow(1.1, steps);
  const r = (x) => Math.round(x * factor);
  return {
    factor,
    lossOfEstate: r(15000),
    funeral: r(15000),
    consortiumEach: r(40000),
    consortium: r(40000) * dependants,
  };
}

/**
 * @param {object} p
 * @param {number} p.age              age of the deceased (15+)
 * @param {number} p.monthlyIncome    monthly income in rupees
 * @param {"permanent"|"other"} p.employment
 * @param {boolean} p.married
 * @param {number} p.dependants       spouse, children and dependent parents (>= 1)
 * @param {number} p.accidentYear
 */
export function estimateDeathClaim(p) {
  const age = Math.max(15, Math.min(80, Math.round(p.age)));
  const dependants = Math.max(1, Math.round(p.dependants));
  const annual = Math.max(0, p.monthlyIncome) * 12;
  const fp = futureProspects(age, p.employment);
  const ded = personalDeduction(p.married, dependants);
  const mult = multiplierFor(age);
  const conv = conventionalHeads(p.accidentYear, dependants);

  const dependency = (incomeFactor, withFp) =>
    Math.round(annual * incomeFactor * (1 + (withFp ? fp : 0)) * (1 - ded) * mult);

  const convTotal = conv.lossOfEstate + conv.funeral + conv.consortium;
  const fullDependency = dependency(1, true);
  const high = fullDependency + convTotal;
  // Lower end: income only partly accepted (weak proof) and no future prospects.
  const low = dependency(0.75, false) + convTotal;

  return {
    inputs: { age, dependants, annual, employment: p.employment, married: p.married },
    multiplier: mult,
    futureProspects: fp,
    personalDeduction: ded,
    lossOfDependency: fullDependency,
    conventional: conv,
    conventionalTotal: convTotal,
    low,
    high,
    noFaultSection164: 500000,
  };
}
