import type { Context } from "hono";
import type { TeacherService } from "./teacher.service.js";
import { HttpError } from "../../../shared/errors/http-error.js";
import { validateJson, validateParams } from "../../../shared/middleware/validate-dto.js";
import { advisingIdParamSchema, createAdvisingSchema } from "./teacher.schemas.js";

export class TeacherController {
  constructor(readonly service: TeacherService) {}

  private requireTeacherId(c: Context): number {
    const teacherId = c.get("teacherId");
    if (!teacherId) throw new HttpError(401, "No autorizado. Docente no encontrado.", "TEACHER_NOT_FOUND");
    return Number(teacherId);
  }

  async getSections(c: Context) {
    return c.json(await this.service.getSections(this.requireTeacherId(c)));
  }

  async getSessions(c: Context) {
    return c.json(await this.service.getSessions(this.requireTeacherId(c)));
  }

  async createSession(c: Context) {
    const body = await validateJson(c, createAdvisingSchema);
    return c.json(await this.service.createSession(this.requireTeacherId(c), body), 201);
  }

  async deleteSession(c: Context) {
    const { id } = validateParams(c, advisingIdParamSchema);
    return c.json(await this.service.deleteSession(this.requireTeacherId(c), id));
  }

  async getAttendees(c: Context) {
    const { id } = validateParams(c, advisingIdParamSchema);
    return c.json(await this.service.getAttendees(this.requireTeacherId(c), id));
  }
}
