import test from "node:test";
import assert from "node:assert/strict";
import { approximateGpa, parseGrade, weightedAverage } from "../src/domain/grades.js";

test("a numeric grade passes at 50", () => {
  assert.equal(parseGrade("50").earnsCredit, true);
  assert.equal(parseGrade("49").earnsCredit, false);
  assert.equal(parseGrade("49").failed, true);
});

test("grades below 32 are averaged in as 32", () => {
  // "any grade below 32% will be calculated into averages as a 32%"
  assert.equal(parseGrade("0").value, 32);
  assert.equal(parseGrade("20").value, 32);
  assert.equal(parseGrade("45").value, 45);
  assert.equal(parseGrade("0").percent, 0, "the reported mark is preserved");
});

test("CR earns credit but is excluded from averages", () => {
  const cr = parseGrade("CR");
  assert.equal(cr.earnsCredit, true);
  assert.equal(cr.inAverage, false);
});

test("failing non-numeric grades carry a value of 32", () => {
  for (const code of ["DNW", "FTC", "NMR", "WF"]) {
    const grade = parseGrade(code);
    assert.equal(grade.value, 32, `${code} should average as 32`);
    assert.equal(grade.earnsCredit, false);
    assert.equal(grade.failed, true);
  }
});

test("withdrawing is not a failure and does not touch the average", () => {
  const wd = parseGrade("WD");
  assert.equal(wd.failed, false);
  assert.equal(wd.earnsCredit, false);
  assert.equal(wd.inAverage, false);
});

test("in-progress markers are recognised", () => {
  for (const code of ["IP", "NG", "MM", ""]) {
    assert.equal(parseGrade(code).inProgress, true, `${code || "(blank)"} should be in progress`);
  }
});

test("pre-2001 letter grades use the legend's values", () => {
  assert.equal(parseGrade("A+").value, 95);
  assert.equal(parseGrade("D-").value, 52);
  assert.equal(parseGrade("D-").earnsCredit, true);
  assert.equal(parseGrade("F+").value, 46);
  assert.equal(parseGrade("F+").earnsCredit, false);
});

test("averages are weighted by units", () => {
  const average = weightedAverage([
    { units: 0.5, grade: parseGrade("90") },
    { units: 0.25, grade: parseGrade("60") },
  ]);
  // (0.5*90 + 0.25*60) / 0.75
  assert.equal(Math.round(average * 100) / 100, 80);
});

test("courses outside the average are skipped", () => {
  const average = weightedAverage([
    { units: 0.5, grade: parseGrade("80") },
    { units: 0.5, grade: parseGrade("CR") },
    { units: 0.5, grade: parseGrade("") },
  ]);
  assert.equal(average, 80);
  assert.equal(weightedAverage([{ units: 0.5, grade: parseGrade("CR") }]), null);
});

test("the 4.0 estimate is monotonic and bounded", () => {
  assert.equal(approximateGpa(95), 4.0);
  assert.equal(approximateGpa(60), 1.7);
  assert.equal(approximateGpa(20), 0);
  assert.equal(approximateGpa(null), null);
  for (let percent = 0; percent < 100; percent += 1) {
    assert.ok(approximateGpa(percent) <= approximateGpa(percent + 1));
  }
});
