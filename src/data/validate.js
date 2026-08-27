import { has, subjectOf } from "./catalog.js";
import { listPrograms, loadProgram } from "./programs.js";
import { candidatesFor } from "../domain/selectors.js";
import { REQUIREMENT_TYPES } from "../domain/requirements.js";

const BLOCK_SECTIONS = ["required_courses", "elective_requirement", "additional_requirement"];

const KNOWN_TOP_LEVEL = new Set([
  "program",
  "source",
  "excluded_courses",
  ...BLOCK_SECTIONS,
  "communication_requirement",
  "breadth_requirement",
  "depth_requirement",
]);

const KNOWN_BLOCK_KEYS = new Set([
  "type", "count", "exclusive", "description", "constraints", "rules",
  "courses", "required", "range", "level_ranges", "patterns", "category_ranges", "groups",
]);

const KNOWN_RULE_KEYS = new Set([
  "min_distinct_subjects", "max_distinct_subjects", "single_subject", "at_or_above",
]);

/**
 * Check one requirement block, recursing into groups.
 * @param {any} block
 * @param {string} where
 * @param {{errors: string[], warnings: string[]}} out
 */
function validateBlock(block, where, out) {
  const problems = out.errors;
  if (!REQUIREMENT_TYPES.includes(block.type)) {
    problems.push(`${where}: unknown type ${JSON.stringify(block.type)}`);
    return;
  }

  for (const key of Object.keys(block)) {
    if (!KNOWN_BLOCK_KEYS.has(key)) problems.push(`${where}: unknown key "${key}"`);
  }

  for (const key of Object.keys(block.rules ?? {})) {
    if (!KNOWN_RULE_KEYS.has(key)) problems.push(`${where}: unknown rule "${key}"`);
  }

  for (const course of block.courses ?? []) {
    if (!has(course.code)) problems.push(`${where}: course ${course.code} is not in the catalogue`);
  }

  for (const code of block.required ?? []) {
    if (!has(code)) problems.push(`${where}: required course ${code} is not in the catalogue`);
  }

  if (block.type === "one_group_required") {
    if (!Array.isArray(block.groups) || block.groups.length === 0) {
      problems.push(`${where}: one_group_required needs a non-empty "groups" array`);
    }
    (block.groups ?? []).forEach((group, index) =>
      validateBlock(group, `${where}.groups[${index}]`, out),
    );
    return;
  }

  if (block.groups) problems.push(`${where}: "groups" is only valid on one_group_required`);

  if (block.type === "n_required" || block.type === "range_required") {
    if (!Number.isInteger(block.count) || block.count < 1) {
      problems.push(`${where}: ${block.type} needs an integer "count"`);
    }
  }

  // Every selector must resolve to real courses of the declared subject. This
  // is the check that would have caught `level_ranges: ["CO3"]` silently
  // matching COMMST and COGSCI.
  for (const token of [...(block.level_ranges ?? []), ...(block.patterns ?? [])]) {
    const match = /^([A-Za-z]+)(\d+)$/.exec(token);
    if (!match) {
      problems.push(`${where}: malformed level token "${token}"`);
      continue;
    }
    const subject = match[1].toUpperCase();
    const resolved = candidatesFor({ level_ranges: [token] }, new Set());
    if (resolved.length === 0) {
      out.warnings.push(`${where}: "${token}" matches no courses in the catalogue`);
    }
    const wrong = resolved.filter((candidate) => subjectOf(candidate.code) !== subject);
    if (wrong.length) {
      problems.push(
        `${where}: "${token}" matched ${wrong.length} course(s) outside ${subject}, e.g. ${wrong[0].code}`,
      );
    }
  }

  for (const subject of block.category_ranges ?? []) {
    const resolved = candidatesFor({ category_ranges: [subject] }, new Set());
    if (resolved.length === 0) {
      // The catalogue snapshot is incomplete (MSCI, for one), so an eligible
      // subject with no courses is a data gap rather than a broken rule.
      out.warnings.push(`${where}: subject "${subject}" matches no courses in the catalogue`);
    }
    const wrong = resolved.filter((candidate) => subjectOf(candidate.code) !== subject.toUpperCase());
    if (wrong.length) {
      problems.push(`${where}: "${subject}" matched ${wrong[0].code}, which is not a ${subject} course`);
    }
  }

  for (const entry of block.range ?? []) {
    if (candidatesFor({ range: [entry] }, new Set()).length === 0) {
      out.warnings.push(`${where}: range "${entry}" matches no courses in the catalogue`);
    }
  }

  const poolSize = candidatesFor(block, new Set()).length;
  if (poolSize === 0) {
    problems.push(`${where}: matches no courses at all`);
  } else if (block.count && block.count > poolSize) {
    problems.push(`${where}: count ${block.count} exceeds its pool of ${poolSize}`);
  }
}

/**
 * Validate one program's requirement file.
 *
 * Every problem this reports used to surface only as an unexplained red badge
 * on the results page, which makes authoring a new program a guessing game.
 *
 * @param {string} programId
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateProgram(programId) {
  /** @type {{errors: string[], warnings: string[]}} */
  const out = { errors: [], warnings: [] };
  const problems = out.errors;
  const program = loadProgram(programId);

  for (const key of Object.keys(program)) {
    if (!KNOWN_TOP_LEVEL.has(key)) problems.push(`${programId}: unknown top-level key "${key}"`);
  }

  for (const course of program.excluded_courses ?? []) {
    if (!has(course.code)) {
      problems.push(`${programId}.excluded_courses: ${course.code} is not in the catalogue`);
    }
  }

  for (const section of BLOCK_SECTIONS) {
    (program[section] ?? []).forEach((block, index) =>
      validateBlock(block, `${programId}.${section}[${index}]`, out),
    );
  }

  const communication = program.communication_requirement;
  if (communication) {
    const lists = Object.keys(communication).filter((key) => key !== "options");
    for (const key of lists) {
      for (const course of communication[key].courses ?? []) {
        if (!has(course.code)) {
          problems.push(`${programId}.communication_requirement.${key}: unknown course ${course.code}`);
        }
      }
    }
    for (const option of communication.options ?? []) {
      for (const requirement of option.requires ?? []) {
        if (!lists.includes(requirement.list)) {
          problems.push(
            `${programId}.communication_requirement: option references missing list "${requirement.list}"`,
          );
        }
      }
    }
  }

  for (const key of ["breadth_requirement", "depth_requirement"]) {
    if (program[key] && typeof program[key].source !== "string") {
      problems.push(`${programId}.${key}: needs a "source" filename`);
    }
  }

  return out;
}

/** Validate every program. Returns programId -> {errors, warnings}. */
export function validateAllPrograms() {
  /** @type {Record<string, {errors: string[], warnings: string[]}>} */
  const report = {};
  for (const program of listPrograms()) {
    const result = validateProgram(program.id);
    if (result.errors.length || result.warnings.length) report[program.id] = result;
  }
  return report;
}
