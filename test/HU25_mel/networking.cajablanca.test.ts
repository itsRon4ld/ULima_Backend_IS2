import { describe, expect, test } from "bun:test";
import type { EventBus } from "../../src/events/index.js";
import { NetworkingService } from "../../src/modules/networking/networking.service.js";
import type { NetworkingRepository } from "../../src/modules/networking/networking.repository.js";
import type { NetworkingCard, SocialLink } from "../../src/modules/networking/networking.types.js";

/**
 * ============================================================================
 * CAJA BLANCA - HU25 NetworkingService.updateMine()
 * Fuente: src/modules/networking/networking.service.ts:31-56
 * ============================================================================
 *
 * Decisiones del metodo:
 *   D1  validation.status === "too_many_links"
 *   D2  validation.status === "invalid_link"
 *   D3  input.links[0] existe ? normalizar : usar null
 *   D4  !card despues de persistir
 *
 * Complejidad ciclomatica: V(G) = 4 decisiones + 1 = 5.
 * Cumple la rubrica porque V(G) es mayor o igual a 4 y tambien mayor a 4.
 *
 * Caminos independientes:
 *   C1  D1 verdadero -> 400 INVALID_NETWORKING_LINK_COUNT
 *   C2  D1 falso, D2 verdadero -> 400 INVALID_NETWORKING_LINK
 *   C3  D1/D2 falsos, D3 verdadero, D4 falso -> normaliza y retorna carnet
 *   C4  D1/D2 falsos, D3 falso, D4 falso -> persiste enlace null
 *   C5  D1/D2 falsos, D4 verdadero -> 404 USER_NOT_FOUND
 */

// EventBus dummy: el test solo evalúa la lógica de updateMine.
const noopEvents = {} as unknown as EventBus;

// Fabrica un carnet de ejemplo (por defecto visible y sin redes).
const card = (over: Partial<NetworkingCard> = {}): NetworkingCard => ({
  optIn: true,
  links: [],
  ...over,
});

// Arma el servicio con un repositorio falso; por defecto replaceByUserId
// "guarda" devolviendo el carnet resultante. Cada test lo sobrescribe para
// espiar lo que se persiste o forzar el camino de "usuario no encontrado".
const makeService = (overrides: Partial<NetworkingRepository> = {}) => {
  const repository = {
    replaceByUserId: async (_userId: number, optIn: boolean, link: SocialLink | null) =>
      card({ optIn, links: link ? [link] : [] }),
    ...overrides,
  } as unknown as NetworkingRepository;

  return new NetworkingService(repository, noopEvents);
};

const expectHttpError = async (
  action: Promise<unknown>,
  statusCode: number,
  code: string,
  message: string,
) => {
  try {
    await action;
  } catch (error) {
    const httpError = error as {
      statusCode?: number;
      code?: string;
      message?: string;
      details?: unknown;
    };
    expect(httpError.statusCode).toBe(statusCode);
    expect(httpError.code).toBe(code);
    expect(httpError.message).toBe(message);
    return httpError;
  }

  throw new Error(`Se esperaba ${statusCode} ${code}`);
};

describe("CAJA BLANCA · HU25 NetworkingService.updateMine() · V(G)=5", () => {
  test("C1: mas de una red -> 400 y no persiste", async () => {
    let writes = 0;
    const service = makeService({
      replaceByUserId: async () => {
        writes += 1;
        return card();
      },
    });

    await expectHttpError(
      service.updateMine(1, {
        optIn: true,
        links: [
          { platform: "github", url: "https://github.com/a" },
          { platform: "instagram", url: "https://instagram.com/a" },
        ],
      }),
      400,
      "INVALID_NETWORKING_LINK_COUNT",
      "El carnet admite una sola red social.",
    );
    expect(writes).toBe(0);
  });

  test("C2: enlace invalido -> 400 con la razon y no persiste", async () => {
    let writes = 0;
    const service = makeService({
      replaceByUserId: async () => {
        writes += 1;
        return card();
      },
    });

    const error = await expectHttpError(
      service.updateMine(1, {
        optIn: true,
        links: [{ platform: "linkedin", url: "https://example.com/a" }],
      }),
      400,
      "INVALID_NETWORKING_LINK",
      "El enlace del carnet no es válido.",
    );
    expect(error.details).toEqual({ reason: "invalid_domain" });
    expect(writes).toBe(0);
  });

  test("C3: enlace valido -> normaliza, persiste y retorna el carnet", async () => {
    let received:
      | { userId: number; optIn: boolean; link: SocialLink | null }
      | undefined;
    const service = makeService({
      replaceByUserId: async (userId, optIn, link) => {
        received = { userId, optIn, link };
        return card({ optIn, links: link ? [link] : [] });
      },
    });

    const result = await service.updateMine(42, {
      optIn: true,
      links: [{ platform: "website", url: "  https://mel.dev  ", label: "  Web  " }],
    });

    const normalized = {
      platform: "website" as const,
      url: "https://mel.dev",
      label: "Web",
    };
    expect(received).toEqual({ userId: 42, optIn: true, link: normalized });
    expect(result).toEqual({ optIn: true, links: [normalized] });
  });

  test("C4: lista sin enlaces -> persiste null y retorna carnet sin red", async () => {
    let savedLink: SocialLink | null | undefined;
    const service = makeService({
      replaceByUserId: async (_userId, optIn, link) => {
        savedLink = link;
        return card({ optIn, links: [] });
      },
    });

    const result = await service.updateMine(8, { optIn: true, links: [] });

    expect(savedLink).toBeNull();
    expect(result).toEqual({ optIn: true, links: [] });
  });

  test("C5: repositorio no encuentra al usuario -> 404 USER_NOT_FOUND", async () => {
    const service = makeService({ replaceByUserId: async () => null });

    await expectHttpError(
      service.updateMine(999, {
        optIn: true,
        links: [{ platform: "github", url: "https://github.com/mel" }],
      }),
      404,
      "USER_NOT_FOUND",
      "Usuario no encontrado.",
    );
  });
});
