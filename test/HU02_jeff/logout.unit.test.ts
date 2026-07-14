import { describe, expect, test } from "bun:test";
import { EventBus } from "../../src/events/index.js";
import type { AuthRepository } from "../../src/modules/auth/auth.repository.js";
import { AuthRepository as AuthRepositoryClass } from "../../src/modules/auth/auth.repository.js";
import { AuthService } from "../../src/modules/auth/auth.service.js";

/**
 * ============================================================================
 * PRUEBA UNITARIA — Cierre de sesión / invalidación de token (HU02)
 * ============================================================================
 * Fuente:
 *   - AuthService.logout()                    src/modules/auth/auth.service.ts:234-240
 *   - AuthRepository.incrementTokenVersion()  src/modules/auth/auth.repository.ts:89-98
 *
 * Qué valida:
 *   El esquema "Single Active Session": cerrar sesión (o iniciar una nueva)
 *   INCREMENTA `app_user.token_version`; el `authMiddleware` rechaza cualquier
 *   JWT cuya versión ya no coincida con la de la BD. Aquí probamos las dos piezas
 *   de forma AISLADA (unitaria), con dependencias falsas (repo / db) y sin tocar
 *   la base real:
 *     1) que logout() delega en incrementTokenVersion() con el id correcto,
 *     2) que logout() es best-effort (traga el error de BD, resuelve void),
 *     3) que incrementTokenVersion() normaliza el resultado a number (Postgres
 *        puede devolver el count como string) y aplica el default 1 sin lanzar.
 *
 * Casos (≥4):
 *   caso 1: logout(42)              -> incrementTokenVersion llamado 1 vez con 42
 *   caso 2: logout(7)               -> usa su propio id (no cruza sesiones)
 *   caso 3: logout con BD que falla -> NO propaga la excepción (resuelve void)
 *   caso 4: incrementTokenVersion   -> devuelve la nueva versión como number
 *   caso 5: incrementTokenVersion   -> fila vacía => default 1 (valor límite)
 *   caso 6: incrementTokenVersion   -> "9" (string de Postgres) => 9 (number)
 */

// --- Fakes -------------------------------------------------------------------
// Repositorio falso (doble de prueba): en vez de la BD real, guarda en memoria
// los ids con que se llamó a incrementTokenVersion y, opcionalmente, simula un
// fallo de BD. Así aislamos AuthService.logout() de la persistencia.
const fakeRepo = (opts: { throwOnIncrement?: boolean } = {}) => {
  const calls = { incrementedUserIds: [] as number[] }; // "espía": aquí se acumulan los ids recibidos
  const repository = {
    incrementTokenVersion: async (userId: number) => { // el único método que logout() invoca
      calls.incrementedUserIds.push(userId); // captura el id para poder afirmarlo luego
      if (opts.throwOnIncrement) throw new Error("fallo de BD"); // simula caída de la BD cuando el test lo pide
      return 1; // valor de retorno irrelevante para logout(); solo cumple la firma
    },
  } as unknown as AuthRepository; // forzamos el tipo: el fake solo implementa lo que el test necesita
  return { repository, calls }; // devolvemos el repo falso y el espía de llamadas
};

/** Construye un AuthRepository REAL pero con un `database.execute` controlado,
 *  de modo que probamos el mapeo real de incrementTokenVersion() sobre filas
 *  prefabricadas (sin conexión real a Postgres). */
const repoWithDbRows = (rows: unknown) =>
  new AuthRepositoryClass(
    { execute: async () => rows } as unknown as ConstructorParameters<typeof AuthRepositoryClass>[0], // db falsa: execute() siempre devuelve `rows`
  );

// --- Tests -------------------------------------------------------------------
describe("UNITARIA · logout / invalidación de token (HU02)", () => {
  test("caso 1: logout(userId) invalida la sesión llamando incrementTokenVersion 1 vez con el id correcto", async () => {
    const { repository, calls } = fakeRepo(); // repo falso sin fallo
    const service = new AuthService(repository, new EventBus()); // servicio bajo prueba con el repo falso

    await service.logout(42); // ejercita el método: cerrar sesión del usuario 42

    expect(calls.incrementedUserIds).toEqual([42]); // verifica que se llamó exactamente una vez y con el id 42
  });

  test("caso 2: logout de otro usuario usa su propio id (no cruza sesiones)", async () => {
    const { repository, calls } = fakeRepo(); // repo falso limpio
    const service = new AuthService(repository, new EventBus()); // servicio bajo prueba

    await service.logout(7); // cierra sesión del usuario 7

    expect(calls.incrementedUserIds).toEqual([7]); // verifica que usó el id 7 (no otro): sin cruce de sesiones
  });

  test("caso 3: si la BD falla, logout NO propaga la excepción (traga el error, resuelve void)", async () => {
    const { repository, calls } = fakeRepo({ throwOnIncrement: true }); // repo falso que lanza al incrementar
    const service = new AuthService(repository, new EventBus()); // servicio bajo prueba

    // No debe lanzar: el endpoint /logout responde 200 igual (best-effort).
    await expect(service.logout(42)).resolves.toBeUndefined(); // verifica que resuelve void y NO relanza el error de BD
    expect(calls.incrementedUserIds).toEqual([42]); // verifica que sí intentó incrementar (llegó a llamar al repo con 42)
  });

  test("caso 4: incrementTokenVersion devuelve la NUEVA versión como número (no string)", async () => {
    const repo = repoWithDbRows([{ token_version: 8 }]); // repo real con una fila que trae token_version = 8

    const version = await repo.incrementTokenVersion(42); // ejecuta el mapeo real sobre esa fila

    expect(version).toBe(8); // verifica que devuelve la versión de la fila (8)
    expect(typeof version).toBe("number"); // verifica que el tipo es number (no string)
  });

  test("caso 5: incrementTokenVersion con fila vacía → default 1 sin lanzar (valor límite)", async () => {
    const repo = repoWithDbRows([]); // caso límite: execute() no devuelve filas

    await expect(repo.incrementTokenVersion(42)).resolves.toBe(1); // verifica que aplica el default 1 (rows[0]?.token_version ?? 1) sin lanzar
  });

  test("caso 6: incrementTokenVersion normaliza token_version tipo string de Postgres → number", async () => {
    const repo = repoWithDbRows([{ token_version: "9" }]); // Postgres puede devolver el número como string "9"

    const version = await repo.incrementTokenVersion(42); // ejecuta el mapeo real (Number(...))

    expect(version).toBe(9); // verifica que "9" se normaliza a 9
    expect(typeof version).toBe("number"); // verifica que quedó como number, no como string
  });
});
