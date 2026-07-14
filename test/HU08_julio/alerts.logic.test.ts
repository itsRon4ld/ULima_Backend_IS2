// Pruebas de la lógica pura de alertas (HU08). Cubren la agregación de notas
// por curso y los BORDES de los umbrales de riesgo académico (avance > 55% y
// promedio < 10.5) — la parte que la app usa para decidir si alertar.

import { describe, expect, test } from "bun:test"; // marco de pruebas de Bun: describe agrupa, test define un caso, expect afirma
import {
  ACADEMIC_RISK_MAX_AVERAGE, // umbral: promedio personal por debajo del cual hay riesgo (10.5)
  ACADEMIC_RISK_MIN_PROGRESS, // umbral: avance calificado por encima del cual se evalúa el riesgo (55)
  CRITICAL_REQUIRED_ON_REMAINING, // umbral: nota necesaria en lo restante sobre la cual el riesgo es crítico (15)
  aggregateCourseScores, // función que agrupa filas de notas por curso y acumula pesos/sumas
  isAcademicRisk, // función que decide si un curso está en riesgo académico
  isCriticalRisk, // función que decide si un curso está en riesgo CRÍTICO
  personalAverage, // función que calcula el promedio ponderado sobre lo calificado
  requiredOnRemaining, // función que calcula qué nota se necesita en lo que falta para aprobar
  type ScoreRow, // tipo de una fila de nota (curso, evaluación, peso, valor)
} from "../../src/modules/alerts/alerts.logic.js"; // SUT: lógica pura de alertas, sin BD ni efectos

/*
 * ============================================================================
 * PRUEBA UNITARIA — aggregateCourseScores(), personalAverage(),
 *                   isAcademicRisk(), requiredOnRemaining(), isCriticalRisk()
 *                   (HU08: alertas de riesgo académico)
 * Fuente: src/modules/alerts/alerts.logic.ts:37-113
 * ============================================================================
 * Qué valida: la lógica pura (sin BD, sin HTTP) que la app usa para decidir si
 * un alumno está en riesgo. Se prueban por separado las 5 funciones puras y,
 * sobre todo, los BORDES exactos de sus umbrales (frontera '>' vs '>=', etc.),
 * porque un error de un solo punto cambia a quién se alerta.
 *
 * Constantes bajo prueba:
 *   ACADEMIC_RISK_MIN_PROGRESS = 55   (avance evaluado, se exige > 55)
 *   ACADEMIC_RISK_MAX_AVERAGE  = 10.5 (promedio personal, se exige < 10.5)
 *   CRITICAL_REQUIRED_ON_REMAINING = 15 (nota en lo restante, se exige > 15)
 *
 * Casos:
 *   aggregateCourseScores: agrupa por curso y acumula peso/suma; ignora filas
 *     sin evaluación o sin nota; acepta pesos/notas como string (numeric de PG);
 *     totalWeight suma el peso de TODAS las evaluaciones (calificadas o no) sin
 *     contar dos veces una misma evaluación repetida.
 *   personalAverage: promedio ponderado sobre lo calificado; 0 sin avance.
 *   isAcademicRisk: bordes de los umbrales (55 exacto no dispara, 56 sí; 10.5
 *     exacto no dispara, 10.49 sí; aprobando no dispara; sin avance no dispara).
 *   requiredOnRemaining: nota necesaria en lo que falta (caso 855, todo
 *     calificado → 0, ya aprobado → bajo, imposible → >20).
 *   isCriticalRisk: bordes del umbral > 15 (15 exacto no, 15.6 sí, 11 no, sin
 *     nota no, todo calificado no, faltó todo sí).
 */

// Helper/fixture: crea una fila de nota con valores por defecto y permite
// sobrescribir solo los campos que importan a cada test (patrón "override").
const row = (over: Partial<ScoreRow>): ScoreRow => ({
  course_id: 1, // curso por defecto (id 1)
  course_name: "Curso", // nombre por defecto del curso
  assessment_id: 10, // id de evaluación por defecto (no null => cuenta para totalWeight)
  assessment_weight: 20, // peso por defecto de la evaluación (%)
  score_value: 15, // nota por defecto (0..20)
  ...over, // cada test reemplaza solo los campos que le interesan
});

describe("aggregateCourseScores", () => {
  test("agrupa por curso y acumula peso y suma ponderada", () => {
    const out = aggregateCourseScores([ // agrega 3 filas: dos del curso 1, una del curso 2
      row({ course_id: 1, assessment_id: 1, assessment_weight: 30, score_value: 12 }), // curso 1, eval 1
      row({ course_id: 1, assessment_id: 2, assessment_weight: 20, score_value: 8 }), // curso 1, eval 2
      row({ course_id: 2, course_name: "Otro", assessment_id: 3, assessment_weight: 40, score_value: 14 }), // curso 2
    ]);
    const c1 = out.find((g) => g.courseId === 1)!; // localiza el agregado del curso 1
    expect(c1.gradedWeight).toBe(50); // verifica que el peso calificado sea 30 + 20 = 50
    expect(c1.weightedSum).toBe(30 * 12 + 20 * 8); // verifica la suma ponderada nota*peso (360 + 160)
    expect(c1.numExamenes).toBe(2); // verifica que cuente 2 evaluaciones calificadas
    expect(out).toHaveLength(2); // verifica que se hayan formado exactamente 2 grupos (curso 1 y curso 2)
  });

  test("ignora filas sin evaluación o sin nota", () => {
    const out = aggregateCourseScores([ // agrega 3 filas del mismo curso, dos "vacías"
      row({ assessment_id: null, assessment_weight: 30, score_value: null }), // sin evaluación (id null) => se ignora del todo
      row({ assessment_id: 5, score_value: null }), // con evaluación pero sin nota => no suma a gradedWeight
      row({ assessment_id: 6, assessment_weight: 25, score_value: 16 }), // única fila calificada válida
    ]);
    expect(out[0].gradedWeight).toBe(25); // verifica que solo el peso de la fila calificada (25) cuente
    expect(out[0].numExamenes).toBe(1); // verifica que solo se cuente 1 evaluación calificada
  });

  test("acepta pesos/notas como string (numéricos de postgres)", () => {
    const out = aggregateCourseScores([ // postgres devuelve numeric como string; debe convertir
      row({ assessment_weight: "40", score_value: "13" }), // peso y nota vienen como texto
    ]);
    expect(out[0].gradedWeight).toBe(40); // verifica que "40" se convierta a número 40
    expect(out[0].weightedSum).toBe(40 * 13); // verifica que "13" se convierta y la suma ponderada sea 520
  });
});

describe("personalAverage", () => {
  test("promedio ponderado sobre lo calificado", () => {
    expect(personalAverage(50, 30 * 12 + 20 * 8)).toBeCloseTo((360 + 160) / 50); // verifica promedio = sumaPonderada / pesoCalificado (520/50 = 10.4)
  });
  test("0 si no hay avance calificado", () => {
    expect(personalAverage(0, 0)).toBe(0); // verifica que sin peso calificado el promedio sea 0 (no división por cero)
  });
});

describe("isAcademicRisk (bordes de los umbrales)", () => {
  test("constantes esperadas", () => {
    expect(ACADEMIC_RISK_MIN_PROGRESS).toBe(55); // verifica que el umbral de avance sea 55
    expect(ACADEMIC_RISK_MAX_AVERAGE).toBe(10.5); // verifica que el umbral de promedio sea 10.5
  });

  test("avance exactamente 55% NO es riesgo (se exige > 55)", () => {
    // avg = 8 (< 10.5) pero avance = 55 exacto → no dispara
    expect(isAcademicRisk(55, 55 * 8)).toBe(false); // verifica frontera '>': 55 exacto no es riesgo aunque el promedio sea bajo
  });

  test("avance 56% y promedio 10.0 → riesgo", () => {
    expect(isAcademicRisk(56, 56 * 10)).toBe(true); // verifica que con avance > 55 y promedio < 10.5 sí hay riesgo
  });

  test("promedio exactamente 10.5 NO es riesgo (se exige < 10.5)", () => {
    expect(isAcademicRisk(60, 60 * 10.5)).toBe(false); // verifica frontera '<': promedio 10.5 exacto no es riesgo
  });

  test("promedio 10.49 con avance alto → riesgo", () => {
    expect(isAcademicRisk(60, 60 * 10.49)).toBe(true); // verifica que un pelo por debajo (10.49) sí dispara el riesgo
  });

  test("promedio 11 (aprobando) → no riesgo aunque el avance sea alto", () => {
    expect(isAcademicRisk(80, 80 * 11)).toBe(false); // verifica que aprobando (promedio 11) no hay riesgo aunque el avance sea alto
  });

  test("sin avance calificado → no riesgo", () => {
    expect(isAcademicRisk(0, 0)).toBe(false); // verifica que sin avance (0) no se marque riesgo (avance no supera 55)
  });
});

describe("aggregateCourseScores — totalWeight (peso de TODAS las evaluaciones)", () => {
  test("suma el peso de evaluaciones calificadas y sin calificar (cada una una vez)", () => {
    // Escenario 855 (semana 15): EV01 y EV02 con nota, EV03 sin nota.
    const out = aggregateCourseScores([
      row({ assessment_id: 19, assessment_weight: 20, score_value: 6 }), // EV01 calificada (peso 20, nota 6)
      row({ assessment_id: 20, assessment_weight: 30, score_value: 5 }), // EV02 calificada (peso 30, nota 5)
      row({ assessment_id: 21, assessment_weight: 50, score_value: null }), // EV03 sin nota (peso 50) => solo suma a totalWeight
    ]);
    expect(out[0].gradedWeight).toBe(50); // verifica que el peso calificado sean solo EV01+EV02 (20+30)
    expect(out[0].totalWeight).toBe(100); // verifica que el peso total incluya también EV03 (20+30+50)
    expect(out[0].weightedSum).toBe(6 * 20 + 5 * 30); // verifica la suma ponderada solo de lo calificado (120 + 150)
  });

  test("una evaluación sin nota repetida no infla totalWeight", () => {
    const out = aggregateCourseScores([ // misma evaluación (id 21) aparece dos veces
      row({ assessment_id: 21, assessment_weight: 50, score_value: null }), // EV21 sin nota (1ª aparición)
      row({ assessment_id: 21, assessment_weight: 50, score_value: null }), // EV21 sin nota repetida (no debe contar de nuevo)
    ]);
    expect(out[0].totalWeight).toBe(50); // verifica que la evaluación repetida cuente su peso una sola vez (50, no 100)
    expect(out[0].gradedWeight).toBe(0); // verifica que sin nota no aporte a gradedWeight
  });
});

describe("requiredOnRemaining (nota necesaria en lo que falta para aprobar)", () => {
  test("caso 855 crítico: 6 y 5 (pesos 20/30, resta 50) → 15.6", () => {
    expect(requiredOnRemaining(50, 6 * 20 + 5 * 30, 100)).toBeCloseTo(15.6, 5); // verifica (10.5*100 - 270)/50 = 15.6: se necesita casi imposible
  });
  test("sin peso restante (todo calificado) → 0", () => {
    expect(requiredOnRemaining(100, 100 * 12, 100)).toBe(0); // verifica que si no queda peso por calificar la necesidad sea 0
  });
  test("ya aprobado pase lo que pase → valor ≤ 0", () => {
    // 18 y 17 en 20/30: weightedSum 870; req = (1050-870)/50 = 3.6 (positivo pero bajo)
    expect(requiredOnRemaining(50, 18 * 20 + 17 * 30, 100)).toBeCloseTo(3.6, 5); // verifica que con notas altas la nota requerida en lo restante sea baja (3.6)
  });
  test("imposible: sin ninguna nota buena, req > 20", () => {
    expect(requiredOnRemaining(50, 0, 100)).toBe(21); // verifica (10.5*100 - 0)/50 = 21: por encima de 20, aprobar es imposible
  });
});

describe("isCriticalRisk (bordes del umbral > 15)", () => {
  test("constante esperada", () => {
    expect(CRITICAL_REQUIRED_ON_REMAINING).toBe(15); // verifica que el umbral de criticidad sea 15
  });
  test("req exactamente 15 NO es crítico (se exige > 15)", () => {
    // (1050 - wSum)/50 = 15 ⇒ wSum = 300
    expect(isCriticalRisk(50, 300, 100)).toBe(false); // verifica frontera '>': si la necesidad es 15 exacta no es crítico
  });
  test("req 15.6 → crítico", () => {
    expect(isCriticalRisk(50, 6 * 20 + 5 * 30, 100)).toBe(true); // verifica que necesitar 15.6 (> 15) sí sea crítico (caso 855)
  });
  test("necesita 11 en lo que falta → NO crítico", () => {
    expect(isCriticalRisk(50, 10 * 20 + 10 * 30, 100)).toBe(false); // verifica que necesitar ~11 (< 15) no sea crítico
  });
  test("sin ninguna nota aún → no crítico (no se puede evaluar)", () => {
    expect(isCriticalRisk(0, 0, 100)).toBe(false); // verifica la guarda: sin nota calificada (gradedWeight 0) no se evalúa criticidad
  });
  test("todo calificado (sin peso restante) → no crítico", () => {
    expect(isCriticalRisk(100, 100 * 5, 100)).toBe(false); // verifica la guarda: sin peso restante ya es aprobó/reprobó, no "necesita X"
  });
  test("faltó todo (weightedSum 0, resta 50) → crítico (imposible)", () => {
    expect(isCriticalRisk(50, 0, 100)).toBe(true); // verifica que con avance calificado pero suma 0 la necesidad (21) supere 15 => crítico
  });
});
