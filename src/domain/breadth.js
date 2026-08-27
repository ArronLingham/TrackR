import { PATHS } from "../data/paths.js";
import { readJSON } from "../data/json.js";
import { canonical, subjectOf } from "../data/catalog.js";

/**
 * @typedef {object} BreadthCategory
 * @property {string} label
 * @property {number} units    Units the calendar asks for
 * @property {number} needed   Courses that represents, at 0.5 units each
 * @property {string[]} taken  Courses counted toward this category
 * @property {string[]} eligible Courses that could have counted
 * @property {boolean} met
 * @property {number} remaining
 * @property {string} progress
 * @property {string} status
 */

const CATEGORIES = ["humanities", "social_sciences", "pure_sciences", "applied_sciences"];

const LABELS = {
  humanities: "Humanities",
  social_sciences: "Social Sciences",
  pure_sciences: "Pure Sciences",
  applied_sciences: "Applied Sciences",
};

/** Breadth is counted in 0.5-unit courses; the calendar states it in units. */
const UNITS_PER_COURSE = 0.5;

function rules() {
  return readJSON(PATHS.breadth);
}

/**
 * Which breadth categories a course is eligible for.
 * @returns {string[]}
 */
function categoriesFor(code, table) {
  const subject = subjectOf(code);
  return CATEGORIES.filter((category) => (table[category] ?? []).includes(subject));
}

/**
 * Elective breadth: 1.0 unit humanities, 1.0 unit social sciences, 0.5 unit
 * pure sciences, 0.5 unit pure-or-applied sciences.
 *
 * No course may satisfy more than one category, so this is an assignment
 * problem, not four independent counts. Courses eligible for only one category
 * are placed first; the rest fill whichever category still needs them most.
 * The previous implementation pushed every leftover overlapping course into
 * applied sciences, which reported progress like "3/1".
 *
 * @param {Set<string>} taken Canonical codes the student has
 * @param {any} [config] The program's `breadth_requirement` block
 */
export function checkBreadth(taken, config = {}) {
  const table = rules();
  const excludedSubjects = new Set(table.excluded_subjects ?? []);
  const list1 = new Set((table.communication_list1_exclusions ?? []).map(canonical));
  const requiredUnits = config.required_units ?? {
    humanities: 1.0,
    social_sciences: 1.0,
    pure_sciences: 0.5,
    applied_sciences: 0.5,
  };

  /** @type {Record<string, BreadthCategory>} */
  const categories = {};
  for (const category of CATEGORIES) {
    const units = requiredUnits[category] ?? 0.5;
    const needed = Math.max(1, Math.round(units / UNITS_PER_COURSE));
    categories[category] = {
      label: LABELS[category],
      units,
      needed,
      taken: [],
      eligible: [],
      met: false,
      remaining: needed,
      progress: `0/${needed}`,
      status: "",
    };
  }

  /** @type {{code: string, options: string[]}[]} */
  const eligible = [];
  for (const code of taken) {
    // Math-faculty subjects never count for breadth, and a List 1
    // communication course cannot double as breadth.
    if (excludedSubjects.has(subjectOf(code)) || list1.has(code)) continue;
    const options = categoriesFor(code, table);
    if (options.length === 0) continue;
    eligible.push({ code, options });
    for (const option of options) categories[option].eligible.push(code);
  }

  // Least-flexible courses first, so a course that fits only one category is
  // never spent on a category another course could have covered.
  eligible.sort((a, b) => a.options.length - b.options.length || a.code.localeCompare(b.code));

  for (const { code, options } of eligible) {
    const target = options
      .map((category) => ({ category, shortfall: categories[category].needed - categories[category].taken.length }))
      .filter((option) => option.shortfall > 0)
      .sort((a, b) => b.shortfall - a.shortfall || a.category.localeCompare(b.category))[0];
    if (target) categories[target.category].taken.push(code);
  }

  let satisfied = true;
  for (const category of CATEGORIES) {
    const entry = categories[category];
    entry.met = entry.taken.length >= entry.needed;
    entry.remaining = Math.max(0, entry.needed - entry.taken.length);
    entry.progress = `${entry.taken.length}/${entry.needed}`;
    entry.status = entry.met
      ? `${entry.label} satisfied (${entry.progress})`
      : `${entry.label}: ${entry.progress}, need ${entry.remaining} more`;
    if (!entry.met) satisfied = false;
  }

  return {
    satisfied,
    description:
      config.description ??
      "Humanities 1.0 unit, Social Sciences 1.0 unit, Pure Sciences 0.5 unit, Applied Sciences 0.5 unit",
    categories,
    note:
      "A course counts toward at most one breadth category. Math-faculty subjects and List 1 communication courses do not count.",
  };
}
