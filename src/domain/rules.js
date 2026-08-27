import { subjectOf, levelOf } from "../data/catalog.js";

/**
 * Constraints a selection of courses must satisfy, beyond simply reaching the
 * required count.
 *
 * The calendar states several requirements as "N courses, *and* ...":
 *   - "Two of the following foundational courses, with different subject codes"
 *   - "Four additional courses, using at least two different subject codes,
 *      and at least two of which must be 400-level courses"
 *   - "Three non-math courses from exactly one of the following subject codes"
 *
 * @typedef {object} Rules
 * @property {number} [min_distinct_subjects]
 * @property {number} [max_distinct_subjects]
 * @property {boolean} [single_subject]  Sugar for max_distinct_subjects: 1
 * @property {{level: number, count: number}} [at_or_above]
 *
 * @typedef {object} RuleResult
 * @property {string} id
 * @property {boolean} met
 * @property {number} have
 * @property {number} need
 * @property {string} message
 */

/** Normalize the sugar forms into a single canonical shape. */
export function normalizeRules(rules) {
  if (!rules) return null;
  const normalized = { ...rules };
  if (normalized.single_subject) {
    normalized.max_distinct_subjects = 1;
    delete normalized.single_subject;
  }
  return normalized;
}

function distinctSubjects(selection) {
  return new Set(selection.map((candidate) => subjectOf(candidate.code)));
}

/**
 * Evaluate every rule against a selection.
 *
 * Returns one entry per rule rather than a single boolean, because "you have
 * the right number of courses but they are all from one subject" is a state a
 * student can sit in for years — the UI needs to be able to say which half is
 * missing.
 *
 * @param {Rules | null | undefined} rules
 * @param {{code: string}[]} selection
 * @returns {RuleResult[]}
 */
export function evaluateRules(rules, selection) {
  const normalized = normalizeRules(rules);
  if (!normalized) return [];

  /** @type {RuleResult[]} */
  const results = [];

  if (normalized.min_distinct_subjects != null) {
    const have = distinctSubjects(selection).size;
    const need = normalized.min_distinct_subjects;
    results.push({
      id: "min_distinct_subjects",
      met: have >= need,
      have,
      need,
      message: `Use courses from at least ${need} different subject codes`,
    });
  }

  if (normalized.max_distinct_subjects != null) {
    const have = distinctSubjects(selection).size;
    const need = normalized.max_distinct_subjects;
    results.push({
      id: "max_distinct_subjects",
      met: have > 0 && have <= need,
      have,
      need,
      message:
        need === 1
          ? "All courses must share one subject code"
          : `Use courses from at most ${need} different subject codes`,
    });
  }

  if (normalized.at_or_above) {
    const { level, count } = normalized.at_or_above;
    const have = selection.filter((candidate) => levelOf(candidate.code) >= level).length;
    results.push({
      id: "at_or_above",
      met: have >= count,
      have,
      need: count,
      message: `At least ${count} course${count === 1 ? "" : "s"} at the ${level}-level or higher`,
    });
  }

  return results;
}

/** Does this selection satisfy every rule? */
export function rulesSatisfied(rules, selection) {
  return evaluateRules(rules, selection).every((result) => result.met);
}
