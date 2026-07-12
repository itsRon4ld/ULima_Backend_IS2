import type { EventBus } from "../../../events/index.js";
import type { TeacherRepository } from "./teacher.repository.js";
import { HttpError } from "../../../shared/errors/http-error.js";
import { limaDateString, validateCreateAdvising } from "./teacher.logic.js";
import type { CreateAdvisingBody } from "./teacher.schemas.js";

export class TeacherService {
  constructor(
    readonly repository: TeacherRepository,
    readonly events: EventBus,
  ) {}

  async getSections(teacherId: number) {
    try {
      const period = await this.repository.getActivePeriod();
      if (!period) return { secciones: [] };
      const secciones = await this.repository.findTeacherSections(teacherId, period.id);
      return { secciones };
    } catch (e) {
      throw this.wrap(e, "getSections");
    }
  }

  async getSessions(teacherId: number) {
    try {
      const sesiones = await this.repository.findTeacherSessions(teacherId);
      return { sesiones };
    } catch (e) {
      throw this.wrap(e, "getSessions");
    }
  }

  async createSession(teacherId: number, body: CreateAdvisingBody) {
    try {
      const period = await this.repository.getActivePeriod();
      if (!period) throw new HttpError(409, "No hay período académico activo.", "NO_ACTIVE_PERIOD");

      const section = await this.repository.findSectionOwnedByTeacher(body.sectionId, teacherId);
      if (!section) {
        throw new HttpError(403, "No puede crear asesorías en una sección que no es suya.", "SECTION_FORBIDDEN");
      }

      const ownExisting = await this.repository.findOwnSessionsForOverlap(teacherId);
      const validation = validateCreateAdvising({
        input: {
          sessionDate: body.sessionDate,
          startTime: body.startTime,
          endTime: body.endTime,
          modality: body.modality,
          classroom: body.classroom,
          meetingUrl: body.meetingUrl,
        },
        today: limaDateString(new Date()),
        periodStart: period.startDate,
        periodEnd: period.endDate,
        ownExisting,
      });

      switch (validation.status) {
        case "invalid_time":
          throw new HttpError(400, "La hora de inicio debe ser anterior a la de fin.", "INVALID_TIME_RANGE");
        case "date_in_past":
          throw new HttpError(400, "La fecha de la asesoría ya pasó.", "DATE_IN_PAST");
        case "date_out_of_period":
          throw new HttpError(400, "La fecha está fuera del período académico activo.", "DATE_OUT_OF_PERIOD");
        case "missing_location":
          throw new HttpError(400, "Indica el aula o el enlace según la modalidad elegida.", "MISSING_LOCATION");
        case "overlap":
          throw new HttpError(409, "Se solapa con otra asesoría tuya ese día.", "ADVISING_OVERLAP");
      }

      const sesion = await this.repository.createExtraSession({
        courseOfferingId: section.courseOfferingId,
        sectionId: body.sectionId,
        teacherId,
        dayOfWeek: validation.dayOfWeek,
        startTime: body.startTime,
        endTime: body.endTime,
        modality: body.modality,
        classroom: body.classroom ?? null,
        meetingUrl: body.meetingUrl ?? null,
        note: body.note ?? null,
        sessionDate: body.sessionDate,
        capacity: body.capacity ?? null,
      });
      return { sesion };
    } catch (e) {
      throw this.wrap(e, "createSession");
    }
  }

  async deleteSession(teacherId: number, id: number) {
    try {
      const own = await this.repository.findSessionOwnership(id);
      if (!own) throw new HttpError(404, "Asesoría no encontrada.", "ADVISING_NOT_FOUND");
      if (own.teacherId !== teacherId) {
        throw new HttpError(403, "No puede eliminar una asesoría que no es suya.", "FORBIDDEN");
      }
      if (own.kind !== "extra") {
        throw new HttpError(409, "Solo se pueden eliminar asesorías extra.", "ONLY_EXTRA_DELETABLE");
      }
      await this.repository.deleteSessionWithRsvps(id);
      return { message: "Asesoría eliminada." };
    } catch (e) {
      throw this.wrap(e, "deleteSession");
    }
  }

  async getAttendees(teacherId: number, id: number) {
    try {
      const own = await this.repository.findSessionOwnership(id);
      if (!own) throw new HttpError(404, "Asesoría no encontrada.", "ADVISING_NOT_FOUND");
      if (own.teacherId !== teacherId) {
        throw new HttpError(403, "No puede ver los asistentes de una asesoría que no es suya.", "FORBIDDEN");
      }
      const asistentes = await this.repository.findAttendees(id);
      return { total: asistentes.length, asistentes };
    } catch (e) {
      throw this.wrap(e, "getAttendees");
    }
  }

  private wrap(e: unknown, where: string): HttpError {
    if (e instanceof HttpError) return e;
    console.error(`DB Error in teacher.service ${where}`, e);
    return new HttpError(500, "Error interno del servidor.", "INTERNAL_ERROR");
  }
}
