import { levelOf, subjectOf } from "../data/catalog.js";
import { normalizeRules, evaluateRules } from "./rules.js";

/** Cap on how many subject compositions we explore. Real blocks need dozens. */
const MAX_COMPOSITIONS = 20000;

/**
 * Choose which of a student's courses to count toward one requirement.
 *
 * Rules have to participate in the choice rather than filter it afterwards.
 * Given CS444, CS445, CS446 and PMATH450 for "four courses from at least two
 * subjects", taking the first four in list order picks three CS courses plus
 * PMATH450 — fine — but taking them in catalogue order can just as easily pick
 * four CS courses and report the subject rule as failed when a valid selection
 * existed. So the search is over per-subject quotas, not over courses.
 *
 * @param {{code: string}[]} available Courses the student has that this block may use
 * @param {number} count               How many are needed
 * @param {import("./rules.js").Rules} [rules]
 * @param {Map<string, number>} [contention] code -> how many other blocks want it
 * @returns {{selection: any[], complete: boolean}}
 */
export function selectCourses(available, count, rules, contention = new Map()) {
  const wanted = Number.isFinite(count) ? Math.max(0, count) : available.length;
  const normalized = normalizeRules(rules);
  const weight = (candidate) => contention.get(candidate.code) ?? 0;

  if (!normalized) {
    // No constraints: prefer courses the fewest other requirements could use,
    // so a course that only this block can count is not left on the table.
    const selection = [...available]
      .sort((a, b) => weight(a) - weight(b) || a.code.localeCompare(b.code))
      .slice(0, wanted);
    return { selection, complete: selection.length >= wanted };
  }

  /** @type {Map<string, any[]>} */
  const bySubject = new Map();
  for (const candidate of available) {
    const subject = subjectOf(candidate.code);
    let list = bySubject.get(subject);
    if (!list) bySubject.set(subject, (list = []));
    list.push(candidate);
  }
  // Higher-level courses first so an "at least N at the 400-level" rule is
  // satisfied whenever it can be; ties go to the least contended course.
  for (const list of bySubject.values()) {
    list.sort(
      (a, b) => levelOf(b.code) - levelOf(a.code) || weight(a) - weight(b) || a.code.localeCompare(b.code),
    );
  }

  const subjects = [...bySubject.keys()].sort((a, b) => {
    const cost = (subject) =>
      bySubject.get(subject).reduce((total, candidate) => total + weight(candidate), 0);
    return cost(a) - cost(b) || a.localeCompare(b);
  });

  // Only the upper bound prunes the search; a shortfall on
  // `min_distinct_subjects` is reported by `score` instead of discarded, so a
  // student sees "4 of 4 courses, but one subject" rather than "1 of 4".
  const maxSubjects = normalized.max_distinct_subjects ?? subjects.length;

  let best = null;
  let bestScore = -Infinity;
  let explored = 0;

  const score = (selection) => {
    const results = evaluateRules(normalized, selection);
    const satisfied = results.filter((result) => result.met).length;
    const cost = selection.reduce((total, candidate) => total + weight(candidate), 0);
    // Fill the count first, then satisfy as many rules as possible, then take
    // the least contended courses.
    return selection.length * 1000 + satisfied * 100 - cost;
  };

  const consider = (selection) => {
    const value = score(selection);
    if (value > bestScore) {
      bestScore = value;
      best = selection;
    }
  };

  /**
   * @param {number} index      next subject to assign a quota to
   * @param {number} remaining  courses still to place
   * @param {number} used       subjects used so far
   * @param {any[]} picked
   */
  const walk = (index, remaining, used, picked) => {
    if (explored > MAX_COMPOSITIONS) return;
    if (remaining === 0) {
      // Record every full-count selection, including ones that break a rule.
      // `score` still ranks rule-satisfying selections above them, so a valid
      // combination wins when one exists — and when none does, the student
      // sees "4 of 4 courses, but only one subject" instead of a bare count.
      explored += 1;
      consider(picked);
      return;
    }
    if (index >= subjects.length) {
      // Cannot reach the count — still worth recording as a partial result.
      if (used <= maxSubjects) consider(picked);
      return;
    }

    const courses = bySubject.get(subjects[index]);
    const most = Math.min(courses.length, remaining);
    // Try larger quotas first so the count is reached early; `score` then
    // prefers whichever complete selection also satisfies the subject rules.
    for (let take = most; take >= 0; take -= 1) {
      if (take > 0 && used + 1 > maxSubjects) continue;
      walk(index + 1, remaining - take, used + (take > 0 ? 1 : 0), [
        ...picked,
        ...courses.slice(0, take),
      ]);
      if (best && best.length >= wanted && evaluateRules(normalized, best).every((r) => r.met)) {
        return; // A fully valid selection exists; stop searching.
      }
    }
  };

  walk(0, Math.min(wanted, available.length), 0, []);

  const selection = best ?? [];
  const complete =
    selection.length >= wanted && evaluateRules(normalized, selection).every((rule) => rule.met);
  return { selection, complete };
}
