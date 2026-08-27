import { canonical } from "../data/catalog.js";
import { candidatesFor } from "./selectors.js";
import { describe } from "./describe.js";
import { evaluateRules } from "./rules.js";
import { selectCourses } from "./selection.js";

/** How many un-taken options to list before summarising the rest. */
const MAX_REMAINING_SHOWN = 12;

/**
 * @typedef {object} RequirementResult
 * @property {string} description
 * @property {string} type
 * @property {any[]} courses_taken     Exactly the courses counted toward this block
 * @property {any[]} courses_remaining Options still open (capped for display)
 * @property {number} remaining_total  Full size of the remaining list
 * @property {boolean} met
 * @property {{count: {have: number, need: number}, rules: any[]}} progress
 * @property {string[]} constraints    Prose notes from the calendar
 * @property {string[]} claims         Canonical codes this block counted
 * @property {number} held_total       Courses the student has from this pool
 * @property {string[]} [missing_required] Named courses still outstanding
 * @property {{description: string, met: boolean}[]} [options] For one_group_required
 */

/**
 * Requirement blocks that phrase themselves as "N *additional* courses" must
 * not reuse a course already counted elsewhere; blocks that name specific
 * courses may overlap freely, because the calendar lets one course satisfy
 * both a faculty core requirement and a plan requirement.
 *
 * Exclusivity is a property of the calendar's prose, not of the rule shape —
 * `BMath Computer Science`'s elective block is a `one_group_required` whose
 * description literally begins "Complete 1 additional course", while BCFM's
 * communication block is an `n_required` that must be shareable. So it is a
 * data flag, with a default that matches the common case.
 *
 * @param {any} requirement
 * @returns {boolean}
 */
export function isExclusive(requirement) {
  if (typeof requirement.exclusive === "boolean") return requirement.exclusive;
  return requirement.type === "n_required" || requirement.type === "range_required";
}

function cap(list) {
  return list; // Return the full list so the frontend can implement "show more" dynamically
}

/**
 * @param {any} requirement
 * @param {object} ctx
 * @param {Set<string>} ctx.taken       Canonical codes the student has
 * @param {Set<string>} ctx.consumed    Codes already counted by an exclusive block
 * @param {Set<string>} ctx.excluded    Codes the program excludes outright
 * @param {Map<string, number>} ctx.contention
 * @returns {RequirementResult}
 */
export function evaluateRequirement(requirement, ctx) {
  const evaluator = EVALUATORS[requirement.type];
  if (!evaluator) {
    throw new Error(`Unknown requirement type: ${JSON.stringify(requirement.type)}`);
  }
  return evaluator(requirement, ctx);
}

/** Courses from this block's pool that the student has and may still use. */
function usableFor(requirement, ctx) {
  const candidates = candidatesFor(requirement, ctx.excluded);
  const held = candidates.filter((candidate) => ctx.taken.has(candidate.code));
  const usable = isExclusive(requirement)
    ? held.filter((candidate) => !ctx.consumed.has(candidate.code))
    : held;
  return { candidates, held, usable };
}

function baseResult(requirement, extra) {
  return {
    description: describe(requirement),
    type: requirement.type,
    constraints: requirement.constraints ?? [],
    ...extra,
  };
}

function countingResult(requirement, ctx, { candidates, held, usable }) {
  const need = requirement.count ?? 1;
  const { selection } = selectCourses(usable, need, requirement.rules, ctx.contention);
  const rules = evaluateRules(requirement.rules, selection);

  // `required` names courses that must be among the counted set, not merely
  // present in the pool.
  const requiredCodes = (requirement.required ?? []).map(canonical);
  const selected = new Set(selection.map((candidate) => candidate.code));
  const missingRequired = requiredCodes.filter((code) => !selected.has(code));

  const remaining = candidates.filter((candidate) => !ctx.taken.has(candidate.code));
  const met =
    selection.length >= need && rules.every((rule) => rule.met) && missingRequired.length === 0;

  return baseResult(requirement, {
    courses_taken: selection,
    courses_remaining: cap(remaining),
    remaining_total: remaining.length,
    met,
    progress: { count: { have: selection.length, need }, rules },
    missing_required: missingRequired,
    claims: selection.map((candidate) => candidate.code),
    held_total: held.length,
  });
}

const EVALUATORS = {
  all_required(requirement, ctx) {
    const { candidates, held } = usableFor(requirement, ctx);
    const remaining = candidates.filter((candidate) => !ctx.taken.has(candidate.code));

    return baseResult(requirement, {
      courses_taken: held,
      courses_remaining: remaining,
      remaining_total: remaining.length,
      // Derived from what the student actually has, not from the remaining
      // list: a course counted by an earlier block used to empty `remaining`
      // and make this report met with nothing taken.
      met: held.length === candidates.length && candidates.length > 0,
      progress: { count: { have: held.length, need: candidates.length }, rules: [] },
      claims: held.map((candidate) => candidate.code),
      held_total: held.length,
    });
  },

  one_required(requirement, ctx) {
    const parts = usableFor(requirement, ctx);
    return countingResult({ ...requirement, count: 1 }, ctx, parts);
  },

  n_required(requirement, ctx) {
    return countingResult(requirement, ctx, usableFor(requirement, ctx));
  },

  range_required(requirement, ctx) {
    return countingResult(requirement, ctx, usableFor(requirement, ctx));
  },

  one_group_required(requirement, ctx) {
    // Each alternative is judged against the same starting state — evaluating
    // them in sequence against a shared consumed-set let the first group take
    // courses the second one needed.
    const outcomes = (requirement.groups ?? []).map((group) =>
      evaluateRequirement(
        { ...group, exclusive: group.exclusive ?? requirement.exclusive },
        { ...ctx, consumed: new Set(ctx.consumed) },
      ),
    );

    // Pick a single winning alternative rather than merging them: merging
    // produced an "Available Options" list mixing two unrelated paths.
    const rank = (result) =>
      (result.met ? 1e6 : 0) + result.progress.count.have * 100 - result.progress.count.need;
    const winner = outcomes.reduce(
      (bestSoFar, result) => (rank(result) > rank(bestSoFar) ? result : bestSoFar),
      outcomes[0],
    );

    if (!winner) {
      return baseResult(requirement, {
        courses_taken: [],
        courses_remaining: [],
        remaining_total: 0,
        met: false,
        progress: { count: { have: 0, need: 1 }, rules: [] },
        claims: [],
        held_total: 0,
      });
    }

    return baseResult(requirement, {
      courses_taken: winner.courses_taken,
      courses_remaining: winner.courses_remaining,
      remaining_total: winner.remaining_total,
      // Met when any alternative is met. The previous implementation also
      // demanded the winning group have nothing remaining, which no
      // "one of N" or "N from a range" group can ever satisfy.
      met: outcomes.some((result) => result.met),
      progress: winner.progress,
      options: outcomes.map((result) => ({ description: result.description, met: result.met })),
      claims: winner.claims,
      held_total: winner.held_total,
    });
  },
};

export const REQUIREMENT_TYPES = Object.keys(EVALUATORS);
