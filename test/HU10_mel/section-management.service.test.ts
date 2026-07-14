import { describe, expect, test } from "bun:test";
import type { EventBus } from "../../src/events/index.js";
import type { SectionManagementRepository } from "../../src/modules/section-management/section-management.repository.js";
import { SectionManagementService } from "../../src/modules/section-management/section-management.service.js";
import type {
  AnnouncementRow,
  RepresentativeAccess,
} from "../../src/modules/section-management/section-management.types.js";

const noopEvents = {} as unknown as EventBus;

const representative: RepresentativeAccess = {
  id: 17,
  sectionId: 3,
  studentId: 42,
  position: "delegate",
};

const announcementRow = (id: number, representativeId: number): AnnouncementRow => ({
  id,
  section_id: 3,
  section_representative_id: representativeId,
  title: `Anuncio ${id}`,
  message: `Mensaje ${id}`,
  published_at: "2026-07-13T00:00:00.000Z",
  autor_code: "20230001",
  full_name: "Delegado Uno",
  institutional_email: "20230001@aloe.ulima.edu.pe",
  position: "delegate",
});

const fakeRepo = (
  overrides: Partial<SectionManagementRepository> = {},
): SectionManagementRepository =>
  ({
    findRepresentativeAccess: async () => representative,
    findAnnouncementsByRepresentative: async () => [announcementRow(1, representative.id)],
    ...overrides,
  }) as unknown as SectionManagementRepository;

describe("SectionManagementService.getAnnouncements", () => {
  test("en gestion devuelve solo anuncios creados por el representante autenticado", async () => {
    let requestedRepresentativeId = 0;
    const service = new SectionManagementService(
      fakeRepo({
        findRepresentativeAccess: async (studentId, sectionId) => ({
          ...representative,
          studentId,
          sectionId,
        }),
        findAnnouncementsByRepresentative: async (sectionRepresentativeId) => {
          requestedRepresentativeId = sectionRepresentativeId;
          return [announcementRow(10, sectionRepresentativeId)];
        },
      }),
      noopEvents,
    );

    const result = await service.getAnnouncements(42, 3);

    expect(requestedRepresentativeId).toBe(17);
    expect(result.anuncios).toHaveLength(1);
    expect(result.anuncios[0].id).toBe("10");
  });
});
