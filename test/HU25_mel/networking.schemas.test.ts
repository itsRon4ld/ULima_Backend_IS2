import { describe, expect, test } from "bun:test";
import { updateNetworkingSchema } from "../../src/modules/networking/networking.schemas.js";

/**
 * ============================================================================
 * CAJA NEGRA — Contrato de entrada del carnet de networking (esquema Zod) (HU25)
 * Fuente: updateNetworkingSchema — src/modules/networking/networking.schemas.ts
 * ============================================================================
 * Se valida el esquema SOLO desde entrada/salida (safeParse), con partición de
 * equivalencia y valores límite sobre los campos del carnet:
 *   - optIn    : boolean (visible / oculto).
 *   - links    : 0 o 1 enlace (MÁXIMO 1; 2+ rechaza).
 *   - platform : enum conocido (linkedin/instagram/github/x/website/other; "facebook" rechaza).
 *   - url      : http(s), dominio coherente con la plataforma, <= 255 caracteres.
 *   - label    : requerida para website/other; <= 80 caracteres.
 * Además rechaza `userId` y cualquier campo extra en cualquier nivel (strict).
 */

describe("updateNetworkingSchema - caja negra", () => {
  test("acepta carnet visible con una plataforma conocida", () => {
    const parsed = updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "github", url: "  https://github.com/alumna  " }], // url con espacios
    });
    expect(parsed.success).toBe(true);                                   // válido
    if (parsed.success) expect(parsed.data.links[0].url).toBe("https://github.com/alumna"); // se recorta al parsear
  });

  test("acepta carnet oculto vacío", () => {
    expect(updateNetworkingSchema.safeParse({ optIn: false, links: [] }).success).toBe(true); // oculto sin red -> ok
  });

  test("rechaza activar sin enlace y más de una red", () => {
    expect(updateNetworkingSchema.safeParse({ optIn: true, links: [] }).success).toBe(true);  // visible sin red -> ok
    expect(updateNetworkingSchema.safeParse({
      optIn: false,
      links: [
        { platform: "github", url: "https://github.com/a" },
        { platform: "instagram", url: "https://instagram.com/a" }, // 2 redes -> supera el máximo de 1
      ],
    }).success).toBe(false);
  });

  test("rechaza protocolo distinto de HTTP(S)", () => {
    expect(updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "github", url: "ftp://github.com/alumna" }], // ftp no es http(s)
    }).success).toBe(false);
  });

  test("rechaza dominio que no corresponde a la plataforma", () => {
    expect(updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "linkedin", url: "https://example.com/in/alumna" }], // example.com no es linkedin
    }).success).toBe(false);
  });

  test("website y other requieren label no vacío", () => {
    expect(updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "website", url: "https://me.dev" }], // website sin label -> rechaza
    }).success).toBe(false);
    expect(updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "other", url: "https://community.dev/me", label: "Comunidad" }], // con label -> ok
    }).success).toBe(true);
  });

  test("rechaza plataforma, URL y label fuera de contrato", () => {
    expect(updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "facebook", url: "https://facebook.com/a" }], // "facebook" no está en el enum
    }).success).toBe(false);
    expect(updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "website", url: `https://example.com/${"x".repeat(240)}`, label: "Web" }], // url > 255
    }).success).toBe(false);
    expect(updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "website", url: "https://example.com", label: "x".repeat(81) }], // label > 80 (borde)
    }).success).toBe(false);
  });

  test("rechaza userId y campos extra en cualquier nivel", () => {
    expect(updateNetworkingSchema.safeParse({
      userId: 999,                                                 // no debe aceptarse un userId del cliente
      optIn: true,
      links: [{ platform: "github", url: "https://github.com/a" }],
    }).success).toBe(false);
    expect(updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "github", url: "https://github.com/a", userId: 999 }], // ni campos extra en el link
    }).success).toBe(false);
  });
});
