import { describe, expect, test } from "bun:test";
import { OfficialGradesService } from "../../src/modules/official-grades/official-grades.service.js";
import type { OfficialGradesRepository } from "../../src/modules/official-grades/official-grades.repository.js";
import type { EventBus } from "../../src/events/index.js";

const noopEvents = {} as unknown as EventBus;

const fakeRepo = (over: Partial<OfficialGradesRepository>): OfficialGradesRepository =>
  ({
    findActivePeriodId: async () => 1,
    teacherIsSectionProfesor: async () => true,
    findTeacherSections: async () => [],
    findSectionStudents: async () => [],
    findSectionAssessments: async () => [],
    findSectionScores: async () => [],
    findSectionEnrollmentIds: async () => new Set<number>(),
    findSectionAssessmentIds: async () => new Set<number>(),
    upsertScore: async () => {},
    findStudentOfficialScores: async () => [],
    ...over,
  }) as unknown as OfficialGradesRepository;

const expectHttpError = async (fn: () => Promise<unknown>, status: number, code: string) => {
  try {
    await fn();
    throw new Error(`se esperaba ${status} ${code} y no se lanzó`);
  } catch (e) {
    const err = e as { statusCode?: number; code?: string };
    expect(err.statusCode).toBe(status);
    expect(err.code).toBe(code);
  }
};

describe("OfficialGradesService.saveSectionScores", () => {
  test("docente que NO es el profesor titular (p.ej. un JP) ⇒ 403 y no escribe", async () => {
    let upserts = 0;
    const service = new OfficialGradesService(
      fakeRepo({
        // teacherIsSectionProfesor=false representa a un JP (u otro docente): no califica.
        teacherIsSectionProfesor: async () => false,
        upsertScore: async () => {
          upserts += 1;
        },
      }),
      noopEvents,
    );
    await expectHttpError(
      () => service.saveSectionScores(9, 1, [{ enrollmentId: 5, assessmentId: 10, value: 15 }]),
      403,
      "NOT_SECTION_PROFESSOR",
    );
    expect(upserts).toBe(0);
  });

  test("matrícula que no es de la sección ⇒ 404 y no escribe nada", async () => {
    let upserts = 0;
    const service = new OfficialGradesService(
      fakeRepo({
        teacherIsSectionProfesor: async () => true,
        findSectionEnrollmentIds: async () => new Set([5]),
        findSectionAssessmentIds: async () => new Set([10]),
        upsertScore: async () => {
          upserts += 1;
        },
      }),
      noopEvents,
    );
    await expectHttpError(
      () =>
        service.saveSectionScores(1, 1, [
          { enrollmentId: 5, assessmentId: 10, value: 12 },
          { enrollmentId: 999, assessmentId: 10, value: 8 },
        ]),
      404,
      "ENROLLMENT_NOT_IN_SECTION",
    );
    expect(upserts).toBe(0); // valida TODO antes de escribir
  });

  test("evaluación que no es de la sección ⇒ 404", async () => {
    const service = new OfficialGradesService(
      fakeRepo({
        findSectionEnrollmentIds: async () => new Set([5]),
        findSectionAssessmentIds: async () => new Set([10]),
      }),
      noopEvents,
    );
    await expectHttpError(
      () => service.saveSectionScores(1, 1, [{ enrollmentId: 5, assessmentId: 77, value: 12 }]),
      404,
      "ASSESSMENT_NOT_IN_SECTION",
    );
  });

  test("todo válido ⇒ upsert de cada nota y devuelve la grilla", async () => {
    const upserts: Array<[number, number, number]> = [];
    const service = new OfficialGradesService(
      fakeRepo({
        findSectionEnrollmentIds: async () => new Set([5, 6]),
        findSectionAssessmentIds: async () => new Set([10]),
        upsertScore: async (e, a, v) => {
          upserts.push([e, a, v]);
        },
        findSectionStudents: async () => [{ enrollmentId: 5, code: "20231483", fullName: "HURTADO" }],
        findSectionAssessments: async () => [
          { assessmentId: 10, code: "EV01", name: "Parcial", weight: "40.00", weekNumber: 8 },
        ],
        findSectionScores: async () => [{ enrollmentId: 5, assessmentId: 10, value: "15.00" }],
      }),
      noopEvents,
    );
    const grid = await service.saveSectionScores(1, 1, [
      { enrollmentId: 5, assessmentId: 10, value: 15 },
      { enrollmentId: 6, assessmentId: 10, value: 18 },
    ]);
    expect(upserts).toEqual([
      [5, 10, 15],
      [6, 10, 18],
    ]);
    expect(grid.assessments[0]).toEqual({ assessmentId: 10, code: "EV01", name: "Parcial", weight: 40, weekNumber: 8 });
    expect(grid.scores[0]).toEqual({ enrollmentId: 5, assessmentId: 10, value: 15 });
  });
});

describe("OfficialGradesService.getSectionGrid", () => {
  test("docente ajeno ⇒ 403", async () => {
    const service = new OfficialGradesService(fakeRepo({ teacherIsSectionProfesor: async () => false }), noopEvents);
    await expectHttpError(() => service.getSectionGrid(9, 1), 403, "NOT_SECTION_PROFESSOR");
  });
});

describe("OfficialGradesService.getMyOfficialCourses", () => {
  test("agrupa por sección y convierte value (null se mantiene)", async () => {
    const service = new OfficialGradesService(
      fakeRepo({
        findStudentOfficialScores: async () => [
          { sectionId: 3, courseName: "ML", sectionCode: "753", assessmentId: 10, code: "EV01", name: "P1", weight: "40.00", value: "15.50" },
          { sectionId: 3, courseName: "ML", sectionCode: "753", assessmentId: 11, code: "EV02", name: "P2", weight: "60.00", value: null },
        ],
      }),
      noopEvents,
    );
    const courses = await service.getMyOfficialCourses(2);
    expect(courses).toHaveLength(1);
    expect(courses[0].sectionId).toBe(3);
    expect(courses[0].assessments).toEqual([
      { assessmentId: 10, code: "EV01", name: "P1", weight: 40, value: 15.5 },
      { assessmentId: 11, code: "EV02", name: "P2", weight: 60, value: null },
    ]);
  });
});
