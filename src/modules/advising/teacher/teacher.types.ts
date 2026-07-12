import type { AdvisingModality } from "./teacher.logic.js";

export type DictanteRol = "Profesor" | "JP";

export type TeacherSection = {
  sectionId: number;
  courseOfferingId: number;
  courseName: string;
  sectionCode: string;
  rol: DictanteRol;
};

export type AdvisingSessionView = {
  id: number;
  sectionId: number | null;
  courseOfferingId: number;
  courseName: string;
  sectionCode: string | null;
  kind: "recurring" | "extra";
  dia: string;
  fecha: string | null;
  inicio: string;
  fin: string;
  modality: AdvisingModality;
  aula: string;
  zoom: string;
  nota: string;
  cupo: number | null;
  asistentes: number;
  rol: DictanteRol;
};

export type Attendee = {
  code: string;
  firstName: string;
  lastName: string;
};

export type ActivePeriod = {
  id: number;
  startDate: string;
  endDate: string;
};
