// Pruebas de la lógica pura de estadísticas del salón (HU11): promedio
// ponderado por alumno, promedio general, % de aprobados e histograma.

import { describe, expect, test } from "bun:test"; // runner de Bun: describe agrupa, test define caso, expect asevera
import {
  PASSING_GRADE, // constante de nota aprobatoria (10.5) que reusamos para no "quemar" el número
  computeSectionStatistics, // función pura bajo prueba (SUT): recibe filas de notas y devuelve estadísticas
  type StatScoreRow, // tipo de una fila de nota (enrollment_id, weight, value) para tipar el helper
} from "../../src/modules/section-management/section-statistics.logic.js";

/*
 * ============================================================================
 * PRUEBA UNITARIA — computeSectionStatistics() (HU11: estadísticas del salón)
 * Fuente: src/modules/section-management/section-statistics.logic.ts:41-74
 * ============================================================================
 * Qué valida: la lógica PURA (sin BD ni efectos) que, a partir de las notas
 * OFICIALES ya calificadas (student_score), calcula por salón:
 *   - promedioGeneral    = media de los promedios ponderados por alumno.
 *   - porcentajeAprobados = % de alumnos con promedio >= PASSING_GRADE (10.5).
 *   - histograma          = conteo por rango de la nota REDONDEADA
 *                           (0-10, 11-13, 14-16, 17-20).
 * Reglas clave que se ejercitan:
 *   - Por alumno el promedio se pondera SOLO sobre el peso ya calificado
 *     (Σ nota·peso / Σ peso); las evaluaciones con value=null se ignoran.
 *   - Si ningún alumno tiene notas, todas las métricas son 0.
 *   - La aprobación usa '>=' (10.5 exacto aprueba).
 *   - Acepta weight/value como string (numéricos de PostgreSQL) vía Number().
 *
 * Casos:
 *   1) sin filas -> todas las métricas en 0.
 *   2) filas con value=null -> no cuentan -> todo en 0.
 *   3) un alumno (18,17) -> promedio ponderado 17.4, aprueba, cae en 17-20.
 *   4) EV02 sin nota -> promedio solo sobre EV01 (peso ya calificado).
 *   5) borde aprobatoria: promedio 10.5 exacto aprueba (>=).
 *   6) escenario 855 (5 alumnos) -> histograma, % aprobados y media general.
 *   7) pesos/notas como string -> se parsean con Number() correctamente.
 */

// Helper/fixture: arma las 2 filas (EV01 peso 20, EV02 peso 30) de UN alumno.
// enr = enrollment_id (identifica al alumno); ev01/ev02 = nota de cada evaluación (null = aún sin calificar).
const alumno = (enr: number, ev01: number | null, ev02: number | null): StatScoreRow[] => [
  { enrollment_id: enr, weight: 20, value: ev01 }, // EV01 pesa 20% de lo calificado
  { enrollment_id: enr, weight: 30, value: ev02 }, // EV02 pesa 30% de lo calificado
];

describe("computeSectionStatistics", () => {
  test("sin filas → todo en 0", () => {
    // Caso vacío: sin alumnos con notas, la función retorna el objeto "cero".
    expect(computeSectionStatistics([])).toEqual({
      promedioGeneral: 0, // verifica que la media general sea 0 cuando no hay datos
      porcentajeAprobados: 0, // verifica que el % de aprobados sea 0 (nadie a quien contar)
      rango0_10: 0, // verifica que el histograma esté vacío en 0-10
      rango11_13: 0, // verifica que el histograma esté vacío en 11-13
      rango14_16: 0, // verifica que el histograma esté vacío en 14-16
      rango17_20: 0, // verifica que el histograma esté vacío en 17-20
    });
  });

  test("evaluaciones sin nota (value null) no cuentan → todo en 0", () => {
    // Alumno con ambas evaluaciones sin calificar (null): debe ignorarse por completo.
    expect(computeSectionStatistics(alumno(1, null, null)).rango0_10).toBe(0); // verifica que un alumno sin notas NO aparezca en el histograma
    expect(computeSectionStatistics(alumno(1, null, null)).promedioGeneral).toBe(0); // verifica que sin notas la media general siga en 0
  });

  test("un alumno: promedio ponderado sobre lo calificado (18,17 → 17.4)", () => {
    const s = computeSectionStatistics(alumno(1, 18, 17)); // un solo alumno con ambas evaluaciones calificadas
    // (18*20 + 17*30) / 50 = 870/50 = 17.4
    expect(s.promedioGeneral).toBeCloseTo(17.4, 5); // verifica el promedio ponderado exacto (17.4) con 5 decimales de tolerancia
    expect(s.porcentajeAprobados).toBe(100); // verifica que el único alumno (17.4 >= 10.5) da 100% de aprobados
    expect(s.rango17_20).toBe(1); // verifica que 17.4 redondeado (17) cae en el rango 17-20
  });

  test("solo cuenta el peso YA calificado (EV02 sin nota) para el promedio del alumno", () => {
    // EV01=12 (peso 20), EV02 sin nota → promedio = 12 (12*20/20)
    const s = computeSectionStatistics(alumno(1, 12, null)); // EV02 en null: solo el peso 20 de EV01 se pondera
    expect(s.promedioGeneral).toBeCloseTo(12, 5); // verifica que el promedio use SOLO lo calificado (12, no diluido por EV02)
    expect(s.rango11_13).toBe(1); // verifica que 12 cae en el rango 11-13
  });

  test("borde aprobatoria: promedio exactamente 10.5 aprueba (≥)", () => {
    // nota 10.5 en ambas → promedio 10.5
    const s = computeSectionStatistics(alumno(1, 10.5, 10.5)); // caso límite: promedio justo en el umbral
    expect(PASSING_GRADE).toBe(10.5); // verifica que la constante de aprobación es 10.5 (documenta el umbral)
    expect(s.porcentajeAprobados).toBe(100); // verifica que 10.5 exacto SÍ aprueba (comparación con '>=', no '>')
  });

  test("escenario 855 (subconjunto): promedios, % aprobados e histograma", () => {
    const rows = [
      ...alumno(1, 18, 17), // 17.4 → 17-20, aprueba
      ...alumno(2, 15, 16), // 15.6 → 14-16, aprueba
      ...alumno(3, 12, 13), // 12.6 → 11-13, aprueba
      ...alumno(4, 6, 5),   //  5.4 → 0-10, jala
      ...alumno(5, 4, 5),   //  4.6 → 0-10, jala
    ]; // 5 alumnos con un promedio en cada rango (dos jalados) para cubrir todo el histograma
    const s = computeSectionStatistics(rows); // corre la lógica sobre las 10 filas (2 por alumno)
    expect(s.rango17_20).toBe(1); // verifica que hay 1 alumno (17.4) en el rango más alto
    expect(s.rango14_16).toBe(1); // verifica que hay 1 alumno (15.6) en 14-16
    expect(s.rango11_13).toBe(1); // verifica que hay 1 alumno (12.6) en 11-13
    expect(s.rango0_10).toBe(2); // verifica que hay 2 alumnos jalados (5.4 y 4.6) en 0-10
    // 3 de 5 aprueban
    expect(s.porcentajeAprobados).toBe(60); // verifica el % de aprobados (3/5 = 60%)
    // media de (17.4, 15.6, 12.6, 5.4, 4.6) = 55.6/5 = 11.12
    expect(s.promedioGeneral).toBeCloseTo(11.12, 5); // verifica la media general de los 5 promedios (11.12)
  });

  test("acepta pesos/notas como string (numéricos de postgres)", () => {
    const s = computeSectionStatistics([
      { enrollment_id: 1, weight: "20", value: "16" }, // weight/value como string: así llegan los numéricos de PostgreSQL
      { enrollment_id: 1, weight: "30", value: "14" }, // segunda evaluación, también en string
    ]);
    // (16*20 + 14*30)/50 = (320+420)/50 = 14.8
    expect(s.promedioGeneral).toBeCloseTo(14.8, 5); // verifica que Number() convierte los strings y el promedio pondera bien (14.8)
    expect(s.rango14_16).toBe(1); // verifica que 14.8 redondeado (15) cae en el rango 14-16
  });
});
