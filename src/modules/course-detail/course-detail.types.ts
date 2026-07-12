export type CourseDetailTab = "announcements" | "advising" | "contacts";

export type RawAnnouncementRow = {
  id: number;
  title: string;
  message: string;
  published_at: Date | string | null;
  autor_code: string;
  full_name: string;
  institutional_email: string;
  position: string;
};

export type AnnouncementAuthorResponse = {
  code: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  career_id: null;
  currentCycle: string;
  setupComplete: true;
};

export type AnnouncementResponse = {
  id: string;
  idSeccion: string;
  titulo: string;
  mensaje: string;
  fecha: string;
  autorCode: string;
  autor: AnnouncementAuthorResponse;
};

export type AnnouncementsResult = {
  anuncios: AnnouncementResponse[];
};

export type TeacherResponse = {
  code: string;
  firstName: string;
  lastName: string;
};

export type RawContactTeacherRow = {
  teacher_code: string | null;
  full_name: string;
};

export type RawContactStudentRow = {
  enrollment_id: number;
  code: string;
  full_name: string;
  institutional_email: string;
  career_id: number | null;
  position: string | null;
};

export type ContactUserResponse = {
  code: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  career_id: number | null;
  currentCycle: string;
  setupComplete: true;
};

export type ContactStudentResponse = {
  user: ContactUserResponse;
  roleInSection: string;
};

export type ContactsResult = {
  docente: TeacherResponse | null;
  alumnos: ContactStudentResponse[];
};
