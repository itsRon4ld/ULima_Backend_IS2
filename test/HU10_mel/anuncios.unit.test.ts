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
 * PRUEBA UNITARIA — SectionManagementService.getAnnouncements() + mapAnnouncement() (HU10: gestión de anuncios académicos)
 * Fuente: src/modules/section-management/section-management.service.ts:80-91 (getAnnouncements),
 *         src/modules/section-management/section-management.service.ts:197-214 (mapAnnouncement),
 *         src/modules/section-management/section-management.service.ts:17-52 (splitName / formatDate / roleLabel)
 * ============================================================================
 * Qué valida: las reglas pequeñas y aisladas del servicio de anuncios, sin BD ni
 * HTTP, mockeando el repositorio. En concreto:
 *   - getAnnouncements consulta el historial POR REPRESENTANTE autenticado
 *     (representative.id), no por sección global.
 *   - mapAnnouncement -> splitName parte "Apellido, Nombre" cuando el full_name
 *     trae coma (lastName antes de la coma, firstName después).
 *   - mapAnnouncement -> formatDate serializa un published_at Date como ISO string.
 *   - mapAnnouncement -> roleLabel traduce la posición: subdelegate => "subdelegado".
 *
 * Casos:
 *   Caso 1 · getAnnouncements pide las filas usando el id del representante (17), no el sectionId (3).
 *   Caso 2 · full_name "Ruiz, Mel" se separa en lastName="Ruiz" / firstName="Mel".
 *   Caso 3 · published_at Date -> "2026-07-13T10:00:00.000Z" (ISO).
 *   Caso 4 · position "subdelegate" -> autor.role = "subdelegado".
 *
 */

// Objeto vacío forzado al tipo EventBus. Es un dummy porque estos tests no evalúan eventos, solo la lógica de anuncios.
const noopEvents = {} as unknown as EventBus;

// Representante autenticado de referencia: es el delegado (id 17) de la sección 3, ligado al alumno 42.
// getAnnouncements debe usar SU id (17), no el sectionId, para pedir el historial.
const representative: RepresentativeAccess = {
  id: 17, // id del representante -> este es el valor que esperamos ver llegar al repo
  sectionId: 3, // sección a la que pertenece
  studentId: 42, // alumno dueño de la cuenta representante
  position: "delegate", // rol: delegado
};

// Helper/fixture de una fila de anuncio tal como la devolvería el repositorio (formato crudo de BD).
const row = (over: Partial<AnnouncementRow> = {}): AnnouncementRow => ({
  id: 10, // id del anuncio
  section_id: 3, // sección del anuncio
  section_representative_id: 17, // representante que lo publicó (coincide con representative.id)
  title: "Entrega", // título del anuncio
  message: "Subir informe", // cuerpo del anuncio
  published_at: new Date("2026-07-13T10:00:00.000Z"), // fecha como Date -> el caso 3 verifica que se serialice a ISO
  autor_code: "20232637", // código del autor
  full_name: "Ruiz, Mel", // nombre "Apellido, Nombre" con coma -> el caso 2 verifica el split
  institutional_email: "20232637@aloe.ulima.edu.pe", // correo institucional del autor
  position: "delegate", // rol del autor -> el caso 4 lo sobrescribe a "subdelegate"
  ...over, // cada test sobrescribe solo lo que le importa
});

// Helper/fixture de ownership de anuncio (usado por otros métodos del servicio; aquí solo alimenta el repo mock).
const ownership = (over: Partial<AnnouncementOwnership> = {}): AnnouncementOwnership => ({
  id: 10, // id del anuncio
  sectionRepresentativeId: 17, // representante dueño
  sectionId: 3, // sección
  studentId: 42, // alumno dueño
  isActive: true, // anuncio activo (no borrado lógicamente)
  ...over, // permite sobrescribir campos puntuales
});

// Fábrica del repositorio mock: devuelve valores prefabricados para cada método que el servicio pueda llamar.
// Se mockea para no tocar la BD y aislar la lógica del servicio; overrides permite cambiar un método por test.
const makeRepo = (overrides: Partial<SectionManagementRepository> = {}) =>
  ({
    findRepresentativeAccess: async () => representative, // el servicio resuelve al representante autenticado
    findAnnouncementsByRepresentative: async () => [row()], // historial por defecto: una fila estándar
    createAnnouncement: async () => 10, // stub: devuelve un id
    findAnnouncementById: async () => row(), // stub: devuelve una fila
    findAnnouncementOwnership: async () => ownership(), // stub: devuelve ownership
    updateAnnouncement: async () => undefined, // stub: no-op
    softDeleteAnnouncement: async () => undefined, // stub: no-op
    ...overrides, // el test puede reemplazar un método concreto (p.ej. para capturar el id pedido)
  }) as unknown as SectionManagementRepository; // forzamos el tipo del repo real

describe("UNITARIA · HU10 SectionManagementService", () => {
  test("caso 1: el historial de gestion consulta por representante autenticado, no por seccion global", async () => {
    let requestedRepresentativeId = 0; // espía: aquí guardaremos el id con el que el servicio consulta el historial
    const service = new SectionManagementService(
      makeRepo({
        // sobrescribimos el método para CAPTURAR el id que el servicio le pasa
        findAnnouncementsByRepresentative: async (id) => {
          requestedRepresentativeId = id; // guardamos el id recibido para verificarlo luego
          return [row({ section_representative_id: id })]; // devolvemos una fila coherente con ese id
        },
      }),
      noopEvents,
    );

    const result = await service.getAnnouncements(42, 3); // llamamos con studentId=42 y sectionId=3

    expect(requestedRepresentativeId).toBe(17); // verifica que consultó por el id del REPRESENTANTE (17), no por el sectionId (3)
    expect(result.anuncios).toHaveLength(1); // verifica que devolvió el único anuncio prefabricado
  });

  test("caso 2: mapAnnouncement separa apellido/nombre cuando full_name viene con coma", async () => {
    const service = new SectionManagementService(makeRepo(), noopEvents); // servicio con repo estándar (full_name = "Ruiz, Mel")

    const result = await service.getAnnouncements(42, 3); // obtiene el historial mapeado

    expect(result.anuncios[0].autor.lastName).toBe("Ruiz"); // verifica que el apellido es lo que va ANTES de la coma
    expect(result.anuncios[0].autor.firstName).toBe("Mel"); // verifica que el nombre es lo que va DESPUÉS de la coma
  });

  test("caso 3: published_at Date se serializa como ISO string", async () => {
    const service = new SectionManagementService(makeRepo(), noopEvents); // repo estándar (published_at es un Date)

    const result = await service.getAnnouncements(42, 3); // obtiene el historial mapeado

    expect(result.anuncios[0].fecha).toBe("2026-07-13T10:00:00.000Z"); // verifica que el Date se serializó a string ISO (formatDate)
  });

  test("caso 4: subdelegado se expone como rol subdelegado en el autor", async () => {
    const service = new SectionManagementService(
      makeRepo({
        // fila cuyo autor es subdelegado -> el mapeo debe traducir el rol
        findAnnouncementsByRepresentative: async () => [row({ position: "subdelegate" })],
      }),
      noopEvents,
    );

    const result = await service.getAnnouncements(42, 3); // obtiene el historial mapeado

    expect(result.anuncios[0].autor.role).toBe("subdelegado"); // verifica que roleLabel traduce "subdelegate" -> "subdelegado"
  });
});
