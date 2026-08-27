// scripts/scraper/scrape-index.js
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_PATH = path.join(__dirname, "../../backend/course-data/course-links.json");

function writeJSON(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const distance = 800;
      const timer = setInterval(() => {
        const el = document.scrollingElement || document.documentElement;
        const max = (el?.scrollHeight || document.body.scrollHeight) - window.innerHeight - 20;
        window.scrollBy(0, distance);
        total += distance;
        if (total >= max) {
          clearInterval(timer);
          resolve();
        }
      }, 120);
    });
  });
}

async function scrapeIndex() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "TrackRScraper/1.0 (+edu noncommercial)",
    viewport: { width: 1200, height: 900 },
  });
  const page = await context.newPage();

  // 1) open catalog -> Courses
  await page.goto(
    "https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog#/courses",
    { waitUntil: "domcontentloaded" }
  );
  // let the SPA finish booting
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(800);

  // 2) collect all subject group links (?group=...), without requiring visibility
  //    (these are the "open in new tab" links on each subject row)
  // NOTE: do NOT use waitForSelector with default visibility requirement.
  await page.waitForSelector('a[href*="#/courses?group="]', { state: "attached", timeout: 60000 });
  const subjectLinks = await page.$$eval('a[href*="#/courses?group="]', (as) => {
    const set = new Set();
    for (const a of as) {
      if (a && a.href) set.add(a.href);
    }
    return [...set];
  });

  console.log(`Found ${subjectLinks.length} subject pages`);

  const courseMap = {};

  // 3) visit each subject page & harvest its course links
  for (let i = 0; i < subjectLinks.length; i++) {
    const subjectUrl = subjectLinks[i];
    console.log(`\n[${i + 1}/${subjectLinks.length}] Subject: ${subjectUrl}`);

    const sp = await context.newPage();
    try {
      await sp.goto(subjectUrl, { waitUntil: "domcontentloaded" });
      await sp.waitForLoadState("networkidle").catch(() => {});
      await sleep(500);

      // ensure large lists render
      await autoScroll(sp);
      await sleep(400);

      // wait for course anchors to be attached (not necessarily visible)
      // use both h3 and h2 just in case
      const selector = 'a[href*="/courses/"]';
      await sp.waitForSelector(selector, { state: "attached", timeout: 60000 });

      const entries = await sp.$$eval(selector, (links) => {
        const out = [];
        for (const a of links) {
          const txt = (a.textContent || "").trim();
          const href = a.href;
          // course code at start: AFM 101, PHYS122, CS 136, etc.
          const m = txt.match(/^([A-Z]{2,5})\s*([0-9]{2,3}[A-Z]?)/);
          if (m && href.includes("/courses/")) {
            const code = `${m[1]} ${m[2]}`.toUpperCase();
            out.push([code, href]);
          }
        }
        return out;
      });

      console.log(`  + ${entries.length} course links`);
      for (const [code, url] of entries) {
        courseMap[code] = url; // de-dupe by last write
      }
    } catch (e) {
      console.warn(`  !! failed subject ${subjectUrl}: ${e.message}`);
    } finally {
      await sp.close();
    }

    // be gentle to the host
    await sleep(300);
  }

  await browser.close();

  // 4) save consolidated mapping
  writeJSON(OUT_PATH, courseMap);
  console.log(`\nSaved ${Object.keys(courseMap).length} unique course links → ${OUT_PATH}`);
}

scrapeIndex();
