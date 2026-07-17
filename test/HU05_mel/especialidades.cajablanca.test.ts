/*
  bun test test/HU05_mel/especialidades.cajablanca.test.ts
*/

import { describe, expect, test } from "bun:test";
import type { EventBus } from "../../src/events/index.js";
import type { AcademicProfileRepository } from "../../src/modules/academic-profile/academic-profile.repository.js";
import { AcademicProfileService } from "../../src/modules/academic-profile/academic-profile.service.js";
import { HttpError } from "../../src/shared/errors/http-error.js";

/**
 * ============================================================================
 * CAJA BLANCA — AcademicProfileService.updateSpecialties() (HU05: guardar especialidades por carrera)
 * Fuente: src/modules/academic-profile/academic-profile.service.ts:47-93
 * ============================================================================
 * NODOS/PREDICADOS del método:
 *   P1  if (!profile)                                     -> 404 USER_NOT_FOUND
 *   P2  primarySpecialtyId = input.primarySpecialtyId ?? null   (coalescencia)
 *   P3  interestSpecialtyIds = [...new Set(... ?? [])]    (dedup + default [])
 *   P4  if (primary != null && interests.includes(primary)) -> 409 DUPLICATE_PRIMARY
 *   P5  specialtyIds = ternario (primary == null ? [] : [primary]) ++ interests
 *   P6  for (specialtyId of specialtyIds)                 (bucle de validación)
 *   P7  if (!exists)                                      -> 404 SPECIALTY_NOT_FOUND
 *   P8  if (!belongsToCareer)                             -> 404 SPECIALTY_NOT_FOUND
 *   P9  try { ... } catch (error)                         (bloque de escritura)
 *   P10 if (primarySpecialtyId != null)                   -> upsert "primary"
 *   P11 for (specialtyId of interestSpecialtyIds)         -> upsert "interest"
 *   P12 if (isUniqueViolation(error))                     -> 409 DUPLICATE_PRIMARY, si no rethrow
 *
 * V(G) = 14 (P1, P2, P3, P4-doble, P5, P6, P7, P8, P9, P10, P11, P12 y sus ramas).
 * Batería: un test por cada región del grafo, aislando el repositorio con dobles
 * de prueba (spies) que capturan EXACTAMENTE las llamadas de escritura.
 *
 * | #   | Camino                                          | Esperado                                         |
 * |-----|-------------------------------------------------|--------------------------------------------------|
 * | C1  | P1(V): perfil inexistente                       | 404 USER_NOT_FOUND, sin escrituras               |
 * | C2  | P4(V): principal repetida como interés          | 409 DUPLICATE_PRIMARY, sin escrituras            |
 * | C3  | P7(V): especialidad inexistente                 | 404 SPECIALTY_NOT_FOUND                          |
 * | C4  | P8(V): especialidad de otra carrera             | 404 SPECIALTY_NOT_FOUND                          |
 * | C7  | P12(V): violación de unicidad (23505)           | 409 DUPLICATE_PRIMARY                            |
 * | C7b | P12(F): otro error en la escritura              | se propaga sin envolver (rethrow)                |
 * | C5  | camino feliz: principal + intereses             | upsert de cada uno + markComplete + setupComplete|
 * | C6  | P10(F): sin principal (solo intereses)          | ningún upsert de tipo "primary"                  |
 * | C8  | P3 dedup: intereses duplicados                  | Set los deduplica, upsert una sola vez           |
 * | C9  | selección vacía                                 | solo desactiva y marca completo, sin upserts     |
 * ============================================================================
 */

// EventBus falso (dummy): objeto vacío forzado al tipo. El servicio no emite eventos en este flujo, así que no evaluamos nada de eventos.
const noopEvents = {} as unknown as EventBus;

// Perfil válido de referencia. El servicio solo lee studentId (para escribir) y career.id (para validar pertenencia de especialidad).
const PROFILE = { studentId: 10, career: { id: 5 } };

// Alias para los overrides parciales del repositorio: cada test sobrescribe solo el método que le importa.
type RepoOverrides = Partial<AcademicProfileRepository>;

// Fábrica del repositorio espía: prefabrica respuestas "todo válido" y registra las llamadas de escritura para poder verificar los caminos.
function makeRepo(over: RepoOverrides = {}) {
  const calls = { // acumulador de llamadas capturadas (así comprobamos QUÉ se escribió, no la BD real)
    deactivated: [] as number[], // studentIds a los que se les desactivaron especialidades
    upserts: [] as Array<{ studentId: number; specialtyId: number; kind: string }>, // cada upsert con su tipo (primary/interest)
    markedComplete: [] as number[], // studentIds marcados como setup completado
  };
  const repo = { // doble de prueba del repositorio (no toca PostgreSQL)
    findProfileByUserId: async () => PROFILE, // por defecto siempre encuentra el perfil de referencia
    specialtyExists: async () => true, // por defecto toda especialidad existe
    specialtyBelongsToCareer: async () => true, // por defecto toda especialidad pertenece a la carrera del alumno
    deactivateAllStudentSpecialties: async (studentId: number) => {
      calls.deactivated.push(studentId); // captura la desactivación previa al upsert
    },
    upsertStudentSpecialty: async (studentId: number, specialtyId: number, kind: string) => {
      calls.upserts.push({ studentId, specialtyId, kind }); // captura cada especialidad guardada y su tipo, en orden
    },
    markSpecialtySetupCompleted: async (studentId: number) => {
      calls.markedComplete.push(studentId); // captura el cierre del setup
    },
    currentSpecialtySelection: async () => [], // lectura final para el response; irrelevante para los caminos, devuelve []
    ...over, // el override del test pisa cualquiera de los métodos anteriores (p. ej. forzar null o lanzar error)
  } as unknown as AcademicProfileRepository; // forzamos el tipo del repositorio real
  return { repo, calls }; // devolvemos el doble y el registro de llamadas
}

// Helper que arma el servicio ya cableado con el repositorio espía y el EventBus dummy.
const build = (over?: RepoOverrides) => {
  const { repo, calls } = makeRepo(over); // crea el repo espía (con overrides opcionales)
  return { service: new AcademicProfileService(repo, noopEvents), calls }; // servicio listo + registro de llamadas
};

describe("[CAJA BLANCA] updateSpecialties - camino de error", () => {
  test("C1 perfil inexistente lanza 404 USER_NOT_FOUND", async () => {
    const { service } = build({ findProfileByUserId: async () => null }); // P1(V): el repo no encuentra perfil
    await expect(
      service.updateSpecialties(1, { primarySpecialtyId: 1, interestSpecialtyIds: [] }),
    ).rejects.toMatchObject({ statusCode: 404, code: "USER_NOT_FOUND" }); // verifica que corte de inmediato con 404 USER_NOT_FOUND
  });

  test("C2 principal repetida como interes lanza 409 DUPLICATE_PRIMARY", async () => {
    const { service, calls } = build(); // repo "todo válido"
    await expect(
      service.updateSpecialties(1, { primarySpecialtyId: 7, interestSpecialtyIds: [7, 8] }), // 7 va como principal Y como interés -> P4(V)
    ).rejects.toMatchObject({ statusCode: 409, code: "DUPLICATE_PRIMARY" }); // verifica que rechace con 409 DUPLICATE_PRIMARY
    // No debe llegar a escribir nada.
    expect(calls.deactivated).toEqual([]); // verifica que NO desactivó (cortó antes de la escritura)
    expect(calls.upserts).toEqual([]); // verifica que NO hizo ningún upsert
  });

  test("C3 especialidad inexistente lanza 404 SPECIALTY_NOT_FOUND", async () => {
    const { service } = build({ specialtyExists: async () => false }); // P7(V): la especialidad no existe
    await expect(
      service.updateSpecialties(1, { primarySpecialtyId: 7, interestSpecialtyIds: [] }),
    ).rejects.toMatchObject({ statusCode: 404, code: "SPECIALTY_NOT_FOUND" }); // verifica 404 SPECIALTY_NOT_FOUND por inexistencia
  });

  test("C4 especialidad de otra carrera lanza 404 SPECIALTY_NOT_FOUND", async () => {
    const { service } = build({ specialtyBelongsToCareer: async () => false }); // P8(V): existe pero no es de la carrera del alumno
    await expect(
      service.updateSpecialties(1, { primarySpecialtyId: 7, interestSpecialtyIds: [] }),
    ).rejects.toMatchObject({ statusCode: 404, code: "SPECIALTY_NOT_FOUND" }); // verifica 404 SPECIALTY_NOT_FOUND por pertenencia
  });

  test("C7 violacion de unicidad (23505) se traduce a 409 DUPLICATE_PRIMARY", async () => {
    const { service } = build({
      upsertStudentSpecialty: async () => {
        throw { code: "23505" }; // P9 catch + P12(V): error de unicidad de Postgres (código 23505)
      },
    });
    await expect(
      service.updateSpecialties(1, { primarySpecialtyId: 7, interestSpecialtyIds: [] }),
    ).rejects.toMatchObject({ statusCode: 409, code: "DUPLICATE_PRIMARY" }); // verifica que el 23505 se traduzca a 409 DUPLICATE_PRIMARY
  });

  test("C7b error distinto en la escritura se propaga sin envolver", async () => {
    const boom = new Error("fallo de BD"); // error genérico que NO es violación de unicidad
    const { service } = build({
      upsertStudentSpecialty: async () => {
        throw boom; // P9 catch + P12(F): no es 23505
      },
    });
    await expect(
      service.updateSpecialties(1, { primarySpecialtyId: 7, interestSpecialtyIds: [] }),
    ).rejects.toBe(boom); // verifica que se propague EXACTAMENTE el mismo error (rethrow, sin envolver en HttpError)
  });
});

describe("[CAJA BLANCA] updateSpecialties - camino exitoso", () => {
  test("C5 principal e intereses validos hacen upsert de cada uno y marcan setup completo", async () => {
    const { service, calls } = build(); // repo "todo válido"
    const res = await service.updateSpecialties(1, { primarySpecialtyId: 7, interestSpecialtyIds: [8, 9] }); // camino feliz completo
    expect(res.message).toBe("Specialties updated"); // verifica el mensaje de éxito
    expect(res.setupComplete).toBe(true); // verifica que reporte el setup como completo
    expect(calls.deactivated).toEqual([10]); // verifica que desactivó las especialidades previas del studentId 10 antes de escribir
    expect(calls.upserts).toEqual([ // verifica el ORDEN y tipo exactos: primero la principal, luego los intereses
      { studentId: 10, specialtyId: 7, kind: "primary" }, // la principal como "primary"
      { studentId: 10, specialtyId: 8, kind: "interest" }, // interés 8
      { studentId: 10, specialtyId: 9, kind: "interest" }, // interés 9
    ]);
    expect(calls.markedComplete).toEqual([10]); // verifica que cerró el setup del studentId 10
  });

  test("C6 sin principal (solo intereses) no hace upsert de tipo primary", async () => {
    const { service, calls } = build(); // repo "todo válido"
    await service.updateSpecialties(1, { primarySpecialtyId: null, interestSpecialtyIds: [8] }); // P10(F): principal null
    expect(calls.upserts).toEqual([{ studentId: 10, specialtyId: 8, kind: "interest" }]); // verifica que solo se guardó el interés
    expect(calls.upserts.some((u) => u.kind === "primary")).toBe(false); // verifica que NO existe ningún upsert de tipo "primary"
  });

  test("C8 intereses duplicados se deduplican con Set y se upsertan una sola vez", async () => {
    const { service, calls } = build(); // repo "todo válido"
    await service.updateSpecialties(1, { primarySpecialtyId: null, interestSpecialtyIds: [8, 8, 9, 9] }); // P3: entradas repetidas
    expect(calls.upserts).toEqual([ // verifica que el Set dedujo los duplicados: cada interés se guarda UNA sola vez
      { studentId: 10, specialtyId: 8, kind: "interest" }, // 8 una vez
      { studentId: 10, specialtyId: 9, kind: "interest" }, // 9 una vez
    ]);
  });

  test("C9 seleccion vacia solo desactiva y marca completo, sin upserts", async () => {
    const { service, calls } = build(); // repo "todo válido"
    const res = await service.updateSpecialties(1, { primarySpecialtyId: null, interestSpecialtyIds: [] }); // sin principal ni intereses
    expect(calls.deactivated).toEqual([10]); // verifica que aun así desactiva las previas del studentId 10
    expect(calls.upserts).toEqual([]); // verifica que NO hace ningún upsert (nada que guardar)
    expect(calls.markedComplete).toEqual([10]); // verifica que igual marca el setup como completo
    expect(res.setupComplete).toBe(true); // verifica que el response confirma el setup completo
  });
});
