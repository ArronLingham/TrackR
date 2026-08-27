/**
 * Waterloo grade semantics.
 *
 * Rules and values are from the Registrar's transcript legend and the Faculty
 * of Mathematics' guide to reading an unofficial transcript:
 *
 *   - Undergraduate grades are percentages. 50% or higher passes.
 *   - Any grade below 32% is calculated into averages as 32%.
 *   - Some non-numeric grades carry a value of 32 (DNW, FTC, NMR, WF, INC);
 *     others carry no value at all and are excluded from averages (CR, AEG,
 *     WD, AUD, NCR).
 *   - Averages are unit-weighted.
 */

/** Grades below this are still averaged in at this value. */
const AVERAGE_FLOOR = 32;

/** A percentage at or above this passes and earns credit. */
export const PASS_MARK = 50;

/**
 * @typedef {object} Grade
 * @property {string} raw            As written on the transcript
 * @property {number|null} percent   The reported percentage, if numeric
 * @property {number|null} value     What the average uses (floor applied)
 * @property {boolean} earnsCredit   Units count toward the degree
 * @property {boolean} inAverage     Included in average calculations
 * @property {boolean} inProgress    No result yet
 * @property {boolean} failed        Attempted and not passed
 */

/**
 * Non-numeric grades. `value` null means the grade is excluded from averages.
 * @type {Record<string, {value: number|null, credit: boolean, inProgress?: boolean, failed?: boolean}>}
 */
const CODES = {
  AEG: { value: null, credit: true }, // Aegrotat — credit granted, no numeric value
  CR: { value: null, credit: true },
  AUD: { value: null, credit: false }, // Audit
  WD: { value: null, credit: false }, // Withdrew — no penalty
  NCR: { value: null, credit: false, failed: true },
  UR: { value: null, credit: false, inProgress: true }, // Under review
  DNW: { value: AVERAGE_FLOOR, credit: false, failed: true }, // Did not write
  FTC: { value: AVERAGE_FLOOR, credit: false, failed: true }, // Failure to complete
  NMR: { value: AVERAGE_FLOOR, credit: false, failed: true }, // No mark reported
  WF: { value: AVERAGE_FLOOR, credit: false, failed: true }, // Withdrew/failure
  INC: { value: AVERAGE_FLOOR, credit: false }, // Incomplete
  IP: { value: null, credit: false, inProgress: true },
  NG: { value: null, credit: false, inProgress: true },
  MM: { value: null, credit: false, inProgress: true }, // Missing mark
};

/**
 * Letter grades, used for courses taken before Fall 2001. `value` is the
 * average-calculation value the legend assigns each letter.
 * @type {Record<string, number>}
 */
const LETTERS = {
  "A+": 95, A: 89, "A-": 83,
  "B+": 78, B: 75, "B-": 72,
  "C+": 68, C: 65, "C-": 62,
  "D+": 58, D: 55, "D-": 52,
  "F+": 46, F: 38, "F-": 32,
};

/** Is this token a grade the transcript could carry? */
export function looksLikeGrade(token) {
  const text = String(token ?? "").trim().toUpperCase();
  if (!text) return false;
  if (text in CODES || text in LETTERS) return true;
  return /^\d{1,3}$/.test(text) && Number(text) <= 100;
}

/**
 * Interpret a grade as written on a transcript.
 * @param {string|number|null|undefined} raw
 * @returns {Grade}
 */
export function parseGrade(raw) {
  const text = String(raw ?? "").trim().toUpperCase();

  if (!text) {
    return {
      raw: "",
      percent: null,
      value: null,
      earnsCredit: false,
      inAverage: false,
      inProgress: true,
      failed: false,
    };
  }

  if (text in CODES) {
    const code = CODES[text];
    return {
      raw: text,
      percent: null,
      value: code.value,
      earnsCredit: code.credit,
      inAverage: code.value !== null,
      inProgress: Boolean(code.inProgress),
      failed: Boolean(code.failed),
    };
  }

  if (text in LETTERS) {
    const value = LETTERS[text];
    return {
      raw: text,
      percent: value,
      value,
      earnsCredit: value >= PASS_MARK,
      inAverage: true,
      inProgress: false,
      failed: value < PASS_MARK,
    };
  }

  const percent = Number(text);
  if (Number.isFinite(percent) && percent >= 0 && percent <= 100) {
    return {
      raw: text,
      percent,
      // "any grade below 32% will be calculated into averages as a 32%"
      value: Math.max(percent, AVERAGE_FLOOR),
      earnsCredit: percent >= PASS_MARK,
      inAverage: true,
      inProgress: false,
      failed: percent < PASS_MARK,
    };
  }

  // Unrecognised — treat as ungraded rather than guessing.
  return {
    raw: text,
    percent: null,
    value: null,
    earnsCredit: false,
    inAverage: false,
    inProgress: true,
    failed: false,
  };
}

/**
 * Unit-weighted average of graded courses, as a percentage.
 * @param {{units: number, grade: Grade}[]} entries
 * @returns {number|null} null when nothing is averageable yet
 */
export function weightedAverage(entries) {
  let totalUnits = 0;
  let totalPoints = 0;

  for (const { units, grade } of entries) {
    if (!grade.inAverage || grade.value === null) continue;
    // A 0-unit course cannot be weighted; count it as a single course so it is
    // not silently dropped.
    const weight = units > 0 ? units : 0.5;
    totalUnits += weight;
    totalPoints += weight * grade.value;
  }

  if (totalUnits === 0) return null;
  return totalPoints / totalUnits;
}

/**
 * Approximate a percentage average on the 4.0 scale.
 *
 * Waterloo publishes no official percentage-to-4.0 mapping — averages are
 * reported as percentages. This is the widely-used approximation for graduate
 * applications and must always be presented as an estimate.
 *
 * @param {number|null} percent
 * @returns {number|null}
 */
export function approximateGpa(percent) {
  if (percent === null) return null;
  const bands = [
    [90, 4.0], [85, 3.9], [80, 3.7], [77, 3.3], [73, 3.0], [70, 2.7],
    [67, 2.3], [63, 2.0], [60, 1.7], [57, 1.3], [53, 1.0], [50, 0.7],
  ];
  for (const [floor, gpa] of bands) {
    if (percent >= floor) return gpa;
  }
  return 0.0;
}
