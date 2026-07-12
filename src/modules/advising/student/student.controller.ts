import type { Context } from "hono";
import { validateParams } from "../../../shared/middleware/validate-dto.js";
import { HttpError } from "../../../shared/errors/http-error.js";
import type { StudentService } from "./student.service.js";
import { sectionIdParamSchema, sessionIdParamSchema } from "./student.schemas.js";

export class StudentController {
  constructor(readonly service: StudentService) {}

  async getAdvising(c: Context) {
    const { sectionId } = validateParams(c, sectionIdParamSchema);
    const studentId = c.get("studentId") as number | undefined;
    return c.json(await this.service.getAdvising(sectionId, studentId));
  }

  async confirmRsvp(c: Context) {
    const { sessionId } = validateParams(c, sessionIdParamSchema);
    const studentId = this.requireStudentId(c);
    return c.json(await this.service.confirmRsvp(sessionId, studentId));
  }

  async cancelRsvp(c: Context) {
    const { sessionId } = validateParams(c, sessionIdParamSchema);
    const studentId = this.requireStudentId(c);
    return c.json(await this.service.cancelRsvp(sessionId, studentId));
  }

  private requireStudentId(c: Context): number {
    const studentId = c.get("studentId") as number | undefined;
    if (studentId == null) {
      throw new HttpError(403, "Solo los alumnos pueden confirmar asistencia.", "RSVP_STUDENT_ONLY");
    }
    return studentId;
  }
}
