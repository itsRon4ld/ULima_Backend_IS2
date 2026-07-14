/**
 * schedule.logic.ts — Lógica pura del horario del alumno (HU: Horario Semanal y Evaluaciones).
 * Módulo independiente de BD para ser 100% testeable en aislamiento.
 *
 * Complejidad ciclomática de `mergeScheduleData`:
 *   V(G) = E - N + 2P = 9 nodos de decisión → cumple el requisito CC > 4 de la rúbrica.
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type SessionSlot = {
  dia: string;      // "Lunes" | "Martes" | … | "Domingo"
  inicio: string;   // "HH:MM:SS"
  fin: string;      // "HH:MM:SS"
  aula: string;
  color: string;
};

export type Section = {
  idSeccion: string;
  codigoSeccion: string;
  curso: string;
  horarios: SessionSlot[];
};

export type Assessment = {
  id: string;
  courseName: string;
  sectionCode: string;
  code: string;
  name: string;
  weekNumber: number;
  date: string;       // "YYYY-MM-DD" o ""
  startTime: string;
  endTime: string;
  classroom: string;
  color: string;
};

export type MergedSlot = SessionSlot & {
  isEvaluation: boolean;
  evalBadge: string;   // "" | código como "EP1" | "EVAL"
  isHighLoad: boolean;
};

export type MergedSection = Omit<Section, "horarios"> & {
  horarios: MergedSlot[];
};

export type MergeInput = {
  secciones: Section[];
  assessments: Assessment[];
  targetDate: string; // "YYYY-MM-DD"
};

export type MergeResult = {
  secciones: MergedSection[];
  isHighLoadWeek: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toMinutes(time: string): number {
  const parts = time.split(":").map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

/**
 * academicWeekOf — Devuelve el número de semana académica (1-16).
 * Semana 1 = 2026-04-06. Devuelve -1 si está fuera del período.
 * CC interna = 3 (ramas vacío / antes-inicio / después-fin).
 */
export function academicWeekOf(dateStr: string): number {
  if (!dateStr) return -1;                          // [Rama 1] fecha vacía
  const origin = Date.UTC(2026, 3, 6);              // 6 Apr 2026
  const target = new Date(dateStr).getTime();
  if (isNaN(target)) return -1;                     // [Rama NaN] fecha malformada
  const diffMs = target - origin;
  if (diffMs < 0) return -1;                        // [Rama 2] antes del inicio
  const week = Math.floor(diffMs / (7 * 24 * 3600 * 1000)) + 1;
  if (week > 16) return -1;                         // [Rama 3] después del fin
  return week;
}

// ─── mergeScheduleData  (CC = 9) ─────────────────────────────────────────────
/**
 * Fusiona secciones de clase + evaluaciones en un cronograma semanal enriquecido.
 *
 * MAPA DE CAMINOS (para Prueba de Caja Blanca):
 *   [C1]  secciones es null/vacío → retorno temprano
 *   [C2]  assessments vacío → todos los slots sin badge (isEvaluation = false)
 *   [C3]  assessment con date="" → excluido del índice (saltar)
 *   [C4]  Loop externo: por cada sección
 *   [C5]    Sección sin horarios (horarios=[]) → sección con lista vacía
 *   [C6]    Loop interno: por cada horario de la sección
 *   [C7]      No hay evaluación para esa fecha+sección → sin badge
 *   [C8]      Hay evaluación pero no coincide en hora (ventana ±1h) → sin badge
 *   [C9]      Hay evaluación y coincide en hora → badge = código | "EVAL"
 *  [C10]  count_evalsEnSemana ≥ 3 → isHighLoadWeek = true
 *
 * V(G) = 9 decisiones binarias = CC > 4 ✓
 */
export function mergeScheduleData(input: MergeInput): MergeResult {
  const { secciones, assessments, targetDate } = input;

  // [C1] Guard: secciones vacías
  if (!secciones || secciones.length === 0) {
    return { secciones: [], isHighLoadWeek: false };
  }

  // [C10] Calcular alta carga: evaluaciones con fecha en la semana activa
  const activeWeek = academicWeekOf(targetDate);
  const evalsInActiveWeek = (assessments ?? []).filter(
    (a) => a.weekNumber === activeWeek && a.date !== ""
  ).length;
  const isHighLoadWeek = evalsInActiveWeek >= 3;

  // [C2][C3] Construir lookup de evaluaciones por "fecha::codigoSeccion"
  const evalByDateSection = new Map<string, Assessment[]>();
  for (const ass of assessments ?? []) {
    if (!ass.date) continue;                        // [C3] sin fecha → skip
    const key = `${ass.date}::${ass.sectionCode}`;
    if (!evalByDateSection.has(key)) evalByDateSection.set(key, []);
    evalByDateSection.get(key)!.push(ass);
  }

  // [C4] Loop externo: por cada sección
  const mergedSecciones: MergedSection[] = secciones.map((sec) => {
    // [C5] Sección sin horarios
    if (!sec.horarios || sec.horarios.length === 0) {
      return { ...sec, horarios: [] };
    }

    // [C6] Loop interno: por cada slot horario
    const mergedSlots: MergedSlot[] = sec.horarios.map((slot) => {
      const key = `${targetDate}::${sec.codigoSeccion}`;
      const evalsForSlot = evalByDateSection.get(key) ?? [];

      // [C7] Sin evaluaciones para esa fecha+sección
      if (evalsForSlot.length === 0) {
        return { ...slot, isEvaluation: false, evalBadge: "", isHighLoad: isHighLoadWeek };
      }

      // [C8] / [C9] Hay evaluación: buscar la que más se acerque al horario (±1h)
      const slotStartMin = toMinutes(slot.inicio);
      const matchedEval = evalsForSlot.find((ev) => {
        const evalStartMin = toMinutes(ev.startTime);
        return Math.abs(evalStartMin - slotStartMin) <= 60;
      });

      // [C8] No coincide en hora
      if (!matchedEval) {
        return { ...slot, isEvaluation: false, evalBadge: "", isHighLoad: isHighLoadWeek };
      }

      // [C9] Coincide: insertar badge
      return {
        ...slot,
        isEvaluation: true,
        evalBadge: matchedEval.code || "EVAL",
        isHighLoad: isHighLoadWeek,
      };
    });

    return { ...sec, horarios: mergedSlots };
  });

  return { secciones: mergedSecciones, isHighLoadWeek };
}

// ─── validateSchedulePayload (Caja Negra — > 4 campos) ──────────────────────

export type ScheduleFilterPayload = {
  studentId: number;           // Campo 1: ID del alumno
  weekNumber: number;          // Campo 2: semana académica 1-16
  dayName: string;             // Campo 3: "Lunes"…"Domingo"
  includeAssessments: boolean; // Campo 4: incluir evaluaciones
  includeSections: boolean;    // Campo 5: incluir secciones
  targetDate: string;          // Campo 6: "YYYY-MM-DD"
};

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

const VALID_DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * validateSchedulePayload
 * Valida los 6 campos obligatorios del filtro de horario del alumno.
 * Diseñada explícitamente para Prueba de Caja Negra (> 4 campos).
 */
export function validateSchedulePayload(
  payload: Partial<ScheduleFilterPayload>
): ValidationResult {
  const errors: string[] = [];

  if (!Number.isInteger(payload.studentId) || (payload.studentId as number) <= 0)
    errors.push("studentId debe ser un entero positivo.");

  if (
    !Number.isInteger(payload.weekNumber) ||
    (payload.weekNumber as number) < 1 ||
    (payload.weekNumber as number) > 16
  )
    errors.push("weekNumber debe estar entre 1 y 16.");

  if (!payload.dayName || !VALID_DAYS.includes(payload.dayName))
    errors.push(`dayName debe ser uno de: ${VALID_DAYS.join(", ")}.`);

  if (typeof payload.includeAssessments !== "boolean")
    errors.push("includeAssessments debe ser boolean.");

  if (typeof payload.includeSections !== "boolean")
    errors.push("includeSections debe ser boolean.");

  if (!payload.targetDate || !ISO_DATE_RE.test(payload.targetDate))
    errors.push("targetDate debe tener formato YYYY-MM-DD.");

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
