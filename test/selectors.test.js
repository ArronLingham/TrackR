import test from "node:test";
import assert from "node:assert/strict";
import { candidatesFor } from "../src/domain/selectors.js";
import { subjectOf } from "../src/data/catalog.js";

const codes = (candidates) => candidates.map((candidate) => candidate.code);

test("level_ranges match only the declared subject", () => {
  // Regression: `startsWith("CO")` used to return 24 courses for "CO3", of
  // which 14 were COMMST, COGSCI or COMM.
  const resolved = candidatesFor({ level_ranges: ["CO3"] });
  assert.ok(resolved.length > 0);
  for (const candidate of resolved) {
    assert.equal(subjectOf(candidate.code), "CO", `${candidate.code} is not a CO course`);
  }
  assert.ok(!codes(resolved).includes("COMMST300"));
  assert.ok(!codes(resolved).includes("COGSCI300"));
});

test("numeric ranges match only the declared subject", () => {
  const resolved = candidatesFor({ range: ["CO350-CO499"] });
  assert.ok(resolved.length > 0);
  for (const candidate of resolved) {
    assert.equal(subjectOf(candidate.code), "CO");
  }
  assert.ok(!codes(resolved).some((code) => code.startsWith("COMM")));
});

test("category_ranges match only the declared subject", () => {
  for (const candidate of candidatesFor({ category_ranges: ["ME"] })) {
    assert.equal(subjectOf(candidate.code), "ME", `${candidate.code} leaked into ME`);
  }
});

test("numeric ranges are inclusive at both ends", () => {
  const resolved = codes(candidatesFor({ range: ["CS340-CS398"] }));
  assert.ok(resolved.includes("CS341"));
  assert.ok(resolved.includes("CS370"));
  assert.ok(!resolved.includes("CS440"));
  assert.ok(!resolved.includes("CS240"));
});

test("a bare code in a range resolves to that single course", () => {
  assert.deepEqual(codes(candidatesFor({ range: ["CO487"] })), ["CO487"]);
});

test("level tokens cover exactly one hundred-block", () => {
  // Suffixed codes such as CS499R are still CS 400-level courses.
  for (const candidate of candidatesFor({ level_ranges: ["CS4"] })) {
    assert.ok(candidate.code.match(/^CS4\d\d[A-Z]*$/), `${candidate.code} is outside CS400-499`);
  }
});

test("patterns and level_ranges behave identically", () => {
  assert.deepEqual(
    codes(candidatesFor({ patterns: ["AFM3"] })).sort(),
    codes(candidatesFor({ level_ranges: ["AFM3"] })).sort(),
  );
});

test("excluded courses are removed", () => {
  const withExclusion = codes(candidatesFor({ range: ["CS340-CS398"] }, new Set(["CS341"])));
  assert.ok(!withExclusion.includes("CS341"));
  assert.ok(withExclusion.includes("CS370"));
});

test("a course reached twice appears once", () => {
  // CS341 is in the explicit list and inside the range.
  const resolved = candidatesFor({
    courses: [{ code: "CS341", title: "Algorithms" }],
    range: ["CS340-CS398"],
  });
  assert.equal(codes(resolved).filter((code) => code === "CS341").length, 1);
});

test("cross-listed codes collapse to one candidate that remembers both", () => {
  const resolved = candidatesFor({
    courses: [{ code: "AMATH242" }, { code: "CS371" }],
  });
  assert.equal(resolved.length, 1);
  assert.deepEqual(resolved[0].codes.sort(), ["AMATH242", "CS371"]);
});

test("unknown selectors resolve to nothing rather than throwing", () => {
  assert.deepEqual(candidatesFor({ level_ranges: ["NOPE9"] }), []);
  assert.deepEqual(candidatesFor({ range: ["garbage"] }), []);
  assert.deepEqual(candidatesFor({}), []);
});
