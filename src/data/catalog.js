import fs from "node:fs";
import { PATHS } from "./paths.js";
import { readJSON } from "./json.js";

/**
 * @typedef {object} CourseRecord
 * @property {string} code      Canonical unspaced code, e.g. "MATH237"
 * @property {string} title
 * @property {string} subject   Letter prefix, e.g. "MATH"
 * @property {number} number    Numeric part, e.g. 237
 * @property {string[]} aliases Other codes the same course is offered under
 */

const CODE_PATTERN = /^([A-Z]+)(\d+)([A-Z]*)$/;

/**
 * Canonical course-code form: uppercase, no whitespace or punctuation.
 *
 * The repository stores codes two ways — `courses.json` uses "MATH237",
 * `prereqs.json` uses "MATH 237" — and users type either. Every comparison in
 * the app goes through this function so the difference stops at the boundary.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalizeCode(raw) {
  return String(raw ?? "").toUpperCase().replace(/[\s.]+/g, "");
}

/**
 * Split a code into subject prefix, number and suffix.
 *
 * A parsed subject is what makes subject matching safe: "COMMST300" parses to
 * subject "COMMST", so it can never satisfy a rule about "CO" courses. The
 * previous implementation compared with `startsWith`, which matched COMMST,
 * COGSCI and COMM for every "CO" rule.
 *
 * @param {string} raw
 * @returns {{subject: string, number: number, suffix: string} | null}
 */
export function parseCode(raw) {
  const match = CODE_PATTERN.exec(normalizeCode(raw));
  if (!match) return null;
  return { subject: match[1], number: Number(match[2]), suffix: match[3] };
}

/** Subject prefix of a code, or "" when unparseable. */
export function subjectOf(raw) {
  return parseCode(raw)?.subject ?? "";
}

/** Course number (237 for MATH237), or 0 when unparseable. */
export function levelOf(raw) {
  return parseCode(raw)?.number ?? 0;
}

/** @returns {{code: string, title: string}[]} */
function rawCourses() {
  return readJSON(PATHS.courses);
}

/**
 * Cross-listings: one real course offered under several subject codes.
 *
 * Two jobs. It lets a plan that names CS371 recognise a student's AMATH242,
 * and it supplies courses the catalogue snapshot is missing entirely
 * (MTHEL300, ACTSC471) so students are not told a real course does not exist.
 *
 * @returns {{codes: string[], title: string}[]}
 */
function crossListings() {
  if (!fs.existsSync(PATHS.crossListings)) return [];
  return readJSON(PATHS.crossListings).map((group) => ({
    codes: group.codes.map(normalizeCode),
    title: group.title,
  }));
}

/** @type {{byCode: Map<string, CourseRecord>, bySubject: Map<string, CourseRecord[]>, aliases: Map<string, string>} | null} */
let index = null;

function getIndex() {
  if (index) return index;

  /** @type {Map<string, CourseRecord>} */
  const byCode = new Map();
  /** @type {Map<string, string>} */
  const aliases = new Map();

  const addRecord = (code, title) => {
    const parsed = parseCode(code);
    if (!parsed) return null;
    const record = {
      code,
      title,
      subject: parsed.subject,
      number: parsed.number,
      aliases: [],
    };
    byCode.set(code, record);
    return record;
  };

  for (const entry of rawCourses()) {
    addRecord(normalizeCode(entry.code), entry.title);
  }

  for (const { codes, title } of crossListings()) {
    // Prefer a canonical code the catalogue already knows, so titles and
    // subject/level parsing stay consistent with the rest of the data.
    const canonicalCode = codes.find((code) => byCode.has(code)) ?? codes[0];
    const record = byCode.get(canonicalCode) ?? addRecord(canonicalCode, title);
    if (!record) continue;

    for (const code of codes) {
      aliases.set(code, canonicalCode);
      if (code !== canonicalCode && !record.aliases.includes(code)) {
        record.aliases.push(code);
      }
      // A cross-listed code that also has its own catalogue entry is the same
      // course; drop the duplicate so counts cannot double.
      if (code !== canonicalCode) byCode.delete(code);
    }
  }

  /** @type {Map<string, CourseRecord[]>} */
  const bySubject = new Map();
  for (const record of byCode.values()) {
    let list = bySubject.get(record.subject);
    if (!list) bySubject.set(record.subject, (list = []));
    list.push(record);
  }
  for (const list of bySubject.values()) list.sort((a, b) => a.number - b.number);

  index = { byCode, bySubject, aliases };
  return index;
}

/**
 * Canonical code for comparison: normalized, then resolved through
 * cross-listings.
 * @param {string} raw
 * @returns {string}
 */
export function canonical(raw) {
  const code = normalizeCode(raw);
  return getIndex().aliases.get(code) ?? code;
}

/** Does this course exist in the catalogue, under any of its codes? */
export function has(raw) {
  return getIndex().byCode.has(canonical(raw));
}

/** @param {string} raw @returns {CourseRecord | undefined} */
export function get(raw) {
  return getIndex().byCode.get(canonical(raw));
}

/**
 * Catalogue courses for one subject, ascending by number.
 * The returned array is shared — callers must not mutate it.
 * @param {string} subject
 * @returns {CourseRecord[]}
 */
export function bySubject(subject) {
  return getIndex().bySubject.get(normalizeCode(subject)) ?? [];
}

/** Every subject prefix present in the catalogue. */
export function subjects() {
  return [...getIndex().bySubject.keys()];
}

/**
 * Is this a real Waterloo subject code?
 *
 * Used to tell a course reference apart from ordinary words that happen to be
 * followed by a number — "Term GPA 83.80" and "Linear Algebra 1" both look
 * like course codes to a pattern alone.
 *
 * @param {string} prefix
 */
export function isSubject(prefix) {
  return getIndex().bySubject.has(normalizeCode(prefix));
}

/** Number of distinct courses in the catalogue. */
export function size() {
  return getIndex().byCode.size;
}

/** Drop the in-memory index. Used by tests that swap fixture data. */
export function resetCatalog() {
  index = null;
}
