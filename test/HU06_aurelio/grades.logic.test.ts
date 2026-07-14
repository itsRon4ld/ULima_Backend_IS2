import { describe, expect, test } from "bun:test";
import { calcularPromedioPonderado, sumaDePesos } from "../../src/modules/grades/grades.logic.js";
import type { NotaInput } from "../../src/modules/grades/grades.types.js";

const n = (over: Partial<NotaInput>): NotaInput => ({ valor: 15, peso: 30, ...over });

describe("calcularPromedioPonderado", () => {
  test("lista vacia -> 0", () => {
    expect(calcularPromedioPonderado([])).toBe(0);
  });

  test("una nota al 100% -> la propia nota", () => {
    expect(calcularPromedioPonderado([n({ valor: 15, peso: 100 })])).toBeCloseTo(15.0, 9);
  });

  test("ponderado de varias evaluaciones", () => {
    // 12*0.3 + 16*0.5 + 8*0.2 = 3.6 + 8.0 + 1.6 = 13.2
    const promedio = calcularPromedioPonderado([
      n({ valor: 12, peso: 30 }),
      n({ valor: 16, peso: 50 }),
      n({ valor: 8, peso: 20 }),
    ]);
    expect(promedio).toBeCloseTo(13.2, 9);
  });

  test("avance parcial (pesos que no suman 100)", () => {
    expect(calcularPromedioPonderado([n({ valor: 14, peso: 50 })])).toBeCloseTo(7.0, 9);
  });
});

describe("sumaDePesos", () => {
  test("suma los pesos ingresados", () => {
    expect(sumaDePesos([n({ peso: 30 }), n({ peso: 50 })])).toBeCloseTo(80.0, 9);
  });

  test("lista vacia -> 0", () => {
    expect(sumaDePesos([])).toBe(0);
  });
});
