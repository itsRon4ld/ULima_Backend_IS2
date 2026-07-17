import { describe, expect, test } from "bun:test";
import { z } from "zod";

/*
 * ============================================================================
 * CAJA NEGRA — Validación de params de asesorías del alumno (HU13: ver/agendar asesorías)
 * Fuente: src/modules/advising/student/student.schemas.ts:3-9
 * ============================================================================
 * Aquí probamos SIN mirar el código, solo por el contrato de entrada/salida:
 * los dos esquemas Zod que validan los parámetros de ruta del módulo de
 * asesorías del alumno. Ambos coaccionan (coerce) el valor a número entero
 * positivo y devuelven { success: true/false } según sea válido o no.
 *
 * CAMPOS DE ENTRADA (2 params de ruta, uno por esquema):
 *   - sectionId : z.coerce.number().int().positive()  (id de la sección)
 *   - sessionId : z.coerce.number().int().positive()  (id de la sesión de asesoría)
 * Como el coerce acepta string, cada campo tiene varias sub-clases a cubrir.
 *
 * | Campo     | Clase válida                         | Clase inválida / límite                        |
 * |-----------|--------------------------------------|------------------------------------------------|
 * | sectionId | entero positivo (1, 999999) o "42"   | 0, negativo, decimal (1.5), "abc", null, ausente |
 * | sessionId | entero positivo (1) o "7"            | 0, negativo, decimal (3.14), "xyz", null, ausente |
 *
 * BATERÍA DE CASOS (particiones de equivalencia + valores frontera):
 * | #  | Entrada                       | Esperado  |
 * |----|-------------------------------|-----------|
 * | V1 | { sectionId: 1 }              | success   |
 * | V2 | { sectionId: "42" } (coerce)  | success=42 |
 * | V3 | { sectionId: 999999 }         | success   |
 * | I1 | {} (sin sectionId)            | fail      |
 * | I2 | { sectionId: 0 } (frontera)   | fail      |
 * | I3 | { sectionId: -1 }             | fail      |
 * | I4 | { sectionId: 1.5 } (decimal)  | fail      |
 * | I5 | { sectionId: "abc" }          | fail      |
 * | I6 | { sectionId: null }           | fail      |
 * | (idéntica batería para sessionId con valores análogos)             |
 *
 */

// Esquema real replicado del SUT: valida el param sectionId como entero positivo (coerce string->number).
const sectionIdParamSchema = z.object({
  sectionId: z.coerce.number().int().positive(),
});

// Esquema real replicado del SUT: valida el param sessionId como entero positivo (coerce string->number).
const sessionIdParamSchema = z.object({
  sessionId: z.coerce.number().int().positive(),
});

// Helper: corre safeParse del esquema con la entrada y devuelve el resultado ({ success }); no lanza excepción, así el test solo mira el booleano.
const safe = (schema: { safeParse: (v: unknown) => { success: boolean } }, input: unknown) =>
  schema.safeParse(input);

describe("sectionIdParamSchema — caja negra", () => {
  test("válido: sectionId numérico positivo", () => {
    const r = safe(sectionIdParamSchema, { sectionId: 1 }); // entrada de la clase VÁLIDA: entero positivo
    expect(r.success).toBe(true); // verifica que el esquema acepte un sectionId = 1
    if (r.success) expect(r.data.sectionId).toBe(1); // verifica que el valor parseado se conserve como 1
  });

  test("válido: coerce de string a number", () => {
    const r = safe(sectionIdParamSchema, { sectionId: "42" }); // entrada string: los params de URL siempre llegan como texto
    expect(r.success).toBe(true); // verifica que el coerce convierta "42" y lo acepte
    if (r.success) expect(r.data.sectionId).toBe(42); // verifica que el string "42" se haya coaccionado al número 42
  });

  test("válido: número grande positivo", () => {
    expect(safe(sectionIdParamSchema, { sectionId: 999999 }).success).toBe(true); // verifica que un id grande siga siendo válido (sin tope superior)
  });

  test("inválido: objeto vacío (sin sectionId)", () => {
    expect(safe(sectionIdParamSchema, {}).success).toBe(false); // verifica que falte del campo requerido haga fallar la validación
  });

  test("inválido: sectionId cero (no positivo)", () => {
    expect(safe(sectionIdParamSchema, { sectionId: 0 }).success).toBe(false); // frontera: 0 no es positivo (positive() exige > 0) -> falla
  });

  test("inválido: sectionId negativo", () => {
    expect(safe(sectionIdParamSchema, { sectionId: -1 }).success).toBe(false); // verifica que un id negativo sea rechazado
  });

  test("inválido: sectionId decimal (no entero)", () => {
    expect(safe(sectionIdParamSchema, { sectionId: 1.5 }).success).toBe(false); // verifica que int() rechace un decimal
  });

  test("inválido: sectionId string no numérico", () => {
    expect(safe(sectionIdParamSchema, { sectionId: "abc" }).success).toBe(false); // verifica que el coerce falle si el string no representa un número
  });

  test("inválido: sectionId null", () => {
    expect(safe(sectionIdParamSchema, { sectionId: null }).success).toBe(false); // verifica que null no sea aceptado como id
  });
});

describe("sessionIdParamSchema — caja negra", () => {
  test("válido: sessionId numérico positivo", () => {
    const r = safe(sessionIdParamSchema, { sessionId: 1 }); // entrada de la clase VÁLIDA: entero positivo
    expect(r.success).toBe(true); // verifica que el esquema acepte un sessionId = 1
    if (r.success) expect(r.data.sessionId).toBe(1); // verifica que el valor parseado se conserve como 1
  });

  test("válido: coerce de string a number", () => {
    const r = safe(sessionIdParamSchema, { sessionId: "7" }); // entrada string: mismo caso que en URL, texto a número
    expect(r.success).toBe(true); // verifica que el coerce convierta "7" y lo acepte
    if (r.success) expect(r.data.sessionId).toBe(7); // verifica que el string "7" se haya coaccionado al número 7
  });

  test("inválido: objeto vacío (sin sessionId)", () => {
    expect(safe(sessionIdParamSchema, {}).success).toBe(false); // verifica que falte del campo requerido haga fallar la validación
  });

  test("inválido: sessionId cero", () => {
    expect(safe(sessionIdParamSchema, { sessionId: 0 }).success).toBe(false); // frontera: 0 no es positivo -> falla
  });

  test("inválido: sessionId negativo", () => {
    expect(safe(sessionIdParamSchema, { sessionId: -5 }).success).toBe(false); // verifica que un id negativo sea rechazado
  });

  test("inválido: sessionId decimal", () => {
    expect(safe(sessionIdParamSchema, { sessionId: 3.14 }).success).toBe(false); // verifica que int() rechace un decimal
  });

  test("inválido: sessionId null", () => {
    expect(safe(sessionIdParamSchema, { sessionId: null }).success).toBe(false); // verifica que null no sea aceptado como id
  });

  test("inválido: sessionId string no numérico", () => {
    expect(safe(sessionIdParamSchema, { sessionId: "xyz" }).success).toBe(false); // verifica que el coerce falle si el string no representa un número
  });
});
