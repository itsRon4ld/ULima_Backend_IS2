// Pruebas de la lógica pura de estadísticas del salón (HU11): promedio
// ponderado por alumno, promedio general, % de aprobados e histograma.

import { describe, expect, test } from "bun:test";
import {
  PASSING_GRADE,
  computeSectionStatistics,
  type StatScoreRow,
} from "../../src/modules/section-management/section-statistics.logic.js";

// Helper: filas (enrollment, EV01 peso 20, EV02 peso 30) para un alumno.
const alumno = (enr: number, ev01: number | null, ev02: number | null): StatScoreRow[] => [
  { enrollment_id: enr, weight: 20, value: ev01 },
  { enrollment_id: enr, weight: 30, value: ev02 },
];

describe("computeSectionStatistics", () => {
  test("sin filas → todo en 0", () => {
    expect(computeSectionStatistics([])).toEqual({
      promedioGeneral: 0,
      porcentajeAprobados: 0,
      rango0_10: 0,
      rango11_13: 0,
      rango14_16: 0,
      rango17_20: 0,
    });
  });

  test("evaluaciones sin nota (value null) no cuentan → todo en 0", () => {
    expect(computeSectionStatistics(alumno(1, null, null)).rango0_10).toBe(0);
    expect(computeSectionStatistics(alumno(1, null, null)).promedioGeneral).toBe(0);
  });

  test("un alumno: promedio ponderado sobre lo calificado (18,17 → 17.4)", () => {
    const s = computeSectionStatistics(alumno(1, 18, 17));
    // (18*20 + 17*30) / 50 = 870/50 = 17.4
    expect(s.promedioGeneral).toBeCloseTo(17.4, 5);
    expect(s.porcentajeAprobados).toBe(100);
    expect(s.rango17_20).toBe(1);
  });

  test("solo cuenta el peso YA calificado (EV02 sin nota) para el promedio del alumno", () => {
    // EV01=12 (peso 20), EV02 sin nota → promedio = 12 (12*20/20)
    const s = computeSectionStatistics(alumno(1, 12, null));
    expect(s.promedioGeneral).toBeCloseTo(12, 5);
    expect(s.rango11_13).toBe(1);
  });

  test("borde aprobatoria: promedio exactamente 10.5 aprueba (≥)", () => {
    // nota 10.5 en ambas → promedio 10.5
    const s = computeSectionStatistics(alumno(1, 10.5, 10.5));
    expect(PASSING_GRADE).toBe(10.5);
    expect(s.porcentajeAprobados).toBe(100);
  });

  test("escenario 855 (subconjunto): promedios, % aprobados e histograma", () => {
    const rows = [
      ...alumno(1, 18, 17), // 17.4 → 17-20, aprueba
      ...alumno(2, 15, 16), // 15.6 → 14-16, aprueba
      ...alumno(3, 12, 13), // 12.6 → 11-13, aprueba
      ...alumno(4, 6, 5),   //  5.4 → 0-10, jala
      ...alumno(5, 4, 5),   //  4.6 → 0-10, jala
    ];
    const s = computeSectionStatistics(rows);
    expect(s.rango17_20).toBe(1);
    expect(s.rango14_16).toBe(1);
    expect(s.rango11_13).toBe(1);
    expect(s.rango0_10).toBe(2);
    // 3 de 5 aprueban
    expect(s.porcentajeAprobados).toBe(60);
    // media de (17.4, 15.6, 12.6, 5.4, 4.6) = 55.6/5 = 11.12
    expect(s.promedioGeneral).toBeCloseTo(11.12, 5);
  });

  test("acepta pesos/notas como string (numéricos de postgres)", () => {
    const s = computeSectionStatistics([
      { enrollment_id: 1, weight: "20", value: "16" },
      { enrollment_id: 1, weight: "30", value: "14" },
    ]);
    // (16*20 + 14*30)/50 = (320+420)/50 = 14.8
    expect(s.promedioGeneral).toBeCloseTo(14.8, 5);
    expect(s.rango14_16).toBe(1);
  });
});
