import { describe, expect, test } from "bun:test";
import { validateSocialLink } from "../../src/modules/networking/networking.logic.js";

/**
 * ============================================================================
 * PRUEBA UNITARIA - HU25 validateSocialLink()
 * Fuente: src/modules/networking/networking.logic.ts:53-65
 * ============================================================================
 * Un solo metodo con exactamente cuatro casos, uno por cada salida posible.
 * No usa servidor, HTTP, repositorio ni base de datos.
 *
 * | Caso | Entrada                                      | Resultado       |
 * |------|----------------------------------------------|-----------------|
 * | U1   | URL HTTP(S) y dominio oficial               | ok              |
 * | U2   | URL con protocolo no permitido              | invalid_url     |
 * | U3   | URL cuyo dominio no corresponde a plataforma| invalid_domain  |
 * | U4   | website sin etiqueta visible                | label_required  |
 */

describe("UNITARIA · HU25 validateSocialLink() · 4 casos", () => {
  test("U1: enlace oficial de la plataforma -> ok", () => {
    expect(
      validateSocialLink({
        platform: "github",
        url: "https://github.com/mel",   // https + dominio oficial de github
      }),
    ).toEqual({ status: "ok" });          // salida 1/4: válido
  });

  test("U2: protocolo distinto de HTTP(S) -> invalid_url", () => {
    expect(
      validateSocialLink({
        platform: "github",
        url: "ftp://github.com/mel",      // ftp no es http(s)
      }),
    ).toEqual({ status: "invalid_url" }); // salida 2/4
  });

  test("U3: dominio ajeno a la plataforma -> invalid_domain", () => {
    expect(
      validateSocialLink({
        platform: "linkedin",
        url: "https://linkedin.fake.io/mel", // el dominio real es fake.io, no linkedin
      }),
    ).toEqual({ status: "invalid_domain" }); // salida 3/4
  });

  test("U4: website sin label -> label_required", () => {
    expect(
      validateSocialLink({
        platform: "website",
        url: "https://mel.dev",           // website exige etiqueta y no se pasó
      }),
    ).toEqual({ status: "label_required" }); // salida 4/4
  });
});
