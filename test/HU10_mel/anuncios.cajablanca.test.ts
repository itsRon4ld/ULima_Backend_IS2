/*
  bun test test/HU10_mel/anuncios.cajablanca.test.ts
*/

import { describe, expect, test } from "bun:test";
import type { EventBus } from "../../src/events/index.js";
import type { SectionManagementRepository } from "../../src/modules/section-management/section-management.repository.js";
import { SectionManagementService } from "../../src/modules/section-management/section-management.service.js";
import type {
  AnnouncementOwnership,
  AnnouncementRow,
  RepresentativeAccess,
} from "../../src/modules/section-management/section-management.types.js";

/**
 * ============================================================================
 * CAJA BLANCA — SectionManagementService.create/update/deleteAnnouncement() (HU10: gestión de anuncios)
 * Fuente: src/modules/section-management/section-management.service.ts:106-195
 * ============================================================================
 * NODOS/PREDICADOS de los métodos (createAnnouncement + updateAnnouncement + deleteAnnouncement):
 *   P1  requireRepresentative(): if (!representative)         -> 403 SECTION_FORBIDDEN
 *   P2  createAnnouncement():    if (!created)                -> 500 ANNOUNCEMENT_CREATE_FAILED
 *   P3  requireAnnouncementOwner(): if (!ownership || !isActive) -> 404 ANNOUNCEMENT_NOT_FOUND
 *   P4  requireAnnouncementOwner(): if (ownership.studentId !== studentId) -> 403 ANNOUNCEMENT_FORBIDDEN
 *   P5  deleteAnnouncement():    softDeleteAnnouncement(id) sobre el id autorizado (nodo de acción)
 *
 * V(G) ≈ 4 decisiones (P1..P4) + 1 nodo de acción (P5) ⇒ 5 caminos independientes.
 * Batería: un test por predicado relevante, aislando la BD con un repositorio
 * falso (fake) y observando qué error lanza o qué acción ejecuta el servicio.
 *
 * | # | Camino probado                              | Entrada que lo fuerza            | Esperado                       |
 * |---|---------------------------------------------|----------------------------------|--------------------------------|
 * | C1| P1(V) -> crear -> P2(V)                     | delegado válido en la sección    | anuncio creado con rep. id 7   |
 * | C2| P1(F)                                       | alumno sin representación        | 403 SECTION_FORBIDDEN          |
 * | C3| P1(V) -> crear -> P2(F)                     | repo no recupera el anuncio      | 500 ANNOUNCEMENT_CREATE_FAILED |
 * | C4| P3(V) -> P4(F)                              | anuncio de otro studentId        | 403 ANNOUNCEMENT_FORBIDDEN     |
 * | C5| P3(V) -> P4(V) -> soft delete               | anuncio propio                   | elimina exactamente el id 50   |
 *
 * Alcance:
 *   No prueba HTTP ni BD real. Se concentra en reglas de negocio, autorización
 *   (el delegado solo gestiona SUS anuncios) y caminos internos del servicio.
 */

// Objeto vacío forzado al tipo EventBus. Es un dummy porque estos caminos no evalúan la emisión de eventos, solo la lógica de anuncios.
const noopEvents = {} as unknown as EventBus;

// Representante "delegado" por defecto: el alumno 100 es delegado (id 7) de la sección 20. Es lo que devuelve el repo cuando SÍ hay representación.
const representative: RepresentativeAccess = {
  id: 7, // id de la representación (section_representative_id) que se graba en el anuncio
  sectionId: 20, // sección sobre la que tiene permiso de gestión
  studentId: 100, // alumno dueño de esa representación
  position: "delegate", // cargo (delegado)
};

// Helper para fabricar filas de anuncio ya "hidratadas" (como salen del JOIN de la BD). Valores por defecto sensatos; cada test sobrescribe solo lo que le importa.
const row = (over: Partial<AnnouncementRow> = {}): AnnouncementRow => ({
  id: 50, // id del anuncio
  section_id: 20, // sección a la que pertenece
  section_representative_id: 7, // representación autora (coincide con representative.id)
  title: "Parcial", // título del anuncio
  message: "Repasar capitulos 1 y 2", // cuerpo del anuncio
  published_at: "2026-07-13T00:00:00.000Z", // fecha de publicación
  autor_code: "20230001", // código del alumno autor
  full_name: "Torres, Ana", // nombre del autor
  institutional_email: "20230001@aloe.ulima.edu.pe", // correo institucional del autor
  position: "delegate", // cargo del autor
  ...over, // permite que cada test cambie solo los campos que necesita
});

// Helper para fabricar el "ownership" (quién es dueño de un anuncio), que usa requireAnnouncementOwner para decidir si autoriza. Por defecto: anuncio propio y activo.
const ownership = (over: Partial<AnnouncementOwnership> = {}): AnnouncementOwnership => ({
  id: 50, // id del anuncio consultado
  sectionRepresentativeId: 7, // representación autora
  sectionId: 20, // sección del anuncio
  studentId: 100, // alumno dueño (si != al que pide, salta ANNOUNCEMENT_FORBIDDEN)
  isActive: true, // anuncio vigente (si false, salta ANNOUNCEMENT_NOT_FOUND)
  ...over, // cada test sobrescribe solo lo relevante
});

// Repositorio falso (fake): simula todos los métodos que el servicio pide a la BD, con respuestas "felices" por defecto. Cada test inyecta overrides para forzar un camino.
const makeRepo = (overrides: Partial<SectionManagementRepository> = {}) =>
  ({
    findRepresentativeAccess: async () => representative, // por defecto SÍ hay representación (P1 verdadero)
    findAnnouncementsByRepresentative: async () => [row()], // lista de anuncios del delegado
    createAnnouncement: async () => 50, // al crear, devuelve el id 50 del nuevo anuncio
    findAnnouncementById: async () => row(), // por defecto SÍ recupera el anuncio creado (P2 verdadero)
    findAnnouncementOwnership: async () => ownership(), // por defecto el anuncio es propio y activo (P3/P4 verdaderos)
    updateAnnouncement: async () => undefined, // edición sin retorno relevante
    softDeleteAnnouncement: async () => undefined, // borrado lógico sin retorno relevante
    ...overrides, // los overrides del test tienen prioridad para forzar el camino a probar
  }) as unknown as SectionManagementRepository; // forzamos el tipo del repositorio real

// Helper que ejecuta una acción que DEBE fallar y verifica el HttpError (statusCode + code) esperado. Si no lanza, el test falla explícitamente.
const expectHttpError = async (action: Promise<unknown>, statusCode: number, code: string) => {
  try {
    await action; // ejecuta la promesa que esperamos que rechace
    throw new Error(`Se esperaba ${statusCode} ${code}`); // si NO lanzó, forzamos un fallo del test
  } catch (error) {
    const httpError = error as { statusCode?: number; code?: string }; // leemos el error como HttpError
    expect(httpError.statusCode).toBe(statusCode); // verifica que el código HTTP sea el esperado (p.ej. 403)
    expect(httpError.code).toBe(code); // verifica que el código de negocio sea el esperado (p.ej. SECTION_FORBIDDEN)
  }
};

describe("CAJA BLANCA · HU10 SectionManagementService", () => {
  test("C1: delegado valido crea anuncio con el sectionRepresentativeId autenticado", async () => {
    let capturedRepresentativeId = 0; // espía: guardará con qué representación se creó el anuncio
    const service = new SectionManagementService(
      makeRepo({
        createAnnouncement: async (input) => {
          capturedRepresentativeId = input.sectionRepresentativeId; // capturamos el id de representación que el servicio pasa al repo
          return 50; // devolvemos el id del anuncio creado
        },
      }),
      noopEvents,
    );

    const result = await service.createAnnouncement(100, 20, { // alumno 100 crea anuncio en sección 20
      title: "Parcial",
      message: "Repasar capitulos 1 y 2",
    });

    expect(capturedRepresentativeId).toBe(7); // verifica que el anuncio se grabó con la representación autenticada (id 7), NO con un id del cliente
    expect(result.anuncio.id).toBe("50"); // verifica que devuelve el anuncio recién creado, con su id serializado a string "50"
  });

  test("C2: alumno sin representacion no puede crear anuncios en la seccion", async () => {
    const service = new SectionManagementService(
      makeRepo({ findRepresentativeAccess: async () => null }), // forzamos P1 falso: NO hay representación para este alumno
      noopEvents,
    );

    await expectHttpError( // verifica que crear anuncio sin ser representante lanza 403 SECTION_FORBIDDEN
      service.createAnnouncement(999, 20, { title: "T", message: "M" }), // alumno 999 (sin cargo) intenta publicar
      403,
      "SECTION_FORBIDDEN",
    );
  });

  test("C3: si el anuncio creado no se recupera, retorna ANNOUNCEMENT_CREATE_FAILED", async () => {
    const service = new SectionManagementService(
      makeRepo({ findAnnouncementById: async () => null }), // forzamos P2 falso: tras crear, la BD no devuelve el anuncio
      noopEvents,
    );

    await expectHttpError( // verifica que un create sin recuperación posterior lanza 500 ANNOUNCEMENT_CREATE_FAILED
      service.createAnnouncement(100, 20, { title: "T", message: "M" }),
      500,
      "ANNOUNCEMENT_CREATE_FAILED",
    );
  });

  test("C4: editar anuncio de otro alumno esta prohibido", async () => {
    const service = new SectionManagementService(
      makeRepo({ findAnnouncementOwnership: async () => ownership({ studentId: 200 }) }), // el anuncio pertenece a OTRO alumno (200), no al 100 -> P4 falso
      noopEvents,
    );

    await expectHttpError( // verifica que editar un anuncio ajeno lanza 403 ANNOUNCEMENT_FORBIDDEN
      service.updateAnnouncement(100, 50, { title: "Nuevo", message: "Texto" }), // alumno 100 intenta editar el anuncio 50 (de 200)
      403,
      "ANNOUNCEMENT_FORBIDDEN",
    );
  });

  test("C5: borrar anuncio propio invoca soft delete exactamente sobre ese id", async () => {
    const deletedIds: number[] = []; // espía: registrará los ids sobre los que se llamó al borrado lógico
    const service = new SectionManagementService(
      makeRepo({ softDeleteAnnouncement: async (id) => void deletedIds.push(id) }), // capturamos el id que el servicio manda a borrar
      noopEvents,
    );

    const result = await service.deleteAnnouncement(100, 50); // alumno 100 (dueño) borra su anuncio 50

    expect(deletedIds).toEqual([50]); // verifica que se borró EXACTAMENTE el id 50 (ni otro id, ni de más)
    expect(result.message).toContain("eliminado"); // verifica que el mensaje de éxito confirma la eliminación
  });
});
