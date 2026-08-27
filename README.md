# TrackR

Course requirement tracker to make sure you're on track to graduate from the University of Waterloo.

Pick your program, paste your transcript, and **TrackR** tells you which requirements you have met, what is still outstanding, your averages, and how many credits you have — all checked against the official University of Waterloo Undergraduate Studies Calendar.

## ✨ Features

- **Flexible Parsing**: Paste directly from Quest, copy a spreadsheet, or hand-type a list of your courses. TrackR understands full unofficial transcripts (including transfer credits!), simple course lists, and grades.
- **Smart Averages**: Computes your unit-weighted percentages automatically, correctly handling edge cases like failures below 32% (averaged as 32%), repeats (highest counts for credit, both count in averages), and exclusions (CR, WD, AEG).
- **Requirement Verification**: Checks your courses against specific degree rules, including core courses, electives, breadth, and depth constraints.
- **Up-to-date Catalog**: Comes with scripts to scrape the latest University of Waterloo public undergraduate catalog.

## 🚀 Quickstart

TrackR requires **Node.js 20 or newer**.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/jovitta-seb/uwreq.git
   cd uwreq
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

4. Open your browser and navigate to `http://localhost:3000`. 
   *(Use `npm run dev` for auto-reload during development, or `PORT=4000 npm start` to change the port).*

## 📖 How it Works

1. **Select your program:** Choose your academic path from the dropdown (e.g., BCS Computer Science, BMath Actuarial Science).
2. **Paste your transcript:** You can paste your entire unofficial Quest transcript directly into the text box. The parser is robust enough to extract course codes, units, and grades line by line, skipping any boilerplate.
3. **View your progress:** TrackR will generate a breakdown showing:
   - Your total earned credits.
   - Your cumulative averages.
   - Which specific degree rules are met, in-progress, or outstanding.

### Example inputs

You can paste a detailed table:
```
Fall 2022    Level: 1A
CS 135       Designing Functional Programs      0.50   0.50   95
MATH 135     Algebra for Honours Mathematics    0.50   0.50   88
```

Or just a simple list:
```
CS135, MATH137, STAT230
```

## 🛠️ Project Architecture

- **`index.js` / `src/app.js`**: The main Express server entry point.
- **`src/domain/`**: The core application logic. This includes the transcript parser (`transcript.js`), requirement validators (`requirements.js`, `rules.js`), and average calculations (`academics.js`, `grades.js`).
- **`src/routes/`**: Express route handlers for the web pages and API.
- **`backend/requirements/`**: JSON files defining the curriculum rules for different programs. 
- **`backend/course-data/`**: Datasets containing the course catalogue, prerequisites, and cross-listings.
- **`scripts/`**: Utility scripts for fixing data and scraping the latest course catalog using Playwright.

## ➕ Adding a New Program

To add a new academic program:
1. Create a new JSON file in `backend/requirements/` named after the program.
2. Define the requirement blocks (e.g., `all_required`, `one_required`, `n_required`, `range_required`).
3. Run `npm test` to validate your new requirement file against the course catalogue schema.

## 🧪 Testing

TrackR uses the built-in Node.js test runner. No network access is required to run the core tests.

```bash
npm test             # Run the full test suite
npm run typecheck    # Validate TypeScript types
```

## ⚠️ Disclaimer

TrackR is a student project, not an official University of Waterloo tool. It checks the requirements a plan lists by name, but does not track complex conditional sequences or term-by-term prerequisites. **Always confirm your academic standing with a university advisor.**
