import { describe, expect, test } from "bun:test";
import { updateNetworkingSchema } from "../../src/modules/networking/networking.schemas.js";

describe("updateNetworkingSchema - caja negra", () => {
  test("acepta carnet visible con una plataforma conocida", () => {
    const parsed = updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "github", url: "  https://github.com/alumna  " }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.links[0].url).toBe("https://github.com/alumna");
  });

  test("acepta carnet oculto vacío", () => {
    expect(updateNetworkingSchema.safeParse({ optIn: false, links: [] }).success).toBe(true);
  });

  test("rechaza activar sin enlace y más de una red", () => {
    expect(updateNetworkingSchema.safeParse({ optIn: true, links: [] }).success).toBe(true);
    expect(updateNetworkingSchema.safeParse({
      optIn: false,
      links: [
        { platform: "github", url: "https://github.com/a" },
        { platform: "instagram", url: "https://instagram.com/a" },
      ],
    }).success).toBe(false);
  });

  test("rechaza protocolo distinto de HTTP(S)", () => {
    expect(updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "github", url: "ftp://github.com/alumna" }],
    }).success).toBe(false);
  });

  test("rechaza dominio que no corresponde a la plataforma", () => {
    expect(updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "linkedin", url: "https://example.com/in/alumna" }],
    }).success).toBe(false);
  });

  test("website y other requieren label no vacío", () => {
    expect(updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "website", url: "https://me.dev" }],
    }).success).toBe(false);
    expect(updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "other", url: "https://community.dev/me", label: "Comunidad" }],
    }).success).toBe(true);
  });

  test("rechaza plataforma, URL y label fuera de contrato", () => {
    expect(updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "facebook", url: "https://facebook.com/a" }],
    }).success).toBe(false);
    expect(updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "website", url: `https://example.com/${"x".repeat(240)}`, label: "Web" }],
    }).success).toBe(false);
    expect(updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "website", url: "https://example.com", label: "x".repeat(81) }],
    }).success).toBe(false);
  });

  test("rechaza userId y campos extra en cualquier nivel", () => {
    expect(updateNetworkingSchema.safeParse({
      userId: 999,
      optIn: true,
      links: [{ platform: "github", url: "https://github.com/a" }],
    }).success).toBe(false);
    expect(updateNetworkingSchema.safeParse({
      optIn: true,
      links: [{ platform: "github", url: "https://github.com/a", userId: 999 }],
    }).success).toBe(false);
  });
});
