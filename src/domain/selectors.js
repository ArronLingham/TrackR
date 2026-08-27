import { bySubject, canonical, get, parseCode } from "../data/catalog.js";

/**
 * A course that could satisfy a requirement.
 *
 * `code` is canonical and is what counting and consumption use. `codes` holds
 * every code the same course is named by, in the order a student would
 * recognise them, so the UI can render "AMATH242 / CS371" rather than silently
 * dropping the alias the student actually enrolled under.
 *
 * @typedef {object} Candidate
 * @property {string} code
 * @property {string} title
 * @property {string[]} codes
 * @property {number} [credits]
 */

/**
 * Courses in `subject` whose number falls within [from, to].
 * @returns {Candidate[]}
 */
function subjectRange(subject, from, to) {
  return bySubject(subject)
    .filter((course) => course.number >= from && course.number <= to)
    .map(toCandidate);
}

/** @returns {Candidate} */
function toCandidate(course) {
  return {
    code: course.code,
    title: course.title,
    codes: [course.code, ...course.aliases],
  };
}

/**
 * Expand a `range` entry: "CS340-CS398", or a bare code like "CO487".
 * @returns {Candidate[]}
 */
function expandRange(entry) {
  const [startRaw, endRaw] = String(entry).split("-");
  const start = parseCode(startRaw);
  if (!start) return [];

  if (!endRaw) {
    const course = get(startRaw);
    return course ? [toCandidate(course)] : [];
  }

  // The end of a range usually repeats the subject ("CS340-CS398") but may be
  // bare digits ("CS340-398").
  const end = parseCode(endRaw) ?? { number: Number(String(endRaw).replace(/\D/g, "")) };
  if (!Number.isFinite(end.number)) return [];

  return subjectRange(start.subject, start.number, end.number);
}

/**
 * Expand a subject-plus-level token: "AFM3" means AFM 300-399, "CS6" means
 * CS 600-699.
 * @returns {Candidate[]}
 */
function expandLevel(entry) {
  const match = /^([A-Za-z]+)(\d+)$/.exec(String(entry).trim());
  if (!match) return [];
  const subject = match[1].toUpperCase();
  const level = Number(match[2]);
  return subjectRange(subject, level * 100, level * 100 + 99);
}

/**
 * Every course that could satisfy `requirement`, deduplicated by canonical
 * code and with excluded courses removed.
 *
 * Subject matching happens through the catalogue's parsed subject field, so a
 * rule about "CO" courses cannot pick up COMMST, COGSCI or COMM. Matching used
 * to be a bare `startsWith` on the code, which meant `level_ranges: ["CO3"]`
 * returned 14 wrong courses out of 24.
 *
 * @param {any} requirement
 * @param {Set<string>} excluded Canonical codes the program excludes
 * @returns {Candidate[]}
 */
export function candidatesFor(requirement, excluded = new Set()) {
  /** @type {Map<string, Candidate>} */
  const found = new Map();

  const add = (candidate) => {
    const code = canonical(candidate.code);
    if (excluded.has(code)) return;

    const existing = found.get(code);
    if (!existing) {
      found.set(code, { ...candidate, code });
      return;
    }
    // Same course reached by two selectors — keep one entry, but remember any
    // additional code it was named by so counts stay honest.
    for (const alias of candidate.codes) {
      if (!existing.codes.includes(alias)) existing.codes.push(alias);
    }
  };

  for (const course of requirement.courses ?? []) {
    const known = get(course.code);
    add({
      code: course.code,
      title: course.title ?? known?.title ?? course.code,
      codes: [course.code, ...(known?.aliases ?? [])],
      credits: course.credits,
    });
  }

  // `required` names courses by bare code rather than by object.
  for (const code of requirement.required ?? []) {
    const known = get(code);
    if (known) add(toCandidate(known));
  }

  for (const entry of requirement.range ?? []) {
    for (const candidate of expandRange(entry)) add(candidate);
  }

  // `level_ranges` and `patterns` are two names for the same "subject + level"
  // token; the data uses both.
  for (const entry of [...(requirement.level_ranges ?? []), ...(requirement.patterns ?? [])]) {
    for (const candidate of expandLevel(entry)) add(candidate);
  }

  for (const subject of requirement.category_ranges ?? []) {
    for (const candidate of bySubject(subject).map(toCandidate)) add(candidate);
  }

  return [...found.values()];
}

/** Display label for a candidate: "AMATH242 / CS371". */
export function labelFor(candidate) {
  return candidate.codes.join(" / ");
}
