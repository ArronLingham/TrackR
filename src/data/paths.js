import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every filesystem path the app reads, resolved once from this module's own
 * location. Nothing in the app may build a data path from `process.cwd()` — the
 * server used to read its views relative to the working directory, so it only
 * ran correctly when started from the repository root.
 */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const PATHS = {
  root: ROOT,
  views: path.join(ROOT, "views"),
  public: path.join(ROOT, "public"),
  courseData: path.join(ROOT, "backend/course-data"),
  courses: path.join(ROOT, "backend/course-data/courses.json"),
  courseOfferingsCsv: path.join(ROOT, "backend/course-data/course offerings.csv"),
  crossListings: path.join(ROOT, "backend/course-data/cross-listings.json"),
  prereqs: path.join(ROOT, "backend/course-data/prereqs.json"),
  requirements: path.join(ROOT, "backend/requirements"),
  breadth: path.join(ROOT, "backend/requirements/breadth.json"),
  depth: path.join(ROOT, "backend/requirements/depth.json"),
};
