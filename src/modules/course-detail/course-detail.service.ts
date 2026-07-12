import type { EventBus } from "../../events/index.js";
import type { CourseDetailRepository } from "./course-detail.repository.js";
import type {
  AnnouncementsResult,
  ContactsResult,
  RawContactTeacherRow,
  TeacherResponse,
} from "./course-detail.types.js";

const splitName = (fullName: string) => {
  if (fullName.includes(",")) {
    const parts = fullName.split(",");
    return {
      lastName: parts[0].trim(),
      firstName: parts.slice(1).join(",").trim(),
    };
  }

  const parts = fullName.trim().split(/\s+/);
  if (parts.length > 2) {
    return {
      lastName: parts.slice(0, 2).join(" "),
      firstName: parts.slice(2).join(" "),
    };
  }
  if (parts.length === 2) {
    return {
      lastName: parts[0],
      firstName: parts[1],
    };
  }

  return {
    firstName: fullName,
    lastName: "",
  };
};

const formatDate = (value: Date | string | null) => {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
};

const representativeRole = (position: string) => {
  if (position === "delegate") return "DELEGADO";
  if (position === "subdelegate") return "SUBDELEGADO";
  return "estudiante";
};

const contactRole = (position: string | null) => {
  if (position === "delegate") return "delegado";
  if (position === "subdelegate") return "subdelegado";
  return "estudiante";
};

const mapTeacher = (row: RawContactTeacherRow): TeacherResponse => ({
  code: row.teacher_code ?? "",
  ...splitName(row.full_name),
});

export class CourseDetailService {
  constructor(
    readonly repository: CourseDetailRepository,
    readonly events: EventBus,
  ) {}

  async getAnnouncements(sectionId: number): Promise<AnnouncementsResult> {
    const rows = await this.repository.findAnnouncementsBySectionId(sectionId);

    return {
      anuncios: rows.map((row) => ({
        id: String(row.id),
        idSeccion: String(sectionId),
        titulo: row.title,
        mensaje: row.message,
        fecha: formatDate(row.published_at),
        autorCode: row.autor_code,
        autor: {
          code: row.autor_code,
          ...splitName(row.full_name),
          email: row.institutional_email,
          role: representativeRole(row.position),
          career_id: null,
          currentCycle: "2026-1",
          setupComplete: true,
        },
      })),
    };
  }

  async getContacts(sectionId: number): Promise<ContactsResult> {
    const [teacher, students] = await Promise.all([
      this.repository.findContactTeacherBySectionId(sectionId),
      this.repository.findContactStudentsBySectionId(sectionId),
    ]);

    return {
      docente: teacher ? mapTeacher(teacher) : null,
      alumnos: students.map((row) => {
        const role = contactRole(row.position);
        return {
          user: {
            code: row.code,
            ...splitName(row.full_name),
            email: row.institutional_email,
            role,
            career_id: row.career_id,
            currentCycle: "2026-1",
            setupComplete: true,
          },
          roleInSection: role,
        };
      }),
    };
  }
}
