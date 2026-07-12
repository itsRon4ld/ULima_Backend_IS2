import type { EventBus } from "../../events/index.js";
import { HttpError } from "../../shared/errors/http-error.js";
import type { ScheduleRepository, RawWeekRow, RawAssessmentRow } from "./schedule.repository.js";
import type {
  SessionsResponse,
  SectionResponse,
  DayInfo,
  AssessmentsResult,
  AssessmentResponse,
  WeeklyLoadResponse,
  WeeklyLoadItem,
} from "./schedule.types.js";

const monthNames = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function formatDateText(date: Date): string {
  return `${date.getUTCDate()} de ${monthNames[date.getUTCMonth()]}`;
}

function parseDateOnly(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map((part) => parseInt(part, 10));
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateOnly(date: Date): string {
  return `${date.getUTCFullYear()}-${(date.getUTCMonth() + 1).toString().padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")}`;
}

function formatTimeToAmPm(timeStr: string): string {
  const [hourStr, minuteStr] = timeStr.split(":");
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  const ampm = hour >= 12 ? "pm" : "am";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  const displayHourStr = displayHour.toString().padStart(2, "0");
  const displayMinuteStr = minute.toString().padStart(2, "0");
  return `${displayHourStr}:${displayMinuteStr} ${ampm}`;
}

function getAcademicWeeks(): RawWeekRow[] {
  const weeks: RawWeekRow[] = [];
  const startDate = new Date(Date.UTC(2026, 3, 6)); // April 6, 2026 UTC

  for (let i = 1; i <= 16; i++) {
    const weekStart = new Date(startDate);
    weekStart.setUTCDate(startDate.getUTCDate() + (i - 1) * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

    weeks.push({
      week_number: i,
      start_date: formatDateOnly(weekStart),
      end_date: formatDateOnly(weekEnd),
    });
  }
  return weeks;
}

export class ScheduleService {
  constructor(
    readonly repository: ScheduleRepository,
    readonly events: EventBus,
  ) {}

  async getSessions(studentId: number): Promise<SessionsResponse> {
    const rows = await this.repository.findActiveEnrollmentsWithSessions(studentId);
    const weeks = getAcademicWeeks();

    const activeDayName = (day: number) =>
      ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"][day - 1] ?? "Por definir";

    const sections = new Map<string, SectionResponse>();
    for (const row of rows) {
      const sectionId = String(row.section_id);
      if (!sections.has(sectionId)) {
        sections.set(sectionId, {
          idSeccion: sectionId,
          codigoSeccion: row.section_code,
          docenteCode: row.teacher_code ?? "",
          promedioSeccion: 0,
          idCurso: String(row.course_id),
          curso: row.course_name,
          asistido: Number(row.attended_hours ?? 0),
          inasistencia: Number(row.absent_hours ?? 0),
          total: Number(row.total_hours ?? 0),
          horarios: [],
        });
      }

      if (row.day_of_week != null) {
        const startTime = row.start_time ?? "08:00:00";
        const endTime = row.end_time ?? "10:00:00";
        const formattedStart = formatTimeToAmPm(startTime);
        const formattedEnd = formatTimeToAmPm(endTime);

        sections.get(sectionId)!.horarios.push({
          dia: activeDayName(Number(row.day_of_week)),
          inicio: startTime,
          hora_inicio: formattedStart,
          fin: endTime,
          hora_fin: formattedEnd,
          aula: row.classroom ?? "Por definir",
          salon: row.classroom ?? "Por definir",
          color: row.color_hex ?? "blue",
        });
      }
    }

    const daysList: DayInfo[] = [];
    if (weeks && weeks.length > 0) {
      for (const week of weeks) {
        const startDate = parseDateOnly(week.start_date);
        const weekNum = week.week_number;
        for (let i = 0; i < 7; i++) {
          const currentDate = new Date(startDate);
          currentDate.setUTCDate(startDate.getUTCDate() + i);
          daysList.push({
            dayName: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"][i],
            dateText: formatDateText(currentDate),
            weekText: `Semana ${weekNum} del ciclo`,
          });
        }
      }
    } else {
      for (let i = 0; i < 7; i++) {
        daysList.push({
          dayName: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"][i],
          dateText: "",
          weekText: "Semana actual",
        });
      }
    }

    return {
      days: daysList,
      secciones: Array.from(sections.values()),
    };
  }

  async getAssessments(studentId: number): Promise<AssessmentsResult> {
    const rawAssessments = await this.repository.findActiveSyllabiAndAssessments(studentId);
    const weeks = getAcademicWeeks();

    const weeksMap = new Map<number, RawWeekRow>();
    for (const w of weeks) {
      weeksMap.set(w.week_number, w);
    }

    const assessmentsList: AssessmentResponse[] = [];
    const seen = new Set<string>();

    const rowsByAssessment = new Map<number, RawAssessmentRow[]>();
    for (const row of rawAssessments) {
      if (!rowsByAssessment.has(row.assessment_id)) {
        rowsByAssessment.set(row.assessment_id, []);
      }
      rowsByAssessment.get(row.assessment_id)!.push(row);
    }

    for (const [, rows] of rowsByAssessment.entries()) {
      const validSessions = rows.filter((r) => r.day_of_week != null);
      if (validSessions.length === 0) {
        const row = rows[0];
        const startTime = row.start_time ?? "08:00:00";
        const endTime = row.end_time ?? "10:00:00";

        assessmentsList.push({
          id: String(row.assessment_id),
          courseName: row.course_name,
          sectionCode: row.section_code,
          code: row.assessment_code,
          name: row.assessment_name,
          weekNumber: row.assessment_week_number,
          date: "",
          startTime: startTime,
          endTime: endTime,
          classroom: row.classroom ?? "Por definir",
          color: row.color_hex ?? "blue",
        });
      } else {
        for (const row of validSessions) {
          if (row.day_of_week == null) continue;

          const week = weeksMap.get(row.assessment_week_number);
          let calculatedDateStr = "";
          if (week) {
            const weekStart = parseDateOnly(week.start_date);
            const dayOffset = row.day_of_week - 1;
            const calculatedDate = new Date(weekStart);
            calculatedDate.setUTCDate(weekStart.getUTCDate() + dayOffset);
            calculatedDateStr = formatDateOnly(calculatedDate);
          }

          const key = `${row.assessment_id}-${calculatedDateStr}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const startTime = row.start_time ?? "08:00:00";
          const endTime = row.end_time ?? "10:00:00";

          assessmentsList.push({
            id: String(row.assessment_id),
            courseName: row.course_name,
            sectionCode: row.section_code,
            code: row.assessment_code,
            name: row.assessment_name,
            weekNumber: row.assessment_week_number,
            date: calculatedDateStr,
            startTime: startTime,
            endTime: endTime,
            classroom: row.classroom ?? "Por definir",
            color: row.color_hex ?? "blue",
          });
        }
      }
    }

    return {
      assessments: assessmentsList.sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  async getWeeklyLoad(studentId: number): Promise<WeeklyLoadResponse> {
    const assessmentsResult = await this.getAssessments(studentId);
    const weeks = getAcademicWeeks();

    const uniqueAssessmentsInWeek = new Map<number, Set<string>>();
    for (const ass of assessmentsResult.assessments) {
      const weekNum = ass.weekNumber;
      if (!uniqueAssessmentsInWeek.has(weekNum)) {
        uniqueAssessmentsInWeek.set(weekNum, new Set<string>());
      }
      uniqueAssessmentsInWeek.get(weekNum)!.add(ass.id);
    }

    const weeksList: WeeklyLoadItem[] = [];
    for (const week of weeks) {
      const weekNum = week.week_number;
      const count = uniqueAssessmentsInWeek.get(weekNum)?.size ?? 0;
      weeksList.push({
        weekNumber: weekNum,
        startDate: week.start_date,
        endDate: week.end_date,
        assessmentCount: count,
        isHighLoad: count >= 3,
      });
    }

    return {
      weeks: weeksList,
    };
  }

  async getTeacherSessions(teacherId: number) {
    const classRows = await this.repository.findTeacherSessionsWithClasses(teacherId);
    const advisingRows = await this.repository.findTeacherAdvisingSessions(teacherId);
    const weeks = getAcademicWeeks();

    const activeDayName = (day: number) =>
      ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"][day - 1] ?? "Por definir";

    const sections = new Map<string, any>();

    for (const row of classRows) {
      const sectionId = String(row.section_id);
      if (!sections.has(sectionId)) {
        sections.set(sectionId, {
          idSeccion: sectionId,
          codigoSeccion: row.section_code,
          docenteCode: row.teacher_code ?? "",
          promedioSeccion: 0,
          idCurso: String(row.course_id),
          curso: row.course_name,
          asistido: 0,
          inasistencia: 0,
          total: 0,
          horarios: [],
        });
      }

      if (row.day_of_week != null) {
        const startTime = row.start_time ?? "08:00:00";
        const endTime = row.end_time ?? "10:00:00";
        const formattedStart = formatTimeToAmPm(startTime);
        const formattedEnd = formatTimeToAmPm(endTime);

        sections.get(sectionId)!.horarios.push({
          dia: activeDayName(Number(row.day_of_week)),
          inicio: startTime,
          hora_inicio: formattedStart,
          fin: endTime,
          hora_fin: formattedEnd,
          aula: row.classroom ?? "Por definir",
          salon: row.classroom ?? "Por definir",
          color: row.color_hex ?? "blue",
        });
      }
    }

    for (const advising of advisingRows) {
      const sectionId = `adv-${advising.id}`;
      const startTime = advising.start_time ?? "08:00:00";
      const endTime = advising.end_time ?? "10:00:00";
      const formattedStart = formatTimeToAmPm(startTime);
      const formattedEnd = formatTimeToAmPm(endTime);

      sections.set(sectionId, {
        idSeccion: sectionId,
        codigoSeccion: advising.kind === "extra" ? "Asesoría Extra" : "Asesoría",
        docenteCode: "",
        promedioSeccion: 0,
        idCurso: String(advising.course_offering_id),
        curso: advising.course_name,
        asistido: 0,
        inasistencia: 0,
        total: 0,
        isAdvising: true,
        horarios: [
          {
            dia: activeDayName(Number(advising.day_of_week)),
            inicio: startTime,
            hora_inicio: formattedStart,
            fin: endTime,
            hora_fin: formattedEnd,
            aula: advising.classroom ?? "Por definir",
            salon: advising.classroom ?? "Por definir",
            color: "#9C27B0",
            fecha: advising.session_date,
          }
        ],
      });
    }

    const daysList: DayInfo[] = [];
    if (weeks && weeks.length > 0) {
      for (const week of weeks) {
        const startDate = parseDateOnly(week.start_date);
        const weekNum = week.week_number;
        for (let i = 0; i < 7; i++) {
          const currentDate = new Date(startDate);
          currentDate.setUTCDate(startDate.getUTCDate() + i);
          daysList.push({
            dayName: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"][i],
            dateText: formatDateText(currentDate),
            weekText: `Semana ${weekNum} del ciclo`,
          });
        }
      }
    }

    return {
      days: daysList,
      secciones: Array.from(sections.values()),
    };
  }

  async getTeacherAssessments(teacherId: number): Promise<AssessmentsResult> {
    const rawAssessments = await this.repository.findTeacherSectionsAssessments(teacherId);
    const weeks = getAcademicWeeks();

    const weeksMap = new Map<number, RawWeekRow>();
    for (const w of weeks) {
      weeksMap.set(w.week_number, w);
    }

    const assessmentsList: AssessmentResponse[] = [];
    const seen = new Set<string>();

    const rowsByAssessment = new Map<number, RawAssessmentRow[]>();
    for (const row of rawAssessments) {
      if (!rowsByAssessment.has(row.assessment_id)) {
        rowsByAssessment.set(row.assessment_id, []);
      }
      rowsByAssessment.get(row.assessment_id)!.push(row);
    }

    for (const [, rows] of rowsByAssessment.entries()) {
      const validSessions = rows.filter((r) => r.day_of_week != null);
      if (validSessions.length === 0) {
        const row = rows[0];
        const startTime = row.start_time ?? "08:00:00";
        const endTime = row.end_time ?? "10:00:00";

        assessmentsList.push({
          id: String(row.assessment_id),
          courseName: row.course_name,
          sectionCode: row.section_code,
          code: row.assessment_code,
          name: row.assessment_name,
          weekNumber: row.assessment_week_number,
          date: "",
          startTime: startTime,
          endTime: endTime,
          classroom: row.classroom ?? "Por definir",
          color: row.color_hex ?? "blue",
        });
      } else {
        for (const row of validSessions) {
          if (row.day_of_week == null) continue;

          const week = weeksMap.get(row.assessment_week_number);
          let calculatedDateStr = "";
          if (week) {
            const weekStart = parseDateOnly(week.start_date);
            const dayOffset = row.day_of_week - 1;
            const calculatedDate = new Date(weekStart);
            calculatedDate.setUTCDate(weekStart.getUTCDate() + dayOffset);
            calculatedDateStr = formatDateOnly(calculatedDate);
          }

          const key = `${row.assessment_id}-${calculatedDateStr}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const startTime = row.start_time ?? "08:00:00";
          const endTime = row.end_time ?? "10:00:00";

          assessmentsList.push({
            id: String(row.assessment_id),
            courseName: row.course_name,
            sectionCode: row.section_code,
            code: row.assessment_code,
            name: row.assessment_name,
            weekNumber: row.assessment_week_number,
            date: calculatedDateStr,
            startTime: startTime,
            endTime: endTime,
            classroom: row.classroom ?? "Por definir",
            color: row.color_hex ?? "blue",
          });
        }
      }
    }

    return {
      assessments: assessmentsList.sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  async getTeacherAssessmentsStatus(teacherId: number, sectionId: number) {
    const isOwner = await this.repository.checkSectionOwnership(sectionId, teacherId);
    if (!isOwner) {
      throw new HttpError(403, "No tiene permisos para ver esta sección.", "SECTION_FORBIDDEN");
    }

    const totalEnrollments = await this.repository.countActiveEnrollments(sectionId);
    const assessments = await this.repository.findTeacherSectionAssessmentsStatus(sectionId);

    const list = await Promise.all(assessments.map(async (ass) => {
      let status = "Sin cargar";
      if (totalEnrollments > 0) {
        if (ass.loaded_count >= totalEnrollments) {
          status = "Completo";
        } else if (ass.loaded_count > 0) {
          status = "Carga parcial";
        }
      }
      const isNotified = await this.repository.findWasAssessmentNotified(sectionId, ass.assessment_id);
      return {
        id: String(ass.assessment_id),
        code: ass.assessment_code,
        name: ass.assessment_name,
        status,
        loadedCount: ass.loaded_count,
        totalCount: totalEnrollments,
        isNotified,
      };
    }));

    return { assessments: list };
  }

  async notifyGrades(teacherId: number, sectionId: number, assessmentId: number) {
    const isOwner = await this.repository.checkSectionOwnership(sectionId, teacherId);
    if (!isOwner) {
      throw new HttpError(403, "No tiene permisos para acceder a esta sección.", "SECTION_FORBIDDEN");
    }

    const sectionInfo = await this.repository.findSectionDetails(sectionId);
    if (!sectionInfo) {
      throw new HttpError(404, "Sección no encontrada.", "SECTION_NOT_FOUND");
    }

    const assessmentInfo = await this.repository.findAssessmentDetails(assessmentId);
    if (!assessmentInfo) {
      throw new HttpError(404, "Evaluación no encontrada.", "ASSESSMENT_NOT_FOUND");
    }

    const students = await this.repository.findActiveStudentsBySectionId(sectionId);

    // Título único por evaluación (incluye código) → cada eval tiene alerta independiente
    const title = `Notas disponibles: ${assessmentInfo.code} - ${sectionInfo.courseName}`;
    // El tag [notif-sX-aY] al final permite detectar si ya se envió (para inicializar switch).
    const message = `El docente ha publicado las notas de ${assessmentInfo.code}: ${assessmentInfo.name} de ${sectionInfo.courseName} (Sección ${sectionInfo.sectionCode}).`;

    // Siempre crear nueva alerta (sin chequeo de duplicados) para permitir re-envíos
    for (const student of students) {
      await this.repository.createAlert(student.studentId, "academic_risk", title, message);
    }

    return { ok: true, notifiedCount: students.length };
  }
}
