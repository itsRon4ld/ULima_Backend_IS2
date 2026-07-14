/**
 * HU1 – Visualización de Malla Curricular Interactiva
 * Archivo : test/malla-curricular/malla.test.ts
 * Runner  : bun test (compatible con Jest API: describe / test / expect)
 *
 * Rúbrica cubierta:
 *   [A] CAJA BLANCA  → getCurriculum() del CurriculumService (CC = 6)
 *   [B] CAJA NEGRA   → Payload de actualización de simulación (> 4 campos)
 *   [C] UNIT TESTS   → 6 casos sobre la lógica pura de construcción de la malla
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import { CurriculumService } from "../../src/modules/curriculum/curriculum.service.js";

// Helpers de fixtures
const makeCourse = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  code: "CS101",
  name: "Matemáticas I",
  credits: 4,
  level: 1,
  row: 0,
  category: "COMMON",
  external_faculty: null,
  specialties: [],
  ...over,
});

const makePrerequisite = (over: Partial<Record<string, unknown>> = {}) => ({
  curriculum_course_id: 2,
  prerequisite_curriculum_course_id: 1,
  required_cycle: null,
  ...over,
});

// Mock base del repositorio (todos los métodos retornan valores neutrales)
const makeRepo = () => ({
  findStudentCurriculumId: mock(async () => 10),
  findCurriculumCourses: mock(async () => []),
  findCoursePrerequisites: mock(async () => []),
  findStudentSimulation: mock(async () => []),
  courseExistsInCurriculum: mock(async () => true),
  upsertSimulation: mock(async () => undefined),
  deleteSimulation: mock(async () => undefined),
});

const makeEvents = () => ({ emit: mock(() => undefined) });

// [A] PRUEBA DE CAJA BLANCA – getCurriculum()
// Complejidad ciclomática del método en CurriculumService.getCurriculum():
//   Nodo 1 : entrada
//   Nodo 2 : for (prerequisite of prerequisites)        → +1
//   Nodo 3 : if prerequisite.prerequisite_curriculum_course_id != null  → +1
//   Nodo 4 : else if required_cycle === 5               → +1
//   Nodo 5 : else if required_cycle === 6               → +1
//   Nodo 6 : flatMap → filter(Boolean) en specialties   → +1
//   Nodo 7 : simulation.map                             → +1
//   CC = 1 + 6 condiciones = 7  (> 4 ✓)
//
// Caminos cubiertos:
//   Path 1 – sin prerrequisitos ni cursos                (loop vacío)
//   Path 2 – prerequisite_curriculum_course_id NOT NULL  (rama 3 verdadera)
//   Path 3 – required_cycle === 5                        (rama 4 verdadera)
//   Path 4 – required_cycle === 6                        (rama 5 verdadera)
//   Path 5 – cursos con especialidades (filtro Boolean)
//   Path 6 – simulación no vacía (simulation.map)
describe("[CAJA BLANCA] getCurriculum – caminos del grafo de control", () => {

  // Path 1: loop de prerrequisitos vacío + courses vacíos
  test("Path 1 – sin cursos ni prerrequisitos: retorna estructuras vacías", async () => {
    const repo = makeRepo();
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    const result = await svc.getCurriculum(1);

    expect(result.courses).toHaveLength(0);
    expect(result.specialties).toHaveLength(0);
    expect(result.simulation).toHaveLength(0);
  });

  // Path 2: prerequisite_curriculum_course_id NOT NULL → list.push(String(id))
  test("Path 2 – prerrequisito con ID de curso: mapea correctamente el id", async () => {
    const repo = makeRepo();
    repo.findCurriculumCourses.mockImplementation(async () => [
      makeCourse({ id: 2, name: "Cálculo I" }),
    ]);
    repo.findCoursePrerequisites.mockImplementation(async () => [
      makePrerequisite({ curriculum_course_id: 2, prerequisite_curriculum_course_id: 1, required_cycle: null }),
    ]);
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    const result = await svc.getCurriculum(1);
    const calcI = result.courses.find(c => c.name === "Cálculo I")!;

    expect(calcI.prerequisites).toContain("1");
  });

  // Path 3: required_cycle === 5 → list.push("_V_CICLO_")
  test("Path 3 – prerrequisito de V ciclo: inserta token _V_CICLO_", async () => {
    const repo = makeRepo();
    repo.findCurriculumCourses.mockImplementation(async () => [
      makeCourse({ id: 5, name: "Especialidad A" }),
    ]);
    repo.findCoursePrerequisites.mockImplementation(async () => [
      makePrerequisite({
        curriculum_course_id: 5,
        prerequisite_curriculum_course_id: null,
        required_cycle: 5,
      }),
    ]);
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    const result = await svc.getCurriculum(1);
    const course = result.courses.find(c => c.id === "5")!;

    expect(course.prerequisites).toContain("_V_CICLO_");
  });

  // Path 4: required_cycle === 6 → list.push("_VI_CICLO_")
  test("Path 4 – prerrequisito de VI ciclo: inserta token _VI_CICLO_", async () => {
    const repo = makeRepo();
    repo.findCurriculumCourses.mockImplementation(async () => [
      makeCourse({ id: 6, name: "Especialidad B" }),
    ]);
    repo.findCoursePrerequisites.mockImplementation(async () => [
      makePrerequisite({
        curriculum_course_id: 6,
        prerequisite_curriculum_course_id: null,
        required_cycle: 6,
      }),
    ]);
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    const result = await svc.getCurriculum(1);
    const course = result.courses.find(c => c.id === "6")!;

    expect(course.prerequisites).toContain("_VI_CICLO_");
  });

  // Path 5: specialties con valores → filter(Boolean) elimina vacíos/null
  test("Path 5 – cursos con y sin especialidad: filter(Boolean) depura la lista", async () => {
    const repo = makeRepo();
    repo.findCurriculumCourses.mockImplementation(async () => [
      makeCourse({ id: 1, specialties: ["Sistemas", "Redes"] }),
      makeCourse({ id: 2, specialties: [] }),              // sin especialidad
      makeCourse({ id: 3, specialties: ["Sistemas"] }),    // duplicado
    ]);
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    const result = await svc.getCurriculum(1);

    // Set elimina duplicados; filter elimina vacíos
    expect(result.specialties).toEqual(["Sistemas", "Redes"]);
  });

  // Path 6: simulation.map → devuelve registros de simulación correctamente
  test("Path 6 – con simulación activa: mapea curriculumCourseId y status", async () => {
    const repo = makeRepo();
    repo.findStudentSimulation.mockImplementation(async () => [
      { curriculumCourseId: 42, status: "planned" },
      { curriculumCourseId: 99, status: "simulated_completed" },
    ]);
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    const result = await svc.getCurriculum(1);

    expect(result.simulation).toHaveLength(2);
    expect(result.simulation[0]).toEqual({ curriculumCourseId: "42", status: "planned" });
    expect(result.simulation[1]).toEqual({ curriculumCourseId: "99", status: "simulated_completed" });
  });
});

// [B] PRUEBA DE CAJA NEGRA – Payload de simulación (> 4 campos de entrada)
// Campos del payload evaluados:
//   1. studentId       (número entero positivo)
//   2. curriculumCourseId (número entero positivo)
//   3. status          (enum: planned | simulated_completed | simulated_available)
//   4. curriculumId    (resuelto internamente; simulamos distintos valores)
//   5. courseExists    (boolean que depende de la BD)
describe("[CAJA NEGRA] updateSimulation – particiones de equivalencia del payload", () => {

  test("BB-1 – payload válido con status 'planned': persiste y devuelve confirmación", async () => {
    const repo = makeRepo();
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    const result = await svc.updateSimulation(1, 10, "planned");

    expect(result.message).toBe("Simulation updated");
    expect(result.simulation.status).toBe("planned");
    expect(result.simulation.curriculumCourseId).toBe("10");
    expect(repo.upsertSimulation).toHaveBeenCalledTimes(1);
  });

  test("BB-2 – payload válido con status 'simulated_completed': persiste correctamente", async () => {
    const repo = makeRepo();
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    const result = await svc.updateSimulation(2, 20, "simulated_completed");

    expect(result.simulation.status).toBe("simulated_completed");
    expect(repo.upsertSimulation).toHaveBeenCalledWith(2, 10, 20, "simulated_completed");
  });

  test("BB-3 – payload válido con status 'simulated_available': persiste correctamente", async () => {
    const repo = makeRepo();
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    const result = await svc.updateSimulation(3, 30, "simulated_available");

    expect(result.simulation.status).toBe("simulated_available");
  });

  test("BB-4 – curso NO existe en el currículo: lanza HttpError 404", async () => {
    const repo = makeRepo();
    repo.courseExistsInCurriculum.mockImplementation(async () => false);
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    await expect(svc.updateSimulation(1, 999, "planned")).rejects.toMatchObject({
      statusCode: 404,
      code: "COURSE_NOT_FOUND",
    });
    expect(repo.upsertSimulation).not.toHaveBeenCalled();
  });

  test("BB-5 – deleteSimulation con curso existente: elimina y retorna mensaje", async () => {
    const repo = makeRepo();
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    const result = await svc.deleteSimulation(1, 10);

    expect(result.message).toBe("Simulation removed");
    expect(repo.deleteSimulation).toHaveBeenCalledWith(1, 10);
  });

  test("BB-6 – deleteSimulation con curso inexistente: lanza HttpError 404", async () => {
    const repo = makeRepo();
    repo.courseExistsInCurriculum.mockImplementation(async () => false);
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    await expect(svc.deleteSimulation(1, 999)).rejects.toMatchObject({ statusCode: 404 });
    expect(repo.deleteSimulation).not.toHaveBeenCalled();
  });
});

// [C] PRUEBAS UNITARIAS – Método getCurriculum (al menos 4 casos)
describe("[UNIT TEST] getCurriculum – casos de prueba independientes", () => {

  test("UT-1 – alumno sin especialidad: courses electivos NO aparecen en specialties", async () => {
    const repo = makeRepo();
    repo.findCurriculumCourses.mockImplementation(async () => [
      makeCourse({ id: 1, specialties: [] }),
      makeCourse({ id: 2, specialties: [] }),
    ]);
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    const { specialties } = await svc.getCurriculum(1);

    expect(specialties).toHaveLength(0);
  });

  test("UT-2 – alumno con especialidad: specialties se incluyen sin duplicados", async () => {
    const repo = makeRepo();
    repo.findCurriculumCourses.mockImplementation(async () => [
      makeCourse({ id: 1, specialties: ["IA", "Redes"] }),
      makeCourse({ id: 2, specialties: ["IA"] }), // "IA" duplicada
    ]);
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    const { specialties } = await svc.getCurriculum(1);

    expect(specialties).toEqual(["IA", "Redes"]);
  });

  test("UT-3 – credits y level se convierten a Number correctamente", async () => {
    const repo = makeRepo();
    repo.findCurriculumCourses.mockImplementation(async () => [
      makeCourse({ id: 1, credits: "4", level: "2", row: "1" }), // llegan como string desde BD
    ]);
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    const { courses } = await svc.getCurriculum(1);

    expect(typeof courses[0].credits).toBe("number");
    expect(typeof courses[0].level).toBe("number");
    expect(courses[0].credits).toBe(4);
    expect(courses[0].level).toBe(2);
  });

  test("UT-4 – cursos sin simulación: simulation es arreglo vacío", async () => {
    const repo = makeRepo();
    repo.findCurriculumCourses.mockImplementation(async () => [
      makeCourse({ id: 1 }),
    ]);
    // findStudentSimulation ya retorna [] por defecto
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    const { simulation } = await svc.getCurriculum(1);

    expect(simulation).toHaveLength(0);
  });

  test("UT-5 – curriculumCourseId se convierte a String en el response de simulación", async () => {
    const repo = makeRepo();
    repo.findStudentSimulation.mockImplementation(async () => [
      { curriculumCourseId: 77, status: "planned" },
    ]);
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    const { simulation } = await svc.getCurriculum(1);

    expect(simulation[0].curriculumCourseId).toBe("77"); // siempre String, no Number
  });

  test("UT-6 – curso sin prerrequisitos: prerequisites es arreglo vacío", async () => {
    const repo = makeRepo();
    repo.findCurriculumCourses.mockImplementation(async () => [
      makeCourse({ id: 10 }),
    ]);
    repo.findCoursePrerequisites.mockImplementation(async () => []); // sin prereqs
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    const { courses } = await svc.getCurriculum(1);

    expect(courses[0].prerequisites).toHaveLength(0);
  });
});
