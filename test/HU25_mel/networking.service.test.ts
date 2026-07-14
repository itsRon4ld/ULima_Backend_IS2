import { describe, expect, test } from "bun:test";
import type { EventBus } from "../../src/events/index.js";
import type { NetworkingRepository } from "../../src/modules/networking/networking.repository.js";
import { NetworkingService } from "../../src/modules/networking/networking.service.js";
import type { NetworkingCard, PublicNetworkingCard } from "../../src/modules/networking/networking.types.js";

const noopEvents = {} as unknown as EventBus;

const fakeRepo = (over: Partial<NetworkingRepository> = {}): NetworkingRepository =>
  ({
    findByUserId: async () => ({ optIn: false, links: [] }),
    findPublicByUserId: async () => ({
      optIn: true,
      links: [],
      owner: {
        userId: 7,
        fullName: "Alumna Test",
        primaryDetail: "Ingenieria",
        secondaryDetail: "20230000 - Alumno",
        roleLabel: "Alumno",
      },
    }),
    replaceByUserId: async (_userId: number, optIn: boolean, link: NetworkingCard["links"][number] | null) => ({
      optIn,
      links: link ? [link] : [],
    }),
    ...over,
  }) as unknown as NetworkingRepository;

const expectHttpError = async (fn: () => Promise<unknown>, status: number, code: string) => {
  try {
    await fn();
    throw new Error(`se esperaba ${status} ${code} y no se lanzó`);
  } catch (error) {
    const actual = error as { statusCode?: number; code?: string };
    expect(actual.statusCode).toBe(status);
    expect(actual.code).toBe(code);
  }
};

describe("NetworkingService.getVisibleByUserId", () => {
  test("devuelve el carnet publico cuando sigue visible", async () => {
    const visible: PublicNetworkingCard = {
      optIn: true,
      links: [{ platform: "github", url: "https://github.com/a", label: null }],
      owner: {
        userId: 7,
        fullName: "Alumna Test",
        primaryDetail: "Ingenieria",
        secondaryDetail: "20230000 - Alumno",
        roleLabel: "Alumno",
      },
    };
    const service = new NetworkingService(fakeRepo({
      findPublicByUserId: async () => visible,
    }), noopEvents);

    expect(await service.getVisibleByUserId(7)).toEqual(visible);
  });

  test("si el usuario oculto el carnet responde 403", async () => {
    const service = new NetworkingService(fakeRepo({
      findPublicByUserId: async () => ({
        optIn: false,
        links: [],
        owner: {
          userId: 7,
          fullName: "Alumna Test",
          primaryDetail: "Ingenieria",
          secondaryDetail: "20230000 - Alumno",
          roleLabel: "Alumno",
        },
      }),
    }), noopEvents);

    await expectHttpError(
      () => service.getVisibleByUserId(7),
      403,
      "NETWORKING_CARD_HIDDEN",
    );
  });
});

describe("NetworkingService.getMine", () => {
  test("el propietario lee el enlace aunque el carnet esté oculto", async () => {
    const service = new NetworkingService(fakeRepo({
      findByUserId: async () => ({
        optIn: false,
        links: [{ platform: "linkedin", url: "https://linkedin.com/in/a", label: null }],
      }),
    }), noopEvents);

    expect(await service.getMine(7)).toEqual({
      optIn: false,
      links: [{ platform: "linkedin", url: "https://linkedin.com/in/a", label: null }],
    });
  });

  test("usuario inexistente responde 404", async () => {
    const service = new NetworkingService(fakeRepo({ findByUserId: async () => null }), noopEvents);
    await expectHttpError(() => service.getMine(999), 404, "USER_NOT_FOUND");
  });

  test("detecta datos históricos con más de una red", async () => {
    const service = new NetworkingService(fakeRepo({
      findByUserId: async () => ({
        optIn: true,
        links: [
          { platform: "github", url: "https://github.com/a", label: null },
          { platform: "instagram", url: "https://instagram.com/a", label: null },
        ],
      }),
    }), noopEvents);
    await expectHttpError(() => service.getMine(7), 500, "NETWORKING_DATA_INTEGRITY");
  });
});

describe("NetworkingService.updateMine", () => {
  test("activa con una red y deriva el propietario del argumento autenticado", async () => {
    let receivedUserId = -1;
    const service = new NetworkingService(fakeRepo({
      replaceByUserId: async (userId, optIn, link) => {
        receivedUserId = userId;
        return { optIn, links: link ? [link] : [] };
      },
    }), noopEvents);

    const result = await service.updateMine(42, {
      optIn: true,
      links: [{ platform: "github", url: " https://github.com/alumna " }],
    });

    expect(receivedUserId).toBe(42);
    expect(result).toEqual({
      optIn: true,
      links: [{ platform: "github", url: "https://github.com/alumna", label: null }],
    });
  });

  test("desactivar enviando el enlace lo conserva", async () => {
    const service = new NetworkingService(fakeRepo(), noopEvents);
    const result = await service.updateMine(8, {
      optIn: false,
      links: [{ platform: "instagram", url: "https://instagram.com/alumna" }],
    });
    expect(result.optIn).toBe(false);
    expect(result.links).toHaveLength(1);
  });

  test("desactivar con arreglo vacío elimina el enlace", async () => {
    const service = new NetworkingService(fakeRepo(), noopEvents);
    expect(await service.updateMine(8, { optIn: false, links: [] }))
      .toEqual({ optIn: false, links: [] });
  });

  test("activa el carnet sin enlace", async () => {
    let writes = 0;
    const service = new NetworkingService(fakeRepo({
      replaceByUserId: async (_userId, optIn, link) => {
        writes += 1;
        return { optIn, links: link ? [link] : [] };
      },
    }), noopEvents);

    expect(await service.updateMine(8, { optIn: true, links: [] }))
      .toEqual({ optIn: true, links: [] });
    expect(writes).toBe(1);
  });

  test("rechaza más de una red antes de escribir", async () => {
    let writes = 0;
    const service = new NetworkingService(fakeRepo({
      replaceByUserId: async () => {
        writes += 1;
        return { optIn: false, links: [] };
      },
    }), noopEvents);
    await expectHttpError(
      () => service.updateMine(8, {
        optIn: false,
        links: [
          { platform: "github", url: "https://github.com/a" },
          { platform: "instagram", url: "https://instagram.com/a" },
        ],
      }),
      400,
      "INVALID_NETWORKING_LINK_COUNT",
    );
    expect(writes).toBe(0);
  });

  test("rechaza enlace de dominio incorrecto antes de escribir", async () => {
    const service = new NetworkingService(fakeRepo(), noopEvents);
    await expectHttpError(
      () => service.updateMine(8, {
        optIn: true,
        links: [{ platform: "github", url: "https://example.com/a" }],
      }),
      400,
      "INVALID_NETWORKING_LINK",
    );
  });

  test("propietario inexistente responde 404", async () => {
    const service = new NetworkingService(fakeRepo({ replaceByUserId: async () => null }), noopEvents);
    await expectHttpError(
      () => service.updateMine(999, {
        optIn: true,
        links: [{ platform: "x", url: "https://x.com/alumna" }],
      }),
      404,
      "USER_NOT_FOUND",
    );
  });
});
