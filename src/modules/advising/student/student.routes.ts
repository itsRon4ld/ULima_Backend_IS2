import { Hono } from "hono";
import type { StudentController } from "./student.controller.js";
import { authMiddleware, requireRole } from "../../../shared/middleware/auth-middleware.js";

export const createStudentRoutes = (controller: StudentController) => {
  const app = new Hono<{ Variables: { studentId: number; role: string } }>();

  app.get(
    "/section/:sectionId",
    authMiddleware,
    requireRole("student", "delegate", "subdelegate"),
    (c) => controller.getAdvising(c),
  );
  app.post(
    "/:sessionId/rsvp",
    authMiddleware,
    requireRole("student", "delegate", "subdelegate"),
    (c) => controller.confirmRsvp(c),
  );
  app.delete(
    "/:sessionId/rsvp",
    authMiddleware,
    requireRole("student", "delegate", "subdelegate"),
    (c) => controller.cancelRsvp(c),
  );

  return app;
};
