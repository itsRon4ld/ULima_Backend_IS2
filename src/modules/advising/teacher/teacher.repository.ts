import type { db } from "../../../db/index.js";
import { sql } from "drizzle-orm";
import type {
  ActivePeriod,
  AdvisingSessionView,
  Attendee,
  DictanteRol,
  TeacherSection,
} from "./teacher.types.js";
import type { AdvisingModality, ExistingAdvising } from "./teacher.logic.js";

const dayName = (day: number) =>
  ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"][day - 1] ?? "Por definir";

const hhmm = (time: string | null) => (time ? time.slice(0, 5) : "");

const splitName = (fullName: string) => {
  if (fullName.includes(",")) {
    const parts = fullName.split(",");
    return { lastName: parts[0].trim(), firstName: parts.slice(1).join(",").trim() };
  }
  const parts = fullName.trim().split(/\s+/);
  if (parts.length > 2) return { lastName: parts.slice(0, 2).join(" "), firstName: parts.slice(2).join(" ") };
  if (parts.length === 2) return { lastName: parts[0], firstName: parts[1] };
  return { firstName: fullName, lastName: "" };
};

type SessionRow = {
  id: number;
  section_id: number | null;
  course_offering_id: number;
  course_name: string;
  section_code: string | null;
  kind: "recurring" | "extra";
  day_of_week: number;
  session_date: string | null;
  start_time: string;
  end_time: string;
  modality: AdvisingModality;
  classroom: string | null;
  meeting_url: string | null;
  note: string | null;
  capacity: number | null;
  rol: DictanteRol;
  asistentes: number;
};

const SESSION_SELECT = sql`
  select
    cas.id,
    cas.section_id,
    cas.course_offering_id,
    c.name as course_name,
    sec.code as section_code,
    cas.kind,
    cas.day_of_week,
    cas.session_date::text as session_date,
    cas.start_time::text as start_time,
    cas.end_time::text as end_time,
    cas.modality,
    cas.classroom,
    cas.meeting_url,
    cas.note,
    cas.capacity,
    case when sec.jp_id = cas.teacher_id then 'JP' else 'Profesor' end as rol,
    (select count(*)::int from advising_rsvp r where r.advising_session_id = cas.id) as asistentes
  from course_advising_session cas
  join course_offering co on co.id = cas.course_offering_id
  join course c on c.id = co.course_id
  left join section sec on sec.id = cas.section_id
`;

const toView = (row: SessionRow): AdvisingSessionView => ({
  id: Number(row.id),
  sectionId: row.section_id == null ? null : Number(row.section_id),
  courseOfferingId: Number(row.course_offering_id),
  courseName: row.course_name,
  sectionCode: row.section_code,
  kind: row.kind,
  dia: dayName(Number(row.day_of_week)),
  fecha: row.session_date,
  inicio: hhmm(row.start_time),
  fin: hhmm(row.end_time),
  modality: row.modality,
  aula: row.classroom ?? "",
  zoom: row.meeting_url ?? "",
  nota: row.note ?? "",
  cupo: row.capacity == null ? null : Number(row.capacity),
  asistentes: Number(row.asistentes),
  rol: row.rol,
});

export class TeacherRepository {
  constructor(readonly database: typeof db) {}

  async getActivePeriod(): Promise<ActivePeriod | null> {
    const rows = (await this.database.execute(sql`
      select id, start_date::text as start_date, end_date::text as end_date
      from academic_period where is_active = true limit 1
    `)) as unknown as Array<{ id: number; start_date: string; end_date: string }>;
    const row = rows[0];
    return row ? { id: Number(row.id), startDate: row.start_date, endDate: row.end_date } : null;
  }

  async findTeacherSections(teacherId: number, periodId: number): Promise<TeacherSection[]> {
    const rows = (await this.database.execute(sql`
      select
        sec.id as section_id,
        sec.course_offering_id,
        c.name as course_name,
        sec.code as section_code,
        case when sec.jp_id = ${teacherId} then 'JP' else 'Profesor' end as rol
      from section sec
      join course_offering co on co.id = sec.course_offering_id and co.academic_period_id = ${periodId}
      join course c on c.id = co.course_id
      where sec.teacher_id = ${teacherId} or sec.jp_id = ${teacherId}
      order by c.name, sec.code
    `)) as unknown as Array<{
      section_id: number;
      course_offering_id: number;
      course_name: string;
      section_code: string;
      rol: DictanteRol;
    }>;
    return rows.map((r) => ({
      sectionId: Number(r.section_id),
      courseOfferingId: Number(r.course_offering_id),
      courseName: r.course_name,
      sectionCode: r.section_code,
      rol: r.rol,
    }));
  }

  async findTeacherSessions(teacherId: number): Promise<AdvisingSessionView[]> {
    const rows = (await this.database.execute(sql`
      ${SESSION_SELECT}
      where cas.teacher_id = ${teacherId}
      order by case when cas.kind = 'extra' then 0 else 1 end,
               cas.session_date nulls last, cas.day_of_week, cas.start_time
    `)) as unknown as SessionRow[];
    return rows.map(toView);
  }

  async findSessionViewById(id: number): Promise<AdvisingSessionView | null> {
    const rows = (await this.database.execute(sql`
      ${SESSION_SELECT} where cas.id = ${id} limit 1
    `)) as unknown as SessionRow[];
    return rows[0] ? toView(rows[0]) : null;
  }

  async findSectionOwnedByTeacher(
    sectionId: number,
    teacherId: number,
  ): Promise<{ sectionId: number; courseOfferingId: number; rol: DictanteRol } | null> {
    const rows = (await this.database.execute(sql`
      select
        sec.id as section_id,
        sec.course_offering_id,
        case when sec.jp_id = ${teacherId} then 'JP' else 'Profesor' end as rol
      from section sec
      where sec.id = ${sectionId} and (sec.teacher_id = ${teacherId} or sec.jp_id = ${teacherId})
      limit 1
    `)) as unknown as Array<{ section_id: number; course_offering_id: number; rol: DictanteRol }>;
    const row = rows[0];
    return row
      ? { sectionId: Number(row.section_id), courseOfferingId: Number(row.course_offering_id), rol: row.rol }
      : null;
  }

  async findOwnSessionsForOverlap(teacherId: number): Promise<ExistingAdvising[]> {
    const rows = (await this.database.execute(sql`
      select cas.kind, cas.day_of_week, cas.session_date::text as session_date,
             cas.start_time::text as start_time, cas.end_time::text as end_time
      from course_advising_session cas
      where cas.teacher_id = ${teacherId}
    `)) as unknown as Array<{
      kind: "recurring" | "extra";
      day_of_week: number;
      session_date: string | null;
      start_time: string;
      end_time: string;
    }>;
    return rows.map((r) => ({
      kind: r.kind,
      dayOfWeek: Number(r.day_of_week),
      sessionDate: r.session_date,
      startTime: r.start_time,
      endTime: r.end_time,
    }));
  }

  async createExtraSession(input: {
    courseOfferingId: number;
    sectionId: number;
    teacherId: number;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    modality: AdvisingModality;
    classroom: string | null;
    meetingUrl: string | null;
    note: string | null;
    sessionDate: string;
    capacity: number | null;
  }): Promise<AdvisingSessionView> {
    const rows = (await this.database.execute(sql`
      insert into course_advising_session
        (course_offering_id, section_id, teacher_id, day_of_week, start_time, end_time,
         classroom, meeting_url, modality, note, kind, session_date, capacity)
      values
        (${input.courseOfferingId}, ${input.sectionId}, ${input.teacherId}, ${input.dayOfWeek},
         ${input.startTime}, ${input.endTime}, ${input.classroom}, ${input.meetingUrl},
         ${input.modality}, ${input.note}, 'extra', ${input.sessionDate}, ${input.capacity})
      returning id
    `)) as unknown as Array<{ id: number }>;
    const view = await this.findSessionViewById(Number(rows[0].id));
    if (!view) throw new Error("No se pudo leer la asesoría recién creada.");
    return view;
  }

  async findSessionOwnership(
    id: number,
  ): Promise<{ id: number; teacherId: number; kind: "recurring" | "extra" } | null> {
    const rows = (await this.database.execute(sql`
      select id, teacher_id, kind from course_advising_session where id = ${id} limit 1
    `)) as unknown as Array<{ id: number; teacher_id: number; kind: "recurring" | "extra" }>;
    const row = rows[0];
    return row ? { id: Number(row.id), teacherId: Number(row.teacher_id), kind: row.kind } : null;
  }

  async deleteSessionWithRsvps(id: number): Promise<void> {
    await this.database.transaction(async (tx) => {
      await tx.execute(sql`delete from advising_rsvp where advising_session_id = ${id}`);
      await tx.execute(sql`delete from course_advising_session where id = ${id}`);
    });
  }

  async findAttendees(sessionId: number): Promise<Attendee[]> {
    const rows = (await this.database.execute(sql`
      select au.code, au.full_name
      from advising_rsvp r
      join student st on st.id = r.student_id
      join app_user au on au.id = st.user_id
      where r.advising_session_id = ${sessionId}
      order by au.full_name
    `)) as unknown as Array<{ code: string; full_name: string }>;
    return rows.map((r) => ({ code: r.code, ...splitName(r.full_name) }));
  }
}
