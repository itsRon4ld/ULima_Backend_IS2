export type RawAdvisingRow = {
  id: number;
  course_offering_id: number;
  section_id: number | null;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
  classroom: string | null;
  meeting_url: string | null;
  teacher_code: string | null;
  full_name: string;
  kind: string | null;
  session_date: string | null;
  dictante_rol: string | null;
  asistentes: number | null;
  my_rsvp: boolean | null;
};

export type TeacherResponse = {
  code: string;
  firstName: string;
  lastName: string;
};

export type AdvisingResponse = {
  id: string;
  courseId: string;
  docenteCode: string;
  docente: TeacherResponse;
  dia: string;
  inicio: string;
  fin: string;
  aula: string;
  zoom: string;
  kind: string;
  fecha: string | null;
  dictanteRol: string;
  asistentes: number;
  myRsvp: boolean;
};

export type AdvisingResult = {
  asesorias: AdvisingResponse[];
};

export type RsvpResult = {
  id: string;
  asistentes: number;
  myRsvp: boolean;
};
