import express from "express";
import { listPrograms, isKnownProgram } from "../data/programs.js";
import { parseTranscript } from "../domain/transcript.js";
import { summarizeAcademics } from "../domain/academics.js";
import { checkMajorProgress, outstanding, summarize } from "../domain/progress.js";
import { get as getCourse } from "../data/catalog.js";
import { readJSON } from "../data/json.js";
import { PATHS } from "../data/paths.js";
import { getProfile, updateProfile } from "../db.js";

const router = express.Router();
const prereqsData = readJSON(PATHS.prereqs);

function buildCourseTitles(progress, transcript) {
  const titles = {};
  const add = (c) => {
    if (c && !titles[c]) {
      const r = getCourse(c);
      if (r) titles[c] = r.title;
    }
  };
  if (transcript && transcript.entries) transcript.entries.forEach(e => add(e.code));
  outstanding(progress).forEach(o => {
    (o.remaining || []).forEach(add);
    (o.rules || []).forEach(r => (r.courses_remaining || []).forEach(add));
  });
  return titles;
}

function buildCoursePrereqs(titlesObj) {
  const prereqs = {};
  for (const c of Object.keys(titlesObj)) {
    if (prereqsData[c]) {
      prereqs[c] = {
        text: prereqsData[c].prereq_text,
        codes: prereqsData[c].prereq_codes || []
      };
    }
  }
  return prereqs;
}

/** Largest paste we will read. A full transcript is a few thousand characters. */
const MAX_INPUT = 200_000;

function renderHome(res, status, locals) {
  res.status(status).render("home", {
    activePage: "home",
    programs: listPrograms(),
    values: { major: "", courses: "", planned_courses: "", coops: "" },
    ...locals,
  });
}

router.get("/", async (req, res) => {
  const profile = await getProfile();
  renderHome(res, 200, {
    values: {
      major: profile.major,
      courses: profile.past_courses,
      planned_courses: profile.planned_courses,
      coops: profile.coops
    }
  });
});

router.get("/features", (req, res) => {

  res.render("features", { activePage: "features" });
});

router.get("/about", (req, res) => {
  res.render("about", { activePage: "about", programs: listPrograms() });
});

router.get("/contact", (req, res) => {
  res.render("contact", {
    activePage: "contact",
    values: { name: "", email: "", subject: "", message: "" },
  });
});

router.post("/submit", async (req, res) => {
  const major = typeof req.body.major === "string" ? req.body.major.trim() : "";
  const rawCourses = typeof req.body.courses === "string" ? req.body.courses : "";
  const plannedCourses = typeof req.body.planned_courses === "string" ? req.body.planned_courses : "";
  const coops = typeof req.body.coops === "string" ? req.body.coops : "";
  const values = { major, courses: rawCourses, planned_courses: plannedCourses, coops };

  // `major` reaches a filesystem path, so it is checked against the known
  // programs rather than trusted from the form.
  if (!isKnownProgram(major)) {
    return renderHome(res, 400, {
      values,
      error: major
        ? `"${major}" is not a program TrackR knows about. Pick one from the list.`
        : "Choose a program before submitting.",
    });
  }

  const transcript = parseTranscript(rawCourses.slice(0, MAX_INPUT));

  if (transcript.entries.length === 0) {
    return renderHome(res, 400, {
      values,
      error: "No course codes found. Paste your transcript, or a list like CS135, MATH137.",
    });
  }

  // Naming the codes we did not recognise, rather than saying "one or more",
  // is the difference between fixing a typo and retyping the whole list.
  if (transcript.unknownCodes.length > 0) {
    return renderHome(res, 400, {
      values,
      error: `${transcript.unknownCodes.length} course code${transcript.unknownCodes.length === 1 ? "" : "s"} could not be found:`,
      unknownCourses: transcript.unknownCodes,
    });
  }

  // Save the profile successfully
  await updateProfile({
    major,
    past_courses: rawCourses,
    planned_courses: plannedCourses,
    coops
  });

  const completed = transcript.entries
    .filter((entry) => entry.grade.earnsCredit)
    .map((entry) => entry.code);
  const inProgress = transcript.entries
    .filter((entry) => entry.grade.inProgress)
    .map((entry) => entry.code);
  
  // Basic parsing for planned courses (just comma/newline separated list of codes for now)
  const planned = plannedCourses.split(/[\s,]+/).map(c => c.trim().toUpperCase()).filter(c => c.length > 0);

  const progress = checkMajorProgress(major, { completed, inProgress, planned });
  const titles = buildCourseTitles(progress, transcript);

  res.render("dashboard", {
    title: "TrackR Dashboard",
    activePage: "results",
    programs: listPrograms(),
    progress,
    summary: summarize(progress),
    outstanding: outstanding(progress),
    academics: summarizeAcademics(transcript, planned),
    transcript,
    userCourses: rawCourses.trim(),
    plannedCourses: plannedCourses.trim(),
    coops: coops.trim(),
    courseTitles: titles,
    coursePrereqs: buildCoursePrereqs(titles),
  });
});

router.post("/contact", (req, res) => {
  const values = {
    name: String(req.body.name ?? "").trim(),
    email: String(req.body.email ?? "").trim(),
    subject: String(req.body.subject ?? "").trim(),
    message: String(req.body.message ?? "").trim(),
  };

  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([field]) => field);

  if (missing.length > 0) {
    return res.status(400).render("contact", {
      activePage: "contact",
      values,
      error: `Please fill in: ${missing.join(", ")}.`,
    });
  }

  // No mail transport is configured, so the message is written to the server
  // log. The confirmation below says exactly that rather than promising a
  // reply the app cannot deliver.
  console.info("[contact] %s <%s> — %s", values.name, values.email, values.subject);

  res.render("contact", {
    activePage: "contact",
    values: { name: "", email: "", subject: "", message: "" },
    sent: { email: values.email },
  });
});

router.post("/api/progress", (req, res) => {
  const { major, completed = [], inProgress = [], planned = [], transcriptRaw = "" } = req.body;

  if (!isKnownProgram(major)) {
    return res.status(400).json({ error: "Unknown program" });
  }

  const progress = checkMajorProgress(major, { completed, inProgress, planned });
  
  // We need to parse transcript to get the academics summary, or reconstruct it
  let transcript = parseTranscript("");
  if (transcriptRaw) {
    transcript = parseTranscript(transcriptRaw);
  } else {
    // Reconstruct a dummy transcript if raw is not provided
    transcript = {
      hasGrades: false,
      terms: [],
      attempts: completed.map(code => ({ code, grade: { earnsCredit: true }, units: 0.5 }))
        .concat(inProgress.map(code => ({ code, grade: { inProgress: true }, units: 0.5 })))
    };
  }

  const academics = summarizeAcademics(transcript, planned);
  const titles = buildCourseTitles(progress, transcript);
  
  res.json({
    progress,
    summary: summarize(progress),
    outstanding: outstanding(progress),
    academics,
    courseTitles: titles,
    coursePrereqs: buildCoursePrereqs(titles),
  });
});

export default router;
