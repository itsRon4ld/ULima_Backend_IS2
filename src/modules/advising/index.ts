import { Hono } from "hono";
import { teacherRoutes } from "./teacher/index.js";
import { studentRoutes } from "./student/index.js";

const app = new Hono();
app.route("/me", teacherRoutes);
app.route("/", studentRoutes);

export const advisingRoutes = app;
export { TeacherController, TeacherRepository, TeacherService } from "./teacher/index.js";
export * from "./teacher/teacher.types.js";
