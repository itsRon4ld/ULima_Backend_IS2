import { describe, expect, test } from "bun:test";
import {
  isHttpUrl,
  normalizeSocialLink,
  urlBelongsToPlatform,
  validateNetworkingSelection,
  validateSocialLink,
} from "../../src/modules/networking/networking.logic.js";

/**
 * ============================================================================
 * PRUEBA UNITARIA — Lógica pura del carnet de networking (HU25)
 * Fuente: src/modules/networking/networking.logic.ts
 * ============================================================================
 * Prueba AISLADA (sin BD) las funciones puras que validan y normalizan el
 * carnet de redes sociales (opt-in, máximo una red):
 *   - isHttpUrl()                 : solo URLs http(s) ABSOLUTAS (ftp / relativas -> false).
 *   - urlBelongsToPlatform()      : el host debe ser el dominio oficial de la plataforma
 *                                   (o un subdominio real); rechaza hosts que solo "contienen" el nombre.
 *   - validateSocialLink()        : website/other EXIGEN etiqueta; el resto no.
 *   - validateNetworkingSelection(): a lo sumo UNA red (visible u oculto).
 *   - normalizeSocialLink()       : recorta espacios de url/label; label vacío -> null.
 */

describe("networking.logic - URLs y dominios", () => {
  test("solo acepta URLs HTTP(S) absolutas", () => {
    expect(isHttpUrl("https://example.com/profile")).toBe(true);  // https absoluta -> ok
    expect(isHttpUrl("http://example.com/profile")).toBe(true);   // http absoluta -> ok
    expect(isHttpUrl("ftp://example.com/profile")).toBe(false);   // otro protocolo -> no
    expect(isHttpUrl("example.com/profile")).toBe(false);         // relativa (sin protocolo) -> no
  });

  test("acepta dominio oficial exacto o subdominio", () => {
    expect(urlBelongsToPlatform("linkedin", "https://linkedin.com/in/alumna")).toBe(true);    // dominio exacto
    expect(urlBelongsToPlatform("linkedin", "https://pe.linkedin.com/in/alumna")).toBe(true); // subdominio real
    expect(urlBelongsToPlatform("github", "https://github.com/alumna")).toBe(true);
  });

  test("rechaza hosts que solo contienen el nombre de la plataforma", () => {
    // "linkedin.com.evil.test" NO es linkedin.com: el dominio real es evil.test (anti-suplantación).
    expect(urlBelongsToPlatform("linkedin", "https://linkedin.com.evil.test/alumna")).toBe(false);
    expect(urlBelongsToPlatform("github", "https://notgithub.com/alumna")).toBe(false);       // "notgithub" != github
    expect(urlBelongsToPlatform("instagram", "https://evil.test/instagram.com")).toBe(false); // el nombre en el path no cuenta
  });

  test("X acepta x.com y twitter.com", () => {
    expect(urlBelongsToPlatform("x", "https://x.com/alumna")).toBe(true);                 // x.com
    expect(urlBelongsToPlatform("x", "https://mobile.twitter.com/alumna")).toBe(true);    // twitter.com (alias) + subdominio
    expect(urlBelongsToPlatform("x", "https://example.com/alumna")).toBe(false);          // dominio ajeno
  });

  test("website y other exigen etiqueta", () => {
    expect(validateSocialLink({ platform: "website", url: "https://me.dev" }).status)
      .toBe("label_required");                                    // website sin label -> falta etiqueta
    expect(validateSocialLink({
      platform: "other",
      url: "https://community.dev/u/me",
      label: "  ",                                                // label en blanco cuenta como ausente
    }).status).toBe("label_required");
    expect(validateSocialLink({
      platform: "website",
      url: "https://me.dev",
      label: "Portafolio",                                        // con etiqueta -> ok
    }).status).toBe("ok");
  });
});

describe("networking.logic - selección única", () => {
  const github = { platform: "github" as const, url: "https://github.com/alumna" }; // enlace válido reutilizable

  test("carnet visible acepta cero o un enlace", () => {
    expect(validateNetworkingSelection({ optIn: true, links: [] }).status)
      .toBe("ok");                                                // visible sin red -> ok (se comparte "sin red")
    expect(validateNetworkingSelection({ optIn: true, links: [github] }).status)
      .toBe("ok");                                                // visible con una red -> ok
  });

  test("carnet oculto acepta cero o un enlace", () => {
    expect(validateNetworkingSelection({ optIn: false, links: [] }).status).toBe("ok");       // oculto sin red -> ok
    expect(validateNetworkingSelection({ optIn: false, links: [github] }).status).toBe("ok"); // oculto con una red -> ok
  });

  test("nunca acepta más de una red total", () => {
    expect(validateNetworkingSelection({
      optIn: false,
      links: [github, { platform: "instagram", url: "https://instagram.com/alumna" }], // 2 redes
    }).status).toBe("too_many_links");                            // límite: máximo 1 red
  });

  test("normaliza espacios y fija label null", () => {
    expect(normalizeSocialLink({
      platform: "linkedin",
      url: "  https://linkedin.com/in/alumna  ",                  // url con espacios alrededor
      label: "  ",                                                // label en blanco
    })).toEqual({
      platform: "linkedin",
      url: "https://linkedin.com/in/alumna",                      // url recortada
      label: null,                                                // label vacío -> null
    });
    expect(normalizeSocialLink({
      platform: "website",
      url: " https://me.dev ",
      label: " Portafolio ",                                      // label con espacios
    }).label).toBe("Portafolio");                                 // se recorta a "Portafolio"
  });
});
