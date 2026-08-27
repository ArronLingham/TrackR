import { PATHS } from "./paths.js";
import { readJSON } from "./json.js";
import { canonical } from "./catalog.js";

/**
 * @typedef {object} PrereqEntry
 * @property {string} text          Human-readable prerequisite sentence
 * @property {string[]} prereqCodes Canonical codes named in that sentence
 */

/** @type {Map<string, PrereqEntry> | null} */
let graph = null;

/**
 * Prerequisite graph, keyed by canonical course code.
 *
 * `prereqs.json` is ~1.4 MB across 7,880 entries and stores spaced codes
 * ("MATH 237"). It used to be re-read and re-parsed on every request by the
 * depth check; it is now converted to canonical keys once per process.
 *
 * @returns {Map<string, PrereqEntry>}
 */
export function prereqGraph() {
  if (graph) return graph;

  graph = new Map();
  for (const [rawCode, entry] of Object.entries(readJSON(PATHS.prereqs))) {
    graph.set(canonical(rawCode), {
      text: entry.prereq_text ?? "",
      prereqCodes: (entry.prereq_codes ?? []).map(canonical),
    });
  }
  return graph;
}

/** Canonical prerequisite codes for one course. */
export function prereqsOf(code) {
  return prereqGraph().get(canonical(code))?.prereqCodes ?? [];
}

/** Drop the in-memory graph. Used by tests that swap fixture data. */
export function resetPrereqs() {
  graph = null;
}
