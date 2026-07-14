/*
  bun test/HU25_mel/networking.unit.test.ts
*/
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
 * PRUEBAS UNITARIAS - Logica pura de carnet networking (HU25)
 * Fuente: src/modules/networking/networking.logic.ts
 * ============================================================================
 * Objetivo:
 *   Probar funciones pequenas y aisladas que sostienen las reglas del carnet
 *   de networking. No se instancia servidor, no se usa HTTP y no se toca la BD.
 *
 * Criterio de aceptacion relacionado:
 *   El carnet funciona como opt-in: puede estar visible sin una red asignada,
 *   acepta solo enlaces seguros y limita la seleccion a una red social.
 *
 * Funciones bajo prueba:
 *   isHttpUrl()
 *   urlBelongsToPlatform()
 *   validateSocialLink()
 *   validateNetworkingSelection()
 *   normalizeSocialLink()
 *
 * TABLA DE CASOS UNITARIOS:
 * | Caso | Funcion / regla                         | Entrada representativa                     | Esperado |
 * |------|------------------------------------------|--------------------------------------------|----------|
 * | U1   | isHttpUrl                                | http/https, ftp, texto plano               | solo http/https valido |
 * | U2   | urlBelongsToPlatform                     | linkedin oficial, dominio parecido falso   | dominio oficial valido |
 * | U3   | validateSocialLink                       | website sin label, other con label         | label requerido |
 * | U4   | validateNetworkingSelection              | optIn=true, links=[]                       | valido sin red |
 * | U5   | validateNetworkingSelection              | dos redes sociales                         | too_many_links |
 * | U6   | normalizeSocialLink                      | url con espacios y label vacio             | trim y label null |
 *
 * Alcance:
 *   Estas pruebas explican reglas atomicas. Para exposicion se pueden tomar U1
 *   a U4 como las cuatro unitarias principales, y dejar U5-U6 como respaldo.
 *
 * PRUEBA UNITARIA DE LA RUBRICA (un solo metodo, 5 casos):
 *   El bloque final concentra 5 casos sobre UN UNICO metodo,
 *   validateSocialLink(), que cubren sus 4 salidas posibles
 *   (ok, invalid_url, invalid_domain, label_required) mas el valor
 *   limite del label compuesto solo por espacios.
 */

describe("UNITARIA · HU25 networking.logic", () => {
  test("caso 1: isHttpUrl acepta http/https y rechaza ftp/texto", () => {
    expect(isHttpUrl("https://github.com/mel")).toBe(true);
    expect(isHttpUrl("http://mel.dev")).toBe(true);
    expect(isHttpUrl("ftp://github.com/mel")).toBe(false);
    expect(isHttpUrl("mel")).toBe(false);
  });

  test("caso 2: dominios oficiales aceptan subdominios", () => {
    expect(urlBelongsToPlatform("linkedin", "https://www.linkedin.com/in/mel")).toBe(true);
    expect(urlBelongsToPlatform("github", "https://evilgithub.com/mel")).toBe(false);
  });

  test("caso 3: website/other requieren label", () => {
    expect(validateSocialLink({ platform: "website", url: "https://mel.dev" }).status).toBe("label_required");
    expect(validateSocialLink({ platform: "other", url: "https://mel.dev", label: "Blog" }).status).toBe("ok");
  });

  test("caso 4: seleccion con cero links es valida para compartir carnet sin red", () => {
    expect(validateNetworkingSelection({ optIn: true, links: [] }).status).toBe("ok");
  });

  test("caso 5: seleccion con dos links retorna too_many_links", () => {
    expect(validateNetworkingSelection({
      optIn: true,
      links: [
        { platform: "github", url: "https://github.com/a" },
        { platform: "instagram", url: "https://instagram.com/a" },
      ],
    }).status).toBe("too_many_links");
  });

  test("caso 6: normalizeSocialLink recorta url y label vacio queda null", () => {
    expect(normalizeSocialLink({
      platform: "github",
      url: "  https://github.com/mel  ",
      label: "   ",
    })).toEqual({ platform: "github", url: "https://github.com/mel", label: null });
  });
});

// Prueba unitaria de la rubrica: UN solo metodo (validateSocialLink) con 5 casos
// que validan su correcto funcionamiento cubriendo las 4 salidas posibles.
describe("UNITARIA · HU25 validateSocialLink (un metodo, 5 casos)", () => {
  test("V1: enlace oficial de la plataforma retorna ok", () => {
    expect(validateSocialLink({ platform: "github", url: "https://github.com/mel" }).status).toBe("ok");
  });

  test("V2: url que no es http/https retorna invalid_url", () => {
    expect(validateSocialLink({ platform: "github", url: "ftp://github.com/mel" }).status).toBe("invalid_url");
  });

  test("V3: dominio que no corresponde a la plataforma retorna invalid_domain", () => {
    expect(validateSocialLink({ platform: "linkedin", url: "https://linkedin.fake.io/mel" }).status).toBe("invalid_domain");
  });

  test("V4: website sin label retorna label_required", () => {
    expect(validateSocialLink({ platform: "website", url: "https://mel.dev" }).status).toBe("label_required");
  });

  test("V5: valor limite, label de solo espacios cuenta como ausente", () => {
    expect(validateSocialLink({ platform: "other", url: "https://mel.dev", label: "   " }).status).toBe("label_required");
  });
});
