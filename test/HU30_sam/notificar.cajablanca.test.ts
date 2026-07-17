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
 * NODOS/PREDICADOS del método:
 *   P1  for (row of rows)                       (bucle sobre la sección)
 *   P2  if (total <= 0) continue                (sin horas: no notificable)
 *   P3  if (pct > limit)                        -> alerta "Has superado el límite…"
 *   P4  else if (faltas !== 2 && faltas !== 3)  -> continue (lejos del límite)
 *       else                                    -> alerta "Estás a X falta(s)…"
 *   P5  notified > 0 ? … : "No hay alumnos que notificar."
 *   P6  notified === 1 ? "ha"/"alumno" : "han"/"alumnos"   (2 ternarios)
 *
 * V(G) ≈ 5 decisiones + 3 ternarios ⇒ 8 (9 separando el && de P4).
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

// Crea un objeto vacío y lo fuerza a ser del tipo EventBus. Es un "mock" falso (dummy) porque el test no evalúa la emisión de eventos, solo la lógica de notificaciones.
const noopEvents = {} as unknown as EventBus;

// Helper para crear filas de prueba. Retorna un objeto alumno con datos simulados por defecto (ciclo 7, 100 horas totales, 0 faltas).
const nrow = (over: Partial<StudentNotifyRow> = {}): StudentNotifyRow => ({
  student_id: 1,
  code: "20230001",
  full_name: "Garcia Lopez, Maria",
  current_level: 5,
  absent_hours: "0",
  total_section_hours: "100",
  course_name: "Ingenieria de Software",
  section_code: "801",
  cycle: 3, // ciclo <= 5 por defecto => límite de inasistencia 25% (los casos C7 lo suben a 6 => 35%)
  ...over, //permite que cada test sobrescriba solo los datos que le importan
});

// Repositorio espía: filas prefabricadas + captura del argumento de createAlerts. Se usa para mockear el repositorio y verificar que el servicio llame a los métodos correctos con los argumentos correctos.
const spyService = (rows: StudentNotifyRow[]) => { //mockeo del repositorio
  const captured: { studentId: number; type: string; title: string; message: string }[] = []; // crea array vacio para guardar las alertas
  const repo = { // simula el repo porque no vamos a usar la BD
    findStudentDetailsBySectionId: async () => rows, // cuando el servicio pida las filas, le devolvemos las que le pasamos al test
    createAlerts: async (data: typeof captured) => { // cuando el servicio intente crear alertas, las guardamos en el array "captured"
      captured.push(...data); // guardamos las alertas
      return data.length; // devolvemos la cantidad de alertas
    },
  } as unknown as AttendanceRiskRepository; // forzamos que sea del tipo AttendanceRiskRepository
  return { service: new AttendanceRiskService(repo, noopEvents), captured }; // devolvemos el servicio mockeado y el array de alertas capturadas
};

describe("CAJA BLANCA · AttendanceRiskService.notifyStudents (HU30)", () => {
  test("C1: sección con 0 horas dictadas -> nadie notificable", async () => {
    const { service, captured } = spyService([ //mockea el repositorio con 1 alumno con 0 horas
      nrow({ absent_hours: "4", total_section_hours: "0" }), // alumno con 0 horas
    ]);

    const res = await service.notifyStudents(1); // llama al metodo notifyStudents del servicio mockeado

    expect(captured).toHaveLength(0); // verifica que no se hayan capturado alertas
    expect(res.notified).toBe(0); // verifica que no se haya notificado a ningun alumno
    expect(res.message).toBe("No hay alumnos que notificar."); // verifica que el mensaje sea el correcto
  });

  test("C2: impedido (30% > 25%) -> alerta academic_risk con el mensaje de límite superado", async () => { // test 2
    const { service, captured } = spyService([ //mockea el repositorio con 1 alumno con 0 horas
      nrow({ student_id: 7, absent_hours: "30" }), // alumno con 0 horas
    ]);

    const res = await service.notifyStudents(1); // llama al metodo notifyStudents del servicio mockeado

    expect(res.notified).toBe(1); // verifica que no se haya notificado a ningun alumno
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

  test("C3: normal a 4 faltas del límite (17h/100h) -> continue, sin alerta", async () => { // test 3
    const { service, captured } = spyService([nrow({ absent_hours: "17" })]); //mockea el repositorio con 1 alumno con 0 horas

    const res = await service.notifyStudents(1); // llama al metodo notifyStudents del servicio mockeado

    expect(captured).toHaveLength(0); // verifica que no se hayan capturado alertas
    expect(res.notified).toBe(0); // verifica que no se haya notificado a ningun alumno
  });

  test("C4: en_riesgo a 2 faltas (21h/100h) -> alerta preventiva con el conteo de faltas", async () => { // test 4
    const { service, captured } = spyService([
      nrow({ student_id: 9, absent_hours: "21" }),
    ]);

    await service.notifyStudents(1); // llama al metodo notifyStudents del servicio mockeado

    expect(captured).toHaveLength(1);   // verifica que no se hayan capturado alertas
    expect(captured[0].studentId).toBe(9); // verifica que el alumno sea el correcto
    expect(captured[0].title).toBe("Alerta de inasistencias - Ingenieria de Software"); // verifica que el titulo sea el correcto
    expect(captured[0].message).toBe(
      "Estás a 2 falta(s) de alcanzar el límite de inasistencias (25%) en Ingenieria de Software (Sección 801). Tu porcentaje actual es de 21%.", // verifica que el mensaje sea el correcto
    ); // verifica que el mensaje sea el correcto
  });

  test("C7: ciclo 6 con 30% -> límite 35%, alerta preventiva a 3 faltas (no 'límite superado')", async () => { // test 7
    const { service, captured } = spyService([
      nrow({ student_id: 11, absent_hours: "30", cycle: 6 }), //mockea el repositorio con 1 alumno con 0 horas
    ]);

    const res = await service.notifyStudents(1); // llama al metodo notifyStudents del servicio mockeado

    expect(res.notified).toBe(1); // verifica que se haya notificado a un alumno
    expect(captured[0].message).toBe(
      "Estás a 3 falta(s) de alcanzar el límite de inasistencias (35%) en Ingenieria de Software (Sección 801). Tu porcentaje actual es de 30%.", // verifica que el mensaje sea el correcto
    );
  });

  test("C8: exactamente 25% en ciclo 3 -> NO se notifica (el límite se supera con '>', no '>=')", async () => {
    const { service, captured } = spyService([nrow({ absent_hours: "25" })]); //mockea el repositorio con 1 alumno con 0 horas

    const res = await service.notifyStudents(1); // llama al metodo notifyStudents del servicio mockeado

    expect(captured).toHaveLength(0); // verifica que no se hayan capturado alertas
    expect(res.notified).toBe(0); // verifica que no se haya notificado a ningun alumno
    expect(res.message).toBe("No hay alumnos que notificar."); // verifica que el mensaje sea el correcto
  });

  test("C5: sección mixta -> createAlerts recibe SOLO impedido + en_riesgo, y el mensaje pluraliza", async () => { // test 5
    const { service, captured } = spyService([
      nrow({ student_id: 1, absent_hours: "30" }),                          // impedido -> alerta
      nrow({ student_id: 2, absent_hours: "21" }),                          // en_riesgo (2 faltas) -> alerta
      nrow({ student_id: 3, absent_hours: "10" }),                          // normal lejos -> continue
      nrow({ student_id: 4, absent_hours: "4", total_section_hours: "0" }), // sin horas -> continue
    ]);

    const res = await service.notifyStudents(1); // llama al metodo notifyStudents del servicio mockeado

    expect(captured.map((a) => a.studentId)).toEqual([1, 2]); // verifica que se hayan capturado alertas
    expect(res.notified).toBe(2); // verifica que se hayan notificado a dos alumnos
    expect(res.message).toBe("Se han notificado a 2 alumnos."); // verifica que el mensaje sea el correcto
  });

  test("C6: un solo notificado -> mensaje en singular ('Se ha notificado a 1 alumno.')", async () => { // test 6
    const { service } = spyService([nrow({ absent_hours: "30" })]); //mockea el repositorio con 1 alumno con 0 horas

    const res = await service.notifyStudents(1); // llama al metodo notifyStudents del servicio mockeado

    expect(res.message).toBe("Se ha notificado a 1 alumno."); // verifica que el mensaje sea el correcto
  });

  test("C9: a 1 falta del límite (24h/100h) -> continue (la preventiva es SOLO a 2 o 3 faltas)", async () => { // test 9
    // faltas = ceil((25 - 24) / 2) = 1 -> ni 2 ni 3 -> no se notifica.
    const { service, captured } = spyService([nrow({ absent_hours: "24" })]); //mockea el repositorio con 1 alumno con 0 horas

    const res = await service.notifyStudents(1); // llama al metodo notifyStudents del servicio mockeado

    expect(captured).toHaveLength(0); // verifica que no se hayan capturado alertas
    expect(res.notified).toBe(0); // verifica que no se haya notificado a ningun alumno
  });

  test("C10: filas presentes pero todas normales -> 'No hay alumnos que notificar.' (rama notified = 0 con datos)", async () => {
    // A diferencia de C1 (que descarta por 0 horas), aquí las filas SÍ se evalúan
    // y ninguna alcanza el umbral: cubre el ternario notified > 0 en falso con datos reales.
    const { service, captured } = spyService([
      nrow({ student_id: 1, absent_hours: "0" }), //mockea el repositorio con 1 alumno con 0 horas
      nrow({ student_id: 2, absent_hours: "10" }),
    ]);

    const res = await service.notifyStudents(1); // llama al metodo notifyStudents del servicio mockeado

    expect(captured).toHaveLength(0); // verifica que no se hayan capturado alertas
    expect(res.notified).toBe(0); // verifica que no se haya notificado a ningun alumno
    expect(res.message).toBe("No hay alumnos que notificar.");
  });
});
