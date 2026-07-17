import { describe, expect, test } from "bun:test";
import {
  announcementIdParamSchema,
  createAnnouncementSchema,
  sectionIdParamSchema,
  updateAnnouncementSchema,
} from "../../src/modules/section-management/section-management.schemas.js";

/**
 * ============================================================================
 * CAJA NEGRA — Registrar/editar anuncios academicos (HU10)
 * Fuente: src/modules/section-management/section-management.schemas.ts:3-16
 * ============================================================================
 * Probamos los esquemas Zod que validan el contrato del formulario/API, sin
 * mirar la implementacion interna del servicio: derivamos los casos desde las
 * clases de equivalencia y los valores limite de cada campo de entrada.
 *
 * CAMPOS DE ENTRADA (4): al considerar ruta + body el payload de registrar/
 * editar anuncio tiene mas de 4 entradas:
 *   sectionId (param), id (param), title (body), message (body).
 *   - sectionId: z.coerce.number().int().positive()
 *   - id:        z.coerce.number().int().positive()
 *   - title:     z.string().trim().min(1).max(150)
 *   - message:   z.string().trim().min(1).max(5000)
 *   (updateAnnouncementSchema === createAnnouncementSchema: mismo contrato)
 *
 * PARTICION DE EQUIVALENCIA + VALORES LIMITE:
 * | Campo     | Clase valida               | Clase invalida / limite              |
 * |-----------|----------------------------|--------------------------------------|
 * | sectionId | entero positivo/coercible  | 0, negativo, texto                   |
 * | id        | entero positivo/coercible  | 0, texto                             |
 * | title     | 1..150 chars tras trim     | "", solo espacios, >150 (151)        |
 * | message   | 1..5000 chars tras trim    | "", solo espacios, >5000 (5001)      |
 *
 * BATERIA DE CASOS:
 * | #    | Que prueba                              | Esperado           |
 * |------|-----------------------------------------|--------------------|
 * | CV1  | title/message validos con espacios      | success + trim     |
 * | CNV1 | title vacio o solo espacios             | success = false    |
 * | CNV2 | message vacio o solo espacios           | success = false    |
 * | CNV3 | fronteras 150/151 y 5000/5001           | valido / invalido  |
 * | CNV4 | update reusa el contrato de create      | igual que create   |
 * | CNV5 | params de ruta: enteros positivos       | 15/99 ok, 0/abc no |
 */

describe("CAJA NEGRA · HU10 create/update announcement payload", () => {
  test("CV1: payload valido con espacios se normaliza por trim", () => {
    // Clase VALIDA de title y message, pero con espacios sobrantes al inicio/fin
    const parsed = createAnnouncementSchema.safeParse({
      title: "  Parcial 2  ",                       // dentro de 1..150 tras recortar
      message: "  El examen sera en la semana 10.  ", // dentro de 1..5000 tras recortar
    });

    expect(parsed.success).toBe(true); // verifica que el payload valido sea aceptado
    if (parsed.success) {              // solo si paso, inspeccionamos los datos normalizados
      expect(parsed.data.title).toBe("Parcial 2");                       // verifica que trim() haya quitado los espacios del title
      expect(parsed.data.message).toBe("El examen sera en la semana 10."); // verifica que trim() haya quitado los espacios del message
    }
  });

  test("CNV1: titulo vacio o solo espacios es rechazado", () => {
    // Clase INVALIDA de title: cadena vacia -> min(1) falla tras trim
    expect(createAnnouncementSchema.safeParse({ title: "", message: "ok" }).success).toBe(false); // verifica que title "" sea rechazado
    // Clase INVALIDA de title: solo espacios -> trim lo deja vacio -> min(1) falla
    expect(createAnnouncementSchema.safeParse({ title: "   ", message: "ok" }).success).toBe(false); // verifica que title de puros espacios sea rechazado
  });

  test("CNV2: mensaje vacio o solo espacios es rechazado", () => {
    // Clase INVALIDA de message: cadena vacia -> min(1) falla tras trim
    expect(createAnnouncementSchema.safeParse({ title: "Titulo", message: "" }).success).toBe(false); // verifica que message "" sea rechazado
    // Clase INVALIDA de message: solo espacios -> trim lo deja vacio -> min(1) falla
    expect(createAnnouncementSchema.safeParse({ title: "Titulo", message: "   " }).success).toBe(false); // verifica que message de puros espacios sea rechazado
  });

  test("CNV3: limites superiores de titulo y mensaje se aplican", () => {
    // VALOR LIMITE title: exactamente 150 chars -> aun valido (max inclusivo)
    expect(createAnnouncementSchema.safeParse({ title: "x".repeat(150), message: "m" }).success).toBe(true); // verifica que title de 150 chars sea aceptado
    // VALOR LIMITE title: 151 chars -> supera max(150) -> invalido
    expect(createAnnouncementSchema.safeParse({ title: "x".repeat(151), message: "m" }).success).toBe(false); // verifica que title de 151 chars sea rechazado
    // VALOR LIMITE message: exactamente 5000 chars -> aun valido (max inclusivo)
    expect(createAnnouncementSchema.safeParse({ title: "T", message: "m".repeat(5000) }).success).toBe(true); // verifica que message de 5000 chars sea aceptado
    // VALOR LIMITE message: 5001 chars -> supera max(5000) -> invalido
    expect(createAnnouncementSchema.safeParse({ title: "T", message: "m".repeat(5001) }).success).toBe(false); // verifica que message de 5001 chars sea rechazado
  });

  test("CNV4: update usa el mismo contrato que create", () => {
    // updateAnnouncementSchema === createAnnouncementSchema: debe comportarse igual
    expect(updateAnnouncementSchema.safeParse({ title: "Cambio", message: "Detalle" }).success).toBe(true); // verifica que un update valido sea aceptado
    // La misma regla min(1) aplica al editar: title vacio tambien se rechaza
    expect(updateAnnouncementSchema.safeParse({ title: "", message: "Detalle" }).success).toBe(false); // verifica que update con title "" sea rechazado
  });

  test("CNV5: parametros de ruta aceptan solo enteros positivos", () => {
    // sectionId VALIDO: "15" es coercible a entero positivo
    expect(sectionIdParamSchema.safeParse({ sectionId: "15" }).success).toBe(true); // verifica que sectionId "15" sea aceptado
    // sectionId INVALIDO: "0" no es positive() -> rechazado
    expect(sectionIdParamSchema.safeParse({ sectionId: "0" }).success).toBe(false); // verifica que sectionId "0" sea rechazado
    // id VALIDO: "99" es coercible a entero positivo
    expect(announcementIdParamSchema.safeParse({ id: "99" }).success).toBe(true); // verifica que id "99" sea aceptado
    // id INVALIDO: "abc" no es coercible a numero -> rechazado
    expect(announcementIdParamSchema.safeParse({ id: "abc" }).success).toBe(false); // verifica que id "abc" sea rechazado
  });
});
