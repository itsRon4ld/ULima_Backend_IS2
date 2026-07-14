/**
 * alumnoSchedule.test.ts
 * ══════════════════════════════════════════════════════════════════════════════
 * Suite de pruebas para el módulo de Horario Semanal y Evaluaciones del Alumno.
 *
 * Cobertura de rúbrica:
 *   ✅ Caja Blanca  — mergeScheduleData (CC = 9, cada camino explícitamente cubierto)
 *   ✅ Caja Negra   — validateSchedulePayload (6 campos de entrada ≥ 4 requeridos)
 *   ✅ Unit Tests   — academicWeekOf  (≥ 4 casos it: éxito, límite, alterno, error)
 *
 * Ejecutar: bun test test/horario-alumno/alumnoSchedule.test.ts
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from "bun:test";
import {
  academicWeekOf,
  mergeScheduleData,
  validateSchedulePayload,
  type Assessment,
  type MergeInput,
  type Section,
  type ScheduleFilterPayload,
} from "./schedule.logic";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const slotLunes = {
  dia: "Lunes",
  inicio: "10:00:00",
  fin: "12:00:00",
  aula: "A-101",
  color: "#2196F3",
};

const baseSection: Section = {
  idSeccion: "1",
  codigoSeccion: "SW02",
  curso: "Ingeniería de Software II",
  horarios: [slotLunes],
};

const evalEnFecha: Assessment = {
  id: "42",
  courseName: "Ingeniería de Software II",
  sectionCode: "SW02",
  code: "EP1",
  name: "Examen Parcial 1",
  weekNumber: 5,               // semana 5 = 2026-04-27..05-03
  date: "2026-04-27",          // Lunes semana 5
  startTime: "10:00:00",
  endTime: "12:00:00",
  classroom: "A-101",
  color: "#F44336",
};

// ══════════════════════════════════════════════════════════════════════════════
// 1. PRUEBA DE CAJA BLANCA — mergeScheduleData (CC = 9)
//    Cada bloque it() cubre explícitamente uno o más caminos del grafo de flujo.
// ══════════════════════════════════════════════════════════════════════════════

describe("CAJA BLANCA — mergeScheduleData (CC = 9)", () => {

  /**
   * Camino C1:  secciones null/vacío → retorno temprano sin procesar.
   * Nodo cubierto: guard al inicio de la función.
   */
  it("[C1] Retorna estructura vacía cuando secciones es []", () => {
    const result = mergeScheduleData({
      secciones: [],
      assessments: [evalEnFecha],
      targetDate: "2026-04-27",
    });
    expect(result.secciones).toHaveLength(0);
    expect(result.isHighLoadWeek).toBe(false);
  });

  /**
   * Camino C2:  assessments vacío → todos los slots se procesan
   *             sin encontrar ningún badge (isEvaluation = false para todos).
   */
  it("[C2] Sin evaluaciones: todos los slots quedan con isEvaluation=false", () => {
    const input: MergeInput = {
      secciones: [baseSection],
      assessments: [],
      targetDate: "2026-04-27",
    };
    const result = mergeScheduleData(input);
    const slot = result.secciones[0].horarios[0];
    expect(slot.isEvaluation).toBe(false);
    expect(slot.evalBadge).toBe("");
  });

  /**
   * Camino C3:  assessment con date="" es excluido del índice interno
   *             → el slot permanece sin badge aunque el sectionCode coincida.
   */
  it("[C3] Assessment con date='' es ignorado (no produce badge)", () => {
    const evalSinFecha: Assessment = { ...evalEnFecha, date: "" };
    const result = mergeScheduleData({
      secciones: [baseSection],
      assessments: [evalSinFecha],
      targetDate: "2026-04-27",
    });
    expect(result.secciones[0].horarios[0].isEvaluation).toBe(false);
  });

  /**
   * Caminos C4 + C6 + C7:
   *   - Loop externo itera por cada sección (C4).
   *   - Loop interno itera por cada slot (C6).
   *   - No hay evaluación para esa fecha+sección (C7) → sin badge.
   */
  it("[C4+C6+C7] Fecha de evaluación distinta a targetDate → sin badge", () => {
    const evalOtraFecha: Assessment = { ...evalEnFecha, date: "2026-05-04" };
    const result = mergeScheduleData({
      secciones: [baseSection],
      assessments: [evalOtraFecha],
      targetDate: "2026-04-27",  // distinta
    });
    const slot = result.secciones[0].horarios[0];
    expect(slot.isEvaluation).toBe(false);
    expect(slot.evalBadge).toBe("");
  });

  /**
   * Camino C5:  Sección sin horarios (horarios=[]) devuelve lista vacía
   *             sin entrar al loop interno.
   */
  it("[C5] Sección con horarios=[] produce MergedSection con horarios=[]", () => {
    const secSinHorarios: Section = { ...baseSection, horarios: [] };
    const result = mergeScheduleData({
      secciones: [secSinHorarios],
      assessments: [evalEnFecha],
      targetDate: "2026-04-27",
    });
    expect(result.secciones[0].horarios).toHaveLength(0);
  });

  /**
   * Camino C8:  Hay evaluación en la fecha correcta pero la diferencia
   *             horaria supera 60 min → no se asigna badge.
   */
  it("[C8] Evaluación existe pero desfase horario > 60min → sin badge", () => {
    const evalLejos: Assessment = {
      ...evalEnFecha,
      startTime: "16:00:00",  // slot es a las 10:00 → diferencia 360 min
    };
    const result = mergeScheduleData({
      secciones: [baseSection],
      assessments: [evalLejos],
      targetDate: "2026-04-27",
    });
    expect(result.secciones[0].horarios[0].isEvaluation).toBe(false);
  });

  /**
   * Camino C9:  Evaluación en fecha correcta Y dentro de ventana ±1h
   *             → isEvaluation=true, evalBadge = código de la evaluación.
   */
  it("[C9] Fecha + hora coinciden → badge 'EP1' insertado correctamente", () => {
    const result = mergeScheduleData({
      secciones: [baseSection],
      assessments: [evalEnFecha],
      targetDate: "2026-04-27",
    });
    const slot = result.secciones[0].horarios[0];
    expect(slot.isEvaluation).toBe(true);
    expect(slot.evalBadge).toBe("EP1");
  });

  /**
   * Camino C9 (variante):  Evaluación sin código → evalBadge cae al fallback "EVAL".
   */
  it("[C9-fallback] Evaluación sin código → evalBadge = 'EVAL'", () => {
    const evalSinCodigo: Assessment = { ...evalEnFecha, code: "" };
    const result = mergeScheduleData({
      secciones: [baseSection],
      assessments: [evalSinCodigo],
      targetDate: "2026-04-27",
    });
    expect(result.secciones[0].horarios[0].evalBadge).toBe("EVAL");
  });

  /**
   * Camino C10 (isHighLoadWeek = true):
   *   ≥ 3 evaluaciones con fecha en la semana activa → alerta de alta carga.
   */
  it("[C10] 3 evaluaciones en la semana activa → isHighLoadWeek = true", () => {
    // 2026-04-27 = semana 4 del período. Todos los evals tienen weekNumber=4.
    const makeEval = (id: string, sec: string): Assessment => ({
      ...evalEnFecha,
      id,
      sectionCode: sec,
      date: "2026-04-27",
      weekNumber: 4,   // semana 4
    });
    const result = mergeScheduleData({
      secciones: [baseSection],
      assessments: [makeEval("1", "SW02"), makeEval("2", "IS01"), makeEval("3", "BD01")],
      targetDate: "2026-04-27",
    });
    expect(result.isHighLoadWeek).toBe(true);
  });

  /**
   * Camino C10 (isHighLoadWeek = false):
   *   2 evaluaciones en semana activa → no es alta carga.
   */
  it("[C10-negativo] 2 evaluaciones en semana activa → isHighLoadWeek = false", () => {
    const makeEval = (id: string, sec: string): Assessment => ({
      ...evalEnFecha,
      id,
      sectionCode: sec,
      date: "2026-04-27",
      weekNumber: 4,   // semana 4
    });
    const result = mergeScheduleData({
      secciones: [baseSection],
      assessments: [makeEval("1", "SW02"), makeEval("2", "IS01")],
      targetDate: "2026-04-27",
    });
    expect(result.isHighLoadWeek).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. PRUEBA DE CAJA NEGRA — validateSchedulePayload (> 4 campos de entrada)
//    Se evalúa el comportamiento externo sin conocer la implementación interna.
//    Los 6 campos son: studentId, weekNumber, dayName, includeAssessments,
//                       includeSections, targetDate.
// ══════════════════════════════════════════════════════════════════════════════

describe("CAJA NEGRA — validateSchedulePayload (6 campos obligatorios)", () => {

  const payloadValido: ScheduleFilterPayload = {
    studentId: 101,
    weekNumber: 5,
    dayName: "Lunes",
    includeAssessments: true,
    includeSections: true,
    targetDate: "2026-04-27",
  };

  it("Payload completamente válido (6 campos correctos) → { valid: true }", () => {
    const result = validateSchedulePayload(payloadValido);
    expect(result.valid).toBe(true);
  });

  it("studentId = 0 → error en campo 1", () => {
    const result = validateSchedulePayload({ ...payloadValido, studentId: 0 });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors).toContain("studentId debe ser un entero positivo.");
  });

  it("weekNumber = 17 (fuera de 1-16) → error en campo 2", () => {
    const result = validateSchedulePayload({ ...payloadValido, weekNumber: 17 });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors).toContain("weekNumber debe estar entre 1 y 16.");
  });

  it("dayName = 'Martes' (válido) → sin error en campo 3", () => {
    const result = validateSchedulePayload({ ...payloadValido, dayName: "Martes" });
    expect(result.valid).toBe(true);
  });

  it("dayName = 'Monday' (inválido, inglés) → error en campo 3", () => {
    const result = validateSchedulePayload({ ...payloadValido, dayName: "Monday" });
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.some((e) => e.includes("dayName"))).toBe(true);
  });

  it("includeAssessments = 'true' (string, no boolean) → error en campo 4", () => {
    const result = validateSchedulePayload({
      ...payloadValido,
      includeAssessments: "true" as unknown as boolean,
    });
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors).toContain("includeAssessments debe ser boolean.");
  });

  it("includeSections = undefined → error en campo 5", () => {
    const result = validateSchedulePayload({ ...payloadValido, includeSections: undefined });
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors).toContain("includeSections debe ser boolean.");
  });

  it("targetDate = '27-04-2026' (formato incorrecto) → error en campo 6", () => {
    const result = validateSchedulePayload({ ...payloadValido, targetDate: "27-04-2026" });
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors).toContain("targetDate debe tener formato YYYY-MM-DD.");
  });

  it("Múltiples campos inválidos → acumula todos los errores", () => {
    const result = validateSchedulePayload({
      studentId: -1,
      weekNumber: 0,
      dayName: "",
      includeAssessments: undefined,
      includeSections: undefined,
      targetDate: "hoy",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.length).toBeGreaterThanOrEqual(6);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. PRUEBAS UNITARIAS — academicWeekOf (≥ 4 casos it)
//    Valida el método aislado: flujo exitoso, flujos alternos, límites y errores.
// ══════════════════════════════════════════════════════════════════════════════

describe("UNIT TEST — academicWeekOf", () => {

  it("[Caso 1 — Flujo exitoso] Semana 1: primer día del período (2026-04-06) → 1", () => {
    // La semana académica 1 arranca el 6 de abril de 2026.
    expect(academicWeekOf("2026-04-06")).toBe(1);
  });

  it("[Caso 2 — Flujo exitoso] Semana 4: 2026-04-27 cae dentro de la semana 4", () => {
    // Semana 4 = 2026-04-27 al 2026-05-03 (21 días desde 2026-04-06 = semana 4).
    expect(academicWeekOf("2026-04-27")).toBe(4);
  });

  it("[Caso 3 — Caso límite superior] Semana 16: último día del período académico", () => {
    // Semana 16 empieza el 2026-07-13 (16 semanas * 7 días desde 2026-04-06).
    const week16Start = new Date(Date.UTC(2026, 3, 6));
    week16Start.setUTCDate(week16Start.getUTCDate() + 15 * 7); // 15 * 7 = 105 días
    const isoStr = week16Start.toISOString().slice(0, 10);
    expect(academicWeekOf(isoStr)).toBe(16);
  });

  it("[Caso 4 — Flujo alterno] Fecha anterior al inicio del período → -1", () => {
    // 2026-04-05 está un día antes del arranque del ciclo.
    expect(academicWeekOf("2026-04-05")).toBe(-1);
  });

  it("[Caso 5 — Flujo alterno] Fecha posterior a semana 16 → -1", () => {
    // 2026-08-01 está fuera de las 16 semanas.
    expect(academicWeekOf("2026-08-01")).toBe(-1);
  });

  it("[Caso 6 — Manejo de error] Cadena vacía → -1 (guard de validación)", () => {
    expect(academicWeekOf("")).toBe(-1);
  });

  it("[Caso 7 — Manejo de error] String inválido ('no-date') → -1 (guard NaN)", () => {
    // Date('no-date') produce NaN → el guard isNaN lo atrapa y retorna -1.
    const result = academicWeekOf("no-date");
    expect(result).toBe(-1);
  });

  it("[Caso 8 — Límite inferior] Semana 1 último día (2026-04-12) → sigue siendo 1", () => {
    expect(academicWeekOf("2026-04-12")).toBe(1);
  });
});
