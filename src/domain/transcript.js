import { canonical, get, has, isSubject } from "../data/catalog.js";
import { unitsFor } from "../data/units.js";
import { looksLikeGrade, parseGrade } from "./grades.js";

/**
 * @typedef {object} TranscriptEntry
 * @property {string} raw                 The code as typed
 * @property {string} code                Canonical code
 * @property {string} title
 * @property {number} units
 * @property {boolean} unitsAssumed       True when the paste did not say
 * @property {import("./grades.js").Grade} grade
 * @property {string|null} term
 * @property {boolean} known              Present in the course catalogue
 *
 * @typedef {object} TranscriptTerm
 * @property {string} name
 * @property {string|null} level
 * @property {TranscriptEntry[]} entries
 */

const COURSE_CODE = /\b([A-Z]{2,8})\s?(\d{1,3}[A-Z]{0,2})\b/g;
const DECIMAL = /\b\d{1,2}\.\d{1,2}\b/g;
/* Anywhere on the line, not just at the start: reports label them variously
   as "Fall 2022", "Term: Fall 2022" or "2022 Fall". A line is only treated as
   a header when it carries no course code. */
const TERM_HEADER = /\b(?:(Fall|Winter|Spring)\s+(\d{4})|(\d{4})\s+(Fall|Winter|Spring))\b/i;
const LEVEL = /\b(?:Level:?\s*)?([1-5][AB])\b/;
/** A token that is a course code all by itself, typo or not. */
const COURSE_TOKEN = /^[A-Z]{2,8}\s?\d{1,4}[A-Z]{0,3}$/;
/** Transfer credits are earned units carrying no mark, like a CR. */
const TRANSFER_HEADING = /transfer credit/i;

/**
 * Boilerplate a transcript is full of: page furniture, term totals, standings,
 * milestones. None of it contains a course, and listing it back as
 * "unrecognised" would bury the lines that genuinely failed to parse.
 */
const BOILERPLATE =
  /^\s*(term|cumulative|transfer|units|attempted|earned|grade|course\b|description|nbr|in gpa|level\b|major average|faculty average|academic standing|milestone|date completed|completed\b|scholarship|award|status\b|applied toward|beginning of|end of|program:|form of study|academic|career|current|test|degree|plan|student|name|id\b|print|page \d|this is not|unofficial|undergraduate|graduate|university of|waterloo ontario|ontario education|\d{1,3} university|^[\d/]{6,10}\s|[\d/]+\s*$|[\d.]+\s*$)/i;

/**
 * Read a pasted transcript.
 *
 * Students paste anything from a full Quest unofficial transcript to a
 * hand-typed list, so this reads line by line rather than expecting fixed
 * columns. Copying out of a PDF also scrambles it: Quest's own report can emit
 * a term's course codes on one line and their grades on the lines after, which
 * `reconcile` below stitches back together.
 *
 * @param {string} text
 * @returns {{terms: TranscriptTerm[], entries: TranscriptEntry[], attempts: TranscriptEntry[], unknownCodes: string[], unparsedLines: string[], hasGrades: boolean, hasUnits: boolean}}
 */
export function parseTranscript(text) {
  /** @type {TranscriptTerm[]} */
  const terms = [];
  /** Best attempt per course — what the requirement check should see. */
  /** @type {TranscriptEntry[]} */
  const entries = [];
  /** Every row as written, including failed attempts a retake replaced.
   *  Averages and unit totals count these, because Waterloo does. */
  /** @type {TranscriptEntry[]} */
  const attempts = [];
  /** @type {string[]} */
  const unparsedLines = [];

  /** @type {TranscriptTerm | null} */
  let currentTerm = null;
  let inTransferSection = false;
  let hasGrades = false;
  let hasUnits = false;

  /** Course codes from a scrambled column, waiting for their detail rows. */
  /** @type {TranscriptEntry[]} */
  let pendingCodes = [];
  /** Detail rows that lost their course code, waiting to be matched up. */
  /** @type {{units: number, gradeText: string, line: string}[]} */
  let orphanRows = [];

  const record = (entry) => {
    // A transfer credit carries no mark but does earn its units.
    if (inTransferSection && !entry.grade.raw) entry.grade = parseGrade("CR");

    entry.term = currentTerm?.name ?? null;
    attempts.push(entry);
    if (currentTerm) currentTerm.entries.push(entry);

    const existing = entries.findIndex((other) => other.code === entry.code);
    if (existing !== -1) {
      if (shouldReplace(entries[existing], entry)) entries[existing] = entry;
    } else {
      entries.push(entry);
    }
  };

  /**
   * Pair a run of orphaned course codes with the detail rows that follow it.
   * Only done when the counts line up exactly — a partial match would invent
   * grades, which is worse than reporting the lines as unread.
   */
  const reconcile = () => {
    if (pendingCodes.length > 0 && pendingCodes.length === orphanRows.length) {
      pendingCodes.forEach((entry, index) => {
        const row = orphanRows[index];
        if (Number.isFinite(row.units)) {
          entry.units = row.units;
          entry.unitsAssumed = false;
          hasUnits = true;
        }
        if (row.gradeText) {
          entry.grade = parseGrade(row.gradeText);
          hasGrades = true;
        }
        record(entry);
      });
    } else {
      pendingCodes.forEach(record);
      orphanRows.forEach((row) => unparsedLines.push(row.line));
    }
    pendingCodes = [];
    orphanRows = [];
  };

  const fixedLines = [];
  const rawLines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  
  for (let i = 0; i < rawLines.length; i++) {
    const current = rawLines[i];
    const next = rawLines[i + 1];
    if (isSubject(current.toUpperCase()) && next && /^\d{1,4}[A-Z]{0,3}$/i.test(next)) {
      fixedLines.push(current + " " + next);
      i++;
    } else {
      fixedLines.push(current);
    }
  }

  for (const rawLine of fixedLines) {
    const line = rawLine.trim();
    if (!line) continue;

    const hasCode = knownCodeMatches(line.toUpperCase()).length > 0;

    const termMatch = hasCode ? null : TERM_HEADER.exec(line);
    if (termMatch) {
      reconcile();
      inTransferSection = false;
      const season = termMatch[1] ?? termMatch[4];
      const year = termMatch[2] ?? termMatch[3];
      const name = `${season[0].toUpperCase()}${season.slice(1).toLowerCase()} ${year}`;
      currentTerm = { name, level: LEVEL.exec(line)?.[1] ?? null, entries: [] };
      terms.push(currentTerm);
      continue;
    }

    if (!hasCode && TRANSFER_HEADING.test(line)) {
      reconcile();
      inTransferSection = true;
      currentTerm = null; // transfer credits sit outside any term
      continue;
    }

    if (currentTerm && !currentTerm.level && !hasCode) {
      const level = LEVEL.exec(line);
      if (level) currentTerm.level = level[1];
    }

    const parsed = parseCourseLine(line);

    if (parsed.kind === "orphan" || parsed.kind === "none") {
      // Term totals and average lines carry decimals too, so they look exactly
      // like a detail row. They have to be filtered out first, or they get
      // paired with a course code and throw the whole column out of step.
      const isSingleNumber = /^\s*[\d.]+\s*$/.test(line);
      const isSmallDecimal = isSingleNumber && parsed.kind === "orphan" && parsed.orphan.units < 10;
      
      if (BOILERPLATE.test(line) && !(isSmallDecimal && pendingCodes.length > 0)) continue;
      
      if (parsed.kind === "orphan" && pendingCodes.length > 0) orphanRows.push(parsed.orphan);
      else unparsedLines.push(line);
      continue;
    }

    for (const entry of parsed.entries) {
      if (entry.grade.raw) hasGrades = true;
      if (!entry.unitsAssumed) hasUnits = true;
    }

    // A course without its grade/units on the same line might be part of a 
    // scrambled PDF column. Hold it for `reconcile`.
    if (parsed.kind === "list" && (currentTerm || inTransferSection)) {
      pendingCodes.push(...parsed.entries);
    } else {
      parsed.entries.forEach(record);
    }
  }

  reconcile();

  // With no grades anywhere, the paste is a plain course list — treat every
  // course as complete so the requirement check behaves as it always has.
  if (!hasGrades) {
    for (const entry of attempts) {
      entry.grade = { ...entry.grade, inProgress: false, earnsCredit: true };
    }
  }

  return {
    terms,
    entries,
    attempts,
    unknownCodes: entries.filter((entry) => !entry.known).map((entry) => entry.raw),
    unparsedLines,
    hasGrades,
    hasUnits,
  };
}

/** Prefer the attempt that earned credit, then the higher mark. */
function shouldReplace(current, candidate) {
  if (candidate.grade.earnsCredit && !current.grade.earnsCredit) return true;
  if (!candidate.grade.earnsCredit && current.grade.earnsCredit) return false;
  return (candidate.grade.percent ?? -1) > (current.grade.percent ?? -1);
}

/**
 * Course-code matches whose prefix is a subject Waterloo actually offers.
 *
 * The pattern alone matches far too much: "Term GPA 83.80" looks like GPA 83,
 * and "Linear Algebra 1 for Honours Mathematics" looks like ALGEBRA 1. Both
 * appear on every Quest transcript, and both used to be reported back to the
 * student as unrecognised course codes — which rejected the whole submission.
 *
 * @param {string} upper
 * @returns {RegExpMatchArray[]}
 */
function knownCodeMatches(upper) {
  COURSE_CODE.lastIndex = 0;
  return [...upper.matchAll(COURSE_CODE)].filter((match) => isSubject(match[1]));
}

/**
 * @typedef {object} ParsedLine
 * @property {"row"|"list"|"orphan"|"none"} kind
 * @property {TranscriptEntry[]} entries
 * @property {{units: number, gradeText: string, line: string}} [orphan]
 */

/**
 * Classify one line and pull any courses out of it.
 *
 * @param {string} line
 * @returns {ParsedLine}
 */
function parseCourseLine(line) {
  // Quest pastes as tabs, spreadsheets as commas, hand-typed lists as spaces.
  const fields = line.split(/\t|\s*[,;|]\s*/).map((field) => field.trim()).filter(Boolean);
  const upper = line.toUpperCase();
  const matches = knownCodeMatches(upper);

  if (matches.length === 0) {
    // No course, but this may still be the tail of a scrambled row: a title,
    // its units and its grade, with the code stranded on an earlier line.
    const decimals = upper.match(DECIMAL) ?? [];
    const gradeText = findGrade(upper, fields, decimals);
    if (decimals.length > 0 || gradeText) {
      return {
        kind: "orphan",
        entries: [],
        orphan: { units: Number(decimals[0] ?? NaN), gradeText, line },
      };
    }
    return { kind: "none", entries: [] };
  }

  const first = matches[0];
  const tail = upper.slice(first.index + first[0].length).trim();
  const decimals = tail.match(DECIMAL) ?? [];
  const gradeText = findGrade(tail, fields, decimals);

  if (decimals.length > 0 || gradeText) {
    // A detail row: the first code is the course, the rest of the line is its
    // title, units and grade.
    return {
      kind: "row",
      entries: [toEntry(`${first[1]}${first[2]}`, Number(decimals[0] ?? NaN), gradeText)],
    };
  }

  // A bare list. Tokens that look like a whole course code are taken at face
  // value even when the catalogue does not know them, so a typo is reported
  // back to the student rather than silently dropped.
  const tokens = (fields.length > 1 ? fields : upper.split(/\s{2,}/)).map((token) =>
    token.trim().toUpperCase(),
  );
  const listed = tokens.filter((token) => COURSE_TOKEN.test(token));
  if (listed.length > 0) {
    return { kind: "list", entries: listed.map((token) => toEntry(token, NaN, "")) };
  }

  // Prose that happens to mention a course. Only take codes the catalogue
  // recognises, so placeholders like the calendar's "ENGL 1XX" are ignored.
  return {
    kind: "list",
    entries: matches
      .map((match) => toEntry(`${match[1]}${match[2]}`, NaN, ""))
      .filter((entry) => entry.known),
  };
}

/**
 * @param {string} raw   The code as written
 * @param {number} units NaN when the line did not state units
 * @param {string} gradeText
 * @returns {TranscriptEntry}
 */
function toEntry(raw, units, gradeText) {
  const code = canonical(raw);
  const catalogEntry = get(code);
  const stated = Number.isFinite(units);

  return {
    raw: raw.replace(/\s+/g, ""),
    code,
    title: catalogEntry?.title ?? raw,
    units: stated ? units : unitsFor(code).units,
    unitsAssumed: !stated,
    grade: parseGrade(gradeText),
    term: null,
    known: has(code),
  };
}

/**
 * Smallest trailing integer treated as a grade rather than part of a title.
 *
 * Course names routinely end in a small sequence number — "Life Contingencies
 * 1", "Calculus 3", "Analytic Methods for Business 2" — and never in a number
 * this large. Marks in single digits are correspondingly rare, and one that is
 * missed shows up as ungraded in the "What TrackR read" panel rather than
 * being silently mis-scored.
 */
const MIN_BARE_GRADE = 10;

/**
 * Find the grade on a line, without mistaking part of the title for one.
 *
 * A grade after the unit columns is unambiguous. Without units — the shape the
 * WaterlooWorks grade report and most hand-typed lists take — the only signal
 * is the trailing number itself, so the title-number cutoff above decides.
 *
 * @param {string} tail        Text following the course code
 * @param {string[]} fields    The line split on tabs/commas
 * @param {string[]} decimals  Unit-looking values found in `tail`
 * @returns {string}
 */
function findGrade(tail, fields, decimals) {
  if (!tail) return "";

  // Delimited input: the last field is the grade if it looks like one.
  if (fields.length > 1) {
    const last = fields[fields.length - 1].toUpperCase();
    if (looksLikeGrade(last) && !/^\d{1,2}\.\d{1,2}$/.test(last)) return last;
  }

  const tokens = tail.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";
  const last = tokens[tokens.length - 1];

  // A non-numeric grade code is unambiguous wherever it appears.
  if (looksLikeGrade(last) && !/^\d+$/.test(last)) return last;
  if (!looksLikeGrade(last)) return "";

  if (decimals.length > 0) {
    // Numeric grade counts only if it follows the last unit value.
    const lastDecimalAt = tail.lastIndexOf(decimals[decimals.length - 1]);
    const lastTokenAt = tail.lastIndexOf(last);
    return lastTokenAt > lastDecimalAt ? last : "";
  }

  // No units on the line. "CS135 95" is unambiguous; past that, fall back to
  // the title-number cutoff so "Life Contingencies 1" keeps its 1.
  if (tokens.length === 1) return last;
  return Number(last) >= MIN_BARE_GRADE ? last : "";
}
