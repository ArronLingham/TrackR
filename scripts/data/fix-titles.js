/**
 * Repair course titles in `course offerings.csv`.
 *
 * The catalogue was extracted from a PDF, and roughly one title in eight came
 * out damaged: glyph-pair spacing was read as a word boundary ("Analy tic",
 * "Ap plications"), ligatures were lost ("E?ciency" for "Efficiency"), and
 * em-dashes became runs of spaces.
 *
 * Every repair is validated against the corpus itself rather than a guess: a
 * split word is only rejoined when the joined form already appears as a whole
 * word in another title, and a "?" is only replaced when exactly one ligature
 * substitution produces a word the corpus already knows. Run with
 * `npm run data:fix-titles`, then `npm run data:courses` to regenerate the JSON.
 */
import fs from "node:fs";
import { PATHS } from "../../src/data/paths.js";

/** Lowercase words that are legitimately their own token in a title. */
const FUNCTION_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "by", "for", "from", "in", "is", "its",
  "of", "on", "or", "the", "to", "with", "within", "via", "into", "through",
  "their", "our", "your", "not", "no", "de", "la", "le", "el", "und", "y",
]);

/** Substitutions tried for a "?" left by a dropped ligature. */
const LIGATURES = ["ffi", "ff", "fi", "ffl", "fl"];

const words = (text) => text.split(/\s+/).filter(Boolean);

function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const comma = line.indexOf(",");
    if (comma === -1) {
      rows.push({ raw: line, code: null });
      continue;
    }
    let title = line.slice(comma + 1);
    let quoted = false;
    if (title.trim().startsWith('"') && title.trim().endsWith('"')) {
      quoted = true;
      title = title.trim().slice(1, -1);
    }
    rows.push({ raw: line, code: line.slice(0, comma), title, quoted });
  }
  return rows;
}

const clean = (word) => word.replace(/[^A-Za-z]/g, "").toLowerCase();

/**
 * A lowercase word that may be the tail of a split word. Trailing punctuation
 * is allowed: "Ap proaches:" is the same defect as "Ap proaches", and treating
 * it differently was enough to hide the whole "Ap" family from the
 * always-a-prefix signal below.
 */
function isFragmentToken(token) {
  const match = /^([a-z]+)[:,;.]?$/.exec(token);
  return Boolean(match) && !FUNCTION_WORDS.has(match[1]);
}

/**
 * Two self-validating signals, both derived from the corpus:
 *
 *  - `vocabulary`: joined forms that already appear as a whole word somewhere.
 *  - `alwaysPrefix`: tokens that *only* ever appear immediately before a
 *    lowercase fragment. "Ap", "Analy" and "Psy" are never words on their own,
 *    which is what identifies them as broken halves — and it is the only
 *    signal available for words the extraction damaged every single time, so
 *    that a clean copy exists nowhere in the file.
 */
function buildSignals(rows) {
  const vocabulary = new Set();
  const total = new Map();
  const beforeFragment = new Map();

  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

  for (const row of rows) {
    if (!row.title) continue;
    const tokens = words(row.title);
    tokens.forEach((token, index) => {
      const word = clean(token);
      if (word.length > 2) vocabulary.add(word);
      if (!/^[A-Za-z]+$/.test(token)) return;
      bump(total, token);
      const next = tokens[index + 1];
      if (next && isFragmentToken(next)) bump(beforeFragment, token);
    });
  }

  const alwaysPrefix = new Set(
    [...total.keys()].filter(
      (token) =>
        token.length >= 2 &&
        !FUNCTION_WORDS.has(token.toLowerCase()) &&
        beforeFragment.get(token) === total.get(token),
    ),
  );

  return { vocabulary, alwaysPrefix };
}

/** Rejoin words the extraction split apart. */
function rejoin(title, { vocabulary, alwaysPrefix }) {
  const tokens = words(title);
  const out = [];

  for (const token of tokens) {
    const previous = out[out.length - 1];
    if (previous && isFragmentToken(token) && /[A-Za-z]$/.test(previous)) {
      const joined = previous + token;
      // Either signal is enough; both keep "Health and Safety" intact.
      if (vocabulary.has(clean(joined)) || alwaysPrefix.has(previous)) {
        out[out.length - 1] = joined;
        continue;
      }
    }
    out.push(token);
  }

  return out.join(" ");
}

/** Restore a dropped ligature, but only when exactly one candidate is a word. */
function restoreLigatures(title, { vocabulary }) {
  if (!title.includes("?")) return title;

  return title
    .split(" ")
    .map((word) => {
      if (!word.includes("?")) return word;
      const matches = LIGATURES.map((ligature) => word.replace(/\?/g, ligature)).filter(
        (candidate) => vocabulary.has(clean(candidate)),
      );
      return matches.length === 1 ? matches[0] : word;
    })
    .join(" ");
}

function repair(title, signals) {
  // Collapse runs of whitespace first. Some are a lost em-dash, but inventing
  // punctuation would be a worse error than losing it.
  let fixed = title.replace(/\s+/g, " ").trim();
  fixed = rejoin(fixed, signals);
  fixed = restoreLigatures(fixed, signals);
  return fixed;
}

const source = fs.readFileSync(PATHS.courseOfferingsCsv, "utf8");
const rows = parseCsv(source);

/**
 * Repairing is convergent: fixing "Cryp tography" in one title teaches the
 * vocabulary the word "Cryptography", which then validates the same repair in
 * titles the first pass could not judge. Iterate until nothing more changes.
 */
const repaired = rows.map((row) => (row.title == null ? row.title : row.title.trim()));
for (let pass = 0; pass < 5; pass += 1) {
  const signals = buildSignals(rows.map((row, index) => ({ title: repaired[index] })));
  let changed = 0;
  rows.forEach((row, index) => {
    if (row.code === null || index === 0) return;
    const next = repair(repaired[index], signals);
    if (next !== repaired[index]) {
      repaired[index] = next;
      changed += 1;
    }
  });
  if (changed === 0) break;
}

const changes = [];
let whitespaceOnly = 0;
const output = rows.map((row, index) => {
  if (row.code === null || index === 0) return row.raw;

  const original = row.title.trim();
  const fixed = repaired[index];
  if (fixed !== original) {
    if (fixed === original.replace(/\s+/g, " ")) {
      whitespaceOnly += 1;
    } else {
      changes.push({ code: row.code.trim(), before: original, after: fixed });
    }
  }
  // Leave untouched rows byte-identical so the diff shows only real repairs.
  if (fixed === original) return row.raw;

  const needsQuotes = fixed.includes(",") || fixed.includes('"');
  return `${row.code},${needsQuotes ? `"${fixed.replace(/"/g, '""')}"` : fixed}`;
});

const summary = `${changes.length} word repair(s), ${whitespaceOnly} whitespace-only fix(es)`;

if (process.argv.includes("--dry-run")) {
  console.log(`${summary} would be applied:\n`);
} else {
  fs.writeFileSync(PATHS.courseOfferingsCsv, `${output.join("\n")}\n`, "utf8");
  console.log(`Applied ${summary} to ${PATHS.courseOfferingsCsv}`);
  console.log("Run `npm run data:courses` to regenerate courses.json.\n");
}

for (const change of changes) {
  console.log(`  ${change.code.padEnd(10)} ${change.before}\n  ${" ".repeat(10)} → ${change.after}`);
}

// A "?" between two letters is a dropped ligature, but when every copy of the
// word is damaged there is nothing in the corpus to check a guess against.
// Report them instead of inventing letters.
const needsReview = rows
  .filter((row, index) => index > 0 && row.code !== null && /[A-Za-z]\?[A-Za-z]/.test(repaired[index]))
  .map((row, index) => `${row.code.trim()}: ${repaired[rows.indexOf(row)]}`);

if (needsReview.length) {
  console.log(`\n${needsReview.length} title(s) need a human — a dropped ligature this file cannot verify:`);
  for (const entry of needsReview) console.log(`  ${entry}`);
}
