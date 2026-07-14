import { describe, test, expect, mock, beforeEach } from "bun:test"; // API de pruebas de Bun (compatible con Jest): describe/test/expect + mock (espías) y beforeEach
import { CurriculumService } from "../../src/modules/curriculum/curriculum.service.js"; // SUT: el servicio de malla curricular que estamos probando

/*
 * ============================================================================
 * ARCHIVO MIXTO (3 técnicas) — HU1: Visualización de Malla Curricular Interactiva
 * Fuente: src/modules/curriculum/curriculum.service.ts
 * Runner: bun test (API compatible con Jest: describe / test / expect)
 * ============================================================================
 * Este archivo combina las tres técnicas de prueba sobre CurriculumService.
 * Cada describe lleva encima una sub-cabecera que dice qué técnica aplica.
 *
 *  [A] CAJA BLANCA — getCurriculum()   (recorre los caminos del grafo de control)
 *  [B] CAJA NEGRA/APOYO — updateSimulation()/deleteSimulation()  (particiones de entrada)
 *  [C] UNITARIA — getCurriculum()      (casos independientes de la lógica pura)
 *
 * NOTA DE RÚBRICA: la caja blanca oficial de este integrante es
 *   AlertsService.getAlertsForStudent (V(G)=9) y la caja negra oficial es
 *   aggregateCourseScores (5 campos), ambas en test/HU08_julio/alertas.test.ts.
 * ============================================================================
 */

// ── Helpers de fixtures ─────────────────────────────────────────────────────
// Fabrica un curso de la malla con valores por defecto razonables; cada test
// sobrescribe solo los campos que le importan con el spread final.
const makeCourse = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1,                    // identificador del curso (se convierte a String en la respuesta)
  code: "CS101",            // código visible del curso
  name: "Matemáticas I",    // nombre del curso
  credits: 4,               // créditos (el servicio los pasa por Number(...))
  level: 1,                 // ciclo/nivel de la malla (también pasa por Number)
  row: 0,                   // fila en la grilla de la malla
  category: "COMMON",       // categoría (COMMON, especialidad, etc.)
  external_faculty: null,   // facultad externa (null = propia)
  specialties: [],          // especialidades del curso (alimentan la lista global)
  ...over,                  // permite que cada test cambie solo lo que necesita
});

// Fabrica un prerrequisito; controla qué rama del if/else-if recorre getCurriculum.
const makePrerequisite = (over: Partial<Record<string, unknown>> = {}) => ({
  curriculum_course_id: 2,                 // curso al que pertenece este prerrequisito
  prerequisite_curriculum_course_id: 1,    // curso requerido (si != null → rama de ID)
  required_cycle: null,                    // ciclo requerido (5 o 6 → tokens especiales)
  ...over,                                 // cada test define la rama a cubrir
});

// Mock base del repositorio: TODOS los métodos devuelven valores neutrales.
// Se mockea el repo para no tocar la BD; cada test sobreescribe con mockImplementation.
const makeRepo = () => ({
  findStudentCurriculumId: mock(async () => 10),   // id de currículo del alumno (fijo)
  findCurriculumCourses: mock(async () => []),     // cursos de la malla (vacío por defecto)
  findCoursePrerequisites: mock(async () => []),   // prerrequisitos (vacío por defecto)
  findStudentSimulation: mock(async () => []),     // simulación del alumno (vacía por defecto)
  courseExistsInCurriculum: mock(async () => true),// ¿el curso existe? (true por defecto)
  upsertSimulation: mock(async () => undefined),   // guardar simulación (no-op espiado)
  deleteSimulation: mock(async () => undefined),   // borrar simulación (no-op espiado)
});

// EventBus falso: solo necesita un emit espiado porque el servicio lo recibe pero
// este archivo no verifica la emisión de eventos.
const makeEvents = () => ({ emit: mock(() => undefined) });

/*
 * ── [A] CAJA BLANCA — getCurriculum() ───────────────────────────────────────
 * NODOS/PREDICADOS del método (curriculum.service.ts:11-51):
 *   P1  for (prerequisite of prerequisites)                     (bucle)
 *   P2  if prerequisite_curriculum_course_id != null            (rama ID)
 *   P3  else if Number(required_cycle) === 5                     (token _V_CICLO_)
 *   P4  else if Number(required_cycle) === 6                     (token _VI_CICLO_)
 *   P5  flatMap(specialties) + filter(Boolean)                  (depura especialidades)
 *   P6  simulation.map                                          (mapea la simulación)
 * V(G) = 1 + 6 condiciones = 7  (> 4 ✓)
 *
 * | # | Camino                                   | Esperado                         |
 * |---|------------------------------------------|----------------------------------|
 * |P1 | loop vacío (sin cursos ni prereqs)       | estructuras vacías               |
 * |P2 | prerequisite_curriculum_course_id != null| prerequisites contiene "1"       |
 * |P3 | required_cycle === 5                      | prerequisites contiene _V_CICLO_ |
 * |P4 | required_cycle === 6                      | prerequisites contiene _VI_CICLO_|
 * |P5 | specialties con duplicados/vacíos         | Set+filter depura la lista       |
 * |P6 | simulación no vacía                       | simulation.map convierte a String|
 */
describe("[CAJA BLANCA] getCurriculum – caminos del grafo de control", () => {

  // Path 1: loop de prerrequisitos vacío + courses vacíos
  test("Path 1 – sin cursos ni prerrequisitos: retorna estructuras vacías", async () => {
    const repo = makeRepo();                                     // repo neutro: todo vacío
    const svc = new CurriculumService(repo as any, makeEvents() as any); // instancia el SUT con mocks

    const result = await svc.getCurriculum(1);                   // ejecuta el método bajo prueba

    expect(result.courses).toHaveLength(0);                      // verifica que no haya cursos (loop nunca entró)
    expect(result.specialties).toHaveLength(0);                  // verifica que no haya especialidades
    expect(result.simulation).toHaveLength(0);                   // verifica que la simulación esté vacía
  });

  // Path 2: prerequisite_curriculum_course_id NOT NULL → list.push(String(id))
  test("Path 2 – prerrequisito con ID de curso: mapea correctamente el id", async () => {
    const repo = makeRepo();                                     // repo base
    repo.findCurriculumCourses.mockImplementation(async () => [  // un curso "Cálculo I" con id 2
      makeCourse({ id: 2, name: "Cálculo I" }),
    ]);
    repo.findCoursePrerequisites.mockImplementation(async () => [ // prereq con id de curso (rama P2)
      makePrerequisite({ curriculum_course_id: 2, prerequisite_curriculum_course_id: 1, required_cycle: null }),
    ]);
    const svc = new CurriculumService(repo as any, makeEvents() as any); // SUT con estos mocks

    const result = await svc.getCurriculum(1);                   // ejecuta el método
    const calcI = result.courses.find(c => c.name === "Cálculo I")!; // localiza el curso mapeado

    expect(calcI.prerequisites).toContain("1");                  // verifica que el prereq quedó como String "1"
  });

  // Path 3: required_cycle === 5 → list.push("_V_CICLO_")
  test("Path 3 – prerrequisito de V ciclo: inserta token _V_CICLO_", async () => {
    const repo = makeRepo();                                     // repo base
    repo.findCurriculumCourses.mockImplementation(async () => [  // curso id 5
      makeCourse({ id: 5, name: "Especialidad A" }),
    ]);
    repo.findCoursePrerequisites.mockImplementation(async () => [ // prereq sin id pero con ciclo 5 (rama P3)
      makePrerequisite({
        curriculum_course_id: 5,
        prerequisite_curriculum_course_id: null,
        required_cycle: 5,
      }),
    ]);
    const svc = new CurriculumService(repo as any, makeEvents() as any); // SUT

    const result = await svc.getCurriculum(1);                   // ejecuta
    const course = result.courses.find(c => c.id === "5")!;      // busca el curso (id ya es String)

    expect(course.prerequisites).toContain("_V_CICLO_");         // verifica que se insertó el token de V ciclo
  });

  // Path 4: required_cycle === 6 → list.push("_VI_CICLO_")
  test("Path 4 – prerrequisito de VI ciclo: inserta token _VI_CICLO_", async () => {
    const repo = makeRepo();                                     // repo base
    repo.findCurriculumCourses.mockImplementation(async () => [  // curso id 6
      makeCourse({ id: 6, name: "Especialidad B" }),
    ]);
    repo.findCoursePrerequisites.mockImplementation(async () => [ // prereq sin id pero con ciclo 6 (rama P4)
      makePrerequisite({
        curriculum_course_id: 6,
        prerequisite_curriculum_course_id: null,
        required_cycle: 6,
      }),
    ]);
    const svc = new CurriculumService(repo as any, makeEvents() as any); // SUT

    const result = await svc.getCurriculum(1);                   // ejecuta
    const course = result.courses.find(c => c.id === "6")!;      // busca el curso id 6

    expect(course.prerequisites).toContain("_VI_CICLO_");        // verifica que se insertó el token de VI ciclo
  });

  // Path 5: specialties con valores → filter(Boolean) elimina vacíos/null
  test("Path 5 – cursos con y sin especialidad: filter(Boolean) depura la lista", async () => {
    const repo = makeRepo();                                     // repo base
    repo.findCurriculumCourses.mockImplementation(async () => [  // tres cursos con distintas especialidades
      makeCourse({ id: 1, specialties: ["Sistemas", "Redes"] }),
      makeCourse({ id: 2, specialties: [] }),              // sin especialidad
      makeCourse({ id: 3, specialties: ["Sistemas"] }),    // duplicado
    ]);
    const svc = new CurriculumService(repo as any, makeEvents() as any); // SUT

    const result = await svc.getCurriculum(1);                   // ejecuta

    // Set elimina duplicados; filter elimina vacíos
    expect(result.specialties).toEqual(["Sistemas", "Redes"]);   // verifica dedupe (Set) y depuración (filter Boolean)
  });

  // Path 6: simulation.map → devuelve registros de simulación correctamente
  test("Path 6 – con simulación activa: mapea curriculumCourseId y status", async () => {
    const repo = makeRepo();                                     // repo base
    repo.findStudentSimulation.mockImplementation(async () => [  // dos registros de simulación (rama P6)
      { curriculumCourseId: 42, status: "planned" },
      { curriculumCourseId: 99, status: "simulated_completed" },
    ]);
    const svc = new CurriculumService(repo as any, makeEvents() as any); // SUT

    const result = await svc.getCurriculum(1);                   // ejecuta

    expect(result.simulation).toHaveLength(2);                   // verifica que se mapearon los 2 registros
    expect(result.simulation[0]).toEqual({ curriculumCourseId: "42", status: "planned" }); // verifica id convertido a String
    expect(result.simulation[1]).toEqual({ curriculumCourseId: "99", status: "simulated_completed" }); // verifica el segundo registro
  });
});

/*
 * ── [B] CAJA NEGRA / APOYO — updateSimulation() y deleteSimulation() ─────────
 * Fuente: curriculum.service.ts:53-83
 * CAMPOS DE ENTRADA del payload de simulación:
 *   1. studentId            (número entero positivo)
 *   2. curriculumCourseId   (número entero positivo)
 *   3. status               (enum: planned | simulated_completed | simulated_available)
 *   4. curriculumId         (resuelto internamente por el repo)
 *   5. courseExists         (boolean que depende de la BD)
 * NOTA: solo 3 campos "de payload" reales → es APOYO por particiones, no alcanza
 * los >4 campos que exige la caja negra oficial de la rúbrica.
 *
 * | Campo             | Clase válida                       | Clase inválida / límite      |
 * |-------------------|------------------------------------|------------------------------|
 * | status            | planned/simulated_completed/...able| —                            |
 * | courseExists      | true → persiste                    | false → HttpError 404        |
 */
describe("[APOYO · PARTICIONES] updateSimulation (payload de 3 campos)", () => {

  test("BB-1 – payload válido con status 'planned': persiste y devuelve confirmación", async () => {
    const repo = makeRepo();                                     // repo base (courseExists = true)
    const svc = new CurriculumService(repo as any, makeEvents() as any); // SUT

    const result = await svc.updateSimulation(1, 10, "planned"); // actualiza simulación con status válido

    expect(result.message).toBe("Simulation updated");           // verifica el mensaje de confirmación
    expect(result.simulation.status).toBe("planned");            // verifica que devuelve el status enviado
    expect(result.simulation.curriculumCourseId).toBe("10");     // verifica que el id se serializa a String
    expect(repo.upsertSimulation).toHaveBeenCalledTimes(1);      // verifica que sí persistió (una sola escritura)
  });

  test("BB-2 – payload válido con status 'simulated_completed': persiste correctamente", async () => {
    const repo = makeRepo();                                     // repo base
    const svc = new CurriculumService(repo as any, makeEvents() as any); // SUT

    const result = await svc.updateSimulation(2, 20, "simulated_completed"); // otro status válido

    expect(result.simulation.status).toBe("simulated_completed"); // verifica el status devuelto
    expect(repo.upsertSimulation).toHaveBeenCalledWith(2, 10, 20, "simulated_completed"); // verifica los args exactos (studentId, curriculumId=10, courseId, status)
  });

  test("BB-3 – payload válido con status 'simulated_available': persiste correctamente", async () => {
    const repo = makeRepo();                                     // repo base
    const svc = new CurriculumService(repo as any, makeEvents() as any); // SUT

    const result = await svc.updateSimulation(3, 30, "simulated_available"); // tercer valor válido del enum

    expect(result.simulation.status).toBe("simulated_available"); // verifica que acepta el tercer status del enum
  });

  test("BB-4 – curso NO existe en el currículo: lanza HttpError 404", async () => {
    const repo = makeRepo();                                     // repo base
    repo.courseExistsInCurriculum.mockImplementation(async () => false); // clase inválida: el curso no existe
    const svc = new CurriculumService(repo as any, makeEvents() as any); // SUT

    await expect(svc.updateSimulation(1, 999, "planned")).rejects.toMatchObject({ // verifica que rechaza con...
      statusCode: 404,                                           // ...código HTTP 404
      code: "COURSE_NOT_FOUND",                                  // ...y código de error de dominio
    });
    expect(repo.upsertSimulation).not.toHaveBeenCalled();        // verifica que NO persistió nada al fallar la validación
  });

  test("BB-5 – deleteSimulation con curso existente: elimina y retorna mensaje", async () => {
    const repo = makeRepo();                                     // repo base (courseExists = true)
    const svc = new CurriculumService(repo as any, makeEvents() as any); // SUT

    const result = await svc.deleteSimulation(1, 10);            // borra la simulación de un curso existente

    expect(result.message).toBe("Simulation removed");           // verifica el mensaje de borrado
    expect(repo.deleteSimulation).toHaveBeenCalledWith(1, 10);   // verifica que delegó al repo con (studentId, courseId)
  });

  test("BB-6 – deleteSimulation con curso inexistente: lanza HttpError 404", async () => {
    const repo = makeRepo();                                     // repo base
    repo.courseExistsInCurriculum.mockImplementation(async () => false); // clase inválida: curso inexistente
    const svc = new CurriculumService(repo as any, makeEvents() as any); // SUT

    await expect(svc.deleteSimulation(1, 999)).rejects.toMatchObject({ statusCode: 404 }); // verifica el 404 al borrar algo que no existe
    expect(repo.deleteSimulation).not.toHaveBeenCalled();        // verifica que NO intentó borrar en la BD
  });
});

/*
 * ── [C] PRUEBA UNITARIA — getCurriculum() ────────────────────────────────────
 * Fuente: curriculum.service.ts:11-51
 * Qué valida: la lógica pura de construcción de la malla (dedupe de especialidades,
 *   conversión de tipos string→number, id→String, listas vacías por defecto).
 * Casos: UT-1..UT-6 (≥4 casos independientes exigidos por la rúbrica).
 */
describe("[UNIT TEST] getCurriculum – casos de prueba independientes", () => {

  test("UT-1 – alumno sin especialidad: courses electivos NO aparecen en specialties", async () => {
    const repo = makeRepo();                                     // repo base
    repo.findCurriculumCourses.mockImplementation(async () => [  // dos cursos, ambos sin especialidad
      makeCourse({ id: 1, specialties: [] }),
      makeCourse({ id: 2, specialties: [] }),
    ]);
    const svc = new CurriculumService(repo as any, makeEvents() as any); // SUT

    const { specialties } = await svc.getCurriculum(1);          // extrae solo la lista de especialidades

    expect(specialties).toHaveLength(0);                         // verifica que sin especialidades la lista queda vacía
  });

  test("UT-2 – alumno con especialidad: specialties se incluyen sin duplicados", async () => {
    const repo = makeRepo();                                     // repo base
    repo.findCurriculumCourses.mockImplementation(async () => [  // cursos con especialidades repetidas
      makeCourse({ id: 1, specialties: ["IA", "Redes"] }),
      makeCourse({ id: 2, specialties: ["IA"] }), // "IA" duplicada
    ]);
    const svc = new CurriculumService(repo as any, makeEvents() as any); // SUT

    const { specialties } = await svc.getCurriculum(1);          // extrae especialidades

    expect(specialties).toEqual(["IA", "Redes"]);                // verifica que "IA" no se duplica (Set)
  });

  test("UT-3 – credits y level se convierten a Number correctamente", async () => {
    const repo = makeRepo();                                     // repo base
    repo.findCurriculumCourses.mockImplementation(async () => [  // valores que llegan como string desde la BD
      makeCourse({ id: 1, credits: "4", level: "2", row: "1" }), // llegan como string desde BD
    ]);
    const svc = new CurriculumService(repo as any, makeEvents() as any); // SUT

    const { courses } = await svc.getCurriculum(1);              // extrae los cursos mapeados

    expect(typeof courses[0].credits).toBe("number");            // verifica que credits quedó tipado como number
    expect(typeof courses[0].level).toBe("number");              // verifica que level quedó tipado como number
    expect(courses[0].credits).toBe(4);                          // verifica el valor convertido de credits
    expect(courses[0].level).toBe(2);                            // verifica el valor convertido de level
  });

  test("UT-4 – cursos sin simulación: simulation es arreglo vacío", async () => {
    const repo = makeRepo();                                     // repo base
    repo.findCurriculumCourses.mockImplementation(async () => [  // un curso cualquiera
      makeCourse({ id: 1 }),
    ]);
    // findStudentSimulation ya retorna [] por defecto
    const svc = new CurriculumService(repo as any, makeEvents() as any); // SUT

    const { simulation } = await svc.getCurriculum(1);           // extrae la simulación

    expect(simulation).toHaveLength(0);                          // verifica que sin registros la simulación queda vacía
  });

  test("UT-5 – curriculumCourseId se convierte a String en el response de simulación", async () => {
    const repo = makeRepo();                                     // repo base
    repo.findStudentSimulation.mockImplementation(async () => [  // simulación con id numérico 77
      { curriculumCourseId: 77, status: "planned" },
    ]);
    const svc = new CurriculumService(repo as any, makeEvents() as any); // SUT

    const { simulation } = await svc.getCurriculum(1);           // extrae la simulación

    expect(simulation[0].curriculumCourseId).toBe("77"); // siempre String, no Number   // verifica la conversión id→String
  });

  test("UT-6 – curso sin prerrequisitos: prerequisites es arreglo vacío", async () => {
    const repo = makeRepo();                                     // repo base
    repo.findCurriculumCourses.mockImplementation(async () => [  // un curso id 10
      makeCourse({ id: 10 }),
    ]);
    repo.findCoursePrerequisites.mockImplementation(async () => []); // sin prereqs
    const svc = new CurriculumService(repo as any, makeEvents() as any); // SUT

    const { courses } = await svc.getCurriculum(1);              // extrae los cursos

    expect(courses[0].prerequisites).toHaveLength(0);            // verifica que sin prereqs la lista queda vacía
  });
});
