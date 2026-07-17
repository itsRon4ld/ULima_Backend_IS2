import { describe, test, expect, mock } from "bun:test"; // API de pruebas de Bun (compatible con Jest): describe/test/expect + mock para espiar
import { CurriculumService } from "../../src/modules/curriculum/curriculum.service.js"; // SUT real: el servicio con updateSimulation/deleteSimulation que probamos

/**
 * ============================================================================
 * ARCHIVO MIXTO — HU2 / HU04: Selección y Simulación de Estado de Cursos
 * Fuente SUT: src/modules/curriculum/curriculum.service.ts:53-83
 * ============================================================================
 * Este archivo combina las TRES técnicas de la rúbrica sobre el mismo tema
 * (la simulación de cursos), cada una en su propio describe:
 *
 *   [A] CAJA BLANCA (de apoyo) — resolveNextStatus(): modelo de transiciones
 *       de la UI. OJO: esta función se define AQUÍ en el test como
 *       especificación ejecutable; NO es código de producción, por eso cuenta
 *       como caja blanca "de apoyo" y no como la oficial del integrante.
 *       NODOS/PREDICADOS:
 *         P1  if (!isUnlocked)                       -> "BLOCKED"
 *         P2  if (hasPrerequisitesPending)           -> "BLOCKED"
 *         P3  if (currentStatus === null)            -> "planned"
 *         P4  if (currentStatus === "planned")       -> "simulated_completed"
 *         P5  if (currentStatus === "simulated_completed") -> "RESET"
 *         P6  if (currentStatus === "simulated_available") -> "planned"
 *       V(G) = 6 predicados + 1 base = 7  (> 4 ✓)
 *       | # | Camino                              | Esperado            |
 *       |---|-------------------------------------|---------------------|
 *       | 1 | !isUnlocked                         | "BLOCKED"           |
 *       | 2 | unlocked + prereqs pendientes       | "BLOCKED"           |
 *       | 3 | unlocked + status null              | "planned"           |
 *       | 4 | unlocked + "planned"                | "simulated_completed" |
 *       | 5 | unlocked + "simulated_completed"    | "RESET"             |
 *       | 6 | unlocked + "simulated_available"    | "planned"           |
 *
 *   [B] CAJA NEGRA (de apoyo) — payload de simulación (> 4 campos de entrada):
 *       CAMPOS: (1) studentId, (2) curriculumCourseId, (3) status (enum de 3),
 *       (4) curriculumId (resuelto por findStudentCurriculumId),
 *       (5) courseExists (courseExistsInCurriculum), (6) currentSimStatus.
 *       Técnica: partición de equivalencia + valores límite.
 *       | Campo             | Clase válida                    | Clase inválida / límite      |
 *       |-------------------|---------------------------------|------------------------------|
 *       | status            | planned/simulated_completed/... | (enum cerrado)               |
 *       | curriculumCourseId| existe en el currículo          | inexistente -> 404           |
 *
 *   [C] PRUEBA UNITARIA — updateSimulation y deleteSimulation:
 *       Qué valida: el orden de llamadas al repositorio, los argumentos
 *       exactos que recibe cada método y la coerción a String del id.
 *
 * NOTA DE RÚBRICA: la caja blanca oficial de este integrante es
 *   AlertsService.getAlertsForStudent (V(G)=9) y la caja negra oficial es
 *   aggregateCourseScores (5 campos), ambas en test/HU08_julio/alertas.test.ts
 *   sobre código real de src/modules/alerts/.
 */

// Función pura auxiliar: resolveNextStatus
// Esta función encapsula la lógica de negocio de HU2: el cambio de estado
// sigue el orden  Disponible → En Proceso → Finalizado, con reglas adicionales.
//
// Complejidad Ciclomática calculada:
//   CC = 1 (base)
//   + 1 (if currentStatus === "simulated_available")
//   + 1 (if currentStatus === "planned")
//   + 1 (if currentStatus === "simulated_completed")
//   + 1 (if !isUnlocked)
//   + 1 (if hasPrerequisitesPending)
//   CC = 7  (> 4 ✓)
//
// Mapa de estados UI ↔ BD:
//   Disponible (sin simular)  → null / sin entrada en simulación
//   En Proceso (simulado)     → "planned"
//   Finalizado (simulado)     → "simulated_completed"
//   Des-aprobado (simulado)   → "simulated_available"
type SimStatus = "planned" | "simulated_completed" | "simulated_available" | null; // los 4 estados posibles (incluye null = sin simular)

interface TransitionContext { // contrato de entrada de la función: los 3 datos que deciden la transición
  currentStatus: SimStatus; // estado actual de la simulación del curso
  isUnlocked: boolean;          // prerrequisitos satisfechos
  hasPrerequisitesPending: boolean; // aún tiene prereqs sin completar
}

function resolveNextStatus(ctx: TransitionContext): SimStatus | "BLOCKED" | "RESET" { // decide a qué estado pasar (o BLOCKED/RESET)
  const { currentStatus, isUnlocked, hasPrerequisitesPending } = ctx; // desestructura las 3 entradas del contexto

  // Condición 1: curso bloqueado por prerrequisitos
  if (!isUnlocked) { // P1: si el curso no está desbloqueado
    return "BLOCKED"; // corta de inmediato: no se puede simular
  }

  // Condición 2: tiene prerrequisitos pendientes en simulación
  if (hasPrerequisitesPending) { // P2: aunque esté desbloqueado, si hay prereqs pendientes
    return "BLOCKED"; // también bloquea
  }

  // Condición 3: estado actual = sin simulación → pasa a "planned" (En Proceso)
  if (currentStatus === null) { // P3: primer clic sobre un curso disponible
    return "planned"; // lo marca como En Proceso
  }

  // Condición 4: estado actual = "planned" → pasa a "simulated_completed" (Finalizado)
  if (currentStatus === "planned") { // P4: siguiente clic sobre uno En Proceso
    return "simulated_completed"; // lo marca como Finalizado
  }

  // Condición 5: estado actual = "simulated_completed" → reset (vuelve a disponible)
  if (currentStatus === "simulated_completed") { // P5: clic sobre uno ya Finalizado
    return "RESET"; // indica al caller que debe llamar DELETE /simulation
  }

  // Condición 6: estado "simulated_available" (des-aprobado) → lo marca como planned
  if (currentStatus === "simulated_available") { // P6: curso des-aprobado que se re-simula
    return "planned"; // vuelve a En Proceso
  }

  return null; // caso por defecto inalcanzable con los estados definidos
}

// Mock base del repositorio
// Devuelve un repo falso con cada método espiado por mock(): así ningún test toca la BD real
const makeRepo = () => ({
  findStudentCurriculumId: mock(async () => 10), // por defecto el alumno pertenece al currículo 10
  findCurriculumCourses: mock(async () => []), // no se usa aquí; presente para cumplir la interfaz
  findCoursePrerequisites: mock(async () => []), // idem: relleno de la interfaz
  findStudentSimulation: mock(async () => []), // idem: relleno de la interfaz
  courseExistsInCurriculum: mock(async () => true), // por defecto el curso SÍ existe (clase válida)
  upsertSimulation: mock(async () => undefined), // espía la escritura de la simulación
  deleteSimulation: mock(async () => undefined), // espía el borrado de la simulación
});

const makeEvents = () => ({ emit: mock(() => undefined) }); // EventBus falso: solo espía emit, no evaluamos eventos aquí

// [A] PRUEBA DE CAJA BLANCA – resolveNextStatus()
// Caminos del grafo de flujo de resolveNextStatus:
//   Path 1 – !isUnlocked                           → "BLOCKED" (condición 1)
//   Path 2 – isUnlocked + hasPrerequisitesPending  → "BLOCKED" (condición 2)
//   Path 3 – unlocked + null status                → "planned"
//   Path 4 – unlocked + "planned"                  → "simulated_completed"
//   Path 5 – unlocked + "simulated_completed"      → "RESET"
//   Path 6 – unlocked + "simulated_available"      → "planned"
// >> Sub-cabecera: CAJA BLANCA de resolveNextStatus(), V(G)=7, un test por camino (P1..P6).
describe("[APOYO · MODELO DE TRANSICIONES] resolveNextStatus (función local al test, no producción)", () => {

  test("Path 1 – curso bloqueado (!isUnlocked): retorna BLOCKED independiente del estado", () => {
    expect(resolveNextStatus({ currentStatus: null, isUnlocked: false, hasPrerequisitesPending: false }))
      .toBe("BLOCKED"); // verifica que con isUnlocked=false devuelve BLOCKED aunque el estado sea null
    expect(resolveNextStatus({ currentStatus: "planned", isUnlocked: false, hasPrerequisitesPending: false }))
      .toBe("BLOCKED"); // verifica que P1 gana también si el estado ya era "planned" (bloqueo tiene prioridad)
  });

  test("Path 2 – curso desbloqueado pero con prereqs pendientes: retorna BLOCKED", () => {
    expect(resolveNextStatus({ currentStatus: null, isUnlocked: true, hasPrerequisitesPending: true }))
      .toBe("BLOCKED"); // verifica P2: desbloqueado pero con prereqs pendientes -> igual bloquea
  });

  test("Path 3 – curso disponible sin simulación (null): avanza a 'planned' (En Proceso)", () => {
    expect(resolveNextStatus({ currentStatus: null, isUnlocked: true, hasPrerequisitesPending: false }))
      .toBe("planned"); // verifica P3: desde null (Disponible) el primer clic pasa a "planned"
  });

  test("Path 4 – curso en 'planned' (En Proceso): avanza a 'simulated_completed' (Finalizado)", () => {
    expect(resolveNextStatus({ currentStatus: "planned", isUnlocked: true, hasPrerequisitesPending: false }))
      .toBe("simulated_completed"); // verifica P4: de "planned" pasa a "simulated_completed"
  });

  test("Path 5 – curso en 'simulated_completed' (Finalizado): retorna RESET (vuelve a disponible)", () => {
    expect(resolveNextStatus({ currentStatus: "simulated_completed", isUnlocked: true, hasPrerequisitesPending: false }))
      .toBe("RESET"); // verifica P5: de Finalizado devuelve RESET (el caller debe borrar la simulación)
  });

  test("Path 6 – curso 'simulated_available' (des-aprobado): vuelve a 'planned'", () => {
    expect(resolveNextStatus({ currentStatus: "simulated_available", isUnlocked: true, hasPrerequisitesPending: false }))
      .toBe("planned"); // verifica P6: un curso des-aprobado se re-simula volviendo a "planned"
  });
});


// [B] PRUEBA DE CAJA NEGRA – Payload completo de simulación (> 4 campos)
// Campos del sistema bajo prueba evaluados como entradas:
//   1. studentId            – identidad del alumno
//   2. curriculumCourseId   – identificador del curso en el currículo
//   3. status               – estado de la simulación (enum de 3 valores)
//   4. curriculumId         – resuelto por findStudentCurriculumId (campo interno)
//   5. courseExists         – resultado de courseExistsInCurriculum (boolean)
//   6. currentSimStatus     – estado previo en BD (afecta idempotencia del upsert)
//
// Técnica: partición de equivalencia + valores límite
// >> Sub-cabecera: CAJA NEGRA sobre updateSimulation/deleteSimulation, 6 campos de entrada, clases válidas + inválida (404).
describe("[APOYO · PARTICIONES] updateSimulation y deleteSimulation (payload de 3 campos)", () => {

  test("BN-1 – clase válida completa (todos los campos correctos, planned): actualiza en BD", async () => {
    const repo = makeRepo(); // repo espía con curso existente por defecto
    const svc = new CurriculumService(repo as any, makeEvents() as any); // instancia el SUT con repo y eventos falsos

    const result = await svc.updateSimulation(101, 55, "planned"); // clase válida: alumno 101, curso 55, estado planned

    expect(result).toMatchObject({ // verifica la forma de la respuesta con los datos esperados
      message: "Simulation updated", // verifica el mensaje de éxito
      simulation: { curriculumCourseId: "55", status: "planned" }, // verifica que el id se devuelve como string y el estado intacto
    });
  });

  test("BN-2 – clase válida: status simulated_completed persiste correctamente", async () => {
    const repo = makeRepo(); // repo espía
    const svc = new CurriculumService(repo as any, makeEvents() as any); // instancia el SUT

    const result = await svc.updateSimulation(102, 88, "simulated_completed"); // otra clase válida del enum

    expect(result.simulation.status).toBe("simulated_completed"); // verifica que el estado devuelto es el enviado
    expect(repo.upsertSimulation).toHaveBeenCalledWith(102, 10, 88, "simulated_completed"); // verifica que persiste con (alumno, currículo=10, curso, estado)
  });

  test("BN-3 – clase válida: status simulated_available persiste correctamente", async () => {
    const repo = makeRepo(); // repo espía
    const svc = new CurriculumService(repo as any, makeEvents() as any); // instancia el SUT

    const result = await svc.updateSimulation(103, 99, "simulated_available"); // tercera clase válida del enum

    expect(result.simulation.status).toBe("simulated_available"); // verifica que el estado des-aprobado se conserva en la respuesta
  });

  test("BN-4 – clase inválida: curriculumCourseId inexistente → HttpError 404", async () => {
    const repo = makeRepo(); // repo espía
    repo.courseExistsInCurriculum.mockImplementation(async () => false); // fuerza la clase inválida: el curso NO existe en el currículo
    const svc = new CurriculumService(repo as any, makeEvents() as any); // instancia el SUT

    await expect(svc.updateSimulation(1, 0, "planned")) // curso 0 inexistente
      .rejects.toMatchObject({ statusCode: 404, code: "COURSE_NOT_FOUND" }); // verifica que lanza 404 con el código de error correcto
  });

  test("BN-5 – deleteSimulation clase válida: elimina y confirma mensaje", async () => {
    const repo = makeRepo(); // repo espía con curso existente
    const svc = new CurriculumService(repo as any, makeEvents() as any); // instancia el SUT

    const result = await svc.deleteSimulation(200, 50); // borra la simulación del alumno 200 sobre el curso 50

    expect(result.message).toBe("Simulation removed"); // verifica el mensaje de borrado exitoso
    expect(repo.deleteSimulation).toHaveBeenCalledWith(200, 50); // verifica que el repo recibió (alumno, curso) exactos
  });

  test("BN-6 – deleteSimulation curso inexistente: HttpError 404, no llama a deleteSimulation", async () => {
    const repo = makeRepo(); // repo espía
    repo.courseExistsInCurriculum.mockImplementation(async () => false); // clase inválida: el curso no existe
    const svc = new CurriculumService(repo as any, makeEvents() as any); // instancia el SUT

    await expect(svc.deleteSimulation(1, 9999)) // intenta borrar un curso inexistente
      .rejects.toMatchObject({ statusCode: 404 }); // verifica que lanza 404
    expect(repo.deleteSimulation).not.toHaveBeenCalled(); // verifica que NUNCA se intentó borrar (corta antes por la validación)
  });
});

// [C] PRUEBAS UNITARIAS – updateSimulation y deleteSimulation (≥ 4 casos)
// >> Sub-cabecera: PRUEBA UNITARIA del ciclo de vida de la simulación: orden de llamadas, argumentos exactos y coerción a String.
describe("[UNIT TEST] CurriculumService – ciclo de vida de la simulación", () => {

  test("UT-1 – updateSimulation llama a findStudentCurriculumId antes de operar", async () => {
    const repo = makeRepo(); // repo espía
    const svc = new CurriculumService(repo as any, makeEvents() as any); // instancia el SUT

    await svc.updateSimulation(5, 10, "planned"); // ejecuta la actualización para el alumno 5

    expect(repo.findStudentCurriculumId).toHaveBeenCalledWith(5); // verifica que resuelve primero el currículo del alumno 5
  });

  test("UT-2 – updateSimulation verifica existencia del curso en el currículo correcto", async () => {
    const repo = makeRepo(); // repo espía
    repo.findStudentCurriculumId.mockImplementation(async () => 42); // el alumno pertenece al currículo 42
    const svc = new CurriculumService(repo as any, makeEvents() as any); // instancia el SUT

    await svc.updateSimulation(5, 10, "planned"); // ejecuta la actualización

    expect(repo.courseExistsInCurriculum).toHaveBeenCalledWith(42, 10); // verifica que valida el curso 10 contra el currículo 42 (no otro)
  });

  test("UT-3 – upsertSimulation recibe los 4 argumentos exactos", async () => {
    const repo = makeRepo(); // repo espía
    repo.findStudentCurriculumId.mockImplementation(async () => 99); // currículo resuelto = 99
    const svc = new CurriculumService(repo as any, makeEvents() as any); // instancia el SUT

    await svc.updateSimulation(7, 33, "simulated_completed"); // ejecuta la actualización

    expect(repo.upsertSimulation).toHaveBeenCalledWith(7, 99, 33, "simulated_completed"); // verifica el orden y valores exactos: (alumno, currículo, curso, estado)
  });

  test("UT-4 – deleteSimulation no llama a upsertSimulation", async () => {
    const repo = makeRepo(); // repo espía
    const svc = new CurriculumService(repo as any, makeEvents() as any); // instancia el SUT

    await svc.deleteSimulation(3, 15); // borra la simulación

    expect(repo.upsertSimulation).not.toHaveBeenCalled(); // verifica que borrar NO escribe (nunca llama al upsert)
    expect(repo.deleteSimulation).toHaveBeenCalledTimes(1); // verifica que el borrado se ejecuta exactamente una vez
  });

  test("UT-5 – updateSimulation error 404 no llama a upsertSimulation", async () => {
    const repo = makeRepo(); // repo espía
    repo.courseExistsInCurriculum.mockImplementation(async () => false); // fuerza el 404: curso inexistente
    const svc = new CurriculumService(repo as any, makeEvents() as any); // instancia el SUT

    try {
      await svc.updateSimulation(1, 999, "planned"); // esto debe lanzar antes de persistir
    } catch {
      // expected
    }

    expect(repo.upsertSimulation).not.toHaveBeenCalled(); // verifica que ante el error NO se escribió nada en BD
  });

  test("UT-6 – curriculumCourseId siempre se retorna como String (no Number)", async () => {
    const repo = makeRepo(); // repo espía
    const svc = new CurriculumService(repo as any, makeEvents() as any); // instancia el SUT

    const result = await svc.updateSimulation(1, 12345, "planned"); // envía el id como número 12345

    expect(typeof result.simulation.curriculumCourseId).toBe("string"); // verifica que el tipo devuelto es string (coerción con String())
    expect(result.simulation.curriculumCourseId).toBe("12345"); // verifica el valor exacto convertido a texto
  });
});
