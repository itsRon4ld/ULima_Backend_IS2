/* Ejecutar de forma independiente:
   bun test test/HU25_mel/networking.cajanegra.test.ts
*/
import { describe, expect, test } from "bun:test";
import {
  socialLinkSchema,
  updateNetworkingSchema,
} from "../../src/modules/networking/networking.schemas.js";

/**
 * ============================================================================
 * CAJA NEGRA - Carnet de networking opt-in (HU25)
 * Fuente: src/modules/networking/networking.schemas.ts
 * ============================================================================
 * ⭐ IDEA CENTRAL PARA EXPONER:
 * Se trata al esquema Zod como una caja: se entrega un payload y solo se
 * observa `success` o el dato normalizado. No se ejecutan autenticación, HTTP,
 * transacción ni base de datos.
 *
 * Objetivo:
 *   Validar el contrato de entrada que recibe la API para guardar el carnet de
 *   networking, sin depender de la implementacion interna del servicio ni de la
 *   BD. Se observan solo entradas y salidas del esquema.
 *
 * Criterio de aceptacion relacionado:
 *   El usuario decide si su carnet esta visible, puede compartirlo incluso sin
 *   red registrada, y como maximo puede registrar una red social valida.
 *
 * Campos de entrada observados desde API:
 *   optIn, links[], platform, url, label.
 * Conteo real: 8 bloques `test`, 12 payloads concretos y 13 aserciones. Algunos
 * bloques agrupan entradas de la misma clase para mantener legible la suite.
 *
 * TABLA DE PARTICION DE EQUIVALENCIA + VALORES LIMITE:
 * | Caso | Clase evaluada                         | Entrada representativa                         | Esperado |
 * |------|----------------------------------------|------------------------------------------------|----------|
 * | CV1  | carnet visible sin enlaces             | optIn=true, links=[]                           | valido   |
 * | CV2  | carnet visible con una red valida      | github con espacios alrededor de la URL        | valido y trim |
 * | CNV1 | cantidad de redes fuera del limite     | dos enlaces en links[]                         | invalido |
 * | CNV2 | protocolo de URL no permitido          | ftp://github.com/a                             | invalido |
 * | CNV3 | dominio no coincide con la plataforma  | linkedin apuntando a example.com               | invalido |
 * | CNV4 | website/other sin nombre visible       | website sin label                              | invalido |
 *
 * Alcance:
 *   Esta prueba no revisa como se guarda el carnet. Solo comprueba el contrato
 *   publico de validacion que cualquier request debe cumplir antes de persistir.
 */

describe("CAJA NEGRA · HU25 updateNetworkingSchema", () => {
  test("CV1: carnet visible sin enlace es valido", () => {
    // Se puede compartir el carnet SIN red registrada.
    expect(updateNetworkingSchema.safeParse({ optIn: true, links: [] }).success).toBe(true);
  });

  test("CV2: carnet visible con una red valida normaliza espacios", () => {
    const parsed = updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "github", url: "  https://github.com/mel  " }], // url con espacios alrededor
    });

    expect(parsed.success).toBe(true);                                    // válido
    if (parsed.success) expect(parsed.data.links[0].url).toBe("https://github.com/mel"); // se recorta al parsear
  });

  test("CNV1: no acepta mas de una red", () => {
    expect(updateNetworkingSchema.safeParse({
      optIn: true,
      links: [
        { platform: "github", url: "https://github.com/a" },
        { platform: "instagram", url: "https://instagram.com/a" }, // 2 redes -> supera el máximo (1)
      ],
    }).success).toBe(false);
  });

  test("CNV2: rechaza protocolo distinto de HTTP(S)", () => {
    // ftp no es http(s) -> el enlace no es válido.
    expect(socialLinkSchema.safeParse({ platform: "github", url: "ftp://github.com/a" }).success).toBe(false);
  });

  test("CNV3: rechaza dominio que no corresponde a la plataforma", () => {
    // example.com no es linkedin -> dominio incoherente con la plataforma.
    expect(socialLinkSchema.safeParse({ platform: "linkedin", url: "https://example.com/in/a" }).success).toBe(false);
  });

  test("CNV4: website y other requieren label", () => {
    expect(socialLinkSchema.safeParse({ platform: "website", url: "https://mel.dev" }).success).toBe(false); // sin label -> no
    expect(socialLinkSchema.safeParse({ platform: "other", url: "https://mel.dev", label: "Portfolio" }).success).toBe(true); // con label -> ok
  });

  // ── Consolidado desde networking.schemas: bordes de contrato y modo estricto ──
  test("CNV5: rechaza plataforma fuera del enum, url > 255 y label > 80 (bordes de contrato)", () => {
    // plataforma "facebook" no está en el enum de redes soportadas -> inválida
    expect(updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "facebook", url: "https://facebook.com/a" }],
    }).success).toBe(false);
    // url de 260 caracteres: representante inválido por exceder el máximo 255.
    // No se afirma aquí cobertura bilateral 255/256 porque este bloque no la ejecuta.
    expect(updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "website", url: `https://example.com/${"x".repeat(240)}`, label: "Web" }],
    }).success).toBe(false);
    // label de 81 caracteres: valor inmediatamente posterior al máximo 80.
    expect(updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "website", url: "https://example.com", label: "x".repeat(81) }],
    }).success).toBe(false);
  });

  // ⭐ SEGURIDAD DEL CONTRATO: el propietario se obtiene del JWT; el cliente no
  // puede inyectar userId ni campos desconocidos en ningún nivel del payload.
  test("CNV6: rechaza userId y campos extra en cualquier nivel (schema estricto)", () => {
    // no debe aceptarse un userId enviado por el cliente (lo pone el servidor desde el JWT)
    expect(updateNetworkingSchema.safeParse({
      userId: 999,
      optIn: true,
      links: [{ platform: "github", url: "https://github.com/a" }],
    }).success).toBe(false);
    // ni un campo extra dentro del link
    expect(updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "github", url: "https://github.com/a", userId: 999 }],
    }).success).toBe(false);
  });
});
