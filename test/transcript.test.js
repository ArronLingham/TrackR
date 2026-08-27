import test from "node:test";
import assert from "node:assert/strict";
import { parseTranscript } from "../src/domain/transcript.js";
import { summarizeAcademics } from "../src/domain/academics.js";

const QUEST = [
  "Undergraduate Unofficial Transcript",
  "Program: Mathematics, Bachelor of Mathematics",
  "",
  "Fall 2022    Level: 1A",
  "Course       Description                            Attempted  Earned  Grade",
  "CS 135       Designing Functional Programs          0.50       0.50    95",
  "MATH 135     Algebra for Honours Mathematics        0.50       0.50    88",
  "MATH 137     Calculus 1 for Honours Mathematics     0.50       0.50    91",
  "ENGL 109     Introduction to Academic Writing       0.50       0.50    82",
  "MTHEL 131    Introduction to Actuarial Practice     0.25       0.25    78",
  "Term Average: 89.20",
  "",
  "Winter 2023    Level: 1B",
  "PD 1         Career Fundamentals                    0.50       0.50    CR",
  "ACTSC 231    Introductory Financial Mathematics     0.50       0.00    45",
  "ACTSC 232    Life Contingencies 1                   0.50       0.00    WD",
  "",
  "Spring 2023   Level: 2A",
  "ACTSC 231    Introductory Financial Mathematics     0.50       0.50    77",
  "ACTSC 232    Life Contingencies 1                   0.50       0.50    68",
  "",
  "Fall 2023   Level: 2B",
  "STAT 231     Statistics                             0.50",
].join("\n");

const codes = (result) => result.entries.map((entry) => entry.code);

test("a Quest transcript parses into terms and courses", () => {
  const result = parseTranscript(QUEST);
  assert.deepEqual(
    result.terms.map((term) => `${term.name} ${term.level}`),
    ["Fall 2022 1A", "Winter 2023 1B", "Spring 2023 2A", "Fall 2023 2B"],
  );
  assert.equal(result.hasGrades, true);
  assert.equal(result.hasUnits, true);
  assert.deepEqual(result.unparsedLines, [], "header rows should not be reported as courses");
  assert.deepEqual(result.unknownCodes, []);
});

test("a course number in the title is not mistaken for a grade", () => {
  // Both rows end in a bare "1" that belongs to the course name. The graded
  // row must read 68, and the ungraded one must stay ungraded.
  const result = parseTranscript(
    [
      "ACTSC 231    Introductory Financial Mathematics    0.50   0.50   77",
      "ACTSC 232    Life Contingencies 1                  0.50   0.50   68",
      "ACTSC 331    Life Contingencies 2                  0.50",
    ].join("\n"),
  );

  const byCode = Object.fromEntries(result.entries.map((entry) => [entry.code, entry]));
  assert.equal(byCode.ACTSC232.grade.percent, 68);
  assert.equal(byCode.ACTSC331.grade.raw, "", "the trailing 2 is part of the title");
  assert.equal(byCode.ACTSC331.grade.inProgress, true);
  assert.equal(byCode.ACTSC331.units, 0.5);
});

test("a retake replaces the failed attempt for requirement purposes", () => {
  const result = parseTranscript(QUEST);
  const actsc231 = result.entries.filter((entry) => entry.code === "ACTSC231");
  assert.equal(actsc231.length, 1);
  assert.equal(actsc231[0].grade.percent, 77);

  // Both attempts survive for averaging, because Waterloo counts both.
  const attempts = result.attempts.filter((entry) => entry.code === "ACTSC231");
  assert.deepEqual(attempts.map((entry) => entry.grade.percent), [45, 77]);
});

test("a course with no grade is in progress, not complete", () => {
  const result = parseTranscript(QUEST);
  const stat231 = result.entries.find((entry) => entry.code === "STAT231");
  assert.equal(stat231.grade.inProgress, true);
  assert.equal(stat231.grade.earnsCredit, false);
});

test("units are read from the transcript, not assumed", () => {
  const result = parseTranscript(QUEST);
  assert.equal(result.entries.find((entry) => entry.code === "MTHEL131").units, 0.25);
  assert.equal(result.entries.find((entry) => entry.code === "CS135").unitsAssumed, false);
});

test("a plain course list still works and counts as complete", () => {
  const result = parseTranscript("CS135, math 137, CS136L, STAT230");
  assert.deepEqual(codes(result), ["CS135", "MATH137", "CS136L", "STAT230"]);
  assert.equal(result.hasGrades, false);
  assert.ok(result.entries.every((entry) => entry.grade.earnsCredit));
});

test("typos in a list are reported rather than dropped", () => {
  const result = parseTranscript("CS135, CS9999, MATH137, NOPE1");
  assert.deepEqual(result.unknownCodes, ["CS9999", "NOPE1"]);
});

test("hand-typed grades and delimited rows both parse", () => {
  assert.equal(parseTranscript("CS135 95").entries[0].grade.percent, 95);
  assert.equal(parseTranscript("CS 135, 0.50, 95").entries[0].grade.percent, 95);
  assert.equal(parseTranscript("CS 135\t0.50\t0.50\t95").entries[0].grade.percent, 95);
});

test("prose only yields courses the catalogue knows", () => {
  const result = parseTranscript("I took Introduction to CS 135 and enjoyed it");
  assert.deepEqual(codes(result), ["CS135"]);
});

test("empty input is not an error", () => {
  const result = parseTranscript("");
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.terms, []);
});

test("academics reports Waterloo's numbers", () => {
  const academics = summarizeAcademics(parseTranscript(QUEST));

  // Fall 2022: (95+88+91+82)*0.5 + 78*0.25, over 2.25 units.
  const fall = academics.averages.terms.find((term) => term.name === "Fall 2022");
  assert.equal(fall.average, 87.8);
  assert.equal(fall.units, 2.25);

  assert.ok(academics.averages.cumulative > 0);
  assert.equal(academics.averages.meetsMinimum, true);
  assert.equal(academics.units.required, 20);
  assert.equal(academics.units.inProgress, 0.5, "STAT 231 has no grade yet");
  assert.equal(academics.units.failed, 0.5, "the first ACTSC 231 attempt");
});

test("COOP, PD and WKRPT units are excluded from the degree total", () => {
  const withPd = summarizeAcademics(parseTranscript("PD 1  Career Fundamentals  0.50  0.50  CR"));
  assert.equal(withPd.units.earned, 0);
  assert.equal(withPd.counts.courses, 0);
});

test("MTHEL and COMM count as non-math units", () => {
  const academics = summarizeAcademics(parseTranscript(QUEST));
  // ENGL 109 (0.5) + MTHEL 131 (0.25)
  assert.equal(academics.units.nonMath.earned, 0.75);
  assert.equal(academics.units.nonMath.met, false);
});

test("units are flagged as assumed when the paste omits them", () => {
  const assumed = summarizeAcademics(parseTranscript("CS135, MATH137"));
  assert.equal(assumed.units.unitsAssumed, true);
  const stated = summarizeAcademics(parseTranscript("CS 135  0.50  0.50  95"));
  assert.equal(stated.units.unitsAssumed, false);
});

test("a grade report with no units column still yields grades", () => {
  // The WaterlooWorks grade report and most hand-typed lists look like this:
  // no unit columns, just a code, a title and a mark.
  const result = parseTranscript(
    [
      "Term: Fall 2022",
      "CS 135 Designing Functional Programs 95",
      "MATH 135 Algebra for Honours Mathematics 88",
      "ACTSC 232 Life Contingencies 1 68",
      "STAT 230 Probability CR",
    ].join("\n"),
  );

  const byCode = Object.fromEntries(result.entries.map((entry) => [entry.code, entry]));
  assert.equal(byCode.CS135.grade.percent, 95);
  assert.equal(byCode.MATH135.grade.percent, 88);
  // The "1" belongs to the title; 68 is the mark.
  assert.equal(byCode.ACTSC232.grade.percent, 68);
  assert.equal(byCode.STAT230.grade.raw, "CR");
  assert.equal(result.hasGrades, true);
  assert.equal(result.hasUnits, false, "units were not stated, so they are assumed");
});

test("a title's sequence number is not read as a grade", () => {
  const result = parseTranscript(
    ["CS 135 Designing Functional Programs 95", "ACTSC 331 Life Contingencies 2"].join("\n"),
  );
  const byCode = Object.fromEntries(result.entries.map((entry) => [entry.code, entry]));
  assert.equal(byCode.ACTSC331.grade.raw, "", "the trailing 2 is part of the title");
  assert.equal(byCode.ACTSC331.grade.inProgress, true);
});

test("term headers are recognised however they are labelled", () => {
  for (const header of ["Fall 2022", "Term: Fall 2022", "2022 Fall", "Fall 2022 Term"]) {
    const result = parseTranscript(`${header}\nCS 135 Designing Functional Programs 95`);
    assert.deepEqual(
      result.terms.map((term) => term.name),
      ["Fall 2022"],
      `failed for ${JSON.stringify(header)}`,
    );
    assert.equal(result.entries.length, 1);
  }
});

test("a course row is never swallowed as a term header", () => {
  // A course line that happens to mention a year must stay a course.
  const result = parseTranscript("HIST 250 Canada Since 1945 0.50 0.50 77");
  assert.deepEqual(result.terms, []);
  assert.equal(result.entries[0].code, "HIST250");
  assert.equal(result.entries[0].grade.percent, 77);
});

/**
 * A Quest transcript copied out of the PDF. The Winter term is deliberately
 * mangled the way the real export mangles it: the course codes end up on one
 * line and their titles, units and grades on the lines that follow.
 */
const QUEST_PDF = [
  "University of Waterloo",
  "Page 1 of 3",
  "Undergraduate Unofficial Transcript",
  "Beginning of Undergraduate Record",
  "Fall 2024",
  "Program: Mathematics, Honours, Co-operative Program",
  "Level: 1A Form Of Study: Enrolment",
  "Course Description Attempted Earned Grade",
  "COMMST 100 Interpersonal Communication 0.50 0.50 86",
  "CS 135 Designing Functional Programs 0.50 0.50 93",
  "MATH 135 Algebra for Honours Mathematics 0.50 0.50 76",
  "MATH 137 Calculus 1 for Honours Mathematics 0.50 0.50 77",
  "MTHEL 99 First-Year Mathematics Readiness 0.00 0.00 CR",
  "In GPA Earned",
  "Term GPA 83.00 Term Totals 2.50 2.50",
  "Cumulative GPA 83.00 Cumulative Totals 2.50 2.50",
  "Major Average: 82.00 Mathematics, Honours, Co-operative Program",
  "Academic Standing: Excellent Standing Effective 01/21/2025",
  "07/29/2024-Declined ENGL 1XX, ECON 1XX.DC",
  "Winter 2025",
  "Course Description CS 136 CS 136L ECON 102 MATH 136 Program: Mathematics, Honours",
  "Level: 1B Form Of Study: Enrolment",
  "Attempted Earned Grade",
  "Elementary Algorithm Design and Data Abstraction 0.50 0.50 72",
  "Tools and Techniques for Software Development 0.25 0.25 CR",
  "Introduction to Macroeconomics 0.50 0.50 90",
  "Linear Algebra 1 for Honours Mathematics 0.50 0.50 73",
  "PD 1 Career Fundamentals 0.50 0.00 CR",
  "In GPA Earned",
  "Term GPA 78.33 Term Totals 2.25 1.75",
  "Major Average: 77.50 Mathematics, Honours, Co-operative Program",
].join("\n");

test("words that merely look like course codes are not treated as courses", () => {
  // "Term GPA 83.00" and "Linear Algebra 1 ..." both match a course-code
  // pattern. Reporting them as unrecognised codes used to reject the whole
  // submission.
  const result = parseTranscript(QUEST_PDF);
  assert.deepEqual(result.unknownCodes, []);
  const codesFound = result.entries.map((entry) => entry.code);
  for (const bogus of ["GPA83", "ALGEBRA1", "CALCULUS1", "ENGL1XX", "ECON1XX"]) {
    assert.ok(!codesFound.includes(bogus), `${bogus} should not be a course`);
  }
});

test("a scrambled PDF column is stitched back together", () => {
  const result = parseTranscript(QUEST_PDF);
  const byCode = Object.fromEntries(result.entries.map((entry) => [entry.code, entry]));

  assert.equal(byCode.CS136.grade.percent, 72);
  assert.equal(byCode.CS136L.grade.raw, "CR");
  assert.equal(byCode.CS136L.units, 0.25, "units come from the row, not the default");
  assert.equal(byCode.ECON102.grade.percent, 90);
  assert.equal(byCode.MATH136.grade.percent, 73);
  assert.equal(byCode.PD1.grade.raw, "CR");

  const winter = result.terms.find((term) => term.name === "Winter 2025");
  assert.equal(winter.level, "1B");
  assert.equal(winter.entries.length, 5);
});

test("term totals are never mistaken for a course's grade row", () => {
  const result = parseTranscript(QUEST_PDF);
  // If "Term GPA 78.33 Term Totals ..." were paired with a course code, the
  // counts would not line up and nothing in Winter 2025 would get a grade.
  assert.ok(result.entries.every((entry) => entry.grade.raw !== "78"));
  assert.deepEqual(result.unparsedLines, []);
});

test("computed averages match the ones the transcript states", () => {
  const academics = summarizeAcademics(parseTranscript(QUEST_PDF));
  const byTerm = Object.fromEntries(academics.averages.terms.map((t) => [t.name, t.average]));

  // Fall 2024: (86 + 93 + 76 + 77) × 0.5 over 2.0 units — MTHEL 99 is CR.
  assert.equal(byTerm["Fall 2024"], 83);
  // Winter 2025: (72 + 90 + 73) × 0.5 over 1.5 units — CS 136L and PD 1 are CR.
  assert.equal(byTerm["Winter 2025"], 78.3);
});

test("transfer credits earn units without a mark", () => {
  const result = parseTranscript(
    ["Transfer Credit from Some High School", "CHEM 120 General Chemistry 1 CHEM 123 General Chemistry 2"].join("\n"),
  );
  assert.equal(result.entries.length, 2);
  for (const entry of result.entries) {
    assert.equal(entry.grade.earnsCredit, true, `${entry.code} should earn credit`);
    assert.equal(entry.grade.inAverage, false, `${entry.code} should stay out of averages`);
    assert.equal(entry.term, null, "transfer credits belong to no term");
  }
});
