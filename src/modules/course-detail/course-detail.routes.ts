import { Hono } from "hono";
import type { CourseDetailController } from "./course-detail.controller.js";
import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { authMiddleware, requireRole, STUDENT_ROLES } from "../../shared/middleware/auth-middleware.js";

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
    return {
      lastName: parts.slice(0, 2).join(" "),
      firstName: parts.slice(2).join(" "),
    };
  } else if (parts.length === 2) {
    return {
      lastName: parts[0],
      firstName: parts[1],
    };
  }
  
  return {
    firstName: fullName,
    lastName: "",
  };
};

export const createCourseDetailRoutes = (controller: CourseDetailController) => {
  const app = new Hono();

  // Todas las rutas de detalle de curso exponen datos académicos sensibles
  // (secciones, docentes, matrículas, contactos): requieren JWT válido de alumno.
  app.use("*", authMiddleware);
  app.use("*", requireRole(...STUDENT_ROLES, "teacher"));

  app.get("/sections", async (c) => {
    try {
      const rows = await db.execute(sql`
        select
          sec.id as section_id,
          sec.code as section_code,
          t.teacher_code,
          c.id as course_id,
          c.name as course_name,
          coalesce(avg(sscore.value), 0) as promedio,
          coalesce(min(e.attended_hours), 0) as attended_hours,
          coalesce(max(e.absent_hours), 0) as absent_hours,
          coalesce(max(e.total_hours), 0) as total_hours
        from section sec
        join teacher t on t.id = sec.teacher_id
        join course_offering co on co.id = sec.course_offering_id
        join course c on c.id = co.course_id
        left join enrollment e on e.section_id = sec.id
        left join student_score sscore on sscore.enrollment_id = e.id
        group by sec.id, sec.code, t.teacher_code, c.id, c.name
        order by c.name, sec.code
      `) as unknown as Array<any>;

      return c.json({
        secciones: rows.map((row) => ({
          idSeccion: String(row.section_id),
          codigoSeccion: row.section_code,
          docenteCode: row.teacher_code ?? "",
          promedioSeccion: Number(row.promedio ?? 0),
          idCurso: String(row.course_id),
          curso: row.course_name,
          asistido: Number(row.attended_hours ?? 0),
          inasistencia: Number(row.absent_hours ?? 0),
          total: Number(row.total_hours ?? 0),
        })),
      });
    } catch (e) {
      console.error("DB Error in /sections", e);
      return c.json({ secciones: [] });
    }
  });

  app.get("/teachers", async (c) => {
    try {
      const rows = await db.execute(sql`
        select teacher_code, full_name
        from teacher
        order by full_name
      `) as unknown as Array<{ teacher_code: string | null; full_name: string }>;

      return c.json({
        docentes: rows.map((row) => ({
          code: row.teacher_code ?? "",
          ...splitName(row.full_name),
        })),
      });
    } catch (e) {
      console.error("DB Error in /teachers", e);
      return c.json({ docentes: [] });
    }
  });

  app.get("/enrollments", async (c) => {
    try {
      const rows = await db.execute(sql`
        select
          e.id,
          au.code as student_code,
          co.course_id,
          e.section_id
        from enrollment e
        join student st on st.id = e.student_id
        join app_user au on au.id = st.user_id
        join section sec on sec.id = e.section_id
        join course_offering co on co.id = sec.course_offering_id
        order by e.section_id, au.code
      `) as unknown as Array<any>;

      return c.json({
        enrollments: rows.map((row) => ({
          id: String(row.id),
          studentCode: row.student_code,
          idCurso: String(row.course_id),
          idSeccion: String(row.section_id),
        })),
      });
    } catch (e) {
      console.error("DB Error in /enrollments", e);
      return c.json({ enrollments: [] });
    }
  });

  app.get("/sections/:sectionId", async (c) => {
    const sectionId = c.req.param("sectionId");
    // Reenvía el Authorization para que la sub-petición interna pase authMiddleware.
    const response = await app.request("/sections", {
      headers: { Authorization: c.req.header("Authorization") ?? "" },
    });
    const data = await response.json() as { secciones: any[] };
    return c.json({ section: data.secciones.find((section) => section.idSeccion === sectionId) ?? null });
  });

  app.get("/sections/:sectionId/announcements", (c) => controller.getAnnouncements(c));

  app.get("/sections/:sectionId/contacts", async (c) => {
    const sectionId = Number(c.req.param("sectionId"));
    try {
      const teacherRows = await db.execute(sql`
        select t.teacher_code, t.full_name
        from section sec
        join teacher t on t.id = sec.teacher_id
        where sec.id = ${sectionId}
        limit 1
      `) as unknown as Array<any>;
      // HU18: jefe de práctica de la sección (0 o 1).
      const jpRows = await db.execute(sql`
        select t.teacher_code, t.full_name
        from section sec
        join teacher t on t.id = sec.jp_id
        where sec.id = ${sectionId}
        limit 1
      `) as unknown as Array<any>;
      const rows = await db.execute(sql`
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
      `) as unknown as Array<any>;

      return c.json({
        docente: teacherRows[0]
          ? {
              code: teacherRows[0].teacher_code ?? "",
              ...splitName(teacherRows[0].full_name),
            }
          : null,
        // HU18: grupo "Jefe de Práctica" (entre Docente y Alumnos). null si la sección no tiene JP.
        jefePractica: jpRows[0]
          ? {
              code: jpRows[0].teacher_code ?? "",
              ...splitName(jpRows[0].full_name),
            }
          : null,
        alumnos: rows.map((row) => ({
          user: {
            code: row.code,
            ...splitName(row.full_name),
            email: row.institutional_email,
            role: row.position === "delegate" ? "delegado" : row.position === "subdelegate" ? "subdelegado" : "estudiante",
            career_id: row.career_id,
            currentCycle: "2026-1",
            setupComplete: true,
          },
          roleInSection: row.position === "delegate" ? "delegado" : row.position === "subdelegate" ? "subdelegado" : "estudiante",
        })),
      });
    } catch (e) {
      console.error(`DB Error in /sections/${sectionId}/contacts`, e);
      return c.json({ docente: null, alumnos: [] });
    }
  });

  // ─── Attendance Risk ────────────────────────────────────────────────────────
  // Umbral Ulima: ≥25 % → impedido, ≥20 % → en_riesgo (< 20 % = normal).
  // Sólo docentes deben ver esto; teacher ya está en requireRole arriba.

  /** Calcula el estado de riesgo basado en el porcentaje de ausencias. */
  const riskStatus = (absentHours: number, totalHours: number): "impedido" | "en_riesgo" | "normal" => {
    if (totalHours === 0) return "normal";
    const pct = (absentHours / totalHours) * 100;
    if (pct >= 25) return "impedido";
    if (pct >= 20) return "en_riesgo";
    return "normal";
  };

  // GET /sections/:sectionId/attendance-risk → lista completa de alumnos en riesgo
  app.get("/sections/:sectionId/attendance-risk", async (c) => {
    const sectionId = Number(c.req.param("sectionId"));
    if (Number.isNaN(sectionId)) return c.json({ students: [] }, 400);
    try {
      const rows = await db.execute(sql`
        select
          au.code,
          au.full_name,
          s.current_level,
          e.absent_hours::float  as absent_hours,
          e.total_hours::float   as total_hours,
          round(
            case when e.total_hours = 0 then 0
                 else (e.absent_hours / e.total_hours) * 100
            end,
            2
          )::float as absence_percentage
        from enrollment e
        join student s   on s.id  = e.student_id
        join app_user au on au.id = s.user_id
        where e.section_id = ${sectionId}
          and e.status = 'active'
        order by absence_percentage desc, au.full_name
      `) as unknown as Array<{
        code: string;
        full_name: string;
        current_level: number | null;
        absent_hours: number;
        total_hours: number;
        absence_percentage: number;
      }>;

      const students = rows
        .map((row) => {
          const { lastName, firstName } = splitName(row.full_name);
          const status = riskStatus(row.absent_hours, row.total_hours);
          // missingFaltas: cuántas horas más bastan para llegar al 25 % (impedido).
          // Si ya es impedido, null.
          const horasParaImpedido = Math.ceil(row.total_hours * 0.25) - row.absent_hours;
          return {
            code: row.code,
            firstName,
            lastName,
            currentLevel: row.current_level ?? null,
            absentHours: Math.round(row.absent_hours),
            totalHours: Math.round(row.total_hours),
            absencePercentage: row.absence_percentage,
            status,
            missingFaltas: status === "en_riesgo" && horasParaImpedido > 0
              ? horasParaImpedido
              : null,
          };
        })
        .filter((s) => s.status !== "normal");   // solo los que tienen riesgo

      return c.json({ students });
    } catch (e) {
      console.error(`DB Error in /sections/${sectionId}/attendance-risk`, e);
      return c.json({ students: [] }, 500);
    }
  });

  // GET /sections/:sectionId/attendance-risk/summary → contadores para la tarjeta resumen
  app.get("/sections/:sectionId/attendance-risk/summary", async (c) => {
    const sectionId = Number(c.req.param("sectionId"));
    if (Number.isNaN(sectionId)) return c.json({ summary: { impedido: 0, en_riesgo: 0, total: 0 } }, 400);
    try {
      const rows = await db.execute(sql`
        select
          count(*) filter (
            where e.total_hours > 0
              and (e.absent_hours / e.total_hours) >= 0.25
          )::int as impedido,
          count(*) filter (
            where e.total_hours > 0
              and (e.absent_hours / e.total_hours) >= 0.20
              and (e.absent_hours / e.total_hours) < 0.25
          )::int as en_riesgo,
          count(*)::int as total
        from enrollment e
        where e.section_id = ${sectionId}
          and e.status = 'active'
      `) as unknown as Array<{ impedido: number; en_riesgo: number; total: number }>;

      const row = rows[0] ?? { impedido: 0, en_riesgo: 0, total: 0 };
      return c.json({
        summary: {
          impedido: Number(row.impedido),
          en_riesgo: Number(row.en_riesgo),
          total: Number(row.total),
        },
      });
    } catch (e) {
      console.error(`DB Error in /sections/${sectionId}/attendance-risk/summary`, e);
      return c.json({ summary: { impedido: 0, en_riesgo: 0, total: 0 } }, 500);
    }
  });

  // POST /sections/:sectionId/attendance-risk/notify → notifica a alumnos en riesgo
  // Implementación actual: stub (retorna 200). La integración de correos se puede
  // añadir conectando Resend igual que en el módulo de auth.
  app.post("/sections/:sectionId/attendance-risk/notify", async (c) => {
    const sectionId = Number(c.req.param("sectionId"));
    if (Number.isNaN(sectionId)) return c.json({ ok: false, notified: 0 }, 400);
    // TODO: enviar correo a cada alumno en riesgo usando Resend.
    console.info(`[attendance-risk/notify] sectionId=${sectionId} — notificación stub`);
    return c.json({ ok: true, notified: 0 });
  });

  return app;
};
