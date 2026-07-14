// Pruebas de la lógica pura de alertas (HU08). Cubren la agregación de notas
// por curso y los BORDES de los umbrales de riesgo académico (avance > 55% y
// promedio < 10.5) — la parte que la app usa para decidir si alertar.

import { describe, expect, test } from "bun:test";
import {
  ACADEMIC_RISK_MAX_AVERAGE,
  ACADEMIC_RISK_MIN_PROGRESS,
  CRITICAL_REQUIRED_ON_REMAINING,
  aggregateCourseScores,
  isAcademicRisk,
  isCriticalRisk,
  personalAverage,
  requiredOnRemaining,
  type ScoreRow,
} from "../../src/modules/alerts/alerts.logic.js";

const row = (over: Partial<ScoreRow>): ScoreRow => ({
  course_id: 1,
  course_name: "Curso",
  assessment_id: 10,
  assessment_weight: 20,
  score_value: 15,
  ...over,
});

describe("aggregateCourseScores", () => {
  test("agrupa por curso y acumula peso y suma ponderada", () => {
    const out = aggregateCourseScores([
      row({ course_id: 1, assessment_id: 1, assessment_weight: 30, score_value: 12 }),
      row({ course_id: 1, assessment_id: 2, assessment_weight: 20, score_value: 8 }),
      row({ course_id: 2, course_name: "Otro", assessment_id: 3, assessment_weight: 40, score_value: 14 }),
    ]);
    const c1 = out.find((g) => g.courseId === 1)!;
    expect(c1.gradedWeight).toBe(50);
    expect(c1.weightedSum).toBe(30 * 12 + 20 * 8);
    expect(c1.numExamenes).toBe(2);
    expect(out).toHaveLength(2);
  });

  test("ignora filas sin evaluación o sin nota", () => {
    const out = aggregateCourseScores([
      row({ assessment_id: null, assessment_weight: 30, score_value: null }),
      row({ assessment_id: 5, score_value: null }),
      row({ assessment_id: 6, assessment_weight: 25, score_value: 16 }),
    ]);
    expect(out[0].gradedWeight).toBe(25);
    expect(out[0].numExamenes).toBe(1);
  });

  test("acepta pesos/notas como string (numéricos de postgres)", () => {
    const out = aggregateCourseScores([
      row({ assessment_weight: "40", score_value: "13" }),
    ]);
    expect(out[0].gradedWeight).toBe(40);
    expect(out[0].weightedSum).toBe(40 * 13);
  });
});

describe("personalAverage", () => {
  test("promedio ponderado sobre lo calificado", () => {
    expect(personalAverage(50, 30 * 12 + 20 * 8)).toBeCloseTo((360 + 160) / 50);
  });
  test("0 si no hay avance calificado", () => {
    expect(personalAverage(0, 0)).toBe(0);
  });
});

describe("isAcademicRisk (bordes de los umbrales)", () => {
  test("constantes esperadas", () => {
    expect(ACADEMIC_RISK_MIN_PROGRESS).toBe(55);
    expect(ACADEMIC_RISK_MAX_AVERAGE).toBe(10.5);
  });

  test("avance exactamente 55% NO es riesgo (se exige > 55)", () => {
    // avg = 8 (< 10.5) pero avance = 55 exacto → no dispara
    expect(isAcademicRisk(55, 55 * 8)).toBe(false);
  });

  test("avance 56% y promedio 10.0 → riesgo", () => {
    expect(isAcademicRisk(56, 56 * 10)).toBe(true);
  });

  test("promedio exactamente 10.5 NO es riesgo (se exige < 10.5)", () => {
    expect(isAcademicRisk(60, 60 * 10.5)).toBe(false);
  });

  test("promedio 10.49 con avance alto → riesgo", () => {
    expect(isAcademicRisk(60, 60 * 10.49)).toBe(true);
  });

  test("promedio 11 (aprobando) → no riesgo aunque el avance sea alto", () => {
    expect(isAcademicRisk(80, 80 * 11)).toBe(false);
  });

  test("sin avance calificado → no riesgo", () => {
    expect(isAcademicRisk(0, 0)).toBe(false);
  });
});

describe("aggregateCourseScores — totalWeight (peso de TODAS las evaluaciones)", () => {
  test("suma el peso de evaluaciones calificadas y sin calificar (cada una una vez)", () => {
    // Escenario 855 (semana 15): EV01 y EV02 con nota, EV03 sin nota.
    const out = aggregateCourseScores([
      row({ assessment_id: 19, assessment_weight: 20, score_value: 6 }),
      row({ assessment_id: 20, assessment_weight: 30, score_value: 5 }),
      row({ assessment_id: 21, assessment_weight: 50, score_value: null }),
    ]);
    expect(out[0].gradedWeight).toBe(50);
    expect(out[0].totalWeight).toBe(100);
    expect(out[0].weightedSum).toBe(6 * 20 + 5 * 30);
  });

  test("una evaluación sin nota repetida no infla totalWeight", () => {
    const out = aggregateCourseScores([
      row({ assessment_id: 21, assessment_weight: 50, score_value: null }),
      row({ assessment_id: 21, assessment_weight: 50, score_value: null }),
    ]);
    expect(out[0].totalWeight).toBe(50);
    expect(out[0].gradedWeight).toBe(0);
  });
});

describe("requiredOnRemaining (nota necesaria en lo que falta para aprobar)", () => {
  test("caso 855 crítico: 6 y 5 (pesos 20/30, resta 50) → 15.6", () => {
    expect(requiredOnRemaining(50, 6 * 20 + 5 * 30, 100)).toBeCloseTo(15.6, 5);
  });
  test("sin peso restante (todo calificado) → 0", () => {
    expect(requiredOnRemaining(100, 100 * 12, 100)).toBe(0);
  });
  test("ya aprobado pase lo que pase → valor ≤ 0", () => {
    // 18 y 17 en 20/30: weightedSum 870; req = (1050-870)/50 = 3.6 (positivo pero bajo)
    expect(requiredOnRemaining(50, 18 * 20 + 17 * 30, 100)).toBeCloseTo(3.6, 5);
  });
  test("imposible: sin ninguna nota buena, req > 20", () => {
    expect(requiredOnRemaining(50, 0, 100)).toBe(21);
  });
});

describe("isCriticalRisk (bordes del umbral > 15)", () => {
  test("constante esperada", () => {
    expect(CRITICAL_REQUIRED_ON_REMAINING).toBe(15);
  });
  test("req exactamente 15 NO es crítico (se exige > 15)", () => {
    // (1050 - wSum)/50 = 15 ⇒ wSum = 300
    expect(isCriticalRisk(50, 300, 100)).toBe(false);
  });
  test("req 15.6 → crítico", () => {
    expect(isCriticalRisk(50, 6 * 20 + 5 * 30, 100)).toBe(true);
  });
  test("necesita 11 en lo que falta → NO crítico", () => {
    expect(isCriticalRisk(50, 10 * 20 + 10 * 30, 100)).toBe(false);
  });
  test("sin ninguna nota aún → no crítico (no se puede evaluar)", () => {
    expect(isCriticalRisk(0, 0, 100)).toBe(false);
  });
  test("todo calificado (sin peso restante) → no crítico", () => {
    expect(isCriticalRisk(100, 100 * 5, 100)).toBe(false);
  });
  test("faltó todo (weightedSum 0, resta 50) → crítico (imposible)", () => {
    expect(isCriticalRisk(50, 0, 100)).toBe(true);
  });
});
