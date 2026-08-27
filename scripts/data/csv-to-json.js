/**
 * Regenerate `backend/course-data/courses.json` from the course-offerings CSV.
 *
 * Run with `npm run data:courses`. There was no script for this before, only a
 * line in the README, and the file drifted: a title fix landed in the CSV in
 * September 2025 and never reached the JSON the app actually reads.
 */
import fs from "node:fs";
import csv from "csv-parser";
import { PATHS } from "../../src/data/paths.js";

const rows = [];
let skipped = 0;

fs.createReadStream(PATHS.courseOfferingsCsv, { encoding: "utf8" })
  .pipe(csv())
  .on("data", (row) => {
    const code = (row.code ?? row["Course code"] ?? "").trim();
    const title = (row.title ?? row["Course title"] ?? "").trim();
    if (code && title) {
      rows.push({ code, title });
    } else {
      skipped += 1;
    }
  })
  .on("end", () => {
    fs.writeFileSync(PATHS.courses, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
    console.log(`Wrote ${rows.length} courses to ${PATHS.courses}`);
    if (skipped) console.warn(`Skipped ${skipped} row(s) missing a code or title`);
  })
  .on("error", (error) => {
    console.error("Failed to read the CSV:", error.message);
    process.exitCode = 1;
  });
