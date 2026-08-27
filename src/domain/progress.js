import { canonical } from "../data/catalog.js";
import { loadProgram } from "../data/programs.js";
import { candidatesFor } from "./selectors.js";
import { evaluateRequirement, isExclusive } from "./requirements.js";
import { checkCommunication } from "./communication.js";
import { checkBreadth } from "./breadth.js";
import { checkDepth } from "./depth.js";

/** Section keys whose value is an array of requirement blocks. */
export const BLOCK_SECTIONS = ["required_courses", "elective_requirement", "additional_requirement"];

const SECTION_LABELS = {
  required_courses: "Core Courses",
  elective_requirement: "Elective Requirements",
  additional_requirement: "Additional Requirements",
  communication_requirement: "Communication Requirement",
  breadth_requirement: "Breadth Requirement",
  depth_requirement: "Depth Requirement",
};

/** Human label for a results section. */
export function sectionLabel(key) {
  return SECTION_LABELS[key] ?? key.replace(/_/g, " ");
}

/**
 * How many exclusive blocks could use each course.
 *
 * Exclusive blocks compete for the same courses, so a block processed first
 * should prefer courses no other block can use. Without this the outcome
 * depends on the order courses happen to appear in the catalogue.
 *
 * @param {any[]} blocks
 * @param {Set<string>} excluded
 * @returns {Map<string, number>}
 */
function contentionMap(blocks, excluded) {
  /** @type {Map<string, number>} */
  const contention = new Map();
  for (const block of blocks) {
    if (!isExclusive(block)) continue;
    for (const candidate of candidatesFor(block, excluded)) {
      contention.set(candidate.code, (contention.get(candidate.code) ?? 0) + 1);
    }
  }
  return contention;
}

/**
 * Evaluate every requirement block against one set of courses.
 *
 * Courses are matched in two passes. Blocks that name specific courses are
 * evaluated against the whole set and may overlap each other — the calendar
 * genuinely lets MATH 237 satisfy both a faculty core requirement and a plan
 * requirement. Blocks phrased as "N additional courses" then draw only from
 * what is left, which is what "additional" means.
 *
 * @param {any} program
 * @param {Set<string>} taken
 * @param {Set<string>} excluded
 * @returns {Map<any, any>} requirement block -> result
 */
function evaluateBlocks(program, taken, excluded) {
  const blocks = BLOCK_SECTIONS.flatMap((section) => program[section] ?? []);
  const contention = contentionMap(blocks, excluded);

  /** @type {Map<any, any>} */
  const results = new Map();
  const consumed = new Set();

  const run = (block) => {
    const result = evaluateRequirement(block, { taken, consumed, excluded, contention });
    results.set(block, result);
    for (const code of result.claims) consumed.add(code);
  };

  for (const block of blocks) if (!isExclusive(block)) run(block);
  for (const block of blocks) if (isExclusive(block)) run(block);

  return results;
}

/**
 * Normalize the caller's input into completed and in-progress course sets.
 * A bare array is treated as all-completed, which is what a plain course list
 * has always meant.
 *
 * @param {string[] | {completed?: string[], inProgress?: string[]}} input
 */
function toCourseSets(input, excluded) {
  const clean = (codes) =>
    new Set((codes ?? []).map(canonical).filter((code) => code && !excluded.has(code)));

  if (Array.isArray(input)) return { completed: clean(input), inProgress: new Set() };

  const completed = clean(input.completed);
  // A course cannot be both; a completed retake wins over an enrolled section.
  const inProgress = new Set([...clean(input.inProgress)].filter((code) => !completed.has(code)));
  return { completed, inProgress };
}

/**
 * Evaluate a student's courses against a program's requirements.
 *
 * Each requirement gets three states rather than two: met on completed work,
 * `in_progress` when the courses currently enrolled would satisfy it, and not
 * met otherwise. Mid-term that distinction is the whole point — a requirement
 * you will finish this term is not the same as one you have not started.
 *
 * @param {string} programId
 * @param {string[] | {completed?: string[], inProgress?: string[]}} courses
 * @returns {any}
 */
export function checkMajorProgress(programId, courses) {
  const program = loadProgram(programId);
  const excluded = new Set((program.excluded_courses ?? []).map((course) => canonical(course.code)));
  const { completed, inProgress } = toCourseSets(courses, excluded);

  const settled = evaluateBlocks(program, completed, excluded);
  // Re-run including enrolled courses to see what this term would finish.
  // Evaluation is pure and cheap, so running it twice is simpler and safer
  // than threading a second state through every evaluator.
  const projectedSet = new Set([...completed, ...inProgress]);
  const projected = inProgress.size
    ? evaluateBlocks(program, projectedSet, excluded)
    : settled;

  const progress = { program: programId };

  for (const [key, value] of Object.entries(program)) {
    if (BLOCK_SECTIONS.includes(key)) {
      progress[key] = value.map((block) => {
        const result = settled.get(block);
        const ahead = projected.get(block);
        return {
          ...result,
          // Courses counted only because they are still in progress.
          in_progress: !result.met && Boolean(ahead?.met),
          projected_taken: ahead?.courses_taken ?? result.courses_taken,
          state: result.met ? "met" : ahead?.met ? "in_progress" : "unmet",
        };
      });
    } else if (key === "communication_requirement") {
      const result = checkCommunication(value, completed);
      const ahead = inProgress.size ? checkCommunication(value, projectedSet) : result;
      progress[key] = {
        ...result,
        in_progress: !result.met && ahead.met,
        state: result.met ? "met" : ahead.met ? "in_progress" : "unmet",
      };
    } else if (key === "breadth_requirement") {
      const result = checkBreadth(completed, value);
      const ahead = inProgress.size ? checkBreadth(projectedSet, value) : result;
      progress[key] = {
        ...result,
        in_progress: !result.satisfied && ahead.satisfied,
        state: result.satisfied ? "met" : ahead.satisfied ? "in_progress" : "unmet",
      };
    } else if (key === "depth_requirement") {
      const result = checkDepth(completed, value);
      const ahead = inProgress.size ? checkDepth(projectedSet, value) : result;
      progress[key] = {
        ...result,
        in_progress: !result.satisfied && ahead.satisfied,
        state: result.satisfied ? "met" : ahead.satisfied ? "in_progress" : "unmet",
      };
    }
  }

  return progress;
}

/** Every section of a result, in render order, with its state. */
function* sections(progress) {
  for (const [key, value] of Object.entries(progress)) {
    if (BLOCK_SECTIONS.includes(key)) {
      for (const result of value) yield { key, result };
    } else if (key.endsWith("_requirement") && value && typeof value === "object") {
      yield { key, result: value };
    }
  }
}

/** Program-level tally used for the results header. */
export function summarize(progress) {
  let met = 0;
  let inProgressCount = 0;
  let total = 0;

  for (const { result } of sections(progress)) {
    total += 1;
    if (result.state === "met") met += 1;
    else if (result.state === "in_progress") inProgressCount += 1;
  }

  return {
    met,
    inProgress: inProgressCount,
    total,
    percent: total === 0 ? 0 : Math.round((met / total) * 100),
    projectedPercent: total === 0 ? 0 : Math.round(((met + inProgressCount) / total) * 100),
  };
}

/**
 * Flat list of what is still outstanding, so a student does not have to expand
 * every section to find out what is left.
 */
export function outstanding(progress) {
  const items = [];
  for (const { key, result } of sections(progress)) {
    if (result.state === "met") continue;
    items.push({
      section: sectionLabel(key),
      state: state(result),
      description: result.description ?? sectionLabel(key),
      count: result.progress?.count ?? null,
      rules: (result.progress?.rules ?? []).filter((rule) => !rule.met),
      remaining: result.courses_remaining ?? [],
      remainingTotal: result.remaining_total ?? 0,
    });
  }
  return items;
}

function state(result) {
  return result.state ?? (result.met || result.satisfied ? "met" : "unmet");
}
