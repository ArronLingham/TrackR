import fs from "node:fs";
import path from "node:path";
import express from "express";
import { PATHS } from "./data/paths.js";

/**
 * A version stamp appended to stylesheet and script URLs.
 *
 * The assets are not fingerprinted, so without this a browser can keep serving
 * a stale stylesheet after a change. Derived from the files' modification
 * times, so it changes exactly when they do.
 */
function assetVersion() {
  const stamp = ["styles/main.css", "scripts/uwflow-tooltips.js"]
    .map((file) => {
      try {
        return fs.statSync(path.join(PATHS.public, file)).mtimeMs;
      } catch {
        return 0;
      }
    })
    .reduce((latest, value) => Math.max(latest, value), 0);
  return Math.round(stamp).toString(36);
}
import pagesRouter from "./routes/pages.js";
import uwflowRouter from "./routes/uwflow.js";

/**
 * Build the Express app.
 *
 * Paths come from `PATHS`, which resolves from this file's own location, so
 * the server no longer depends on being started from the repository root.
 */
export function createApp() {
  const app = express();

  app.set("view engine", "ejs");
  app.set("views", PATHS.views);
  app.locals.assetVersion = assetVersion();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  // No far-future cache: these assets are not fingerprinted, so a hard
  // max-age means a CSS fix would not reach anyone until it expired. ETags
  // (on by default) still make repeat requests cheap 304s.
  app.use(express.static(PATHS.public));

  app.use("/api/uwflow", uwflowRouter);
  app.use("/", pagesRouter);

  app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: "Not found" });
    }
    return res.status(404).render("error", {
      title: "Not found",
      activePage: "",
      status: 404,
      heading: "Page not found",
      detail: "That page does not exist.",
    });
  });

  // Express 5 forwards rejected promises here, so an unreachable UWFlow or a
  // malformed requirements file produces a readable page instead of a stack
  // trace in the response.
  app.use((error, req, res, _next) => {
    console.error("[error]", error);
    if (res.headersSent) return undefined;
    if (req.path.startsWith("/api/")) {
      return res.status(500).json({ error: "Something went wrong" });
    }
    return res.status(500).render("error", {
      title: "Error",
      activePage: "",
      status: 500,
      heading: "Something went wrong",
      detail: "The request could not be completed. Please try again.",
    });
  });

  return app;
}
