import { describe, expect, test } from "bun:test";
import type { EventBus } from "../../src/events/index.js";
import type { SectionManagementRepository } from "../../src/modules/section-management/section-management.repository.js";
import { SectionManagementService } from "../../src/modules/section-management/section-management.service.js";
import type {
  AnnouncementRow,
  RepresentativeAccess,
} from "../../src/modules/section-management/section-management.types.js";

/**
 * ============================================================================
 * PRUEBA UNITARIA — SectionManagementService.getAnnouncements() (HU10: anuncios del delegado)
 * Fuente: src/modules/section-management/section-management.service.ts:80-91
 * ============================================================================
 * Qué valida:
 *   Que el servicio, dado un studentId + sectionId, resuelva primero al
 *   representante autenticado (requireRepresentative -> findRepresentativeAccess)
 *   y luego pida los anuncios USANDO EL id del representante (no el studentId
 *   ni el sectionId), garantizando que solo devuelve los anuncios creados por
 *   ese representante. También verifica que el mapeo transforma cada fila cruda
 *   en la respuesta de dominio (id numérico -> string).
 *
 * Se aísla el repositorio con un doble (fakeRepo) para probar SOLO la lógica
 * del service, sin tocar PostgreSQL. Se captura el argumento con el que se
 * llamó a findAnnouncementsByRepresentative para asegurar el flujo de datos.
 *
 * Casos:
 *   | # | Caso                                                    | Esperado                                   |
 *   |---|---------------------------------------------------------|--------------------------------------------|
 *   | 1 | delegado válido pide sus anuncios en gestión            | pide con representante.id=17; 1 anuncio "10" |
 *
 */

// Objeto vacío forzado al tipo EventBus: es un doble "dummy" porque getAnnouncements
// no emite eventos, así que su implementación real no importa para este test.
const noopEvents = {} as unknown as EventBus;

// Fixture del representante autenticado (delegado): así luce lo que devuelve
// findRepresentativeAccess cuando el alumno SÍ es delegado/subdelegado de la sección.
const representative: RepresentativeAccess = {
  id: 17,          // id del section_representative -> es la clave con la que se filtran los anuncios
  sectionId: 3,    // sección sobre la que gestiona
  studentId: 42,   // alumno detrás del representante
  position: "delegate", // cargo (delegado); determina la etiqueta de rol en el mapeo
};

// Helper que fabrica una fila cruda de anuncio (tal como la devolvería el repositorio/BD).
// Recibe el id del anuncio y el id del representante autor para poder variarlos por caso.
const announcementRow = (id: number, representativeId: number): AnnouncementRow => ({
  id,                                    // id numérico del anuncio (el mapeo lo convierte a string)
  section_id: 3,                         // sección del anuncio
  section_representative_id: representativeId, // autor: el representante que lo publicó
  title: `Anuncio ${id}`,                // título simulado
  message: `Mensaje ${id}`,              // cuerpo simulado
  published_at: "2026-07-13T00:00:00.000Z", // fecha ISO que luego se formatea
  autor_code: "20230001",                // código del alumno autor
  full_name: "Delegado Uno",             // nombre completo (se parte en el mapeo)
  institutional_email: "20230001@aloe.ulima.edu.pe", // correo institucional del autor
  position: "delegate",                  // cargo del autor -> etiqueta de rol
});

// Doble del repositorio: devuelve valores por defecto sensatos y permite
// sobrescribir métodos por caso vía overrides. Se castea al tipo del repo real
// para satisfacer TypeScript sin implementar toda la interfaz.
const fakeRepo = (
  overrides: Partial<SectionManagementRepository> = {},
): SectionManagementRepository =>
  ({
    // por defecto: el alumno SÍ es representante de la sección
    findRepresentativeAccess: async () => representative,
    // por defecto: hay 1 anuncio creado por ese representante
    findAnnouncementsByRepresentative: async () => [announcementRow(1, representative.id)],
    ...overrides, // cada test reemplaza solo lo que necesita
  }) as unknown as SectionManagementRepository;

describe("SectionManagementService.getAnnouncements", () => {
  test("en gestion devuelve solo anuncios creados por el representante autenticado", async () => {
    // Variable espía: aquí guardaremos el id con el que el service consulta los anuncios,
    // para comprobar que usa el id del REPRESENTANTE y no el studentId ni el sectionId.
    let requestedRepresentativeId = 0;
    const service = new SectionManagementService(
      fakeRepo({
        // Devuelve el representante pero reflejando los studentId/sectionId recibidos,
        // confirmando que el service pasa los parámetros correctos a la resolución de acceso.
        findRepresentativeAccess: async (studentId, sectionId) => ({
          ...representative,
          studentId,
          sectionId,
        }),
        // Captura el argumento real y devuelve un anuncio "10" atribuido a ese id.
        findAnnouncementsByRepresentative: async (sectionRepresentativeId) => {
          requestedRepresentativeId = sectionRepresentativeId; // guardamos el id usado
          return [announcementRow(10, sectionRepresentativeId)];
        },
      }),
      noopEvents,
    );

    // Ejecuta el método bajo prueba: alumno 42 pidiendo anuncios de la sección 3.
    const result = await service.getAnnouncements(42, 3);

    // verifica que los anuncios se pidieron con el id del representante (17), no con 42 ni 3
    expect(requestedRepresentativeId).toBe(17);
    // verifica que se devuelve exactamente un anuncio (el que produjo el doble)
    expect(result.anuncios).toHaveLength(1);
    // verifica que el mapeo convirtió el id numérico 10 en la cadena "10"
    expect(result.anuncios[0].id).toBe("10");
  });
});
