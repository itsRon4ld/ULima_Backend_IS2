import type { db } from "../../../db/index.js";
import { sql } from "drizzle-orm";
import type { RawAdvisingRow } from "./student.types.js";
import type { SessionLike } from "./student.logic.js";

export class StudentRepository {
  constructor(readonly database: typeof db) {}

  async findBySection(sectionId: number, studentId?: number): Promise<RawAdvisingRow[]> {
    const myRsvpExpr = studentId != null
      ? sql`exists(select 1 from advising_rsvp r where r.advising_session_id = cas.id and r.student_id = ${studentId})`
      : sql`false`;

    try {
      return (await this.database.execute(sql`
        select
          cas.id,
          cas.course_offering_id,
          cas.section_id,
          cas.day_of_week,
          cas.start_time,
          cas.end_time,
          cas.classroom,
          cas.meeting_url,
          cas.kind,
          cas.session_date::text as session_date,
          t.teacher_code,
          t.full_name,
          case when cas.teacher_id = sec.jp_id then 'JP' else 'Profesor' end as dictante_rol,
          (select count(*)::int from advising_rsvp r where r.advising_session_id = cas.id) as asistentes,
          ${myRsvpExpr} as my_rsvp
        from course_advising_session cas
        join teacher t on t.id = cas.teacher_id
        join section sec on sec.course_offering_id = cas.course_offering_id
        where sec.id = ${sectionId}
          and (cas.section_id is null or cas.section_id = ${sectionId})
          and (
            cas.kind = 'recurring'
            or cas.kind = 'extra'
          )
        order by
          case when cas.kind = 'extra' then 0 else 1 end,
          cas.session_date nulls last, cas.day_of_week, cas.start_time
      `)) as unknown as RawAdvisingRow[];
    } catch (e) {
      console.error(`DB Error in findBySection(${sectionId})`, e);
      return [];
    }
  }

  async findSessionById(sessionId: number): Promise<SessionLike | null> {
    const rows = (await this.database.execute(sql`
      select kind, session_date::text as "sessionDate",
             day_of_week as "dayOfWeek",
             start_time::text as "startTime",
             end_time::text as "endTime"
      from course_advising_session
      where id = ${sessionId}
      limit 1
    `)) as unknown as Array<{
      kind: string;
      sessionDate: string | null;
      dayOfWeek: number;
      startTime: string;
      endTime: string;
    }>;
    const r = rows[0];
    if (!r) return null;
    return {
      kind: r.kind,
      sessionDate: r.sessionDate,
      dayOfWeek: Number(r.dayOfWeek),
      startTime: r.startTime,
      endTime: r.endTime,
    };
  }

  async isParticipant(sessionId: number, studentId: number): Promise<boolean> {
    const rows = (await this.database.execute(sql`
      select 1
      from course_advising_session cas
      join section sec on sec.course_offering_id = cas.course_offering_id
      join enrollment e on e.section_id = sec.id and e.status = 'active'
      where cas.id = ${sessionId}
        and e.student_id = ${studentId}
        and (cas.section_id is null or cas.section_id = sec.id)
      limit 1
    `)) as unknown as Array<unknown>;
    return rows.length > 0;
  }

  async insertRsvp(sessionId: number, studentId: number): Promise<void> {
    await this.database.execute(sql`
      insert into advising_rsvp (advising_session_id, student_id)
      values (${sessionId}, ${studentId})
      on conflict (advising_session_id, student_id) do nothing
    `);
  }

  async deleteRsvp(sessionId: number, studentId: number): Promise<void> {
    await this.database.execute(sql`
      delete from advising_rsvp
      where advising_session_id = ${sessionId} and student_id = ${studentId}
    `);
  }

  async countRsvp(sessionId: number): Promise<number> {
    const rows = (await this.database.execute(sql`
      select count(*)::int as total
      from advising_rsvp
      where advising_session_id = ${sessionId}
    `)) as unknown as Array<{ total: number }>;
    return Number(rows[0]?.total ?? 0);
  }
}
