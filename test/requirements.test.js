import test from "node:test";
import assert from "node:assert/strict";
import { canonical } from "../src/data/catalog.js";
import { evaluateRequirement, isExclusive } from "../src/domain/requirements.js";
import { selectCourses } from "../src/domain/selection.js";
import { evaluateRules } from "../src/domain/rules.js";

const ctx = (taken, consumed = []) => ({
  taken: new Set(taken.map(canonical)),
  consumed: new Set(consumed.map(canonical)),
  excluded: new Set(),
  contention: new Map(),
});

const course = (code) => ({ code });
const codes = (result) => result.courses_taken.map((candidate) => candidate.code);

test("all_required needs every listed course", () => {
  const block = { type: "all_required", courses: [course("CS341"), course("CS350")] };
  assert.equal(evaluateRequirement(block, ctx(["CS341", "CS350"])).met, true);

  const partial = evaluateRequirement(block, ctx(["CS341"]));
  assert.equal(partial.met, false);
  assert.deepEqual(codes(partial), ["CS341"]);
  assert.deepEqual(partial.courses_remaining.map((c) => c.code), ["CS350"]);
});

test("all_required stays met when another block also counted the course", () => {
  // Regression: `met` was derived from courses_remaining, so a course counted
  // elsewhere emptied the remaining list and reported met with nothing taken.
  const block = { type: "all_required", courses: [course("CS341")] };
  const result = evaluateRequirement(block, ctx(["CS341"], ["CS341"]));
  assert.equal(result.met, true);
  assert.deepEqual(codes(result), ["CS341"]);
});

test("one_required counts exactly one course", () => {
  const block = { type: "one_required", courses: [course("CS135"), course("CS145")] };
  const result = evaluateRequirement(block, ctx(["CS135", "CS145"]));
  assert.equal(result.met, true);
  // Both are held, but only one is consumed — the other stays available.
  assert.equal(result.courses_taken.length, 1);
  assert.equal(result.claims.length, 1);
});

test("n_required never reports more courses than it counts", () => {
  // Regression: the consumed set was capped at `count` but the displayed set
  // was not, so a "complete 2" block could show five courses.
  const block = {
    type: "n_required",
    count: 2,
    courses: ["STAT431", "STAT440", "STAT441", "STAT442"].map(course),
  };
  const result = evaluateRequirement(block, ctx(["STAT431", "STAT440", "STAT441", "STAT442"]));
  assert.equal(result.met, true);
  assert.equal(result.courses_taken.length, 2);
  assert.equal(result.claims.length, 2);
});

test("n_required honours its `required` list", () => {
  const block = {
    type: "n_required",
    count: 2,
    patterns: ["AFM3"],
    required: ["CFM401"],
  };
  const without = evaluateRequirement(block, ctx(["AFM311", "AFM322"]));
  assert.equal(without.met, false);
  assert.deepEqual(without.missing_required, ["CFM401"]);

  const with401 = evaluateRequirement(block, ctx(["AFM311", "CFM401"]));
  assert.equal(with401.met, true);
});

test("exclusive blocks skip courses another block already counted", () => {
  const block = { type: "range_required", count: 2, range: ["CS440-CS489"] };
  const free = evaluateRequirement(block, ctx(["CS450", "CS452"]));
  assert.equal(free.met, true);

  const contended = evaluateRequirement(block, ctx(["CS450", "CS452"], ["CS450"]));
  assert.equal(contended.met, false);
  assert.deepEqual(codes(contended), ["CS452"]);
});

test("named blocks share courses, additional blocks do not", () => {
  assert.equal(isExclusive({ type: "all_required" }), false);
  assert.equal(isExclusive({ type: "one_required" }), false);
  assert.equal(isExclusive({ type: "n_required" }), true);
  assert.equal(isExclusive({ type: "range_required" }), true);
  // Exclusivity comes from the calendar's prose, so the data can override it.
  assert.equal(isExclusive({ type: "one_group_required", exclusive: true }), true);
  assert.equal(isExclusive({ type: "n_required", exclusive: false }), false);
});

test("one_group_required is met when any alternative is met", () => {
  // Regression: the old check also demanded the winning group have nothing
  // remaining, which no "one of N" group can ever satisfy.
  const block = {
    type: "one_group_required",
    groups: [
      { type: "one_required", courses: [course("CO487"), course("CS499T"), course("STAT440")] },
      { type: "range_required", count: 1, range: ["CS440-CS498"] },
    ],
  };
  assert.equal(evaluateRequirement(block, ctx(["CO487"])).met, true);
  assert.equal(evaluateRequirement(block, ctx(["CS450"])).met, true);
  assert.equal(evaluateRequirement(block, ctx(["CS135"])).met, false);
});

test("one_group_required evaluates each alternative from the same starting state", () => {
  // Regression: groups shared one mutable consumed-set, so the first group
  // took courses the second one needed.
  const block = {
    type: "one_group_required",
    groups: [
      { type: "range_required", count: 3, range: ["CS440-CS489"] },
      { type: "one_required", courses: [course("CS450")] },
    ],
  };
  const result = evaluateRequirement(block, ctx(["CS450"]));
  assert.equal(result.met, true, "the second alternative should still see CS450");
});

test("unknown requirement types fail loudly", () => {
  assert.throws(
    () => evaluateRequirement({ type: "sometimes_required" }, ctx([])),
    /Unknown requirement type/,
  );
});

test("rules are checked against the selection, not the pool", () => {
  const rules = { min_distinct_subjects: 2 };
  assert.equal(evaluateRules(rules, [course("CS245"), course("CS246")])[0].met, false);
  assert.equal(evaluateRules(rules, [course("CS245"), course("AMATH250")])[0].met, true);
});

test("selection searches for a combination that satisfies the rules", () => {
  // Taking the first two by list order gives two CS courses and fails; a valid
  // pair exists, so the selection has to find it.
  const available = [course("CS245"), course("CS246"), course("AMATH250")];
  const { selection, complete } = selectCourses(available, 2, { min_distinct_subjects: 2 });
  assert.equal(complete, true);
  const subjects = new Set(selection.map((c) => c.code.replace(/\d.*/, "")));
  assert.equal(subjects.size, 2);
});

test("selection prefers higher-level courses when a level rule applies", () => {
  const available = [course("CO351"), course("CO450"), course("CO452")];
  const { selection, complete } = selectCourses(available, 2, {
    at_or_above: { level: 400, count: 2 },
  });
  assert.equal(complete, true);
  assert.deepEqual(selection.map((c) => c.code).sort(), ["CO450", "CO452"]);
});

test("selection reports a partial result rather than nothing", () => {
  const { selection, complete } = selectCourses([course("CS245")], 2, { min_distinct_subjects: 2 });
  assert.equal(complete, false);
  assert.equal(selection.length, 1);
});

test("single_subject is sugar for max_distinct_subjects: 1", () => {
  const [rule] = evaluateRules({ single_subject: true }, [course("ECON101"), course("PHYS121")]);
  assert.equal(rule.id, "max_distinct_subjects");
  assert.equal(rule.met, false);
});
