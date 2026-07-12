import { db } from "../../../db/index.js";
import { eventBus } from "../../../events/index.js";
import { TeacherRepository } from "./teacher.repository.js";
import { TeacherService } from "./teacher.service.js";
import { TeacherController } from "./teacher.controller.js";
import { createTeacherRoutes } from "./teacher.routes.js";

const teacherRepository = new TeacherRepository(db);
const teacherService = new TeacherService(teacherRepository, eventBus);
const teacherController = new TeacherController(teacherService);

export const teacherRoutes = createTeacherRoutes(teacherController);
export { TeacherRepository, TeacherService, TeacherController };
export * from "./teacher.types.js";
