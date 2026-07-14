import { describe, expect, test } from "bun:test";
import type { EventBus } from "../../src/events/index.js";
import type { GradesRepository } from "../../src/modules/grades/grades.repository.js";
import { GradesService } from "../../src/modules/grades/grades.service.js";

/**
 * ============================================================================
 * CAJA BLANCA — GradesService.saveNotas() + deleteNota() (HU06: registrar notas)
 * Fuente: src/modules/grades/grades.service.ts:79-94
 * ============================================================================
 * Leyendo el fuente: cuando findEnrollmentId() devuelve null, saveNotas hace
 * `continue` y DESCARTA EN SILENCIO las notas de esa sección — la respuesta
 * HTTP sigue siendo 200 en ambos casos, así que esta rama es invisible desde
 * el contrato y solo se puede verificar espiando las llamadas al repositorio.
 *
 * NODOS/PREDICADOS de saveNotas():
 *   P1  for (curso of body.cursos)          (0..n iteraciones)
 *   P2  if (enrollmentId == null) continue  (sin matrícula activa)
 *   P3  for (nota of curso.notas)           (0..m upserts)
 * deleteNota(): P4  if (enrollmentId == null) return
 *
 * V(G) saveNotas = 3 decisiones + 1 = 4 · deleteNota = 2  ⇒ un test por camino:
 *
 * | # | Camino                                   | Esperado                        |
 * |---|-------------------------------------------|---------------------------------|
 * | C1| cursos: [] (P1 no itera)                  | 0 upserts, resuelve sin lanzar  |
 * | C2| P2(V): sección sin matrícula              | 0 upserts (descarte silencioso) |
 * | C3| P2(F)→P3: matriculado con 2 notas         | 2 upserts con el enrollment 501 |
 * | C4| mixto: [sin matrícula, matriculado]       | upserts SOLO del matriculado    |
 * | C5| deleteNota P4(V): sin matrícula           | 0 deletes                       |
 * | C6| deleteNota P4(F): matriculado             | 1 delete exacto                 |
 *
 * Flujo de datos (criterio todos-los-usos): el par def-uso de `enrollmentId`
 * (def :81 / uso :85) se verifica comprobando que upsertScore recibe el id
 * devuelto por findEnrollmentId, no el sectionId ni otro valor.
 */

// EventBus vacío forzado al tipo: es un dummy porque saveNotas/deleteNota no emiten eventos, solo escriben en el repositorio.
const noopEvents = {} as unknown as EventBus;

// Forma de una llamada capturada a upsertScore: qué matrícula, qué evaluación y qué valor recibió.
type Upsert = { enrollmentId: number; assessmentId: number; valor: number | null };
// Forma de una llamada capturada a deleteScore: qué matrícula y qué evaluación se borró.
type Delete = { enrollmentId: number; assessmentId: number };

// Repositorio ESPÍA: matrícula por sectionId (ausente = no matriculado) y
// registro de cada llamada para las aserciones de interacción.
const spyRepo = (enrollments: Record<number, number>) => {
  const upserts: Upsert[] = []; // array donde guardamos cada upsertScore que el servicio intente hacer
  const deletes: Delete[] = []; // array donde guardamos cada deleteScore que el servicio intente hacer
  const repo = { // objeto que simula el repositorio real (no toca la BD)
    findEnrollmentId: async (_studentId: number, sectionId: number) =>
      enrollments[sectionId] ?? null, // devuelve la matrícula del mapa; si no existe la sección => null (dispara P2/P4)
    upsertScore: async (enrollmentId: number, assessmentId: number, valor: number | null) => {
      upserts.push({ enrollmentId, assessmentId, valor }); // en vez de escribir en BD, registramos con qué argumentos se llamó
    },
    deleteScore: async (enrollmentId: number, assessmentId: number) => {
      deletes.push({ enrollmentId, assessmentId }); // en vez de borrar en BD, registramos con qué argumentos se llamó
    },
  } as unknown as GradesRepository; // forzamos el tipo porque solo implementamos los métodos que el test usa
  return { repo, upserts, deletes }; // devolvemos el repo espía y los dos registros para inspeccionarlos
};

describe("CAJA BLANCA · GradesService.saveNotas (HU06)", () => {
  test("C1: lista de cursos vacía -> no consulta matrícula ni escribe nada", async () => {
    const { repo, upserts } = spyRepo({ 42: 501 }); // hay matrícula disponible, pero el body no traerá cursos
    await new GradesService(repo, noopEvents).saveNotas(7, { cursos: [] }); // P1 no itera: el for no entra
    expect(upserts).toHaveLength(0); // verifica que no se hizo ningún upsert (cuerpo del bucle nunca se ejecutó)
  });

  test("C2: sección sin matrícula -> continue silencioso, 0 upserts y sin excepción", async () => {
    const { repo, upserts } = spyRepo({}); // mapa vacío: la sección 42 no tiene matrícula => findEnrollmentId devolverá null
    const service = new GradesService(repo, noopEvents); // servicio con el repo espía

    await service.saveNotas(7, {
      cursos: [{ sectionId: 42, notas: [{ assessmentId: 1, valor: 15 }] }], // 1 curso con 1 nota, pero sin matrícula
    });

    expect(upserts).toHaveLength(0); // verifica que P2 hizo continue: la nota se descartó en silencio, 0 escrituras
  });

  test("C3: matriculado con 2 notas -> un upsert por nota con el enrollmentId correcto", async () => {
    const { repo, upserts } = spyRepo({ 42: 501 }); // la sección 42 sí tiene matrícula 501
    const service = new GradesService(repo, noopEvents); // servicio con el repo espía

    await service.saveNotas(7, {
      cursos: [
        {
          sectionId: 42,
          notas: [
            { assessmentId: 1, valor: 15 }, // primera nota
            { assessmentId: 2, valor: 12.5 }, // segunda nota
          ],
        },
      ],
    });

    expect(upserts).toEqual([ // verifica el flujo de datos: cada upsert usa el enrollmentId 501 (no el sectionId 42)
      { enrollmentId: 501, assessmentId: 1, valor: 15 }, // P3 iteró la 1ª nota con la matrícula correcta
      { enrollmentId: 501, assessmentId: 2, valor: 12.5 }, // P3 iteró la 2ª nota con la matrícula correcta
    ]);
  });

  test("C4: mezcla matriculado/no matriculado -> solo persiste la sección con matrícula", async () => {
    const { repo, upserts } = spyRepo({ 42: 501 }); // solo la sección 42 tiene matrícula; la 99 no
    const service = new GradesService(repo, noopEvents); // servicio con el repo espía

    await service.saveNotas(7, {
      cursos: [
        { sectionId: 99, notas: [{ assessmentId: 9, valor: 20 }] }, // sin matrícula -> P2 continue (se descarta)
        { sectionId: 42, notas: [{ assessmentId: 1, valor: 15 }] }, // matriculado -> P3 escribe
      ],
    });

    expect(upserts).toEqual([{ enrollmentId: 501, assessmentId: 1, valor: 15 }]); // verifica que SOLO se persistió la sección 42, no la 99
  });
});

describe("CAJA BLANCA · GradesService.deleteNota (HU06)", () => {
  test("C5: sin matrícula -> early return, no borra nada", async () => {
    const { repo, deletes } = spyRepo({}); // mapa vacío: la sección 42 no tiene matrícula => findEnrollmentId devuelve null
    await new GradesService(repo, noopEvents).deleteNota(7, 42, 1); // P4(V): return temprano antes de borrar
    expect(deletes).toHaveLength(0); // verifica que no se llamó a deleteScore (0 borrados)
  });

  test("C6: matriculado -> borra exactamente la nota (enrollmentId + assessmentId)", async () => {
    const { repo, deletes } = spyRepo({ 42: 501 }); // la sección 42 tiene matrícula 501
    await new GradesService(repo, noopEvents).deleteNota(7, 42, 1); // P4(F): llega hasta deleteScore
    expect(deletes).toEqual([{ enrollmentId: 501, assessmentId: 1 }]); // verifica que borró con la matrícula 501 y la evaluación 1 (flujo de datos correcto)
  });
});
