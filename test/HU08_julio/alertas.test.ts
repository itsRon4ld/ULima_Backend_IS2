/**
 * HU3 – Alertas de Riesgo Académico y Carga de Evaluaciones
 * Archivo : test/alertas-academicas/alertas.test.ts
 * Runner  : bun test (compatible con Jest API)
 *
 * Rúbrica cubierta:
 *   [A] CAJA BLANCA  → AlertsService.getAlertsForStudent() (CC ≥ 5)
 *   [B] CAJA NEGRA   → EnrollmentWithScore payloads con > 4 campos de entrada
 *   [C] UNIT TESTS   → aggregateCourseScores, personalAverage, isAcademicRisk (≥ 4 casos)
 *
 * Umbrales del sistema (alerts.logic.ts):
 *   ACADEMIC_RISK_MIN_PROGRESS = 55  (avance evaluado en %)
 *   ACADEMIC_RISK_MAX_AVERAGE  = 10.5 (promedio personal /20)
 *   HIGH_LOAD_THRESHOLD        = 3   (evaluaciones por semana)
 */

import { describe, test, expect, mock } from "bun:test";
import {
  aggregateCourseScores,
  isAcademicRisk,
  personalAverage,
  ACADEMIC_RISK_MIN_PROGRESS,
  ACADEMIC_RISK_MAX_AVERAGE,
  type ScoreRow,
} from "../../src/modules/alerts/alerts.logic.js";
import { AlertsService } from "../../src/modules/alerts/alerts.service.js";
import type { EnrollmentWithScore, StoredAlert } from "../../src/modules/alerts/alerts.repository.js";

// ---------------------------------------------------------------------------
// Helpers de fixtures
// ---------------------------------------------------------------------------
const makeEnrollment = (over: Partial<EnrollmentWithScore> = {}): EnrollmentWithScore => ({
  enrollment_id: 1,
  course_id: 100,
  course_name: "Cálculo I",
  section_code: "SEC-01",
  assessment_id: 10,
  assessment_weight: "30",
  score_value: "8",
  ...over,
});

const makeStoredAlert = (over: Partial<StoredAlert> = {}): StoredAlert => ({
  id: 1,
  studentId: 1,
  type: "academic_risk",
  title: "Riesgo Académico: Cálculo I",
  message: "Tu promedio es bajo",
  isRead: false,
  createdAt: new Date("2026-07-01"),
  ...over,
});

const makeScoreRow = (over: Partial<ScoreRow> = {}): ScoreRow => ({
  course_id: 1,
  course_name: "Cálculo I",
  assessment_id: 10,
  assessment_weight: 30,
  score_value: 8,
  ...over,
});

// Mock base del repositorio de alertas
const makeRepo = () => ({
  getActiveEnrollmentsWithScores: mock(async () => [] as EnrollmentWithScore[]),
  getHighLoadWeeks: mock(async () => [] as Array<{ week_number: number; assessment_count: number }>),
  getAlerts: mock(async () => [] as StoredAlert[]),
  getActivePeriodStart: mock(async () => null as Date | null),
  findAlertByTitle: mock(async () => false),
  createAlert: mock(async () => undefined),
  markAlertAsRead: mock(async () => true),
});

const makeEvents = () => ({ emit: mock(() => undefined) });

// [A] PRUEBA DE CAJA BLANCA – AlertsService.getAlertsForStudent()
// Complejidad Ciclomática del método:
//   Nodo 1: entrada
//   Nodo 2: for (group of courseGroups)                      → +1
//   Nodo 3:   if isAcademicRisk(...)                         → +1
//   Nodo 4:     if (!exists) → createAlert                   → +1
//   Nodo 5: for (week of highLoadWeeks)                      → +1
//   Nodo 6:   if (!exists) → createAlert                     → +1
//   CC = 1 + 5 = 6  (> 4 ✓)
//
// Caminos cubiertos:
//   Path 1 – sin enrollments ni semanas de alta carga         (loops vacíos)
//   Path 2 – riesgo académico detectado, alerta NO existe     (crea alerta)
//   Path 3 – riesgo académico detectado, alerta YA existe     (no duplica)
//   Path 4 – alta carga detectada, alerta NO existe           (crea alerta)
//   Path 5 – alta carga detectada, alerta YA existe           (no duplica)
//   Path 6 – múltiples cursos: algunos en riesgo, otros no
describe("[CAJA BLANCA] AlertsService.getAlertsForStudent – caminos del grafo de control", () => {

  test("Path 1 – sin enrollments ni semanas cargadas: no crea alertas", async () => {
    const repo = makeRepo();
    const svc = new AlertsService(repo as any, makeEvents() as any);

    await svc.getAlertsForStudent(1);

    expect(repo.createAlert).not.toHaveBeenCalled();
  });

  test("Path 2 – riesgo académico detectado y alerta no existe: crea alerta academic_risk", async () => {
    const repo = makeRepo();
    // avance = 70%, promedio = 8 → riesgo (70 > 55 && 8 < 10.5)
    repo.getActiveEnrollmentsWithScores.mockImplementation(async () => [
      makeEnrollment({ assessment_weight: "70", score_value: "8" }),
    ]);
    repo.findAlertByTitle.mockImplementation(async () => false); // no existe aún
    const svc = new AlertsService(repo as any, makeEvents() as any);

    await svc.getAlertsForStudent(1);

    expect(repo.createAlert).toHaveBeenCalledWith(
      1,
      "academic_risk",
      "Riesgo Académico: Cálculo I",
      expect.stringContaining("Cálculo I"),
    );
  });

  test("Path 3 – riesgo académico detectado pero alerta ya existe: NO duplica", async () => {
    const repo = makeRepo();
    repo.getActiveEnrollmentsWithScores.mockImplementation(async () => [
      makeEnrollment({ assessment_weight: "70", score_value: "8" }),
    ]);
    repo.findAlertByTitle.mockImplementation(async () => true); // ya existe
    const svc = new AlertsService(repo as any, makeEvents() as any);

    await svc.getAlertsForStudent(1);

    expect(repo.createAlert).not.toHaveBeenCalled();
  });

  test("Path 4 – alta carga detectada y alerta no existe: crea alerta high_load", async () => {
    const repo = makeRepo();
    repo.getHighLoadWeeks.mockImplementation(async () => [
      { week_number: 8, assessment_count: 3 },
    ]);
    repo.findAlertByTitle.mockImplementation(async () => false);
    const svc = new AlertsService(repo as any, makeEvents() as any);

    await svc.getAlertsForStudent(1);

    expect(repo.createAlert).toHaveBeenCalledWith(
      1,
      "high_load",
      "Alta Carga: Semana 8",
      expect.stringContaining("3"),
    );
  });

  test("Path 5 – alta carga detectada pero alerta ya existe: NO duplica", async () => {
    const repo = makeRepo();
    repo.getHighLoadWeeks.mockImplementation(async () => [
      { week_number: 8, assessment_count: 4 },
    ]);
    repo.findAlertByTitle.mockImplementation(async () => true); // ya existe
    const svc = new AlertsService(repo as any, makeEvents() as any);

    await svc.getAlertsForStudent(1);

    expect(repo.createAlert).not.toHaveBeenCalled();
  });

  test("Path 6 – múltiples cursos: solo crea alerta para el curso en riesgo", async () => {
    const repo = makeRepo();
    repo.getActiveEnrollmentsWithScores.mockImplementation(async () => [
      // Curso 1: en riesgo (70% avance, promedio 8)
      makeEnrollment({ course_id: 1, course_name: "Cálculo I", assessment_weight: "70", score_value: "8" }),
      // Curso 2: no en riesgo (promedio 15)
      makeEnrollment({ course_id: 2, course_name: "Programación", assessment_weight: "70", score_value: "15" }),
    ]);
    repo.findAlertByTitle.mockImplementation(async () => false);
    const svc = new AlertsService(repo as any, makeEvents() as any);

    await svc.getAlertsForStudent(1);

    // Solo debe crear 1 alerta (Cálculo I), no para Programación
    expect(repo.createAlert).toHaveBeenCalledTimes(1);
    expect(repo.createAlert).toHaveBeenCalledWith(1, "academic_risk", "Riesgo Académico: Cálculo I", expect.any(String));
  });
});

// [B] PRUEBA DE CAJA NEGRA – EnrollmentWithScore payload (> 4 campos)
// Campos del payload EnrollmentWithScore evaluados:
//   1. enrollment_id      – identificador de matrícula
//   2. course_id          – identificador del curso
//   3. course_name        – nombre del curso (se usa para el título de la alerta)
//   4. section_code       – código de sección (puede ser null)
//   5. assessment_id      – null si no hay evaluación → se ignora en agregación
//   6. assessment_weight  – peso de la evaluación (string, numérico)
//   7. score_value        – calificación (string, numérico, null si no calificado)
// Técnica: partición de equivalencia + valores límite de umbrales
describe("[CAJA NEGRA] aggregateCourseScores con payloads EnrollmentWithScore", () => {

  test("BN-1 – payload completo y válido: acumula peso y suma ponderada", () => {
    const rows: ScoreRow[] = [
      makeScoreRow({ course_id: 1, assessment_weight: 40, score_value: 12 }),
      makeScoreRow({ course_id: 1, assessment_weight: 30, score_value: 9 }),
    ];

    const result = aggregateCourseScores(rows);

    expect(result[0].gradedWeight).toBe(70);
    expect(result[0].weightedSum).toBe(40 * 12 + 30 * 9);
    expect(result[0].numExamenes).toBe(2);
  });

  test("BN-2 – assessment_id null: fila ignorada en la agregación", () => {
    const rows: ScoreRow[] = [
      makeScoreRow({ assessment_id: null, assessment_weight: 40, score_value: null }),
      makeScoreRow({ assessment_id: 5, assessment_weight: 30, score_value: 14 }),
    ];

    const result = aggregateCourseScores(rows);

    expect(result[0].gradedWeight).toBe(30);
    expect(result[0].numExamenes).toBe(1);
  });

  test("BN-3 – score_value null (sin calificar): fila ignorada en la agregación", () => {
    const rows: ScoreRow[] = [
      makeScoreRow({ assessment_id: 1, assessment_weight: 50, score_value: null }),
    ];

    const result = aggregateCourseScores(rows);

    expect(result[0].gradedWeight).toBe(0);
    expect(result[0].numExamenes).toBe(0);
  });

  test("BN-4 – peso y nota como string (PostgreSQL los devuelve así): convierte correctamente", () => {
    const rows: ScoreRow[] = [
      makeScoreRow({ assessment_weight: "35", score_value: "11" }),
    ];

    const result = aggregateCourseScores(rows);

    expect(result[0].gradedWeight).toBe(35);
    expect(result[0].weightedSum).toBe(35 * 11);
  });

  test("BN-5 – múltiples cursos en la misma respuesta: agrupa correctamente por course_id", () => {
    const rows: ScoreRow[] = [
      makeScoreRow({ course_id: 1, course_name: "Cálculo I", assessment_weight: 40, score_value: 10 }),
      makeScoreRow({ course_id: 2, course_name: "Física I", assessment_weight: 60, score_value: 8 }),
      makeScoreRow({ course_id: 1, course_name: "Cálculo I", assessment_weight: 30, score_value: 12 }),
    ];

    const result = aggregateCourseScores(rows);

    expect(result).toHaveLength(2);
    const calc = result.find(g => g.courseId === 1)!;
    expect(calc.gradedWeight).toBe(70);
    expect(calc.numExamenes).toBe(2);
  });

  test("BN-6 – valor de avance en el límite exacto (55%): NO debe ser riesgo académico", () => {
    // Borde: gradedWeight === 55 exactamente → isAcademicRisk requiere > 55
    const result = isAcademicRisk(55, 55 * 8); // promedio = 8 < 10.5 pero avance no supera umbral
    expect(result).toBe(false);
  });

  test("BN-7 – avance 55.01% y promedio < 10.5: SÍ es riesgo académico", () => {
    // Superamos el borde por un decimal
    expect(isAcademicRisk(55.01, 55.01 * 10)).toBe(true);
  });
});

// [C] PRUEBAS UNITARIAS – aggregateCourseScores, personalAverage, isAcademicRisk
describe("[UNIT TEST] Lógica pura de alertas académicas (alerts.logic.ts)", () => {

  // --- aggregateCourseScores ---
  test("UT-1 – lista vacía: retorna arreglo vacío", () => {
    expect(aggregateCourseScores([])).toHaveLength(0);
  });

  test("UT-2 – un solo registro válido: grupoId = course_id, numExamenes = 1", () => {
    const result = aggregateCourseScores([makeScoreRow()]);
    expect(result[0].courseId).toBe(1);
    expect(result[0].numExamenes).toBe(1);
  });

  // --- personalAverage ---
  test("UT-3 – gradedWeight = 0: retorna 0 (evita división por cero)", () => {
    expect(personalAverage(0, 0)).toBe(0);
    expect(personalAverage(0, 500)).toBe(0); // weightedSum es ignorado
  });

  test("UT-4 – promedio ponderado correcto: (nota * peso) / peso total", () => {
    // (12 * 30 + 8 * 20) / 50 = (360 + 160) / 50 = 10.4
    expect(personalAverage(50, 520)).toBeCloseTo(10.4);
  });

  // --- isAcademicRisk ---
  test("UT-5 – Escenario 1 HU3: avance > 55% y promedio < 10.5 → RIESGO", () => {
    // avance = 60%, promedio = 10 → es riesgo
    expect(isAcademicRisk(60, 60 * 10)).toBe(true);
  });

  test("UT-6 – promedio exactamente 10.5: NO es riesgo (umbral es estricto < 10.5)", () => {
    expect(isAcademicRisk(60, 60 * 10.5)).toBe(false);
  });

  test("UT-7 – promedio 11 (aprobando): NO es riesgo aunque avance sea alto", () => {
    expect(isAcademicRisk(80, 80 * 11)).toBe(false);
  });

  test("UT-8 – sin avance calificado (0%): NO es riesgo", () => {
    expect(isAcademicRisk(0, 0)).toBe(false);
  });

  // --- markAlertAsRead (AlertsService) ---
  test("UT-9 – markAlertAsRead delegado al repositorio: retorna true si existe", async () => {
    const repo = makeRepo();
    repo.markAlertAsRead.mockImplementation(async () => true);
    const svc = new AlertsService(repo as any, makeEvents() as any);

    const result = await svc.markAlertAsRead(1, 42);

    expect(result).toBe(true);
    expect(repo.markAlertAsRead).toHaveBeenCalledWith(1, 42);
  });

  test("UT-10 – markAlertAsRead: retorna false si la alerta no pertenece al alumno", async () => {
    const repo = makeRepo();
    repo.markAlertAsRead.mockImplementation(async () => false);
    const svc = new AlertsService(repo as any, makeEvents() as any);

    const result = await svc.markAlertAsRead(99, 42);

    expect(result).toBe(false);
  });

  // --- Escenario 2 HU3: Alta carga ---
  test("UT-11 – Escenario 2 HU3: ≥ 3 evaluaciones en misma semana → crea alerta high_load", async () => {
    const repo = makeRepo();
    repo.getHighLoadWeeks.mockImplementation(async () => [
      { week_number: 5, assessment_count: 3 },
    ]);
    repo.findAlertByTitle.mockImplementation(async () => false);
    const svc = new AlertsService(repo as any, makeEvents() as any);

    await svc.getAlertsForStudent(1);

    expect(repo.createAlert).toHaveBeenCalledWith(
      1,
      "high_load",
      "Alta Carga: Semana 5",
      "Tienes 3 evaluaciones programadas en la semana 5 de tu ciclo.",
    );
  });

  test("UT-12 – constantes de umbral no han sido modificadas accidentalmente", () => {
    expect(ACADEMIC_RISK_MIN_PROGRESS).toBe(55);
    expect(ACADEMIC_RISK_MAX_AVERAGE).toBe(10.5);
  });
});
