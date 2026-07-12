import { db } from "../../../db/index.js";
import { eventBus } from "../../../events/index.js";
import { StudentRepository } from "./student.repository.js";
import { StudentService } from "./student.service.js";
import { StudentController } from "./student.controller.js";
import { createStudentRoutes } from "./student.routes.js";

const studentRepository = new StudentRepository(db);
const studentService = new StudentService(studentRepository, eventBus);
const studentController = new StudentController(studentService);

export const studentRoutes = createStudentRoutes(studentController);
export { StudentRepository, StudentService, StudentController };
export * from "./student.types.js";
