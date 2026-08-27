import { canonical } from "./catalog.js";
import { listPrograms, loadProgram } from "./programs.js";

/** Almost every Waterloo course is a half-unit, one-term course. */
export const DEFAULT_UNITS = 0.5;

/** @type {Map<string, number> | null} */
let table = null;

/**
 * Course unit values, harvested from the `credits` field the requirement files
 * already carry.
 *
 * The course catalogue itself has only codes and titles, so this is the only
 * unit data in the repository. It covers the courses programs name explicitly
 * — including the exceptions that matter, like the 0.25-unit CS 136L —
 * and everything else falls back to a half unit.
 *
 * @returns {Map<string, number>}
 */
function unitsTable() {
  if (table) return table;

  table = new Map();
  const visit = (block) => {
    for (const course of block.courses ?? []) {
      if (typeof course.credits === "number") table.set(canonical(course.code), course.credits);
    }
    for (const group of block.groups ?? []) visit(group);
  };

  for (const program of listPrograms()) {
    const data = loadProgram(program.id);
    for (const section of ["required_courses", "elective_requirement", "additional_requirement"]) {
      for (const block of data[section] ?? []) visit(block);
    }
    const communication = data.communication_requirement ?? {};
    for (const [key, list] of Object.entries(communication)) {
      if (key !== "options" && list?.courses) visit(list);
    }
  }

  return table;
}

/**
 * Units for a course, falling back to a half unit.
 * @param {string} code
 * @returns {{units: number, assumed: boolean}}
 */
export function unitsFor(code) {
  const known = unitsTable().get(canonical(code));
  return known === undefined ? { units: DEFAULT_UNITS, assumed: true } : { units: known, assumed: false };
}

/** Drop the cached table. Used by tests. */
export function resetUnits() {
  table = null;
}
