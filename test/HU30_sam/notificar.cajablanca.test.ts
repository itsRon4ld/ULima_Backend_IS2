import { describe, expect, test } from "bun:test";
import type { EventBus } from "../../src/events/index.js";
import type { AttendanceRiskRepository } from "../../src/modules/attendance-risk/attendance-risk.repository.js";
import { AttendanceRiskService } from "../../src/modules/attendance-risk/attendance-risk.service.js";
import type { StudentNotifyRow } from "../../src/modules/attendance-risk/attendance-risk.types.js";

/**
 * ============================================================================
 * CAJA BLANCA — AttendanceRiskService.notifyStudents() (HU30: alerta de impedido)
 * Fuente: src/modules/attendance-risk/attendance-risk.service.ts:152-193
 * ============================================================================
 * ⭐ IDEA CENTRAL PARA EXPONER:
 * Se inspeccionan las decisiones internas de notifyStudents() y se usa un
 * repositorio espía para comprobar no solo el retorno, sino el arreglo EXACTO
 * que el servicio intenta persistir mediante createAlerts().
 *
 * NODOS/PREDICADOS del método:
 *   P1  for (row of rows)                       (bucle sobre la sección)
 *   P2  if (total <= 0) continue                (sin horas: no notificable)
 *   P3  if (pct > limit)                        -> alerta "Has superado el límite…"
 *   P4  else if (faltas !== 2 && faltas !== 3)  -> continue (lejos del límite)
 *       else                                    -> alerta "Estás a X falta(s)…"
 *   P5  notified > 0 ? … : "No hay alumnos que notificar."
 *   P6  notified === 1 ? "ha"/"alumno" : "han"/"alumnos"   (2 ternarios)
 *
 * CONTEO DECLARADO DE McCABE:
 *   9 decisiones = for + total<=0 + ciclo>=6 + pct>límite + 2 operandos del
 *   `&&` + notified>0 + 2 ternarios de singular/plural.
 *   V(G) = decisiones + 1 región base = 9 + 1 = 10.
 * Batería: un test por camino + verificación del FLUJO DE DATOS hacia
 * createAlerts() con un repositorio espía que captura el array exacto.
 *
 * | # | Camino                       | Esperado                                   |
 * |---|-------------------------------|--------------------------------------------|
 * | C1| P2(V): total 0h               | sin alerta; "No hay alumnos que notificar." |
 * | C2| P3(V): impedido               | alerta "Has superado el límite…" exacta     |
 * | C3| P4(V): normal a 4+ faltas     | sin alerta (continue)                       |
 * | C4| P4(F): en_riesgo a 2 faltas   | alerta "Estás a 2 falta(s)…" exacta         |
 * | C5| mixto (C1+C2+C3+C4 juntos)    | createAlerts recibe EXACTAMENTE 2 alertas   |
 * | C6| P6 singular: 1 notificado     | "Se ha notificado a 1 alumno."              |
 * | C7| límite 35% (ciclo 6)          | en_riesgo a 3 faltas, mensaje con (35%)     |
 * | C8| frontera: 25% exacto          | P3(F) por '>' estricto -> nadie notificado  |
 * | C9| a 1 falta (24h/100h)          | continue (preventiva SOLO a 2 o 3 faltas)   |
 * |C10| filas normales, notified = 0  | "No hay alumnos que notificar." con datos   |
 *
 */

// Dummy de EventBus: notifyStudents() no emite eventos en este flujo. Se entrega
// solo para satisfacer el constructor y mantener aislada la unidad probada.
const noopEvents = {} as unknown as EventBus;

// Fixture base válido: ciclo 3 (límite 25%), 100 horas totales y 0 ausentes.
// Cada test modifica únicamente los datos necesarios para forzar su camino.
const nrow = (over: Partial<StudentNotifyRow> = {}): StudentNotifyRow => ({
  student_id: 1,
  code: "20230001",
  full_name: "Garcia Lopez, Maria",
  current_level: 5,
  absent_hours: "0",
  total_section_hours: "100",
  course_name: "Ingenieria de Software",
  section_code: "801",
  cycle: 3,
  ...over,
});

// Repositorio espía: sustituye la BD, devuelve las filas preparadas y captura
// las alertas recibidas. `captured` permite verificar el flujo de datos exacto.
const spyService = (rows: StudentNotifyRow[]) => {
  const captured: { studentId: number; type: string; title: string; message: string }[] = [];
  const repo = {
    findStudentDetailsBySectionId: async () => rows,
    createAlerts: async (data: typeof captured) => {
      captured.push(...data);
      return data.length;
    },
  } as unknown as AttendanceRiskRepository;
  return { service: new AttendanceRiskService(repo, noopEvents), captured };
};

describe("CAJA BLANCA · AttendanceRiskService.notifyStudents (HU30)", () => {
  test("C1: sección con 0 horas dictadas -> nadie notificable", async () => {
    const { service, captured } = spyService([
      nrow({ absent_hours: "4", total_section_hours: "0" }),
    ]);

    const res = await service.notifyStudents(1);

    expect(captured).toHaveLength(0);
    expect(res.notified).toBe(0);
    expect(res.message).toBe("No hay alumnos que notificar.");
  });

  // ⭐ Camino central de negocio: demuestra umbral estricto, payload de alerta
  // y mensaje público cuando el alumno ya superó el límite permitido.
  test("C2: impedido (30% > 25%) -> alerta academic_risk con el mensaje de límite superado", async () => {
    const { service, captured } = spyService([
      nrow({ student_id: 7, absent_hours: "30" }),
    ]);

    const res = await service.notifyStudents(1);

    expect(res.notified).toBe(1);
    expect(captured).toEqual([
      {
        studentId: 7,
        type: "academic_risk",
        title: "Alerta de inasistencias - Ingenieria de Software",
        message:
          "Has superado el límite de inasistencias permitidas (25%) en Ingenieria de Software (Sección 801). Tu porcentaje actual es de 30%.",
      },
    ]);
  });

  test("C3: normal a 4 faltas del límite (17h/100h) -> continue, sin alerta", async () => {
    const { service, captured } = spyService([nrow({ absent_hours: "17" })]);

    const res = await service.notifyStudents(1);

    expect(captured).toHaveLength(0);
    expect(res.notified).toBe(0);
  });

  // ⭐ Contrasta con C2: todavía no está impedido, pero recibe una alerta
  // preventiva porque el cálculo con sesiones de 2 horas da exactamente 2.
  test("C4: en_riesgo a 2 faltas (21h/100h) -> alerta preventiva con el conteo de faltas", async () => {
    const { service, captured } = spyService([
      nrow({ student_id: 9, absent_hours: "21" }),
    ]);

    await service.notifyStudents(1);

    expect(captured).toHaveLength(1);   // se debe construir exactamente una alerta preventiva
    expect(captured[0].studentId).toBe(9); // la alerta debe pertenecer al alumno evaluado
    expect(captured[0].title).toBe("Alerta de inasistencias - Ingenieria de Software");
    expect(captured[0].message).toBe(
      "Estás a 2 falta(s) de alcanzar el límite de inasistencias (25%) en Ingenieria de Software (Sección 801). Tu porcentaje actual es de 21%.",
    );
  });

  test("C7: ciclo 6 con 30% -> límite 35%, alerta preventiva a 3 faltas (no 'límite superado')", async () => {
    const { service, captured } = spyService([
      nrow({ student_id: 11, absent_hours: "30", cycle: 6 }),
    ]);

    const res = await service.notifyStudents(1);

    expect(res.notified).toBe(1);
    expect(captured[0].message).toBe(
      "Estás a 3 falta(s) de alcanzar el límite de inasistencias (35%) en Ingenieria de Software (Sección 801). Tu porcentaje actual es de 30%.",
    );
  });

  test("C8: exactamente 25% en ciclo 3 -> NO se notifica (el límite se supera con '>', no '>=')", async () => {
    const { service, captured } = spyService([nrow({ absent_hours: "25" })]);

    const res = await service.notifyStudents(1);

    expect(captured).toHaveLength(0);
    expect(res.notified).toBe(0);
    expect(res.message).toBe("No hay alumnos que notificar.");
  });

  // ⭐ Mejor demostración del spy: cuatro filas entran, pero solo los ids 1 y 2
  // deben llegar a createAlerts; además cubre la respuesta en plural.
  test("C5: sección mixta -> createAlerts recibe SOLO impedido + en_riesgo, y el mensaje pluraliza", async () => {
    const { service, captured } = spyService([
      nrow({ student_id: 1, absent_hours: "30" }),                          // impedido -> alerta
      nrow({ student_id: 2, absent_hours: "21" }),                          // en_riesgo (2 faltas) -> alerta
      nrow({ student_id: 3, absent_hours: "10" }),                          // normal lejos -> continue
      nrow({ student_id: 4, absent_hours: "4", total_section_hours: "0" }), // sin horas -> continue
    ]);

    const res = await service.notifyStudents(1);

    expect(captured.map((a) => a.studentId)).toEqual([1, 2]);
    expect(res.notified).toBe(2);
    expect(res.message).toBe("Se han notificado a 2 alumnos.");
  });

  test("C6: un solo notificado -> mensaje en singular ('Se ha notificado a 1 alumno.')", async () => {
    const { service } = spyService([nrow({ absent_hours: "30" })]);

    const res = await service.notifyStudents(1);

    expect(res.message).toBe("Se ha notificado a 1 alumno.");
  });

  test("C9: a 1 falta del límite (24h/100h) -> continue (la preventiva es SOLO a 2 o 3 faltas)", async () => {
    // faltas = ceil((25 - 24) / 2) = 1 -> ni 2 ni 3 -> no se notifica.
    const { service, captured } = spyService([nrow({ absent_hours: "24" })]);

    const res = await service.notifyStudents(1);

    expect(captured).toHaveLength(0);
    expect(res.notified).toBe(0);
  });

  test("C10: filas presentes pero todas normales -> 'No hay alumnos que notificar.' (rama notified = 0 con datos)", async () => {
    // A diferencia de C1 (que descarta por 0 horas), aquí las filas SÍ se evalúan
    // y ninguna alcanza el umbral: cubre el ternario notified > 0 en falso con datos reales.
    const { service, captured } = spyService([
      nrow({ student_id: 1, absent_hours: "0" }),
      nrow({ student_id: 2, absent_hours: "10" }),
    ]);

    const res = await service.notifyStudents(1);

    expect(captured).toHaveLength(0);
    expect(res.notified).toBe(0);
    expect(res.message).toBe("No hay alumnos que notificar.");
  });
});
