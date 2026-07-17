import { describe, expect, test } from "bun:test";
import { calcularPromedioPonderado, sumaDePesos } from "../../src/modules/grades/grades.logic.js";
import { calculateAverageSchema } from "../../src/modules/grades/grades.schemas.js";
import type { NotaInput } from "../../src/modules/grades/grades.types.js";

/**
 * ============================================================================
 * UNITARIAS — HU07: visualizar promedio del curso (módulo Calculadora)
 * Fuentes: src/modules/grades/grades.logic.ts   (funciones puras del promedio)
 *          src/modules/grades/grades.schemas.ts (contrato de POST /grades/me/calculate)
 * ============================================================================
 * PU-C1 · calcularPromedioPonderado(): promedio = Σ valor·(peso/100).
 * PU-C2 · sumaDePesos(): alimenta la barra "Suma de pesos: X% / 100%" de la UI.
 * PU-C3 · calculateAverageSchema (Zod): rechaza notas fuera de [0,20] y pesos
 *         fuera de [0,100] ANTES de llegar al service.
 *
 * Sin mocks: PU-C1/C2 son funciones puras sin dependencias y PU-C3 valida el
 * esquema aislado. Los casos frontera (20/100 exactos, todo ceros, pesos que
 * exceden 100) están elegidos como "asesinos de mutantes" (>/>=, ±, recortes).
 *
 * MUTANTE EQUIVALENTE conocido (Stryker lo reporta como Survived y es
 * imposible de matar): en grades.logic.ts:4, `if (notas.length === 0) return 0`
 * -> `if (false)`. Con lista vacía el bucle no itera y la suma ya es 0, así
 * que el programa mutado es semánticamente idéntico al original.
 */

// Helper (fixture) para armar una nota de la calculadora con valores por defecto:
// valor 15 (nota) y peso 30 (%). Cada test sobreescribe solo lo que le importa vía "over".
const n = (over: Partial<NotaInput> = {}): NotaInput => ({ valor: 15, peso: 30, ...over });

describe("PU-C1 · calcularPromedioPonderado (HU07)", () => {
  test("lista vacía -> 0 (calculadora recién abierta: no divide ni lanza)", () => {
    // verifica que con [] la función retorne 0 (rama `if (notas.length === 0) return 0`), sin errores
    expect(calcularPromedioPonderado([])).toBe(0);
  });

  test("una sola nota con peso 100% -> devuelve la propia nota", () => {
    // verifica que 15·(100/100) = 15; toBeCloseTo(…, 9) tolera el ruido de coma flotante
    expect(calcularPromedioPonderado([n({ valor: 15, peso: 100 })])).toBeCloseTo(15.0, 9);
  });

  test("ponderado de varias evaluaciones: 12·0.3 + 16·0.5 + 8·0.2 = 13.2", () => {
    // arma tres evaluaciones con pesos que suman 100 (caso feliz de un curso completo)
    const promedio = calcularPromedioPonderado([
      n({ valor: 12, peso: 30 }),
      n({ valor: 16, peso: 50 }),
      n({ valor: 8, peso: 20 }),
    ]);
    // verifica la acumulación: 3.6 + 8.0 + 1.6 = 13.2 (mata mutantes en el operador de la suma)
    expect(promedio).toBeCloseTo(13.2, 9);
  });

  test("avance parcial: pesos que no suman 100 devuelven el acumulado (14·0.5 = 7), sin extrapolar", () => {
    // verifica que con un solo peso de 50% NO se re-escala a 100%: 14·(50/100) = 7 exacto
    expect(calcularPromedioPonderado([n({ valor: 14, peso: 50 })])).toBeCloseTo(7.0, 9);
  });

  test("todo en cero -> 0 (mata mutantes de operador en la acumulación)", () => {
    // verifica que 0·0 + 0·1 = 0; si un mutante cambiara * por + o - el resultado dejaría de ser 0
    expect(calcularPromedioPonderado([n({ valor: 0, peso: 0 }), n({ valor: 0, peso: 100 })])).toBe(0);
  });
});

describe("PU-C2 · sumaDePesos (HU07)", () => {
  test("lista vacía -> 0", () => {
    // verifica que reduce sobre [] use el acumulador inicial 0 (barra "0% / 100%" al abrir)
    expect(sumaDePesos([])).toBe(0);
  });

  test("suma los pesos ingresados: 30 + 50 = 80", () => {
    // verifica que reduce sume solo los pesos (ignora el valor): 30 + 50 = 80
    expect(sumaDePesos([n({ peso: 30 }), n({ peso: 50 })])).toBeCloseTo(80.0, 9);
  });

  test("pesos inconsistentes NO se recortan a 100: 60 + 60 = 120 (el tope lo decide la UI)", () => {
    // verifica que la lógica NO limita a 100: devuelve 120 tal cual (recortar es tarea del front)
    expect(sumaDePesos([n({ peso: 60 }), n({ peso: 60 })])).toBe(120);
  });
});

describe("PU-C3 · calculateAverageSchema — contrato de POST /grades/me/calculate (HU07)", () => {
  test("payload válido con lista vacía -> aceptado (calculadora sin notas)", () => {
    // verifica que un body con notas: [] pase la validación Zod (el array admite min(0))
    expect(calculateAverageSchema.safeParse({ notas: [] }).success).toBe(true);
  });

  test("nota > 20 rechazada y el error apunta al campo exacto (notas[0].valor)", () => {
    // parsea un payload con valor 25 (fuera de max(20)); safeParse no lanza, devuelve success:false
    const r = calculateAverageSchema.safeParse({ notas: [{ valor: 25, peso: 50 }] });
    // verifica que la validación falle por exceder el máximo de nota (20)
    expect(r.success).toBe(false);
    if (!r.success) {
      // verifica que Zod señale la ruta exacta del campo inválido: notas -> índice 0 -> valor
      expect(r.error.issues[0].path).toEqual(["notas", 0, "valor"]);
    }
  });

  test("nota negativa rechazada", () => {
    // verifica que valor -1 falle por debajo de min(0) (no hay notas negativas)
    expect(calculateAverageSchema.safeParse({ notas: [{ valor: -1, peso: 50 }] }).success).toBe(false);
  });

  test("peso > 100 rechazado", () => {
    // verifica que peso 150 falle por exceder max(100) (un peso no puede pasar del 100%)
    expect(calculateAverageSchema.safeParse({ notas: [{ valor: 15, peso: 150 }] }).success).toBe(false);
  });

  test("fronteras válidas: valor 0 y 20, peso 0 y 100 se aceptan (límites inclusivos)", () => {
    // arma un payload con los extremos exactos permitidos (prueba que min/max sean inclusivos, no '>')
    const r = calculateAverageSchema.safeParse({
      notas: [
        { valor: 0, peso: 0 },
        { valor: 20, peso: 100 },
      ],
    });
    // verifica que los límites 0 y 20 / 0 y 100 pasen la validación (frontera aceptada)
    expect(r.success).toBe(true);
  });
});
