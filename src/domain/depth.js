import { PATHS } from "../data/paths.js";
import { readJSON } from "../data/json.js";
import { canonical, levelOf, subjectOf } from "../data/catalog.js";
import { prereqsOf } from "../data/prereqs.js";

const CHAIN_LENGTH = 3;
const MIN_COURSES = 3;
const SENIOR_LEVEL = 300;

/**
 * Subjects that can carry depth: the union of the breadth categories. Depth is
 * an *elective* requirement, so math-faculty subjects are out.
 */
function eligibleSubjects(table) {
  return new Set([
    ...(table.humanities ?? []),
    ...(table.social_sciences ?? []),
    ...(table.pure_sciences ?? []),
    ...(table.applied_sciences ?? []),
  ]);
}

/**
 * Walk backwards through prerequisites looking for a chain of `CHAIN_LENGTH`
 * courses the student has actually taken, all in the same subject.
 *
 * @param {string} code
 * @param {Set<string>} withinSubject
 * @param {string[]} chain
 * @returns {string[] | null}
 */
function findChain(code, withinSubject, chain) {
  if (chain.length === CHAIN_LENGTH) return chain;
  for (const prereq of prereqsOf(code)) {
    if (!withinSubject.has(prereq) || chain.includes(prereq)) continue;
    const found = findChain(prereq, withinSubject, [...chain, prereq]);
    if (found) return found;
  }
  return null;
}

/**
 * Elective depth: 1.5 units in one subject including at least 0.5 unit at the
 * 300-level or higher, or 1.5 units in one subject forming a prerequisite
 * chain of length three.
 *
 * @param {Set<string>} taken Canonical codes the student has
 * @param {any} [config] The program's `depth_requirement` block
 */
export function checkDepth(taken, config = {}) {
  const table = readJSON(PATHS.breadth);
  const eligible = eligibleSubjects(table);
  const excludedSubjects = new Set(table.excluded_subjects ?? []);
  const list1 = new Set((table.communication_list1_exclusions ?? []).map(canonical));
  const depthRules = readJSON(PATHS.depth);

  /** @type {Map<string, string[]>} */
  const bySubject = new Map();
  for (const code of taken) {
    const subject = subjectOf(code);
    if (!eligible.has(subject) || excludedSubjects.has(subject) || list1.has(code)) continue;
    let list = bySubject.get(subject);
    if (!list) bySubject.set(subject, (list = []));
    list.push(code);
  }

  const subjects = [...bySubject.keys()].sort();
  const description =
    config.description ?? depthRules.options.map((option) => option.description).join(" OR ");

  for (const subject of subjects) {
    const courses = bySubject.get(subject).sort();
    if (courses.length >= MIN_COURSES && courses.some((code) => levelOf(code) >= SENIOR_LEVEL)) {
      return {
        satisfied: true,
        description,
        option_met: 1,
        subject,
        courses_used: courses,
        examples: depthRules.examples,
      };
    }
  }

  for (const subject of subjects) {
    const courses = bySubject.get(subject);
    const withinSubject = new Set(courses);
    for (const code of courses.slice().sort()) {
      const chain = findChain(code, withinSubject, [code]);
      if (chain) {
        return {
          satisfied: true,
          description,
          option_met: 2,
          subject,
          chain,
          courses_used: chain,
          examples: depthRules.examples,
        };
      }
    }
  }

  // Report the closest subject so the student knows where they stand.
  const closest = subjects
    .map((subject) => ({ subject, count: bySubject.get(subject).length }))
    .sort((a, b) => b.count - a.count)[0];

  return {
    satisfied: false,
    description,
    subject: closest?.subject ?? null,
    courses_used: closest ? bySubject.get(closest.subject).sort() : [],
    note: closest
      ? `Closest subject is ${closest.subject} with ${closest.count} course${closest.count === 1 ? "" : "s"}; you need 3 in one subject, including one at the 300-level or higher.`
      : "No eligible courses yet. Depth must come from a non-math subject.",
    examples: depthRules.examples,
  };
}
