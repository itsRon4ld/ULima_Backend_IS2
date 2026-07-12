import type { db } from "../../db/index.js";
import { sql } from "drizzle-orm";

export type RawSessionRow = {
  section_id: number;
  section_code: string;
  teacher_code: string | null;
  course_id: number;
  course_name: string;
  attended_hours: string;
  absent_hours: string;
  total_hours: string;
  session_id: number | null;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
  classroom: string | null;
  color_hex: string | null;
};

export type RawAssessmentRow = {
  course_id: number;
  course_name: string;
  section_id: number;
  section_code: string;
  assessment_id: number;
  assessment_name: string;
  assessment_code: string;
  assessment_week_number: number;
  assessment_weight: string;
  assessment_type: string | null;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
  classroom: string | null;
  color_hex: string | null;
};

export type RawWeekRow = {
  week_number: number;
  start_date: string;
  end_date: string;
};

export class ScheduleRepository {
  constructor(readonly database: typeof db) {}

  async findActiveEnrollmentsWithSessions(studentId: number): Promise<RawSessionRow[]> {
    try {
      return (await this.database.execute(sql`
        select
          sec.id as section_id,
          sec.code as section_code,
          t.teacher_code,
          c.id as course_id,
          c.name as course_name,
          e.attended_hours,
          e.absent_hours,
          e.total_hours,
          ss.id as session_id,
          ss.day_of_week,
          ss.start_time,
          ss.end_time,
          ss.classroom,
          ss.color_hex
        from enrollment e
        join section sec on sec.id = e.section_id
        join teacher t on t.id = sec.teacher_id
        join course_offering co on co.id = sec.course_offering_id
        join course c on c.id = co.course_id
        left join schedule_session ss on ss.section_id = sec.id
        where e.student_id = ${studentId}
          and e.status = 'active'
        order by ss.day_of_week, ss.start_time, c.name
      `)) as unknown as RawSessionRow[];
    } catch (e) {
      console.error('DB Error in findActiveEnrollmentsWithSessions', e);
      return [];
    }
  }

  async findActiveSyllabiAndAssessments(studentId: number): Promise<RawAssessmentRow[]> {
    try {
      return (await this.database.execute(sql`
        select
          c.id as course_id,
          c.name as course_name,
          sec.id as section_id,
          sec.code as section_code,
          a.id as assessment_id,
          a.name as assessment_name,
          a.code as assessment_code,
          a.week_number as assessment_week_number,
          a.weight as assessment_weight,
          at.name as assessment_type,
          ss.day_of_week,
          ss.start_time,
          ss.end_time,
          ss.classroom,
          ss.color_hex
        from enrollment e
        join section sec on sec.id = e.section_id
        join course_offering co on co.id = sec.course_offering_id
        join course c on c.id = co.course_id
        join syllabus sy on sy.course_offering_id = co.id
        join assessment a on a.syllabus_id = sy.id
        left join assessment_type at on at.id = a.assessment_type_id
        left join schedule_session ss on ss.section_id = sec.id
        where e.student_id = ${studentId}
          and e.status = 'active'
        order by a.week_number, c.name, a.code, ss.day_of_week
      `)) as unknown as RawAssessmentRow[];
    } catch (e) {
      console.error('DB Error in findActiveSyllabiAndAssessments', e);
      return [];
    }
  }

  async findAcademicWeeksForActivePeriod(): Promise<RawWeekRow[]> {
    try {
      return (await this.database.execute(sql`
        select
          aw.week_number,
          aw.start_date,
          aw.end_date
        from academic_week aw
        join academic_period ap on ap.id = aw.academic_period_id
        where ap.is_active = true
        order by aw.week_number
      `)) as unknown as RawWeekRow[];
    } catch (e) {
      console.error('DB Error in findAcademicWeeksForActivePeriod', e);
      return [];
    }
  }

  async findTeacherSessionsWithClasses(teacherId: number): Promise<RawSessionRow[]> {
    try {
      return (await this.database.execute(sql`
        select
          sec.id as section_id,
          sec.code as section_code,
          t.teacher_code,
          c.id as course_id,
          c.name as course_name,
          '0' as attended_hours,
          '0' as absent_hours,
          '0' as total_hours,
          ss.id as session_id,
          ss.day_of_week,
          ss.start_time,
          ss.end_time,
          ss.classroom,
          ss.color_hex
        from section sec
        join teacher t on t.id = sec.teacher_id
        join course_offering co on co.id = sec.course_offering_id
        join course c on c.id = co.course_id
        left join schedule_session ss on ss.section_id = sec.id
        where sec.teacher_id = ${teacherId} or sec.jp_id = ${teacherId}
        order by ss.day_of_week, ss.start_time, c.name
      `)) as unknown as RawSessionRow[];
    } catch (e) {
      console.error('DB Error in findTeacherSessionsWithClasses', e);
      return [];
    }
  }

  async findTeacherAdvisingSessions(teacherId: number) {
    try {
      return (await this.database.execute(sql`
        select
          cas.id,
          cas.course_offering_id,
          cas.section_id,
          c.name as course_name,
          sec.code as section_code,
          cas.kind,
          cas.day_of_week,
          cas.session_date::text as session_date,
          cas.start_time::text as start_time,
          cas.end_time::text as end_time,
          cas.modality,
          cas.classroom,
          cas.meeting_url
        from course_advising_session cas
        join course_offering co on co.id = cas.course_offering_id
        join course c on c.id = co.course_id
        left join section sec on sec.id = cas.section_id
        where cas.teacher_id = ${teacherId}
        order by cas.day_of_week, cas.start_time
      `)) as unknown as Array<{
        id: number;
        course_offering_id: number;
        section_id: number | null;
        course_name: string;
        section_code: string | null;
        kind: "recurring" | "extra";
        day_of_week: number;
        session_date: string | null;
        start_time: string;
        end_time: string;
        modality: string;
        classroom: string | null;
        meeting_url: string | null;
      }>;
    } catch (e) {
      console.error('DB Error in findTeacherAdvisingSessions', e);
      return [];
    }
  }

  async findTeacherSectionsAssessments(teacherId: number): Promise<RawAssessmentRow[]> {
    try {
      return (await this.database.execute(sql`
        select
          c.id as course_id,
          c.name as course_name,
          sec.id as section_id,
          sec.code as section_code,
          a.id as assessment_id,
          a.name as assessment_name,
          a.code as assessment_code,
          a.week_number as assessment_week_number,
          a.weight as assessment_weight,
          at.name as assessment_type,
          ss.day_of_week,
          ss.start_time,
          ss.end_time,
          ss.classroom,
          ss.color_hex
        from section sec
        join course_offering co on co.id = sec.course_offering_id
        join course c on c.id = co.course_id
        join syllabus sy on sy.course_offering_id = co.id
        join assessment a on a.syllabus_id = sy.id
        left join assessment_type at on at.id = a.assessment_type_id
        left join schedule_session ss on ss.section_id = sec.id
        where sec.teacher_id = ${teacherId} or sec.jp_id = ${teacherId}
        order by a.week_number, c.name, a.code, ss.day_of_week
      `)) as unknown as RawAssessmentRow[];
    } catch (e) {
      console.error('DB Error in findTeacherSectionsAssessments', e);
      return [];
    }
  }

  async checkSectionOwnership(sectionId: number, teacherId: number): Promise<boolean> {
    try {
      const rows = (await this.database.execute(sql`
        select 1 from section
        where id = ${sectionId} and (teacher_id = ${teacherId} or jp_id = ${teacherId})
        limit 1
      `)) as unknown as Array<{ '1': number }>;
      return rows.length > 0;
    } catch (e) {
      console.error('DB Error in checkSectionOwnership', e);
      return false;
    }
  }

  async countActiveEnrollments(sectionId: number): Promise<number> {
    try {
      const rows = (await this.database.execute(sql`
        select count(*)::int as total
        from enrollment
        where section_id = ${sectionId} and status = 'active'
      `)) as unknown as Array<{ total: number }>;
      return rows[0]?.total ?? 0;
    } catch (e) {
      console.error('DB Error in countActiveEnrollments', e);
      return 0;
    }
  }

  async findTeacherSectionAssessmentsStatus(sectionId: number) {
    try {
      return (await this.database.execute(sql`
        select
          a.id as assessment_id,
          a.code as assessment_code,
          a.name as assessment_name,
          count(ss.id)::int as loaded_count
        from assessment a
        join syllabus sy on sy.id = a.syllabus_id
        join course_offering co on co.id = sy.course_offering_id
        join section sec on sec.course_offering_id = co.id
        left join enrollment e on e.section_id = sec.id and e.status = 'active'
        left join student_score ss on ss.assessment_id = a.id and ss.enrollment_id = e.id and ss.value is not null
        where sec.id = ${sectionId}
        group by a.id, a.code, a.name
        order by a.id
      `)) as unknown as Array<{
        assessment_id: number;
        assessment_code: string;
        assessment_name: string;
        loaded_count: number;
      }>;
    } catch (e) {
      console.error('DB Error in findTeacherSectionAssessmentsStatus', e);
      return [];
    }
  }

  async findSectionDetails(sectionId: number) {
    try {
      const rows = await this.database.execute(sql`
        select sec.code as section_code, c.name as course_name
        from section sec
        join course_offering co on co.id = sec.course_offering_id
        join course c on c.id = co.course_id
        where sec.id = ${sectionId}
        limit 1
      `) as unknown as Array<{ section_code: string; course_name: string }>;
      return rows[0] ? { sectionCode: rows[0].section_code, courseName: rows[0].course_name } : null;
    } catch (e) {
      console.error('DB Error in findSectionDetails', e);
      return null;
    }
  }

  async findAssessmentDetails(assessmentId: number) {
    try {
      const rows = await this.database.execute(sql`
        select code, name from assessment where id = ${assessmentId} limit 1
      `) as unknown as Array<{ code: string; name: string }>;
      return rows[0] ? { code: rows[0].code, name: rows[0].name } : null;
    } catch (e) {
      console.error('DB Error in findAssessmentDetails', e);
      return null;
    }
  }

  async findActiveStudentsBySectionId(sectionId: number) {
    try {
      return await this.database.execute(sql`
        select student_id as "studentId" from enrollment where section_id = ${sectionId} and status = 'active'
      `) as unknown as Array<{ studentId: number }>;
    } catch (e) {
      console.error('DB Error in findActiveStudentsBySectionId', e);
      return [];
    }
  }

  async countGradedForAssessment(assessmentId: number, sectionId: number): Promise<number> {
    try {
      const rows = await this.database.execute(sql`
        select count(ss.id)::int as graded
        from enrollment e
        left join student_score ss on ss.assessment_id = ${assessmentId}
          and ss.enrollment_id = e.id
          and ss.value is not null
        where e.section_id = ${sectionId} and e.status = 'active'
      `) as unknown as Array<{ graded: number }>;
      return rows[0]?.graded ?? 0;
    } catch (e) {
      console.error('DB Error in countGradedForAssessment', e);
      return 0;
    }
  }

  async findAlertByTitle(studentId: number, title: string): Promise<boolean> {
    try {
      const rows = await this.database.execute(sql`
        select id from alert where student_id = ${studentId} and title = ${title} limit 1
      `) as unknown as any[];
      return rows.length > 0;
    } catch (e) {
      console.error('DB Error in findAlertByTitle', e);
      return false;
    }
  }

  /**
   * Verifica si algún alumno de la sección recibió una alerta de notas
   * para la evaluación dada (patrón de título único por assessmentId+sectionId).
   * Usado para inicializar el estado del switch en el frontend.
   */
  async findWasAssessmentNotified(sectionId: number, assessmentId: number): Promise<boolean> {
    try {
      const rows = await this.database.execute(sql`
        select al.id from alert al
        join enrollment e on e.student_id = al.student_id and e.section_id = ${sectionId} and e.status = 'active'
        join section sec on sec.id = e.section_id
        join course_offering co on co.id = sec.course_offering_id
        join course c on c.id = co.course_id
        join assessment ass on ass.id = ${assessmentId}
        where al.title = 'Notas disponibles: ' || ass.code || ' - ' || c.name
        limit 1
      `) as unknown as any[];
      return rows.length > 0;
    } catch (e) {
      console.error('DB Error in findWasAssessmentNotified', e);
      return false;
    }
  }

  async createAlert(studentId: number, type: "academic_risk" | "high_load", title: string, message: string): Promise<void> {
    try {
      await this.database.execute(sql`
        insert into alert (student_id, type, title, message, is_read, created_at)
        values (${studentId}, ${type}, ${title}, ${message}, false, now())
      `);
    } catch (e) {
      console.error('DB Error in createAlert', e);
    }
  }
}
