/**
 * docenteSchedule.test.ts
 * ════════════════════════════════════════════════════════════════════════════
 * Suite de pruebas para el módulo de Horario Interactivo para Docentes.
 *
 * Cobertura de rúbrica:
 *   ✅ Caja Blanca  — resolveTeacherBlock (CC = 10, cada camino explícito)
 *   ✅ Caja Negra   — validateCourseBlockInput (6 campos de entrada ≥ 4 requeridos)
 *   ✅ Unit Tests   — computeGradesStatus (≥ 4 casos it: éxito, límite, alterno, error)
 *
 * Ejecutar: bun test test/horario-docente/docenteSchedule.test.ts
 * ════════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from "bun:test";
import {
  resolveTeacherBlock,
  validateCourseBlockInput,
  computeGradesStatus,
  type CourseBlockInput,
} from "./teacherSchedule.logic";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseBlock: CourseBlockInput = {
  courseName: "Ingeniería de Software II",
  section: "SW-02",
  delegateName: "Ana Pérez",
  subDelegateName: "Luis García",
  gradesUploadStatus: "Sin cargar",
  kind: "class",
};

// ══════════════════════════════════════════════════════════════════════════════
// 1. PRUEBA DE CAJA BLANCA — resolveTeacherBlock (CC = 10)
//    Cada it() documenta el(los) camino(s) del grafo de flujo que cubre.
// ══════════════════════════════════════════════════════════════════════════════

describe("CAJA BLANCA — resolveTeacherBlock (CC = 10)", () => {

  /**
   * Camino D1: input = null → debe lanzar Error.
   */
  it("[D1] Input null → lanza Error con mensaje descriptivo", () => {
    expect(() => resolveTeacherBlock(null)).toThrow("CourseBlockInput no puede ser nulo.");
  });

  /**
   * Camino D1 (variante): input = undefined → también lanza Error.
   */
  it("[D1-variante] Input undefined → lanza Error", () => {
    expect(() => resolveTeacherBlock(undefined)).toThrow();
  });

  /**
   * Camino D2: kind = "class" → bloque de clase regular sin badge.
   */
  it("[D2] kind='class' → displayTitle = courseName, badgeLabel vacío", () => {
    const result = resolveTeacherBlock({ ...baseBlock, kind: "class" });
    expect(result.displayTitle).toBe("Ingeniería de Software II");
    expect(result.badgeLabel).toBe("");
    expect(result.actionLabel).toBe("Ver sección");
  });

  /**
   * Camino D3: kind = "assessment" con código → badge = código evaluación.
   */
  it("[D3] kind='assessment' con código → badge = 'EP1', color rojo", () => {
    const result = resolveTeacherBlock({
      ...baseBlock,
      kind: "assessment",
      assessmentCode: "EP1",
      assessmentName: "Examen Parcial 1",
    });
    expect(result.badgeLabel).toBe("EP1");
    expect(result.badgeColor).toBe("#F44336");
    expect(result.actionLabel).toBe("Ver evaluación");
  });

  /**
   * Camino D4: kind = "assessment" SIN código → fallback badge "EVAL".
   */
  it("[D4] kind='assessment' sin código → badge fallback 'EVAL'", () => {
    const result = resolveTeacherBlock({
      ...baseBlock,
      kind: "assessment",
      assessmentCode: "",
    });
    expect(result.badgeLabel).toBe("EVAL");
  });

  /**
   * Camino D5: kind = "advising", isExtra = false → sin badge extra,
   *            displayTitle empieza con "Asesoría:".
   */
  it("[D5] kind='advising' no extra → badgeLabel vacío, título contiene 'Asesoría:'", () => {
    const result = resolveTeacherBlock({
      ...baseBlock,
      kind: "advising",
      isExtra: false,
      advisingModality: "classroom",
    });
    expect(result.displayTitle).toContain("Asesoría:");
    expect(result.badgeLabel).toBe("");
    expect(result.actionLabel).toBe("Ver asistentes");
  });

  /**
   * Camino D6: kind = "advising", isExtra = true → badge "EXTRA" violeta.
   */
  it("[D6] kind='advising' extra → badge 'EXTRA', color violeta", () => {
    const result = resolveTeacherBlock({
      ...baseBlock,
      kind: "advising",
      isExtra: true,
      advisingModality: "classroom",
    });
    expect(result.badgeLabel).toBe("EXTRA");
    expect(result.badgeColor).toBe("#9C27B0");
  });

  /**
   * Camino D7: advisingModality = "virtual" → subtítulo indica reunión en línea.
   */
  it("[D7] advisingModality='virtual' → subtítulo contiene 'Virtual'", () => {
    const result = resolveTeacherBlock({
      ...baseBlock,
      kind: "advising",
      advisingModality: "virtual",
    });
    expect(result.displaySubtitle).toContain("Virtual");
  });

  /**
   * Camino D8: advisingModality = "hybrid" → subtítulo indica híbrida.
   */
  it("[D8] advisingModality='hybrid' → subtítulo contiene 'Híbrida'", () => {
    const result = resolveTeacherBlock({
      ...baseBlock,
      kind: "advising",
      advisingModality: "hybrid",
    });
    expect(result.displaySubtitle).toContain("Híbrida");
  });

  /**
   * Camino D9: advisingModality = "classroom" → subtítulo presencial.
   */
  it("[D9] advisingModality='classroom' → subtítulo contiene 'Presencial'", () => {
    const result = resolveTeacherBlock({
      ...baseBlock,
      kind: "advising",
      advisingModality: "classroom",
    });
    expect(result.displaySubtitle).toContain("Presencial");
  });

  /**
   * Camino D10 (showAtRiskBadge = true): atRiskCount > 0.
   */
  it("[D10] atRiskCount = 3 → showAtRiskBadge = true, atRiskCount = 3", () => {
    const result = resolveTeacherBlock({ ...baseBlock, atRiskCount: 3 });
    expect(result.showAtRiskBadge).toBe(true);
    expect(result.atRiskCount).toBe(3);
  });

  /**
   * Camino D10 (showAtRiskBadge = false): atRiskCount = 0.
   */
  it("[D10-negativo] atRiskCount = 0 → showAtRiskBadge = false", () => {
    const result = resolveTeacherBlock({ ...baseBlock, atRiskCount: 0 });
    expect(result.showAtRiskBadge).toBe(false);
  });

  /**
   * Camino D11 (canNotifyGrades = true): gradesUploadStatus = "Completo".
   */
  it("[D11] gradesUploadStatus='Completo' → canNotifyGrades=true, label con ✅", () => {
    const result = resolveTeacherBlock({ ...baseBlock, gradesUploadStatus: "Completo" });
    expect(result.canNotifyGrades).toBe(true);
    expect(result.gradesStatusLabel).toContain("✅");
  });

  /**
   * Camino D11 (variante): gradesUploadStatus = "Carga parcial" → también permite notificar.
   */
  it("[D11-parcial] gradesUploadStatus='Carga parcial' → canNotifyGrades=true, label con ⚠️", () => {
    const result = resolveTeacherBlock({ ...baseBlock, gradesUploadStatus: "Carga parcial" });
    expect(result.canNotifyGrades).toBe(true);
    expect(result.gradesStatusLabel).toContain("⚠️");
  });

  /**
   * Camino D11 (negativo): gradesUploadStatus = "Sin cargar" → canNotifyGrades=false.
   */
  it("[D11-negativo] gradesUploadStatus='Sin cargar' → canNotifyGrades=false, label con ❌", () => {
    const result = resolveTeacherBlock({ ...baseBlock, gradesUploadStatus: "Sin cargar" });
    expect(result.canNotifyGrades).toBe(false);
    expect(result.gradesStatusLabel).toContain("❌");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. PRUEBA DE CAJA NEGRA — validateCourseBlockInput (≥ 5 campos obligatorios)
//    Se evalúa el comportamiento externo sin conocer la implementación interna.
//    Campos: courseName, section, delegateName, subDelegateName,
//            gradesUploadStatus, kind (+ advisingModality opcional).
// ══════════════════════════════════════════════════════════════════════════════

describe("CAJA NEGRA — validateCourseBlockInput (6 campos obligatorios)", () => {

  const payloadValido: CourseBlockInput = {
    courseName: "Ingeniería de Software II",
    section: "SW-02",
    delegateName: "Ana Pérez",
    subDelegateName: "Luis García",
    gradesUploadStatus: "Sin cargar",
    kind: "class",
  };

  it("Payload con todos los campos válidos → { valid: true }", () => {
    expect(validateCourseBlockInput(payloadValido).valid).toBe(true);
  });

  it("Campo 1 — courseName vacío → error 'courseName es requerido'", () => {
    const result = validateCourseBlockInput({ ...payloadValido, courseName: "" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors).toContain("courseName es requerido y no puede estar vacío.");
  });

  it("Campo 2 — section vacío → error 'section es requerido'", () => {
    const result = validateCourseBlockInput({ ...payloadValido, section: "   " });
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.some((e) => e.includes("section"))).toBe(true);
  });

  it("Campo 3 — delegateName ausente → error", () => {
    const result = validateCourseBlockInput({ ...payloadValido, delegateName: "" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors).toContain("delegateName es requerido.");
  });

  it("Campo 4 — subDelegateName ausente → error", () => {
    const result = validateCourseBlockInput({ ...payloadValido, subDelegateName: "" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors).toContain("subDelegateName es requerido.");
  });

  it("Campo 5 — gradesUploadStatus inválido ('Pendiente') → error", () => {
    const result = validateCourseBlockInput({
      ...payloadValido,
      gradesUploadStatus: "Pendiente" as any,
    });
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.some((e) => e.includes("gradesUploadStatus"))).toBe(true);
  });

  it("Campo 6 — kind inválido ('seminar') → error", () => {
    const result = validateCourseBlockInput({ ...payloadValido, kind: "seminar" as any });
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.some((e) => e.includes("kind"))).toBe(true);
  });

  it("Campo adicional — advisingModality inválida ('zoom') para advising → error", () => {
    const result = validateCourseBlockInput({
      ...payloadValido,
      kind: "advising",
      advisingModality: "zoom" as any,
    });
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.some((e) => e.includes("advisingModality"))).toBe(true);
  });

  it("Payload advising con modality 'virtual' → { valid: true }", () => {
    const result = validateCourseBlockInput({
      ...payloadValido,
      kind: "advising",
      advisingModality: "virtual",
    });
    expect(result.valid).toBe(true);
  });

  it("Múltiples campos inválidos → acumula ≥ 3 errores", () => {
    const result = validateCourseBlockInput({
      courseName: "",
      section: "",
      delegateName: "",
      subDelegateName: "",
      gradesUploadStatus: undefined,
      kind: undefined,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. PRUEBAS UNITARIAS — computeGradesStatus (≥ 4 casos it)
//    Valida el método auxiliar con todos los flujos posibles.
// ══════════════════════════════════════════════════════════════════════════════

describe("UNIT TEST — computeGradesStatus", () => {

  it("[Caso 1 — Flujo exitoso] 30/30 alumnos cargados → 'Completo'", () => {
    expect(computeGradesStatus(30, 30)).toBe("Completo");
  });

  it("[Caso 2 — Flujo alterno] 15/30 alumnos cargados → 'Carga parcial'", () => {
    expect(computeGradesStatus(15, 30)).toBe("Carga parcial");
  });

  it("[Caso 3 — Caso límite: nadie cargado] 0/30 → 'Sin cargar'", () => {
    expect(computeGradesStatus(0, 30)).toBe("Sin cargar");
  });

  it("[Caso 4 — Caso límite: sin alumnos matriculados] 0/0 → 'Sin cargar'", () => {
    // totalEnrollments = 0: no hay alumnos en la sección → estado sin cargar.
    expect(computeGradesStatus(0, 0)).toBe("Sin cargar");
  });

  it("[Caso 5 — Manejo de error] totalEnrollments negativo → 'Sin cargar'", () => {
    // Se defiende ante datos corruptos de la BD.
    expect(computeGradesStatus(5, -1)).toBe("Sin cargar");
  });

  it("[Caso 6 — Límite superior] loadedCount > totalEnrollments → 'Completo'", () => {
    // Dato de BD inconsistente: más notas que alumnos. Se trata como Completo.
    expect(computeGradesStatus(32, 30)).toBe("Completo");
  });

  it("[Caso 7 — loadedCount = 1 (mínimo parcial)] 1/30 → 'Carga parcial'", () => {
    expect(computeGradesStatus(1, 30)).toBe("Carga parcial");
  });

  it("[Caso 8 — 1 alumno, 1 nota cargada] 1/1 → 'Completo'", () => {
    expect(computeGradesStatus(1, 1)).toBe("Completo");
  });
});
