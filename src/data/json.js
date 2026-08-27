import fs from "node:fs";

/** @type {Map<string, unknown>} */
const cache = new Map();

/**
 * Read and parse a JSON file, caching the parsed value by path.
 *
 * The requirement engine reads the same files on every request. `prereqs.json`
 * alone is ~1.4 MB / 7,880 entries, and re-parsing it per submission dominated
 * request time. These files are static assets shipped with the app, so a
 * process-lifetime cache is the right lifetime.
 *
 * @param {string} filePath
 * @returns {any}
 */
export function readJSON(filePath) {
  if (!cache.has(filePath)) {
    cache.set(filePath, JSON.parse(fs.readFileSync(filePath, "utf-8")));
  }
  return cache.get(filePath);
}

/** Drop cached parses. Used by tests that write fixture files. */
export function clearJSONCache() {
  cache.clear();
}
