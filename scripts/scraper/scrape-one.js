// scripts/scraper/scrape-one.js
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- helpers ----
const OUT_PATH = path.join(__dirname, "../../backend/course-data/prereqs.json");

function normalizeCode(raw) {
  const m = raw.toUpperCase().match(/([A-Z]{2,5})\s*([0-9]{2,3}[A-Z]?)/);
  return m ? `${m[1]} ${m[2]}` : null;
}

function extractCourseCodes(text) {
  const codes = new Set();
  const re = /\b([A-Z]{2,5})\s*([0-9]{2,3}[A-Z]?)\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const norm = normalizeCode(`${m[1]} ${m[2]}`);
    if (norm) codes.add(norm);
  }
  return [...codes];
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

// ---- main scrape ----
// Exported so batch scraper can reuse it
export async function scrapeOneCourse(courseUrl, page = null) {
  let browser;
  if (!page) {
    browser = await chromium.launch();
    page = await browser.newPage({ userAgent: "TrackRScraper/1.0 (+edu noncommercial)" });
  }

  await page.goto(courseUrl, { waitUntil: "domcontentloaded" });

  // Derive course code from the page <h1>
  let title = "";
  try {
    title = (await page.locator("h1").first().innerText()).trim();
  } catch {}
  const codeFromTitle = normalizeCode(title) || normalizeCode(courseUrl) || "UNKNOWN";

  let prereqText = "";
  let prereqCodes = [];
  try {
    // ---- Primary selector (structured DOM) ----
    const prereqHeading = page.locator("h3.course-view__label___FPV12", { hasText: "Prerequisites" });
    const sibling = prereqHeading.locator("xpath=following-sibling::*[1]");
    prereqText = (await sibling.innerText()).trim();

    // cut off at Coreq/Antireq if present
    prereqText = prereqText.split("Corequisites")[0].split("Antirequisites")[0].trim();
    prereqCodes = extractCourseCodes(prereqText).filter(c => c !== codeFromTitle);
  } catch (e1) {
    console.log(`Primary parse failed for ${codeFromTitle}, trying fallback…`);
    try {
      // ---- Fallback selector (broader) ----
      const prereqSection = page.locator('div:has-text("Prerequisites")').first();
      prereqText = await prereqSection.innerText();
      prereqText = prereqText.split("Corequisites")[0].split("Antirequisites")[0].trim();
      prereqCodes = extractCourseCodes(prereqText).filter(c => c !== codeFromTitle);
    } catch (e2) {
      console.log("No prerequisites found for this course:", codeFromTitle);
    }
  }

  if (browser) await browser.close();

  return {
    code: codeFromTitle,
    prereq_text: prereqText,
    prereq_codes: prereqCodes,
    scraped_at: new Date().toISOString(),
    source: courseUrl,
  };
}

// ---- CLI usage ----
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const courseUrl = process.argv[2];
    if (!courseUrl) {
      console.error("Usage: node scripts/scraper/scrape-one.js <course-url>");
      process.exit(1);
    }

    const entry = await scrapeOneCourse(courseUrl);

    const db = readJSONSafe(OUT_PATH);
    db[entry.code] = {
      prereq_text: entry.prereq_text,
      prereq_codes: entry.prereq_codes,
      scraped_at: entry.scraped_at,
      source: entry.source,
    };
    writeJSON(OUT_PATH, db);

    console.log(
      `Saved ${entry.code} with ${entry.prereq_codes.length} prereq code(s) → ${OUT_PATH}`
    );
  })();
}
