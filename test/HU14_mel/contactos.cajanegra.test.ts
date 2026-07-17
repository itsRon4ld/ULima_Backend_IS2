import { describe, expect, test } from "bun:test";
import type { EventBus } from "../../src/events/index.js";
import type { CourseDetailRepository } from "../../src/modules/course-detail/course-detail.repository.js";
import { sectionIdParamSchema } from "../../src/modules/course-detail/course-detail.schemas.js";
import { CourseDetailService } from "../../src/modules/course-detail/course-detail.service.js";

/**
 * ============================================================================
 * CAJA NEGRA — Visualizar contactos de la sección (HU14)
 * Fuente: GET /course-detail/sections/:sectionId/contacts (CourseDetailService.getContacts)
 * ============================================================================
 * Se valida el CONTRATO que consume el frontend (docente, alumnos[], user,
 * roleInSection, career_id) sin mirar la implementación, y la validación del
 * parámetro de ruta. Clases de equivalencia:
 *   CV1  docente + alumnos representativos -> estructura completa mapeada.
 *   CV2  docente ausente y alumnos vacíos  -> estructura estable {docente:null, alumnos:[]}.
 *   CNV1 sectionId inválido                -> rechazado por el DTO de ruta (entero positivo).
 */

// EventBus dummy: el test solo mira el contrato de salida.
const noopEvents = {} as unknown as EventBus;

// Repositorio falso: devuelve el docente y los alumnos del caso (aísla la BD).
const repo = (teacher: unknown, students: unknown[]) =>
  ({
    findAnnouncementsBySectionId: async () => [],
    findContactTeacherBySectionId: async () => teacher,
    findContactStudentsBySectionId: async () => students,
  }) as unknown as CourseDetailRepository;

describe("CAJA NEGRA · HU14 contactos de seccion", () => {
  test("CV1: devuelve docente y alumnos con campos esperados", async () => {
    const service = new CourseDetailService(
      repo(
        { teacher_code: "P001", full_name: "Quispe, Rosa" },   // docente (formato "Apellidos, Nombres")
        [
          {
            enrollment_id: 1,
            code: "20230001",
            full_name: "Torres, Ana",
            institutional_email: "20230001@aloe.ulima.edu.pe",
            career_id: 1,
            position: "delegate",                              // delegado
          },
        ],
      ),
      noopEvents,
    );

    const result = await service.getContacts(10);

    expect(result.docente).toEqual({ code: "P001", firstName: "Rosa", lastName: "Quispe" }); // nombre partido
    expect(result.alumnos[0].user.code).toBe("20230001");      // el código se conserva
    expect(result.alumnos[0].roleInSection).toBe("delegado");  // position -> etiqueta de rol
    expect(result.alumnos[0].user.career_id).toBe(1);          // career_id presente en el contrato
  });

  test("CV2: seccion sin docente ni alumnos retorna estructura estable", async () => {
    const service = new CourseDetailService(repo(null, []), noopEvents); // sin docente ni alumnos
    // Aun vacía, el contrato es estable (no lanza; devuelve las claves esperadas).
    await expect(service.getContacts(10)).resolves.toEqual({ docente: null, alumnos: [] });
  });

  test("CNV1: sectionId acepta solo entero positivo", () => {
    expect(sectionIdParamSchema.safeParse({ sectionId: "10" }).success).toBe(true);  // "10" coerce -> ok
    expect(sectionIdParamSchema.safeParse({ sectionId: "-1" }).success).toBe(false); // negativo -> no
    expect(sectionIdParamSchema.safeParse({ sectionId: "abc" }).success).toBe(false);// no numérico -> no
  });
});
