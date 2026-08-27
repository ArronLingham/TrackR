import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";

let server;
let origin;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = /** @type {import("node:net").AddressInfo} */ (server.address());
  origin = `http://127.0.0.1:${address.port}`;
});

after(() => server?.close());

const get = (path) => fetch(`${origin}${path}`);

const post = (path, fields) =>
  fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });

test("every navigation target responds", async () => {
  for (const path of ["/", "/features", "/about", "/contact"]) {
    const response = await get(path);
    assert.equal(response.status, 200, `${path} returned ${response.status}`);
    const html = await response.text();
    assert.match(html, /<\/body>\s*<\/html>/, `${path} is not a complete document`);
    assert.equal((html.match(/<!DOCTYPE html>/gi) ?? []).length, 1, `${path} has nested documents`);
  }
});

test("the program picker is built from the requirements directory", async () => {
  const html = await (await get("/")).text();
  for (const program of [
    "BCS Computer Science",
    "BCS Data Science",
    "BCFM Computing and Financial Management",
    "BMath Computer Science",
    "BMath Actuarial Science",
    "BMath Computational Mathematics",
  ]) {
    assert.ok(html.includes(`value="${program}"`), `missing option for ${program}`);
  }
});

test("an unknown path renders a 404 page", async () => {
  const response = await get("/does-not-exist");
  assert.equal(response.status, 404);
  assert.match(await response.text(), /Page not found/);
});

test("an unknown API path returns JSON", async () => {
  const response = await get("/api/nope");
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "Not found");
});

test("a submitted program name cannot reach the filesystem", async () => {
  // `major` used to be interpolated straight into a path, so "../../package"
  // read the repository's own package.json and an unknown name threw a 500.
  const response = await post("/submit", { major: "../../package", courses: "CS135" });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /not a program TrackR knows about/);
});

test("a missing courses field is a 400, not a crash", async () => {
  const response = await post("/submit", { major: "BCS Computer Science" });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /No course codes found/);
});

test("unrecognised course codes are named individually", async () => {
  const response = await post("/submit", {
    major: "BCS Computer Science",
    courses: "CS135, CS9999, MATH137, NOPE1",
  });
  assert.equal(response.status, 400);
  const html = await response.text();
  assert.match(html, /2 course codes could not be found/);
  assert.match(html, /CS9999/);
  assert.match(html, /NOPE1/);
});

test("a pasted transcript produces averages, credits and outstanding work", async () => {
  const response = await post("/submit", {
    major: "BMath Actuarial Science",
    courses: [
      "Fall 2022    Level: 1A",
      "CS 135       Designing Functional Programs        0.50   0.50   95",
      "MATH 135     Algebra for Honours Mathematics      0.50   0.50   88",
      "ENGL 109     Introduction to Academic Writing     0.50   0.50   82",
      "Term Average: 88.33",
      "",
      "Winter 2023   Level: 1B",
      "MATH 136     Linear Algebra 1                     0.50",
    ].join("\n"),
  });

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Cumulative average/);
  assert.match(html, /Units earned/);
  assert.match(html, /What you still need/);
  assert.match(html, /Averages by term/);
  assert.match(html, /Fall 2022/);
  // MATH 136 has no grade, so it is enrolled rather than finished.
  assert.match(html, /in progress this term|state-in_progress/);
});

test("a rejected submission keeps what the student typed", async () => {
  const response = await post("/submit", {
    major: "BCS Computer Science",
    courses: "CS135, CS9999",
  });
  const html = await response.text();
  assert.match(html, /CS135, CS9999/, "the course list was discarded");
  assert.match(html, /value="BCS Computer Science"\s*\n?\s*selected/, "the program was discarded");
});

test("a valid submission renders results for every program", async () => {
  const courses = [
    "CS135", "CS136", "CS136L", "MATH135", "MATH136", "MATH137", "MATH138",
    "MATH235", "MATH237", "MATH239", "STAT230", "STAT231",
    "CS240", "CS241", "CS245", "CS246", "CS251", "CS341", "CS350",
    "ENGL109", "ENGL210E", "PSYCH101", "PSYCH211", "PSYCH315",
    "ECON101", "PHYS121", "HEALTH107",
  ].join(", ");

  for (const major of [
    "BCS Computer Science",
    "BCS Data Science",
    "BCFM Computing and Financial Management",
    "BMath Computer Science",
    "BMath Actuarial Science",
    "BMath Computational Mathematics",
  ]) {
    const response = await post("/submit", { major, courses });
    assert.equal(response.status, 200, `${major} returned ${response.status}`);
    const html = await response.text();
    assert.match(html, /requirements met/, `${major} did not render a summary`);
    assert.equal((html.match(/<h1>/g) ?? []).length, 1, `${major} should have exactly one h1`);
    assert.match(html, /role="progressbar"/, `${major} is missing progressbar semantics`);
  }
});

test("the contact form validates and confirms", async () => {
  const incomplete = await post("/contact", { name: "Ada", email: "" });
  assert.equal(incomplete.status, 400);
  assert.match(await incomplete.text(), /Please fill in/);

  const complete = await post("/contact", {
    name: "Ada",
    email: "ada@example.com",
    subject: "Hello",
    message: "Nice tool",
  });
  assert.equal(complete.status, 200);
  assert.match(await complete.text(), /ada@example.com/);
});
