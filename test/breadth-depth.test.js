import test from "node:test";
import assert from "node:assert/strict";
import { canonical } from "../src/data/catalog.js";
import { checkBreadth } from "../src/domain/breadth.js";
import { checkDepth } from "../src/domain/depth.js";

const taken = (...codes) => new Set(codes.map(canonical));

test("breadth counts each course toward at most one category", () => {
  // BIOL is listed under both pure and applied sciences. Four BIOL courses
  // must not fill applied sciences four times over.
  const result = checkBreadth(taken("BIOL130", "BIOL239", "BIOL308", "BIOL359"));
  for (const category of Object.values(result.categories)) {
    assert.ok(
      category.taken.length <= category.needed,
      `${category.label} counted ${category.taken.length} of ${category.needed}`,
    );
  }
  const counted = Object.values(result.categories).flatMap((category) => category.taken);
  assert.equal(new Set(counted).size, counted.length, "a course was counted twice");
});

test("breadth satisfies pure and applied from two overlapping courses", () => {
  const result = checkBreadth(taken("PHYS121", "CHEM120"));
  assert.equal(result.categories.pure_sciences.met, true);
  assert.equal(result.categories.applied_sciences.met, true);
});

test("breadth ignores math-faculty subjects", () => {
  const result = checkBreadth(taken("CS341", "MATH237", "STAT230", "PMATH330"));
  for (const category of Object.values(result.categories)) {
    assert.deepEqual(category.taken, []);
  }
  assert.equal(result.satisfied, false);
});

test("breadth ignores List 1 communication courses", () => {
  // ENGL is a humanities subject, but ENGL 109 is a List 1 communication
  // course and the calendar says it cannot also be humanities breadth.
  const result = checkBreadth(taken("ENGL109", "ENGL129R"));
  assert.deepEqual(result.categories.humanities.taken, []);
});

test("breadth is met by a full spread", () => {
  const result = checkBreadth(
    taken("PHIL145", "HIST190", "ECON101", "PSYCH101", "PHYS121", "HEALTH107"),
  );
  assert.equal(result.satisfied, true, JSON.stringify(result.categories, null, 2));
});

test("depth option 1: three courses in one subject with one at 300+", () => {
  const result = checkDepth(taken("PSYCH101", "PSYCH211", "PSYCH315"));
  assert.equal(result.satisfied, true);
  assert.equal(result.option_met, 1);
  assert.equal(result.subject, "PSYCH");
});

test("depth needs a 300-level course, not just three courses", () => {
  const result = checkDepth(taken("PSYCH101", "PSYCH211", "PSYCH212"));
  assert.equal(result.satisfied, false);
  assert.equal(result.subject, "PSYCH");
  assert.match(result.note, /300-level/);
});

test("depth cannot come from a math subject", () => {
  const result = checkDepth(taken("CS135", "CS240", "CS341"));
  assert.equal(result.satisfied, false);
});

test("depth reports something useful when nothing qualifies", () => {
  const result = checkDepth(taken("CS135"));
  assert.equal(result.satisfied, false);
  assert.ok(result.note.length > 0);
  assert.ok(Array.isArray(result.examples));
});
