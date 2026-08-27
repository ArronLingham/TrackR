import { canonical, get } from "../data/catalog.js";

/**
 * @typedef {object} CommunicationList
 * @property {string} description
 * @property {any[]} courses_taken
 * @property {any[]} courses_remaining
 */

function toCandidate(course) {
  const known = get(course.code);
  return {
    code: canonical(course.code),
    title: course.title ?? known?.title ?? course.code,
    codes: [course.code, ...(known?.aliases ?? []).filter((alias) => alias !== course.code)],
    credits: course.credits,
  };
}

/**
 * Evaluate the Undergraduate Communication Requirement.
 *
 * The lists and the options that combine them are program data, because the
 * rule varies: most plans need one course from List 1 and one from List 2,
 * while Actuarial Science and Statistics plans need one from List 1 plus
 * ENGL 378 / MTHEL 300.
 *
 * Communication courses are never consumed — a List 2 course can also count as
 * a humanities breadth course, and the calendar says so explicitly.
 *
 * @param {any} config
 * @param {Set<string>} taken Canonical codes the student has
 */
export function checkCommunication(config, taken) {
  /** @type {Record<string, CommunicationList>} */
  const lists = {};

  for (const [key, value] of Object.entries(config)) {
    if (key === "options" || !value?.courses) continue;
    const candidates = value.courses.map(toCandidate);
    lists[key] = {
      description: value.description ?? key,
      courses_taken: candidates.filter((candidate) => taken.has(candidate.code)),
      courses_remaining: candidates.filter((candidate) => !taken.has(candidate.code)),
    };
  }

  const options = (config.options ?? []).map((option) => {
    const requires = (option.requires ?? []).map((requirement) => {
      const list = lists[requirement.list];
      const have = list ? list.courses_taken.length : 0;
      return {
        list: requirement.list,
        label: list?.description ?? requirement.list,
        have,
        need: requirement.count,
        met: have >= requirement.count,
      };
    });
    return {
      description: option.description,
      requires,
      met: requires.length > 0 && requires.every((requirement) => requirement.met),
    };
  });

  const met = options.some((option) => option.met);

  // Progress reflects the best single option, not "how many lists have at
  // least one course" — Option 1 asks for *two* courses from List 1, so the
  // old ratio could read 2/2 while both options showed as unmet.
  const best = options.reduce(
    (bestSoFar, option) => {
      const need = option.requires.reduce((total, r) => total + r.need, 0);
      const have = option.requires.reduce((total, r) => total + Math.min(r.have, r.need), 0);
      return have / Math.max(need, 1) > bestSoFar.ratio ? { have, need, ratio: have / need } : bestSoFar;
    },
    { have: 0, need: 1, ratio: 0 },
  );

  return {
    lists,
    options,
    met,
    satisfied: met,
    progress: { count: { have: best.have, need: best.need } },
  };
}
