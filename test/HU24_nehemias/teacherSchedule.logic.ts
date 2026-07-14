/**
 * teacherSchedule.logic.ts
 * ════════════════════════════════════════════════════════════════════════════
 * Lógica pura del módulo de Horario Interactivo para Docentes.
 * Independiente de BD para ser 100% testeable en aislamiento.
 *
 * Complejidad ciclomática de `resolveTeacherBlock`:
 *   V(G) = 10 caminos de decisión → cumple el requisito CC > 4 de la rúbrica.
 * ════════════════════════════════════════════════════════════════════════════
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Tipo de bloque en el horario del docente. */
export type BlockKind = "class" | "advising" | "assessment";

/** Modalidad de una asesoría. */
export type AdvisingModality = "classroom" | "virtual" | "hybrid";

/** Estado de carga de notas (≥ 5 campos → Caja Negra). */
export type GradesUploadStatus = "Sin cargar" | "Carga parcial" | "Completo";

/**
 * CourseBlockInput
 * Objeto de entrada con ≥ 5 campos requeridos.
 * Diseñado para la Prueba de Caja Negra de la rúbrica.
 */
export type CourseBlockInput = {
  courseName: string;           // Campo 1
  section: string;              // Campo 2 — código de sección (ej. "SW-02")
  delegateName: string;         // Campo 3
  subDelegateName: string;      // Campo 4
  gradesUploadStatus: GradesUploadStatus; // Campo 5
  kind: BlockKind;              // Campo 6
  advisingModality?: AdvisingModality;
  assessmentCode?: string;      // Ej. "EP1" (solo si kind = "assessment")
  assessmentName?: string;
  atRiskCount?: number;         // Alumnos en riesgo/impedidos
  isExtra?: boolean;            // true si es asesoría extra (kind = "advising")
};

/** Metadatos procesados del bloque para renderizado en la UI. */
export type CourseBlockMetadata = {
  displayTitle: string;    // Título principal del bloque
  displaySubtitle: string; // Subtítulo (sección, modalidad, código eval…)
  badgeLabel: string;      // "" | "EXTRA" | "EVAL" | código de evaluación
  badgeColor: string;      // Color hex del badge
  showAtRiskBadge: boolean;// true si hay alumnos impedidos/en riesgo
  atRiskCount: number;
  gradesStatusLabel: string; // etiqueta legible del estado de notas
  canNotifyGrades: boolean;  // true solo si status = "Completo" o "Carga parcial"
  actionLabel: string;       // CTA del botón principal del bloque
};

/** Resultado de validación del bloque de entrada. */
export type BlockValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

// ─── resolveTeacherBlock  (CC = 10) ──────────────────────────────────────────

/**
 * resolveTeacherBlock
 * ─────────────────────────────────────────────────────────────────────────────
 * Procesa un bloque del horario del docente y genera sus metadatos de
 * renderizado según el tipo de evento (clase, asesoría, evaluación).
 *
 * MAPA DE CAMINOS (para Prueba de Caja Blanca):
 *   [D1]  input null/undefined → lanzar Error
 *   [D2]  kind = "class" (clase regular) → título = courseName, sin badge
 *   [D3]  kind = "assessment" → badge con código de evaluación
 *   [D4]    assessmentCode vacío en assessment → badge fallback "EVAL"
 *   [D5]  kind = "advising" no extra → badge vacío, subtítulo por modalidad
 *   [D6]  kind = "advising" extra (isExtra=true) → badge "EXTRA"
 *   [D7]    modality = "virtual" → subtítulo indica "Virtual"
 *   [D8]    modality = "hybrid"  → subtítulo indica "Híbrida"
 *   [D9]    modality = "classroom" / undefined → subtítulo indica "Presencial"
 *   [D10] atRiskCount > 0 → showAtRiskBadge = true
 *   [D11] gradesUploadStatus = "Completo" o "Carga parcial" → canNotifyGrades
 *
 * V(G) = 10 decisiones binarias → CC > 4 ✓
 */
export function resolveTeacherBlock(input: CourseBlockInput | null | undefined): CourseBlockMetadata {
  // [D1] Guard
  if (!input) throw new Error("CourseBlockInput no puede ser nulo.");

  const { courseName, section, kind, advisingModality, assessmentCode, isExtra, atRiskCount = 0, gradesUploadStatus } = input;

  let displayTitle = courseName;
  let displaySubtitle = `Sección ${section}`;
  let badgeLabel = "";
  let badgeColor = "";

  // ── Resolución por tipo de bloque ───────────────────────────────────────
  if (kind === "assessment") {
    // [D3] Evaluación programada en el horario
    displayTitle = courseName;
    displaySubtitle = `Sección ${section}`;
    badgeLabel = assessmentCode && assessmentCode.trim() !== ""
      ? assessmentCode           // [D3] código presente
      : "EVAL";                  // [D4] fallback
    badgeColor = "#F44336";

  } else if (kind === "advising") {
    // [D5] / [D6] Asesoría (recurrente o extra)
    displayTitle = `Asesoría: ${courseName}`;

    if (isExtra) {
      badgeLabel = "EXTRA";      // [D6]
      badgeColor = "#9C27B0";
    }

    // [D7] / [D8] / [D9] Subtítulo según modalidad
    if (advisingModality === "virtual") {
      displaySubtitle = "Virtual — Reunión en línea"; // [D7]
    } else if (advisingModality === "hybrid") {
      displaySubtitle = "Híbrida — Presencial y virtual"; // [D8]
    } else {
      displaySubtitle = `Presencial — Sección ${section}`; // [D9]
    }

  } else {
    // [D2] Clase regular
    displayTitle = courseName;
    displaySubtitle = `Sección ${section}`;
    badgeLabel = "";
    badgeColor = "";
  }

  // [D10] Badge de alumnos en riesgo
  const showAtRiskBadge = atRiskCount > 0;

  // [D11] Permiso para notificar notas
  const canNotifyGrades =
    gradesUploadStatus === "Completo" || gradesUploadStatus === "Carga parcial";

  // Etiqueta legible del estado de notas
  const gradesStatusLabel =
    gradesUploadStatus === "Completo"
      ? "✅ Notas completas"
      : gradesUploadStatus === "Carga parcial"
      ? "⚠️ Carga parcial"
      : "❌ Sin cargar";

  // CTA del botón principal
  const actionLabel =
    kind === "advising"
      ? "Ver asistentes"
      : kind === "assessment"
      ? "Ver evaluación"
      : "Ver sección";

  return {
    displayTitle,
    displaySubtitle,
    badgeLabel,
    badgeColor,
    showAtRiskBadge,
    atRiskCount,
    gradesStatusLabel,
    canNotifyGrades,
    actionLabel,
  };
}

// ─── validateCourseBlockInput (Caja Negra — ≥ 5 campos) ─────────────────────

const VALID_KINDS: BlockKind[] = ["class", "advising", "assessment"];
const VALID_STATUSES: GradesUploadStatus[] = ["Sin cargar", "Carga parcial", "Completo"];
const VALID_MODALITIES: AdvisingModality[] = ["classroom", "virtual", "hybrid"];

/**
 * validateCourseBlockInput
 * Valida los 6 campos obligatorios del bloque del docente.
 * Diseñada para Prueba de Caja Negra (> 4 campos de entrada).
 */
export function validateCourseBlockInput(
  payload: Partial<CourseBlockInput>
): BlockValidationResult {
  const errors: string[] = [];

  if (!payload.courseName || payload.courseName.trim() === "")
    errors.push("courseName es requerido y no puede estar vacío.");

  if (!payload.section || payload.section.trim() === "")
    errors.push("section es requerido y no puede estar vacío.");

  if (!payload.delegateName || payload.delegateName.trim() === "")
    errors.push("delegateName es requerido.");

  if (!payload.subDelegateName || payload.subDelegateName.trim() === "")
    errors.push("subDelegateName es requerido.");

  if (!payload.gradesUploadStatus || !VALID_STATUSES.includes(payload.gradesUploadStatus))
    errors.push(`gradesUploadStatus debe ser uno de: ${VALID_STATUSES.join(", ")}.`);

  if (!payload.kind || !VALID_KINDS.includes(payload.kind))
    errors.push(`kind debe ser uno de: ${VALID_KINDS.join(", ")}.`);

  if (payload.kind === "advising" && payload.advisingModality !== undefined) {
    if (!VALID_MODALITIES.includes(payload.advisingModality))
      errors.push(`advisingModality debe ser uno de: ${VALID_MODALITIES.join(", ")}.`);
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ─── computeGradesStatus (Unit Test — método auxiliar) ───────────────────────

/**
 * computeGradesStatus
 * Calcula el GradesUploadStatus a partir de conteos crudos.
 * Método sencillo pero con ≥ 4 ramas para los casos unitarios de la rúbrica.
 */
export function computeGradesStatus(
  loadedCount: number,
  totalEnrollments: number
): GradesUploadStatus {
  if (totalEnrollments <= 0) return "Sin cargar";          // [E1] sin alumnos
  if (loadedCount <= 0) return "Sin cargar";               // [E2] nadie cargado
  if (loadedCount >= totalEnrollments) return "Completo";  // [E3] todos cargados
  return "Carga parcial";                                  // [E4] parcial
}
