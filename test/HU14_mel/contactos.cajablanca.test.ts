import { describe, expect, test } from "bun:test";
import type { EventBus } from "../../src/events/index.js";
import type { CourseDetailRepository } from "../../src/modules/course-detail/course-detail.repository.js";
import { CourseDetailService } from "../../src/modules/course-detail/course-detail.service.js";
import type {
  RawContactStudentRow,
  RawContactTeacherRow,
} from "../../src/modules/course-detail/course-detail.types.js";

/**
 * ============================================================================
 * CAJA BLANCA — CourseDetailService.getContacts() (HU14: contactos de la sección)
 * Fuente: src/modules/course-detail/course-detail.service.ts
 * ============================================================================
 * Se recorre cada CAMINO interno del armado de contactos, aislando la BD con un
 * repositorio falso (stub). Caminos cubiertos:
 *   C1  teacher null           -> docente null
 *   C2  teacher existe          -> mapTeacher() (código + nombres partidos)
 *   C3  position "delegate"     -> rol "delegado"
 *   C4  position "subdelegate"  -> rol "subdelegado"
 *   C5  position null/otro      -> rol "estudiante"
 *   (splitName con coma/dos/una palabra se cubre de paso al mapear nombres)
 */

// EventBus dummy: el test solo evalúa el armado de contactos.
const noopEvents = {} as unknown as EventBus;

// Fabrica una fila de alumno de contacto; cada test sobrescribe lo que necesita.
const student = (over: Partial<RawContactStudentRow> = {}): RawContactStudentRow => ({
  enrollment_id: 1,
  code: "20230001",
  full_name: "Torres, Ana",
  institutional_email: "20230001@aloe.ulima.edu.pe",
  career_id: 1,
  position: "delegate",                          // por defecto delegado (los tests cambian el position)
  ...over,
});

// Arma el servicio con un repositorio falso que devuelve el docente y los alumnos del caso.
const serviceWith = (
  teacher: RawContactTeacherRow | null,
  students: RawContactStudentRow[],
) =>
  new CourseDetailService(
    {
      findAnnouncementsBySectionId: async () => [],          // no se usa aquí
      findContactTeacherBySectionId: async () => teacher,    // el docente del caso (o null)
      findContactStudentsBySectionId: async () => students,  // los alumnos del caso
    } as unknown as CourseDetailRepository,
    noopEvents,
  );

describe("CAJA BLANCA · HU14 getContacts()", () => {
  test("C1: teacher null retorna docente null", async () => {
    const result = await serviceWith(null, []).getContacts(1); // sin docente
    expect(result.docente).toBeNull();                          // rama C1: docente null
  });

  test("C2: teacher existente se mapea con codigo y nombres", async () => {
    const result = await serviceWith({ teacher_code: "P002", full_name: "Diaz Elena" }, []).getContacts(1);
    // rama C2: mapTeacher parte "Diaz Elena" (sin coma, 2 palabras) en apellido/nombre.
    expect(result.docente).toEqual({ code: "P002", firstName: "Elena", lastName: "Diaz" });
  });

  test("C3: delegate se normaliza a delegado", async () => {
    const result = await serviceWith(null, [student({ position: "delegate" })]).getContacts(1);
    expect(result.alumnos[0].roleInSection).toBe("delegado");   // rama C3
  });

  test("C4: subdelegate se normaliza a subdelegado", async () => {
    const result = await serviceWith(null, [student({ position: "subdelegate" })]).getContacts(1);
    expect(result.alumnos[0].roleInSection).toBe("subdelegado"); // rama C4
  });

  test("C5: position null cae a estudiante", async () => {
    const result = await serviceWith(null, [student({ position: null })]).getContacts(1);
    expect(result.alumnos[0].roleInSection).toBe("estudiante");  // rama C5: sin cargo -> estudiante
  });
});
