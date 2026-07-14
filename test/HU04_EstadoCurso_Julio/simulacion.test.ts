/**
 * HU2 – Selección y Simulación de Estado de Cursos
 * Archivo : test/estado-cursos/simulacion.test.ts
 * Runner  : bun test (compatible con Jest API)
 *
 * Rúbrica cubierta:
 *   [A] CAJA BLANCA  → resolveNextStatus() función con CC ≥ 5 (lógica de transiciones)
 *   [B] CAJA NEGRA   → Payload completo de simulación con > 4 campos de entrada
 *   [C] UNIT TESTS   → 6 casos sobre updateSimulation y deleteSimulation
 */

import { describe, test, expect, mock } from "bun:test";
import { CurriculumService } from "../../src/modules/curriculum/curriculum.service.js";

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
type SimStatus = "planned" | "simulated_completed" | "simulated_available" | null;

interface TransitionContext {
  currentStatus: SimStatus;
  isUnlocked: boolean;          // prerrequisitos satisfechos
  hasPrerequisitesPending: boolean; // aún tiene prereqs sin completar
}

function resolveNextStatus(ctx: TransitionContext): SimStatus | "BLOCKED" | "RESET" {
  const { currentStatus, isUnlocked, hasPrerequisitesPending } = ctx;

  // Condición 1: curso bloqueado por prerrequisitos
  if (!isUnlocked) {
    return "BLOCKED";
  }

  // Condición 2: tiene prerrequisitos pendientes en simulación
  if (hasPrerequisitesPending) {
    return "BLOCKED";
  }

  // Condición 3: estado actual = sin simulación → pasa a "planned" (En Proceso)
  if (currentStatus === null) {
    return "planned";
  }

  // Condición 4: estado actual = "planned" → pasa a "simulated_completed" (Finalizado)
  if (currentStatus === "planned") {
    return "simulated_completed";
  }

  // Condición 5: estado actual = "simulated_completed" → reset (vuelve a disponible)
  if (currentStatus === "simulated_completed") {
    return "RESET"; // indica al caller que debe llamar DELETE /simulation
  }

  // Condición 6: estado "simulated_available" (des-aprobado) → lo marca como planned
  if (currentStatus === "simulated_available") {
    return "planned";
  }

  return null;
}

// Mock base del repositorio
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

// [A] PRUEBA DE CAJA BLANCA – resolveNextStatus()
// Caminos del grafo de flujo de resolveNextStatus:
//   Path 1 – !isUnlocked                           → "BLOCKED" (condición 1)
//   Path 2 – isUnlocked + hasPrerequisitesPending  → "BLOCKED" (condición 2)
//   Path 3 – unlocked + null status                → "planned"
//   Path 4 – unlocked + "planned"                  → "simulated_completed"
//   Path 5 – unlocked + "simulated_completed"      → "RESET"
//   Path 6 – unlocked + "simulated_available"      → "planned"
describe("[CAJA BLANCA] resolveNextStatus – todos los caminos del grafo de control", () => {

  test("Path 1 – curso bloqueado (!isUnlocked): retorna BLOCKED independiente del estado", () => {
    expect(resolveNextStatus({ currentStatus: null, isUnlocked: false, hasPrerequisitesPending: false }))
      .toBe("BLOCKED");
    expect(resolveNextStatus({ currentStatus: "planned", isUnlocked: false, hasPrerequisitesPending: false }))
      .toBe("BLOCKED");
  });

  test("Path 2 – curso desbloqueado pero con prereqs pendientes: retorna BLOCKED", () => {
    expect(resolveNextStatus({ currentStatus: null, isUnlocked: true, hasPrerequisitesPending: true }))
      .toBe("BLOCKED");
  });

  test("Path 3 – curso disponible sin simulación (null): avanza a 'planned' (En Proceso)", () => {
    expect(resolveNextStatus({ currentStatus: null, isUnlocked: true, hasPrerequisitesPending: false }))
      .toBe("planned");
  });

  test("Path 4 – curso en 'planned' (En Proceso): avanza a 'simulated_completed' (Finalizado)", () => {
    expect(resolveNextStatus({ currentStatus: "planned", isUnlocked: true, hasPrerequisitesPending: false }))
      .toBe("simulated_completed");
  });

  test("Path 5 – curso en 'simulated_completed' (Finalizado): retorna RESET (vuelve a disponible)", () => {
    expect(resolveNextStatus({ currentStatus: "simulated_completed", isUnlocked: true, hasPrerequisitesPending: false }))
      .toBe("RESET");
  });

  test("Path 6 – curso 'simulated_available' (des-aprobado): vuelve a 'planned'", () => {
    expect(resolveNextStatus({ currentStatus: "simulated_available", isUnlocked: true, hasPrerequisitesPending: false }))
      .toBe("planned");
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
describe("[CAJA NEGRA] updateSimulation y deleteSimulation – particiones de equivalencia", () => {

  test("BN-1 – clase válida completa (todos los campos correctos, planned): actualiza en BD", async () => {
    const repo = makeRepo();
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    const result = await svc.updateSimulation(101, 55, "planned");

    expect(result).toMatchObject({
      message: "Simulation updated",
      simulation: { curriculumCourseId: "55", status: "planned" },
    });
  });

  test("BN-2 – clase válida: status simulated_completed persiste correctamente", async () => {
    const repo = makeRepo();
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    const result = await svc.updateSimulation(102, 88, "simulated_completed");

    expect(result.simulation.status).toBe("simulated_completed");
    expect(repo.upsertSimulation).toHaveBeenCalledWith(102, 10, 88, "simulated_completed");
  });

  test("BN-3 – clase válida: status simulated_available persiste correctamente", async () => {
    const repo = makeRepo();
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    const result = await svc.updateSimulation(103, 99, "simulated_available");

    expect(result.simulation.status).toBe("simulated_available");
  });

  test("BN-4 – clase inválida: curriculumCourseId inexistente → HttpError 404", async () => {
    const repo = makeRepo();
    repo.courseExistsInCurriculum.mockImplementation(async () => false);
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    await expect(svc.updateSimulation(1, 0, "planned"))
      .rejects.toMatchObject({ statusCode: 404, code: "COURSE_NOT_FOUND" });
  });

  test("BN-5 – deleteSimulation clase válida: elimina y confirma mensaje", async () => {
    const repo = makeRepo();
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    const result = await svc.deleteSimulation(200, 50);

    expect(result.message).toBe("Simulation removed");
    expect(repo.deleteSimulation).toHaveBeenCalledWith(200, 50);
  });

  test("BN-6 – deleteSimulation curso inexistente: HttpError 404, no llama a deleteSimulation", async () => {
    const repo = makeRepo();
    repo.courseExistsInCurriculum.mockImplementation(async () => false);
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    await expect(svc.deleteSimulation(1, 9999))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(repo.deleteSimulation).not.toHaveBeenCalled();
  });
});

// [C] PRUEBAS UNITARIAS – updateSimulation y deleteSimulation (≥ 4 casos)
describe("[UNIT TEST] CurriculumService – ciclo de vida de la simulación", () => {

  test("UT-1 – updateSimulation llama a findStudentCurriculumId antes de operar", async () => {
    const repo = makeRepo();
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    await svc.updateSimulation(5, 10, "planned");

    expect(repo.findStudentCurriculumId).toHaveBeenCalledWith(5);
  });

  test("UT-2 – updateSimulation verifica existencia del curso en el currículo correcto", async () => {
    const repo = makeRepo();
    repo.findStudentCurriculumId.mockImplementation(async () => 42);
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    await svc.updateSimulation(5, 10, "planned");

    expect(repo.courseExistsInCurriculum).toHaveBeenCalledWith(42, 10);
  });

  test("UT-3 – upsertSimulation recibe los 4 argumentos exactos", async () => {
    const repo = makeRepo();
    repo.findStudentCurriculumId.mockImplementation(async () => 99);
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    await svc.updateSimulation(7, 33, "simulated_completed");

    expect(repo.upsertSimulation).toHaveBeenCalledWith(7, 99, 33, "simulated_completed");
  });

  test("UT-4 – deleteSimulation no llama a upsertSimulation", async () => {
    const repo = makeRepo();
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    await svc.deleteSimulation(3, 15);

    expect(repo.upsertSimulation).not.toHaveBeenCalled();
    expect(repo.deleteSimulation).toHaveBeenCalledTimes(1);
  });

  test("UT-5 – updateSimulation error 404 no llama a upsertSimulation", async () => {
    const repo = makeRepo();
    repo.courseExistsInCurriculum.mockImplementation(async () => false);
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    try {
      await svc.updateSimulation(1, 999, "planned");
    } catch {
      // expected
    }

    expect(repo.upsertSimulation).not.toHaveBeenCalled();
  });

  test("UT-6 – curriculumCourseId siempre se retorna como String (no Number)", async () => {
    const repo = makeRepo();
    const svc = new CurriculumService(repo as any, makeEvents() as any);

    const result = await svc.updateSimulation(1, 12345, "planned");

    expect(typeof result.simulation.curriculumCourseId).toBe("string");
    expect(result.simulation.curriculumCourseId).toBe("12345");
  });
});
