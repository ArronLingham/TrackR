import test from "node:test";
import assert from "node:assert/strict";
import { listPrograms } from "../src/data/programs.js";
import { validateAllPrograms, validateProgram } from "../src/data/validate.js";
import { checkMajorProgress, outstanding, summarize } from "../src/domain/progress.js";
import { candidatesFor } from "../src/domain/selectors.js";
import { subjectOf } from "../src/data/catalog.js";
import { loadProgram } from "../src/data/programs.js";

const BLOCK_SECTIONS = ["required_courses", "elective_requirement", "additional_requirement"];

/** Every requirement block across every program, with a readable label. */
function allBlocks() {
  const blocks = [];
  for (const program of listPrograms()) {
    const data = loadProgram(program.id);
    for (const section of BLOCK_SECTIONS) {
      (data[section] ?? []).forEach((block, index) => {
        blocks.push({ where: `${program.id}.${section}[${index}]`, block });
        (block.groups ?? []).forEach((group, groupIndex) =>
          blocks.push({ where: `${program.id}.${section}[${index}].groups[${groupIndex}]`, block: group }),
        );
      });
    }
  }
  return blocks;
}

test("the app ships the expected programs", () => {
  const ids = listPrograms().map((program) => program.id);
  assert.deepEqual(ids, [
    "BCFM Computing and Financial Management",
    "BCS Computer Science",
    "BCS Data Science",
    "BMath Actuarial Science",
    "BMath Computational Mathematics",
    "BMath Computer Science",
  ]);
});

test("every requirement file passes schema validation", (t) => {
  const report = validateAllPrograms();
  const errors = Object.entries(report).flatMap(([, result]) => result.errors);
  assert.deepEqual(errors, []);

  // Warnings are known gaps in the catalogue snapshot rather than broken
  // rules, so they are reported instead of failing the run. See the README.
  for (const [program, result] of Object.entries(report)) {
    for (const warning of result.warnings) t.diagnostic(`${program}: ${warning}`);
  }
});

test("every subject selector resolves to courses of that subject", () => {
  // Property test for the bug where "CO3" matched COMMST and COGSCI.
  for (const { where, block } of allBlocks()) {
    for (const token of [...(block.level_ranges ?? []), ...(block.patterns ?? [])]) {
      const subject = /^([A-Za-z]+)/.exec(token)[1].toUpperCase();
      for (const candidate of candidatesFor({ level_ranges: [token] })) {
        assert.equal(subjectOf(candidate.code), subject, `${where}: ${token} matched ${candidate.code}`);
      }
    }
  }
});

test("no requirement asks for more courses than its pool holds", () => {
  for (const { where, block } of allBlocks()) {
    if (!block.count) continue;
    const pool = candidatesFor(block).length;
    assert.ok(pool >= block.count, `${where}: needs ${block.count} but its pool holds ${pool}`);
  }
});

test("evaluating a program twice gives the same answer", () => {
  // Regression: shared mutable state between requirement blocks made results
  // depend on evaluation order.
  const courses = ["CS135", "CS136", "MATH135", "MATH136", "MATH137", "MATH138", "STAT230"];
  for (const program of listPrograms()) {
    const first = checkMajorProgress(program.id, courses);
    const second = checkMajorProgress(program.id, courses);
    assert.deepEqual(first, second, `${program.id} is not deterministic`);
  }
});

test("a block never counts a course the student did not enter", () => {
  const courses = ["CS135", "CS136", "CS240", "MATH135", "MATH137", "ECON101"];
  const entered = new Set(courses);
  for (const program of listPrograms()) {
    const progress = checkMajorProgress(program.id, courses);
    for (const section of BLOCK_SECTIONS) {
      for (const result of progress[section] ?? []) {
        for (const candidate of result.courses_taken) {
          const claimed = candidate.codes.some((code) => entered.has(code));
          assert.ok(claimed, `${program.id}: counted ${candidate.code}, which was not entered`);
        }
      }
    }
  }
});

test("a block never counts more courses than it needs", () => {
  const courses = [
    "CS135", "CS136", "CS136L", "CS240", "CS241", "CS245", "CS246", "CS251", "CS341", "CS350",
    "CS370", "CS450", "CS452", "CS454", "CS480", "CS486",
    "MATH135", "MATH136", "MATH137", "MATH138", "MATH235", "MATH237", "MATH239",
    "STAT230", "STAT231", "STAT330", "STAT331", "STAT440", "STAT441",
  ];
  for (const program of listPrograms()) {
    const progress = checkMajorProgress(program.id, courses);
    for (const section of BLOCK_SECTIONS) {
      (progress[section] ?? []).forEach((result, index) => {
        if (result.progress.count.need == null) return;
        assert.ok(
          result.courses_taken.length <= result.progress.count.need,
          `${program.id}.${section}[${index}] counted ${result.courses_taken.length} for a need of ${result.progress.count.need}`,
        );
      });
    }
  }
});

test("no course is counted by two exclusive blocks", () => {
  const courses = [
    "CS135", "CS136", "CS136L", "CS240", "CS241", "CS245", "CS246", "CS251", "CS341", "CS350",
    "CS370", "CS450", "CS452", "CS454", "CS480", "CS486", "CO487",
    "MATH135", "MATH136", "MATH137", "MATH138", "MATH235", "MATH237", "MATH239",
    "STAT230", "STAT231", "STAT440",
  ];
  for (const program of listPrograms()) {
    const data = loadProgram(program.id);
    const progress = checkMajorProgress(program.id, courses);
    const seen = new Map();
    for (const section of BLOCK_SECTIONS) {
      (data[section] ?? []).forEach((block, index) => {
        const exclusive =
          typeof block.exclusive === "boolean"
            ? block.exclusive
            : block.type === "n_required" || block.type === "range_required";
        if (!exclusive) return;
        for (const candidate of progress[section][index].courses_taken) {
          const where = `${section}[${index}]`;
          assert.ok(
            !seen.has(candidate.code),
            `${program.id}: ${candidate.code} counted by both ${seen.get(candidate.code)} and ${where}`,
          );
          seen.set(candidate.code, where);
        }
      });
    }
  }
});

test("breadth and depth appear only where the calendar puts them", () => {
  // BCS plans carry them, and BMath Computer Science inherits them via
  // "5.0 non-math units ... the same restrictions as specified for the BCS".
  // Computational Mathematics and Actuarial Science do not.
  const withBreadth = listPrograms()
    .map((program) => program.id)
    .filter((id) => Boolean(loadProgram(id).breadth_requirement));
  assert.deepEqual(withBreadth.sort(), [
    "BCS Computer Science",
    "BCS Data Science",
    "BMath Computer Science",
  ]);
});

test("a complete Actuarial Science transcript satisfies every requirement", () => {
  const transcript = [
    "CS135", "MATH135", "MATH137", "ENGL109", "MTHEL131",
    "CS136", "MATH136", "MATH138", "ECON101", "ECON102", "AFM101",
    "MATH235", "MATH237", "STAT230", "ACTSC231", "AMATH250",
    "STAT231", "ACTSC232", "ACTSC372", "ACTSC363", "ACTSC331",
    "STAT330", "STAT331", "STAT333", "ENGL378", "STAT340",
    "ACTSC431", "ACTSC446", "ACTSC432", "ACTSC445", "AFM424", "STAT443", "STAT332",
  ];
  const progress = checkMajorProgress("BMath Actuarial Science", transcript);
  const summary = summarize(progress);
  assert.equal(summary.met, summary.total, JSON.stringify(unmet(progress), null, 2));
  assert.equal(progress.communication_requirement.met, true);
});

test("Actuarial Science accepts MTHEL 300 in place of ENGL 378", () => {
  const transcript = ["mthel 300", "ENGL109"];
  const progress = checkMajorProgress("BMath Actuarial Science", transcript);
  const block = progress.required_courses.find((r) => r.description.includes("ENGL378"));
  assert.equal(block.met, true);
  assert.equal(progress.communication_requirement.met, true);
});

test("a complete Computational Mathematics transcript satisfies every requirement", () => {
  const transcript = [
    "CS135", "CS136", "MATH135", "MATH136", "MATH137", "MATH138",
    "MATH235", "MATH237", "MATH239", "STAT230", "STAT231",
    "AMATH242", "CS230", "CS234", "AMATH250", "CS246",
    "AMATH342", "STAT340", "CO450", "CS480", "CO351", "STAT441",
    "ECON101", "ECON102", "ECON201", "ENGL109", "ENGL210E",
  ];
  const progress = checkMajorProgress("BMath Computational Mathematics", transcript);
  const summary = summarize(progress);
  assert.equal(summary.met, summary.total, JSON.stringify(unmet(progress), null, 2));
});

test("Computational Mathematics enforces the different-subject rule", () => {
  const base = [
    "CS135", "CS136", "MATH135", "MATH136", "MATH137", "MATH138",
    "MATH235", "MATH237", "MATH239", "STAT230", "STAT231",
    "AMATH242", "CS230", "CS234", "ENGL109", "ENGL210E",
  ];
  const sameSubject = checkMajorProgress("BMath Computational Mathematics", [
    ...base, "CS245", "CS246",
  ]).required_courses[4];
  assert.equal(sameSubject.met, false);
  assert.equal(sameSubject.progress.rules.find((r) => r.id === "min_distinct_subjects").met, false);

  const mixed = checkMajorProgress("BMath Computational Mathematics", [
    ...base, "CS246", "AMATH250",
  ]).required_courses[4];
  assert.equal(mixed.met, true);
});

test("Computational Mathematics enforces the single-subject concentration", () => {
  const base = [
    "CS135", "CS136", "MATH135", "MATH136", "MATH137", "MATH138",
    "MATH235", "MATH237", "MATH239", "STAT230", "STAT231",
    "AMATH242", "CS230", "CS234", "ENGL109", "ENGL210E",
  ];
  const index = 10;
  const spread = checkMajorProgress("BMath Computational Mathematics", [
    ...base, "ECON101", "ECON102", "PHYS121",
  ]).additional_requirement[index];
  assert.equal(spread.met, false);

  const focused = checkMajorProgress("BMath Computational Mathematics", [
    ...base, "ECON101", "ECON102", "ECON201",
  ]).additional_requirement[index];
  assert.equal(focused.met, true);

  const allFirstYear = checkMajorProgress("BMath Computational Mathematics", [
    ...base, "ECON101", "ECON102", "ECON120",
  ]).additional_requirement[index];
  assert.equal(allFirstYear.met, false, "needs one course at the 200-level or higher");
});

test("an empty transcript meets nothing and throws nothing", () => {
  for (const program of listPrograms()) {
    const progress = checkMajorProgress(program.id, []);
    const summary = summarize(progress);
    assert.equal(summary.met, 0, `${program.id} met something with no courses`);
    assert.ok(summary.total > 0);
  }
});

test("an unknown program is rejected rather than read from disk", () => {
  assert.throws(() => checkMajorProgress("../../package", []), /Unknown program/);
  assert.throws(() => validateProgram("nope"), /Unknown program/);
});

/** Requirement descriptions that are not met — used to explain a failed assertion. */
function unmet(progress) {
  const out = [];
  for (const section of BLOCK_SECTIONS) {
    for (const result of progress[section] ?? []) {
      if (!result.met) out.push({ section, description: result.description, progress: result.progress });
    }
  }
  for (const key of ["communication_requirement", "breadth_requirement", "depth_requirement"]) {
    const value = progress[key];
    if (value && !(value.met ?? value.satisfied)) out.push({ section: key });
  }
  return out;
}

test("an enrolled course is in progress, not met", () => {
  const done = ["CS135", "MATH135", "MATH137"];
  const settled = checkMajorProgress("BMath Actuarial Science", { completed: done });
  const enrolled = checkMajorProgress("BMath Actuarial Science", {
    completed: done,
    inProgress: ["STAT231"],
  });

  const find = (progress) =>
    progress.additional_requirement.find((r) => r.description.includes("STAT231"));

  assert.equal(find(settled).state, "unmet");
  assert.equal(find(enrolled).state, "in_progress");
  assert.equal(find(enrolled).met, false, "in progress is not the same as met");
});

test("a course cannot be both completed and in progress", () => {
  const progress = checkMajorProgress("BCS Computer Science", {
    completed: ["CS135"],
    inProgress: ["CS135"],
  });
  const block = progress.required_courses.find((r) => r.description.includes("CS135"));
  assert.equal(block.state, "met");
});

test("the summary separates met from in progress", () => {
  const progress = checkMajorProgress("BCS Computer Science", {
    completed: ["CS135", "MATH135"],
    inProgress: ["MATH137"],
  });
  const result = summarize(progress);
  assert.ok(result.met >= 2);
  assert.ok(result.inProgress >= 1);
  assert.ok(result.projectedPercent > result.percent);
});

test("outstanding lists only what is not met, with its section", () => {
  const progress = checkMajorProgress("BMath Computational Mathematics", { completed: ["CS135"] });
  const items = outstanding(progress);
  assert.ok(items.length > 0);
  assert.ok(items.every((item) => item.state !== "met"));
  assert.ok(items.every((item) => typeof item.section === "string" && item.section.length > 0));
  assert.equal(
    items.length,
    summarize(progress).total - summarize(progress).met,
    "every unmet requirement should be listed",
  );
});

test("a plain array of courses still means all complete", () => {
  const asArray = checkMajorProgress("BCS Computer Science", ["CS135", "MATH137"]);
  const asObject = checkMajorProgress("BCS Computer Science", {
    completed: ["CS135", "MATH137"],
  });
  assert.deepEqual(asArray, asObject);
});
