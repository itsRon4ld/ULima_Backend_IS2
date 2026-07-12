import type { db } from "../../db/index.js";
import { sql } from "drizzle-orm";
import type {
  RawAnnouncementRow,
  RawContactStudentRow,
  RawContactTeacherRow,
} from "./course-detail.types.js";

export class CourseDetailRepository {
  constructor(readonly database: typeof db) {}

  async findAnnouncementsBySectionId(sectionId: number): Promise<RawAnnouncementRow[]> {
    try {
      return (await this.database.execute(sql`
        select
          a.id,
          a.title,
          a.message,
          a.published_at,
          au.code as autor_code,
          au.full_name,
          au.institutional_email,
          sr.position
        from announcement a
        join section_representative sr on sr.id = a.section_representative_id
        join enrollment e on e.id = sr.enrollment_id
        join student st on st.id = e.student_id
        join app_user au on au.id = st.user_id
        where sr.section_id = ${sectionId}
          and a.is_active = true
        order by a.published_at desc
      `)) as unknown as RawAnnouncementRow[];
    } catch (e) {
      console.error(`DB Error in findAnnouncementsBySectionId(${sectionId})`, e);
      return [];
    }
  }

  async findContactTeacherBySectionId(sectionId: number): Promise<RawContactTeacherRow | null> {
    try {
      const rows = (await this.database.execute(sql`
        select t.teacher_code, t.full_name
        from section sec
        join teacher t on t.id = sec.teacher_id
        where sec.id = ${sectionId}
        limit 1
      `)) as unknown as RawContactTeacherRow[];

      return rows[0] ?? null;
    } catch (e) {
      console.error(`DB Error in findContactTeacherBySectionId(${sectionId})`, e);
      return null;
    }
  }

  async findContactStudentsBySectionId(sectionId: number): Promise<RawContactStudentRow[]> {
    try {
      return (await this.database.execute(sql`
        select
          e.id as enrollment_id,
          au.code,
          au.full_name,
          au.institutional_email,
          s.career_id,
          sr.position
        from enrollment e
        join student s on s.id = e.student_id
        join app_user au on au.id = s.user_id
        left join section_representative sr on sr.enrollment_id = e.id and sr.is_active = true
        where e.section_id = ${sectionId}
        order by au.full_name
      `)) as unknown as RawContactStudentRow[];
    } catch (e) {
      console.error(`DB Error in findContactStudentsBySectionId(${sectionId})`, e);
      return [];
    }
  }
}
