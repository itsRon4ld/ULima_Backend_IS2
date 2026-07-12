import type { EventBus } from "../../../events/index.js";
import type { StudentRepository } from "./student.repository.js";
import { HttpError } from "../../../shared/errors/http-error.js";
import { isSessionPast } from "./student.logic.js";
import type { AdvisingResult, RsvpResult } from "./student.types.js";

const dayName = (day: number) =>
  ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"][day - 1] ?? "Por definir";

const splitName = (fullName: string) => {
  if (fullName.includes(",")) {
    const parts = fullName.split(",");
    return {
      lastName: parts[0].trim(),
      firstName: parts.slice(1).join(",").trim(),
    };
  }
  const parts = fullName.trim().split(/\s+/);
  if (parts.length > 2) {
    return { lastName: parts.slice(0, 2).join(" "), firstName: parts.slice(2).join(" ") };
  }
  if (parts.length === 2) return { lastName: parts[0], firstName: parts[1] };
  return { firstName: fullName, lastName: "" };
};

export class StudentService {
  constructor(
    readonly repository: StudentRepository,
    readonly events: EventBus,
  ) {}

  async getAdvising(sectionId: number, studentId?: number): Promise<AdvisingResult> {
    const rows = await this.repository.findBySection(sectionId, studentId);
    const now = new Date();

    const asesorias = rows
      .map((row) => {
        const startTime = row.start_time ?? "";
        const endTime = row.end_time ?? "";

        if (row.kind === "extra" && row.session_date) {
          const past = isSessionPast(
            { kind: "extra", sessionDate: row.session_date, dayOfWeek: Number(row.day_of_week), startTime, endTime },
            now,
          );
          if (past) return null;
        }

        if (row.kind === "recurring") {
          const past = isSessionPast(
            { kind: "recurring", sessionDate: null, dayOfWeek: Number(row.day_of_week), startTime, endTime },
            now,
          );
          if (past) return null;
        }

        return {
          id: String(row.id),
          courseId: String(row.course_offering_id),
          docenteCode: row.teacher_code ?? "",
          docente: {
            code: row.teacher_code ?? "",
            ...splitName(row.full_name),
          },
          dia: dayName(Number(row.day_of_week)),
          inicio: startTime,
          fin: endTime,
          aula: row.classroom ?? "Por definir",
          zoom: row.meeting_url ?? "",
          kind: row.kind ?? "recurring",
          fecha: row.session_date ?? null,
          dictanteRol: row.dictante_rol ?? "Profesor",
          asistentes: Number(row.asistentes ?? 0),
          myRsvp: row.my_rsvp === true,
        };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);

    return { asesorias };
  }

  async confirmRsvp(sessionId: number, studentId: number): Promise<RsvpResult> {
    const session = await this.repository.findSessionById(sessionId);
    if (!session) {
      throw new HttpError(404, "Asesoría no disponible para tu sección.", "SESSION_NOT_FOUND");
    }

    if (isSessionPast(session, new Date())) {
      throw new HttpError(409, "No puedes confirmar asistencia a una asesoría que ya pasó.", "SESSION_ALREADY_PAST");
    }

    const allowed = await this.repository.isParticipant(sessionId, studentId);
    if (!allowed) {
      throw new HttpError(404, "Asesoría no disponible para tu sección.", "SESSION_NOT_FOUND");
    }

    await this.repository.insertRsvp(sessionId, studentId);
    const asistentes = await this.repository.countRsvp(sessionId);
    return { id: String(sessionId), asistentes, myRsvp: true };
  }

  async cancelRsvp(sessionId: number, studentId: number): Promise<RsvpResult> {
    await this.repository.deleteRsvp(sessionId, studentId);
    const asistentes = await this.repository.countRsvp(sessionId);
    return { id: String(sessionId), asistentes, myRsvp: false };
  }
}
