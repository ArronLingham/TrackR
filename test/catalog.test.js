import test from "node:test";
import assert from "node:assert/strict";
import {
  bySubject,
  canonical,
  get,
  has,
  levelOf,
  normalizeCode,
  parseCode,
  size,
  subjectOf,
} from "../src/data/catalog.js";

test("normalizeCode accepts whatever a student types", () => {
  for (const raw of ["MATH237", "math 237", " Math237 ", "MATH  237", "math.237"]) {
    assert.equal(normalizeCode(raw), "MATH237", `failed for ${JSON.stringify(raw)}`);
  }
});

test("parseCode splits subject, number and suffix", () => {
  assert.deepEqual(parseCode("CS136L"), { subject: "CS", number: 136, suffix: "L" });
  assert.deepEqual(parseCode("COMMST100"), { subject: "COMMST", number: 100, suffix: "" });
  assert.deepEqual(parseCode("ACTSC231"), { subject: "ACTSC", number: 231, suffix: "" });
  assert.equal(parseCode("not-a-code"), null);
});

test("every catalogue code parses", () => {
  // The engine derives subject and level from this parse, so a code it cannot
  // read would silently drop out of every subject rule.
  const unparseable = [];
  for (const subject of ["CS", "MATH", "ACTSC", "CO", "AMATH", "PMATH", "STAT", "ECON"]) {
    for (const course of bySubject(subject)) {
      if (!parseCode(course.code)) unparseable.push(course.code);
    }
  }
  assert.deepEqual(unparseable, []);
});

test("subject prefixes do not bleed into one another", () => {
  // "CO" is a prefix of COMMST, COGSCI, COMM and COOP. Matching on the parsed
  // subject rather than on startsWith is what keeps them apart.
  assert.equal(subjectOf("COMMST300"), "COMMST");
  assert.equal(subjectOf("CO350"), "CO");
  assert.ok(bySubject("CO").every((course) => course.code.startsWith("CO") && /^CO\d/.test(course.code)));
  assert.ok(bySubject("CO").every((course) => course.subject === "CO"));
  assert.ok(!bySubject("CO").some((course) => course.code.startsWith("COMM")));
});

test("levelOf reads the course number", () => {
  assert.equal(levelOf("CS480"), 480);
  assert.equal(levelOf("ECON101"), 101);
  assert.equal(levelOf("garbage"), 0);
});

test("cross-listed codes resolve to one course", () => {
  assert.equal(canonical("CS371"), canonical("AMATH242"));
  assert.equal(canonical("MTHEL300"), canonical("ENGL378"));
  assert.equal(canonical("BIOL382"), canonical("AMATH382"));
});

test("courses missing from the catalogue snapshot resolve through cross-listings", () => {
  // Neither code appears in courses.json; the cross-listing file supplies the
  // course so a student is not told a real course does not exist.
  assert.ok(has("MTHEL300"));
  assert.ok(has("ACTSC471"));
  assert.ok(has("AFM476"));
  assert.equal(get("AFM476").code, "ACTSC471");
});

test("a cross-listed course appears once, so counts cannot double", () => {
  assert.equal(get("CS371").code, "AMATH242");
  assert.ok(get("AMATH242").aliases.includes("CS371"));
  assert.ok(!bySubject("CS").some((course) => course.code === "CS371"));
});

test("unknown codes are rejected", () => {
  assert.ok(!has("ZZZ999"));
  assert.ok(!has(""));
  assert.ok(has("CS135"));
});

test("the catalogue is non-trivial", () => {
  assert.ok(size() > 4000, `catalogue only has ${size()} courses`);
});
