import { describe, expect, test } from "bun:test";
import {
  isHttpUrl,
  normalizeSocialLink,
  urlBelongsToPlatform,
  validateNetworkingSelection,
  validateSocialLink,
} from "../../src/modules/networking/networking.logic.js";

describe("networking.logic - URLs y dominios", () => {
  test("solo acepta URLs HTTP(S) absolutas", () => {
    expect(isHttpUrl("https://example.com/profile")).toBe(true);
    expect(isHttpUrl("http://example.com/profile")).toBe(true);
    expect(isHttpUrl("ftp://example.com/profile")).toBe(false);
    expect(isHttpUrl("example.com/profile")).toBe(false);
  });

  test("acepta dominio oficial exacto o subdominio", () => {
    expect(urlBelongsToPlatform("linkedin", "https://linkedin.com/in/alumna")).toBe(true);
    expect(urlBelongsToPlatform("linkedin", "https://pe.linkedin.com/in/alumna")).toBe(true);
    expect(urlBelongsToPlatform("github", "https://github.com/alumna")).toBe(true);
  });

  test("rechaza hosts que solo contienen el nombre de la plataforma", () => {
    expect(urlBelongsToPlatform("linkedin", "https://linkedin.com.evil.test/alumna")).toBe(false);
    expect(urlBelongsToPlatform("github", "https://notgithub.com/alumna")).toBe(false);
    expect(urlBelongsToPlatform("instagram", "https://evil.test/instagram.com")).toBe(false);
  });

  test("X acepta x.com y twitter.com", () => {
    expect(urlBelongsToPlatform("x", "https://x.com/alumna")).toBe(true);
    expect(urlBelongsToPlatform("x", "https://mobile.twitter.com/alumna")).toBe(true);
    expect(urlBelongsToPlatform("x", "https://example.com/alumna")).toBe(false);
  });

  test("website y other exigen etiqueta", () => {
    expect(validateSocialLink({ platform: "website", url: "https://me.dev" }).status)
      .toBe("label_required");
    expect(validateSocialLink({
      platform: "other",
      url: "https://community.dev/u/me",
      label: "  ",
    }).status).toBe("label_required");
    expect(validateSocialLink({
      platform: "website",
      url: "https://me.dev",
      label: "Portafolio",
    }).status).toBe("ok");
  });
});

describe("networking.logic - selección única", () => {
  const github = { platform: "github" as const, url: "https://github.com/alumna" };

  test("carnet visible acepta cero o un enlace", () => {
    expect(validateNetworkingSelection({ optIn: true, links: [] }).status)
      .toBe("ok");
    expect(validateNetworkingSelection({ optIn: true, links: [github] }).status)
      .toBe("ok");
  });

  test("carnet oculto acepta cero o un enlace", () => {
    expect(validateNetworkingSelection({ optIn: false, links: [] }).status).toBe("ok");
    expect(validateNetworkingSelection({ optIn: false, links: [github] }).status).toBe("ok");
  });

  test("nunca acepta más de una red total", () => {
    expect(validateNetworkingSelection({
      optIn: false,
      links: [github, { platform: "instagram", url: "https://instagram.com/alumna" }],
    }).status).toBe("too_many_links");
  });

  test("normaliza espacios y fija label null", () => {
    expect(normalizeSocialLink({
      platform: "linkedin",
      url: "  https://linkedin.com/in/alumna  ",
      label: "  ",
    })).toEqual({
      platform: "linkedin",
      url: "https://linkedin.com/in/alumna",
      label: null,
    });
    expect(normalizeSocialLink({
      platform: "website",
      url: " https://me.dev ",
      label: " Portafolio ",
    }).label).toBe("Portafolio");
  });
});
