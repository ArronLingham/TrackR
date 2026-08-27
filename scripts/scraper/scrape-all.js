// scripts/scraper/scrape-all.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { scrapeOneCourse } from "./scrape-one.js"; // single-course scraper launches + closes its own browser when no page is passed

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LINKS_PATH = path.join(__dirname, "../../backend/course-data/course-links.json");
const OUT_PATH   = path.join(__dirname, "../../backend/course-data/prereqs.json");
const MISMATCH_LOG = path.join(__dirname, "../../backend/course-data/scrape-mismatches.log");

function appendLog(msg) {
  fs.appendFileSync(MISMATCH_LOG, msg + "\n");
}

function readJSONSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function writeJSON(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function scrapeAll() {
  const links = readJSONSafe(LINKS_PATH);
  const existing = readJSONSafe(OUT_PATH);
  const codes = Object.keys(links);

  console.log(`Found ${codes.length} courses in course-links.json`);
  console.log(`${Object.keys(existing).length} already scraped in prereqs.json`);

  let skipped = 0;
  let scraped = 0;
  let failed  = 0;

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    const url = links[code];

    if (existing[code]) {
      skipped++;
      continue;
    }

    console.log(`[${i + 1}/${codes.length}] Scraping ${code} …`);

    try {
      // Fresh browser + page per course (scrapeOneCourse handles opening & closing)
      const entry = await scrapeOneCourse(url);

      // If the page title produced a different code, log it but keep the known key
      if (entry.code !== code) {
        const warning = `Mismatch: expected "${code}" but scrape-one saw "${entry.code}". Using "${code}" as key.`;
        console.warn(`  ⚠️ ${warning}`);
        appendLog(`[${new Date().toISOString()}] ${warning} | URL: ${url}`);
      }

      // Always store under the known code (from course-links.json)
      existing[code] = {
        prereq_text: entry.prereq_text,
        prereq_codes: entry.prereq_codes,
        scraped_at: entry.scraped_at,
        source: entry.source,
      };
      scraped++;

      // Write after every course for maximum safety/correctness
      writeJSON(OUT_PATH, existing);

    } catch (e) {
      console.warn(`  !! failed ${code}: ${e.message}`);
      appendLog(`[${new Date().toISOString()}] ERROR: ${code} failed | ${e.message} | URL: ${url}`);
      failed++;
    }

    // small delay to be polite; adjust if you want
    await sleep(250);
  }

  const summary = `
Finished scraping all courses
Summary:
  Skipped (already in prereqs.json): ${skipped}
  Newly scraped: ${scraped}
  Failed: ${failed}
  Total saved: ${Object.keys(existing).length} → ${OUT_PATH}
`.trim();

  console.log(summary);
  appendLog(`[${new Date().toISOString()}] ${summary}`);
}

scrapeAll();
