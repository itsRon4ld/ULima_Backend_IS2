import { Hono } from "hono";
import type { TeacherController } from "./teacher.controller.js";
import { authMiddleware, requireRole } from "../../../shared/middleware/auth-middleware.js";

export const createTeacherRoutes = (controller: TeacherController) => {
  const app = new Hono<{ Variables: { teacherId: number; role: string } }>();

  app.use("*", authMiddleware);
  app.use("*", requireRole("teacher"));

  app.get("/sections", (c) => controller.getSections(c));
  app.get("/sessions", (c) => controller.getSessions(c));
  app.post("/sessions", (c) => controller.createSession(c));
  app.delete("/sessions/:id", (c) => controller.deleteSession(c));
  app.get("/sessions/:id/attendees", (c) => controller.getAttendees(c));

  return app;
};
