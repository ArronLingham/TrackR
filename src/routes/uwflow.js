import express from "express";
import { getCourseRating } from "../services/uwflow.js";

const router = express.Router();

router.get("/course/:code", async (req, res, next) => {
  try {
    const course = await getCourseRating(req.params.code);
    if (!course) {
      return res.status(404).json({ error: "Course not found on UWFlow" });
    }
    res.set("Cache-Control", "public, max-age=1800");
    return res.json(course);
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      return res.status(504).json({ error: "UWFlow timed out" });
    }
    return next(error);
  }
});

export default router;
