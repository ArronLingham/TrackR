import path from "node:path";
import { PATHS } from "../data/paths.js";
import { readJSON } from "../data/json.js";
import { subjectOf } from "../data/catalog.js";
import { approximateGpa, weightedAverage } from "./grades.js";

/**
 * @typedef {import("./transcript.js").TranscriptEntry} TranscriptEntry
 */

function degreeRules() {
  return readJSON(path.join(PATHS.requirements, "degree.json"));
}

/** Round to one decimal without floating-point noise in the output. */
const round1 = (value) => (value === null ? null : Math.round(value * 10) / 10);
const round2 = (value) => (value === null ? null : Math.round(value * 100) / 100);

/**
 * Averages and unit totals for a parsed transcript.
 *
 * Waterloo reports averages as unit-weighted percentages, and counts every
 * attempt — including failed ones — so this works from `attempts` rather than
 * the deduplicated course list the requirement checker uses.
 *
 * @param {{terms: any[], attempts: TranscriptEntry[], hasGrades: boolean}} transcript
 */
export function summarizeAcademics(transcript) {
  const rules = degreeRules();
  const excluded = new Set(rules.excluded_subjects ?? []);
  const mathSubjects = new Set(rules.math_subjects ?? []);

  // COOP, PD and WKRPT courses do not count toward the degree unit minimum.
  const counted = transcript.attempts.filter((entry) => !excluded.has(subjectOf(entry.code)));
  const isMath = (entry) => mathSubjects.has(subjectOf(entry.code));

  const sumUnits = (list) => list.reduce((total, entry) => total + entry.units, 0);

  const earned = counted.filter((entry) => entry.grade.earnsCredit);
  const inProgress = counted.filter((entry) => entry.grade.inProgress);
  const failed = counted.filter((entry) => entry.grade.failed);

  const unitsEarned = sumUnits(earned);
  const unitsInProgress = sumUnits(inProgress);
  const unitsFailed = sumUnits(failed);
  const nonMathEarned = sumUnits(earned.filter((entry) => !isMath(entry)));
  const mathEarned = sumUnits(earned.filter(isMath));

  const cumulative = weightedAverage(counted);
  const mathAverage = weightedAverage(counted.filter(isMath));

  const terms = transcript.terms.map((term) => {
    const average = weightedAverage(term.entries);
    return {
      name: term.name,
      level: term.level,
      units: round2(sumUnits(term.entries.filter((entry) => entry.grade.earnsCredit))),
      average: round1(average),
      gpa: approximateGpa(average),
      courses: term.entries.length,
    };
  });

  return {
    hasGrades: transcript.hasGrades,

    averages: {
      cumulative: round1(cumulative),
      cumulativeGpa: approximateGpa(cumulative),
      math: round1(mathAverage),
      mathGpa: approximateGpa(mathAverage),
      minimum: rules.minimum_cumulative_average,
      meetsMinimum: cumulative === null ? null : cumulative >= rules.minimum_cumulative_average,
      terms,
    },

    units: {
      label: rules.label,
      earned: round2(unitsEarned),
      inProgress: round2(unitsInProgress),
      failed: round2(unitsFailed),
      required: rules.minimum_units,
      remaining: round2(Math.max(0, rules.minimum_units - unitsEarned)),
      remainingAfterTerm: round2(Math.max(0, rules.minimum_units - unitsEarned - unitsInProgress)),
      percent: Math.min(100, Math.round((unitsEarned / rules.minimum_units) * 100)),
      math: round2(mathEarned),
      nonMath: {
        earned: round2(nonMathEarned),
        required: rules.minimum_non_math_units,
        remaining: round2(Math.max(0, rules.minimum_non_math_units - nonMathEarned)),
        met: nonMathEarned >= rules.minimum_non_math_units,
      },
      failedLimit: rules.maximum_failed_units,
      overFailedLimit: unitsFailed > rules.maximum_failed_units,
      // Only flagged when the paste never stated units, since the 0.5 default
      // is wrong for courses like the 0.25-unit CS 136L.
      unitsAssumed: counted.some((entry) => entry.unitsAssumed),
    },

    counts: {
      courses: counted.length,
      earned: earned.length,
      inProgress: inProgress.length,
      failed: failed.length,
    },

    notes: rules.notes ?? [],
  };
}
