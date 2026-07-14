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
 * CAJA BLANCA - Guardar especialidades por carrera (HU05)
 * Fuente: src/modules/academic-profile/academic-profile.service.ts (updateSpecialties)
 * ============================================================================
 * Objetivo:
 *   Recorrer los caminos independientes de AcademicProfileService.updateSpecialties,
 *   que guarda la especialidad principal y las de interes del alumno.
 *
 * Complejidad ciclomatica:
 *   V(G) = 14. Decisiones que la determinan: if(!profile), primarySpecialtyId ?? null,
 *   interestSpecialtyIds ?? [], if(primary != null && incluye principal), ternario del
 *   armado de specialtyIds, for de validacion, if(!exists), if(!belongsToCareer),
 *   if(primary != null) del upsert, for de intereses, try/catch, if(isUniqueViolation).
 *
 * Justificacion de caja blanca:
 *   Se conoce la estructura interna del metodo, por lo que se disena un caso de prueba
 *   por cada region del grafo de flujo, aislando el repositorio con dobles de prueba.
 * ============================================================================
 */

const noopEvents = {} as unknown as EventBus;

// Perfil valido de referencia. El servicio solo lee studentId y career.id.
const PROFILE = { studentId: 10, career: { id: 5 } };

type RepoOverrides = Partial<AcademicProfileRepository>;

// Registro de llamadas para verificar los caminos de escritura.
function makeRepo(over: RepoOverrides = {}) {
  const calls = {
    deactivated: [] as number[],
    upserts: [] as Array<{ studentId: number; specialtyId: number; kind: string }>,
    markedComplete: [] as number[],
  };
  const repo = {
    findProfileByUserId: async () => PROFILE,
    specialtyExists: async () => true,
    specialtyBelongsToCareer: async () => true,
    deactivateAllStudentSpecialties: async (studentId: number) => {
      calls.deactivated.push(studentId);
    },
    upsertStudentSpecialty: async (studentId: number, specialtyId: number, kind: string) => {
      calls.upserts.push({ studentId, specialtyId, kind });
    },
    markSpecialtySetupCompleted: async (studentId: number) => {
      calls.markedComplete.push(studentId);
    },
    currentSpecialtySelection: async () => [],
    ...over,
  } as unknown as AcademicProfileRepository;
  return { repo, calls };
}

const build = (over?: RepoOverrides) => {
  const { repo, calls } = makeRepo(over);
  return { service: new AcademicProfileService(repo, noopEvents), calls };
};

describe("[CAJA BLANCA] updateSpecialties - camino de error", () => {
  test("C1 perfil inexistente lanza 404 USER_NOT_FOUND", async () => {
    const { service } = build({ findProfileByUserId: async () => null });
    await expect(
      service.updateSpecialties(1, { primarySpecialtyId: 1, interestSpecialtyIds: [] }),
    ).rejects.toMatchObject({ statusCode: 404, code: "USER_NOT_FOUND" });
  });

  test("C2 principal repetida como interes lanza 409 DUPLICATE_PRIMARY", async () => {
    const { service, calls } = build();
    await expect(
      service.updateSpecialties(1, { primarySpecialtyId: 7, interestSpecialtyIds: [7, 8] }),
    ).rejects.toMatchObject({ statusCode: 409, code: "DUPLICATE_PRIMARY" });
    // No debe llegar a escribir nada.
    expect(calls.deactivated).toEqual([]);
    expect(calls.upserts).toEqual([]);
  });

  test("C3 especialidad inexistente lanza 404 SPECIALTY_NOT_FOUND", async () => {
    const { service } = build({ specialtyExists: async () => false });
    await expect(
      service.updateSpecialties(1, { primarySpecialtyId: 7, interestSpecialtyIds: [] }),
    ).rejects.toMatchObject({ statusCode: 404, code: "SPECIALTY_NOT_FOUND" });
  });

  test("C4 especialidad de otra carrera lanza 404 SPECIALTY_NOT_FOUND", async () => {
    const { service } = build({ specialtyBelongsToCareer: async () => false });
    await expect(
      service.updateSpecialties(1, { primarySpecialtyId: 7, interestSpecialtyIds: [] }),
    ).rejects.toMatchObject({ statusCode: 404, code: "SPECIALTY_NOT_FOUND" });
  });

  test("C7 violacion de unicidad (23505) se traduce a 409 DUPLICATE_PRIMARY", async () => {
    const { service } = build({
      upsertStudentSpecialty: async () => {
        throw { code: "23505" };
      },
    });
    await expect(
      service.updateSpecialties(1, { primarySpecialtyId: 7, interestSpecialtyIds: [] }),
    ).rejects.toMatchObject({ statusCode: 409, code: "DUPLICATE_PRIMARY" });
  });

  test("C7b error distinto en la escritura se propaga sin envolver", async () => {
    const boom = new Error("fallo de BD");
    const { service } = build({
      upsertStudentSpecialty: async () => {
        throw boom;
      },
    });
    await expect(
      service.updateSpecialties(1, { primarySpecialtyId: 7, interestSpecialtyIds: [] }),
    ).rejects.toBe(boom);
  });
});

describe("[CAJA BLANCA] updateSpecialties - camino exitoso", () => {
  test("C5 principal e intereses validos hacen upsert de cada uno y marcan setup completo", async () => {
    const { service, calls } = build();
    const res = await service.updateSpecialties(1, { primarySpecialtyId: 7, interestSpecialtyIds: [8, 9] });
    expect(res.message).toBe("Specialties updated");
    expect(res.setupComplete).toBe(true);
    expect(calls.deactivated).toEqual([10]);
    expect(calls.upserts).toEqual([
      { studentId: 10, specialtyId: 7, kind: "primary" },
      { studentId: 10, specialtyId: 8, kind: "interest" },
      { studentId: 10, specialtyId: 9, kind: "interest" },
    ]);
    expect(calls.markedComplete).toEqual([10]);
  });

  test("C6 sin principal (solo intereses) no hace upsert de tipo primary", async () => {
    const { service, calls } = build();
    await service.updateSpecialties(1, { primarySpecialtyId: null, interestSpecialtyIds: [8] });
    expect(calls.upserts).toEqual([{ studentId: 10, specialtyId: 8, kind: "interest" }]);
    expect(calls.upserts.some((u) => u.kind === "primary")).toBe(false);
  });

  test("C8 intereses duplicados se deduplican con Set y se upsertan una sola vez", async () => {
    const { service, calls } = build();
    await service.updateSpecialties(1, { primarySpecialtyId: null, interestSpecialtyIds: [8, 8, 9, 9] });
    expect(calls.upserts).toEqual([
      { studentId: 10, specialtyId: 8, kind: "interest" },
      { studentId: 10, specialtyId: 9, kind: "interest" },
    ]);
  });

  test("C9 seleccion vacia solo desactiva y marca completo, sin upserts", async () => {
    const { service, calls } = build();
    const res = await service.updateSpecialties(1, { primarySpecialtyId: null, interestSpecialtyIds: [] });
    expect(calls.deactivated).toEqual([10]);
    expect(calls.upserts).toEqual([]);
    expect(calls.markedComplete).toEqual([10]);
    expect(res.setupComplete).toBe(true);
  });
});
