import { describe, expect, test } from "bun:test";
import { calcularPromedioPonderado, sumaDePesos } from "../../src/modules/grades/grades.logic.js";
import type { NotaInput } from "../../src/modules/grades/grades.types.js";

/**
 * ============================================================================
 * PRUEBA UNITARIA — calcularPromedioPonderado() y sumaDePesos() (HU06: calculadora de notas)
 * Fuente: src/modules/grades/grades.logic.ts:3-14
 * ============================================================================
 * Qué valida: las dos funciones puras que sostienen la calculadora del alumno.
 *   - calcularPromedioPonderado(notas): suma cada valor por su peso/100.
 *       * lista vacía -> 0 (guarda de borde antes del bucle)
 *       * fórmula: Σ (valor * peso/100)   (peso en porcentaje)
 *   - sumaDePesos(notas): reduce y acumula los pesos ingresados.
 * Son funciones SIN estado ni BD, por eso no hay mocks: se prueban con
 * entradas literales y se comprueba el número de salida con toBeCloseTo
 * (tolerancia de 9 decimales, porque son operaciones en punto flotante).
 *
 * Casos:
 *   - calcularPromedioPonderado: lista vacía, una nota al 100%, ponderado de
 *     varias evaluaciones, y avance parcial (pesos que no llegan a 100).
 *   - sumaDePesos: suma de pesos ingresados y lista vacía.
 *
 * ⭐ Para la exposición se selecciona "ponderado de varias evaluaciones" como
 * UNITARIA OFICIAL 4/4 de Sam. Las demás quedan como cobertura complementaria.
 */

// Helper (fixture): crea una NotaInput con valores por defecto (valor 15, peso 30%)
// y deja que cada test sobrescriba solo el campo que le importa vía "over".
const n = (over: Partial<NotaInput>): NotaInput => ({ valor: 15, peso: 30, ...over });

describe("calcularPromedioPonderado", () => {
  test("lista vacia -> 0", () => {
    expect(calcularPromedioPonderado([])).toBe(0); // verifica que sin notas el promedio sea exactamente 0 (rama de borde)
  });

  test("una nota al 100% -> la propia nota", () => {
    // con peso 100% el ponderado es la nota tal cual: 15 * (100/100) = 15
    expect(calcularPromedioPonderado([n({ valor: 15, peso: 100 })])).toBeCloseTo(15.0, 9); // verifica que una nota al 100% se devuelva íntegra
  });

  // ⭐ UNITARIA OFICIAL 4/4 — calcularPromedioPonderado(): fórmula completa.
  test("ponderado de varias evaluaciones", () => {
    // 12*0.3 + 16*0.5 + 8*0.2 = 3.6 + 8.0 + 1.6 = 13.2
    const promedio = calcularPromedioPonderado([
      n({ valor: 12, peso: 30 }), // primera evaluación: 12 al 30%
      n({ valor: 16, peso: 50 }), // segunda evaluación: 16 al 50%
      n({ valor: 8, peso: 20 }),  // tercera evaluación: 8 al 20% (los pesos suman 100)
    ]);
    expect(promedio).toBeCloseTo(13.2, 9); // verifica que la suma ponderada dé 13.2
  });

  test("avance parcial (pesos que no suman 100)", () => {
    // solo se ha rendido el 50%: 14 * (50/100) = 7.0 (no reescala al total)
    expect(calcularPromedioPonderado([n({ valor: 14, peso: 50 })])).toBeCloseTo(7.0, 9); // verifica que con pesos parciales devuelva el aporte acumulado, no el promedio final
  });
});

describe("sumaDePesos", () => {
  test("suma los pesos ingresados", () => {
    // 30 + 50 = 80 (el valor de la nota no interviene aquí, solo el peso)
    expect(sumaDePesos([n({ peso: 30 }), n({ peso: 50 })])).toBeCloseTo(80.0, 9); // verifica que acumule correctamente los pesos
  });

  test("lista vacia -> 0", () => {
    expect(sumaDePesos([])).toBe(0); // verifica que sin notas la suma de pesos sea 0 (valor inicial del reduce)
  });
});
