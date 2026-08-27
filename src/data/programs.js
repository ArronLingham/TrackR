import fs from "node:fs";
import path from "node:path";
import { PATHS } from "./paths.js";
import { readJSON } from "./json.js";

/**
 * @typedef {object} ProgramSummary
 * @property {string} id    Filename stem — the value submitted by the form
 * @property {string} label Human-readable name shown in the picker
 */

/**
 * These live alongside the program files but are shared rule tables, not
 * programs: breadth and depth categories, and the faculty-wide degree
 * minimums from Table 1.
 */
const SHARED_FILES = new Set(["breadth.json", "depth.json", "degree.json"]);

/** @type {ProgramSummary[] | null} */
let programs = null;

/**
 * Every program the app can evaluate, discovered from the requirements
 * directory.
 *
 * The homepage picker used to hardcode its `<option>` list, so adding a
 * program meant editing a template and keeping it in sync with the filenames
 * by hand. Reading the directory makes dropping in a JSON file sufficient, and
 * gives the server an allow-list to validate submissions against.
 *
 * @returns {ProgramSummary[]}
 */
export function listPrograms() {
  if (programs) return programs;

  programs = fs
    .readdirSync(PATHS.requirements)
    .filter((file) => file.endsWith(".json") && !SHARED_FILES.has(file))
    .map((file) => ({ id: path.basename(file, ".json"), label: path.basename(file, ".json") }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return programs;
}

/** Is this a program the app knows about? Guards the filesystem lookup below. */
export function isKnownProgram(id) {
  return listPrograms().some((program) => program.id === id);
}

/**
 * Load one program's requirement data.
 * @param {string} id
 * @returns {any}
 * @throws {Error} when `id` is not a known program
 */
export function loadProgram(id) {
  if (!isKnownProgram(id)) {
    throw new Error(`Unknown program: ${id}`);
  }
  return readJSON(path.join(PATHS.requirements, `${id}.json`));
}

/** Drop the cached listing. Used by tests that add fixture programs. */
export function resetPrograms() {
  programs = null;
}
