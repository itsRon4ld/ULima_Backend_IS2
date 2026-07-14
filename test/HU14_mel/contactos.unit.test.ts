import { describe, expect, test } from "bun:test";
import type { EventBus } from "../../src/events/index.js";
import type { CourseDetailRepository } from "../../src/modules/course-detail/course-detail.repository.js";
import { CourseDetailService } from "../../src/modules/course-detail/course-detail.service.js";
import type { RawContactStudentRow } from "../../src/modules/course-detail/course-detail.types.js";

/**
 * ============================================================================
 * PRUEBA UNITARIA — Mapeo de contactos de la sección (HU14)
 * Fuente: CourseDetailService.getContacts() — src/modules/course-detail/course-detail.service.ts
 * ============================================================================
 * Casos pequeños y aislados (repositorio falso) sobre el mapeo de un alumno:
 * conserva código/correo, preserva career_id null, y parte el nombre completo
 * (splitName) en apellidos/nombres para 2 apellidos y para una sola palabra.
 */

// EventBus dummy: el test solo evalúa el mapeo.
const noopEvents = {} as unknown as EventBus;

// Fabrica una fila de alumno; cada test cambia solo lo que le importa.
const student = (over: Partial<RawContactStudentRow> = {}): RawContactStudentRow => ({
  enrollment_id: 1,
  code: "20230001",
  full_name: "Ramos Silva Marco",
  institutional_email: "20230001@aloe.ulima.edu.pe",
  career_id: 2,
  position: null,
  ...over,
});

// Servicio con repositorio falso (sin docente): solo devuelve los alumnos del caso.
const serviceWith = (students: RawContactStudentRow[]) =>
  new CourseDetailService(
    {
      findAnnouncementsBySectionId: async () => [],
      findContactTeacherBySectionId: async () => null,
      findContactStudentsBySectionId: async () => students,
    } as unknown as CourseDetailRepository,
    noopEvents,
  );

describe("UNITARIA · HU14 contactos", () => {
  test("caso 1: estudiante conserva codigo y correo institucional", async () => {
    const result = await serviceWith([student()]).getContacts(1);
    expect(result.alumnos[0].user.code).toBe("20230001");                        // el código se conserva
    expect(result.alumnos[0].user.email).toBe("20230001@aloe.ulima.edu.pe");     // y el correo institucional
  });

  test("caso 2: career_id null se conserva como null", async () => {
    const result = await serviceWith([student({ career_id: null })]).getContacts(1);
    expect(result.alumnos[0].user.career_id).toBeNull();                          // null se preserva (no se convierte)
  });

  test("caso 3: full_name con dos apellidos separa correctamente", async () => {
    const result = await serviceWith([student({ full_name: "Ramos Silva Marco" })]).getContacts(1);
    // Sin coma y 3 palabras: los 2 primeros tokens son apellidos, el resto nombres.
    expect(result.alumnos[0].user.lastName).toBe("Ramos Silva");
    expect(result.alumnos[0].user.firstName).toBe("Marco");
  });

  test("caso 4: full_name de una palabra no inventa apellido", async () => {
    const result = await serviceWith([student({ full_name: "Ulises" })]).getContacts(1);
    expect(result.alumnos[0].user.firstName).toBe("Ulises");                      // todo es nombre
    expect(result.alumnos[0].user.lastName).toBe("");                             // apellido vacío (no se inventa)
  });
});
