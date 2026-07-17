import { describe, expect, test } from "bun:test";
import { OfficialGradesService } from "../../src/modules/official-grades/official-grades.service.js";
import type { OfficialGradesRepository } from "../../src/modules/official-grades/official-grades.repository.js";
import type { EventBus } from "../../src/events/index.js";

/**
 * ============================================================================
 * CAJA BLANCA — OfficialGradesService.saveSectionScores() (HU29: calificar como docente)
 * Fuente: src/modules/official-grades/official-grades.service.ts
 * ============================================================================
 * Verifica las reglas con las que el PROFESOR TITULAR carga las notas oficiales
 * de su sección, aislando la persistencia con un repositorio falso (doble de
 * prueba); no toca la BD. Se recorre cada rama de autorización/validación:
 *
 *   P1  teacherIsSectionProfesor == false  -> 403 NOT_SECTION_PROFESSOR (un JP no califica)
 *   P2  enrollment ajeno a la sección      -> 404 ENROLLMENT_NOT_IN_SECTION
 *   P3  assessment ajeno a la sección      -> 404 ASSESSMENT_NOT_IN_SECTION
 *   P4  todo válido                        -> upsert de cada nota + devuelve la grilla
 *
 * Regla clave (all-or-nothing): valida TODAS las notas ANTES de escribir; si una
 * es inválida NO se escribe ninguna (se afirma con el contador de upserts).
 * Además se cubren getSectionGrid (403 al docente ajeno) y getMyOfficialCourses
 * (agrupado por sección + conversión de tipos, conservando value null).
 *
 * Casos: saveSectionScores 4 · getSectionGrid 1 · getMyOfficialCourses 1.
 */

// EventBus dummy: el test no evalúa eventos, solo la lógica del servicio.
const noopEvents = {} as unknown as EventBus;

// Repositorio FALSO: implementa todos los métodos con respuestas neutras (docente
// SÍ es titular, sets vacíos, upsert no-op). Cada test sobrescribe (`over`) solo
// lo que necesita para forzar un camino concreto.
const fakeRepo = (over: Partial<OfficialGradesRepository>): OfficialGradesRepository =>
  ({
    findActivePeriodId: async () => 1,                 // período académico activo (irrelevante para estos caminos)
    teacherIsSectionProfesor: async () => true,        // por defecto: el docente SÍ es el profesor titular
    findTeacherSections: async () => [],
    findSectionStudents: async () => [],
    findSectionAssessments: async () => [],
    findSectionScores: async () => [],
    findSectionEnrollmentIds: async () => new Set<number>(), // matrículas de la sección (vacío por defecto)
    findSectionAssessmentIds: async () => new Set<number>(), // evaluaciones de la sección (vacío por defecto)
    upsertScore: async () => {},                       // guardar una nota (no-op; los tests lo espían)
    findStudentOfficialScores: async () => [],
    ...over,                                            // el test inyecta aquí el comportamiento que quiere probar
  }) as unknown as OfficialGradesRepository;

// Helper: ejecuta `fn` y afirma que lanzó un HttpError con el status y code esperados.
const expectHttpError = async (fn: () => Promise<unknown>, status: number, code: string) => {
  try {
    await fn();                                         // corre la acción que DEBE fallar
    throw new Error(`se esperaba ${status} ${code} y no se lanzó`); // si no lanzó, el test falla
  } catch (e) {
    const err = e as { statusCode?: number; code?: string };
    expect(err.statusCode).toBe(status);               // verifica el código HTTP (403 / 404)
    expect(err.code).toBe(code);                       // verifica el código de negocio (NOT_SECTION_PROFESSOR, etc.)
  }
};

describe("OfficialGradesService.saveSectionScores", () => {
  test("docente que NO es el profesor titular (p.ej. un JP) ⇒ 403 y no escribe", async () => {
    let upserts = 0;                                    // contador espía: cuántas notas se intentaron guardar
    const service = new OfficialGradesService(
      fakeRepo({
        // teacherIsSectionProfesor=false representa a un JP (u otro docente): no califica.
        teacherIsSectionProfesor: async () => false,   // fuerza P1: el docente NO es titular
        upsertScore: async () => {
          upserts += 1;                                 // si alguna nota se escribiera, lo detectaríamos aquí
        },
      }),
      noopEvents,
    );
    await expectHttpError(
      () => service.saveSectionScores(9, 1, [{ enrollmentId: 5, assessmentId: 10, value: 15 }]), // intenta calificar
      403,
      "NOT_SECTION_PROFESSOR",                          // debe cortar con 403 antes de escribir
    );
    expect(upserts).toBe(0);                            // y no debe haber escrito ninguna nota
  });

  test("matrícula que no es de la sección ⇒ 404 y no escribe nada", async () => {
    let upserts = 0;
    const service = new OfficialGradesService(
      fakeRepo({
        teacherIsSectionProfesor: async () => true,    // el docente sí es titular (pasa P1)
        findSectionEnrollmentIds: async () => new Set([5]),   // en la sección solo existe la matrícula 5
        findSectionAssessmentIds: async () => new Set([10]),  // y la evaluación 10
        upsertScore: async () => {
          upserts += 1;
        },
      }),
      noopEvents,
    );
    await expectHttpError(
      () =>
        service.saveSectionScores(1, 1, [
          { enrollmentId: 5, assessmentId: 10, value: 12 },  // válida
          { enrollmentId: 999, assessmentId: 10, value: 8 }, // 999 NO es de la sección -> debe fallar
        ]),
      404,
      "ENROLLMENT_NOT_IN_SECTION",                     // P2
    );
    expect(upserts).toBe(0); // valida TODO antes de escribir (all-or-nothing: ni siquiera guarda la nota válida)
  });

  test("evaluación que no es de la sección ⇒ 404", async () => {
    const service = new OfficialGradesService(
      fakeRepo({
        findSectionEnrollmentIds: async () => new Set([5]),   // la matrícula 5 sí existe
        findSectionAssessmentIds: async () => new Set([10]),  // pero solo la evaluación 10
      }),
      noopEvents,
    );
    await expectHttpError(
      () => service.saveSectionScores(1, 1, [{ enrollmentId: 5, assessmentId: 77, value: 12 }]), // eval 77 no existe
      404,
      "ASSESSMENT_NOT_IN_SECTION",                    // P3
    );
  });

  test("todo válido ⇒ upsert de cada nota y devuelve la grilla", async () => {
    const upserts: Array<[number, number, number]> = []; // espía: registra (enrollment, assessment, value) de cada guardado
    const service = new OfficialGradesService(
      fakeRepo({
        findSectionEnrollmentIds: async () => new Set([5, 6]), // ambas matrículas son de la sección
        findSectionAssessmentIds: async () => new Set([10]),   // y la evaluación existe
        upsertScore: async (e, a, v) => {
          upserts.push([e, a, v]);                     // captura cada nota que el servicio guarda
        },
        findSectionStudents: async () => [{ enrollmentId: 5, code: "20231483", fullName: "HURTADO" }],
        findSectionAssessments: async () => [
          { assessmentId: 10, code: "EV01", name: "Parcial", weight: "40.00", weekNumber: 8 }, // peso como string (viene de PG)
        ],
        findSectionScores: async () => [{ enrollmentId: 5, assessmentId: 10, value: "15.00" }], // value como string (PG)
      }),
      noopEvents,
    );
    const grid = await service.saveSectionScores(1, 1, [
      { enrollmentId: 5, assessmentId: 10, value: 15 }, // ambas válidas -> P4
      { enrollmentId: 6, assessmentId: 10, value: 18 },
    ]);
    expect(upserts).toEqual([
      [5, 10, 15],                                     // guardó la nota del alumno 5
      [6, 10, 18],                                     // y la del alumno 6, en orden
    ]);
    // La grilla devuelta convierte los strings de Postgres a number (weight "40.00" -> 40).
    expect(grid.assessments[0]).toEqual({ assessmentId: 10, code: "EV01", name: "Parcial", weight: 40, weekNumber: 8 });
    expect(grid.scores[0]).toEqual({ enrollmentId: 5, assessmentId: 10, value: 15 }); // value "15.00" -> 15
  });
});

describe("OfficialGradesService.getSectionGrid", () => {
  test("docente ajeno ⇒ 403", async () => {
    // Leer la grilla de otra sección también exige ser el profesor titular.
    const service = new OfficialGradesService(fakeRepo({ teacherIsSectionProfesor: async () => false }), noopEvents);
    await expectHttpError(() => service.getSectionGrid(9, 1), 403, "NOT_SECTION_PROFESSOR");
  });
});

describe("OfficialGradesService.getMyOfficialCourses", () => {
  test("agrupa por sección y convierte value (null se mantiene)", async () => {
    const service = new OfficialGradesService(
      fakeRepo({
        findStudentOfficialScores: async () => [       // dos evaluaciones de la MISMA sección (id 3)
          { sectionId: 3, courseName: "ML", sectionCode: "753", assessmentId: 10, code: "EV01", name: "P1", weight: "40.00", value: "15.50" },
          { sectionId: 3, courseName: "ML", sectionCode: "753", assessmentId: 11, code: "EV02", name: "P2", weight: "60.00", value: null }, // sin nota aún
        ],
      }),
      noopEvents,
    );
    const courses = await service.getMyOfficialCourses(2); // notas oficiales del alumno 2
    expect(courses).toHaveLength(1);                   // las 2 filas se agrupan en 1 curso/sección
    expect(courses[0].sectionId).toBe(3);
    expect(courses[0].assessments).toEqual([
      { assessmentId: 10, code: "EV01", name: "P1", weight: 40, value: 15.5 }, // "15.50" -> 15.5
      { assessmentId: 11, code: "EV02", name: "P2", weight: 60, value: null }, // null se conserva (evaluación sin calificar)
    ]);
  });
});
