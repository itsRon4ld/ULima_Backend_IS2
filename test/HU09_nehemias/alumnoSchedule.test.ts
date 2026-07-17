import { describe, expect, it } from "bun:test";
import {
  academicWeekOf,
  mergeScheduleData,
  validateSchedulePayload,
  type Assessment,
  type MergeInput,
  type Section,
  type ScheduleFilterPayload,
} from "../../src/modules/schedule/schedule.logic.js";

/*
 * ============================================================================
 * ARCHIVO MIXTO — Horario Semanal y Evaluaciones del Alumno (HU09)
 * Fuente: src/modules/schedule/schedule.logic.ts
 * ============================================================================
 * Este archivo cubre las TRES técnicas de la rúbrica sobre el mismo módulo de
 * lógica pura (schedule.logic.ts, sin BD para poder testear en aislamiento):
 *
 *   1) CAJA BLANCA — mergeScheduleData()   (fusiona secciones + evaluaciones)
 *   2) CAJA NEGRA  — validateSchedulePayload()  (valida los 6 campos del filtro)
 *   3) UNITARIA    — academicWeekOf()      (mapea una fecha a la semana 1-16)
 *
 * Cada describe lleva encima su propia sub-cabecera con la técnica, los
 * nodos/campos y el V(G) correspondiente.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 1) CAJA BLANCA — mergeScheduleData() (HU09: horario enriquecido con badges)
 *    Fuente: src/modules/schedule/schedule.logic.ts:114-180
 *    NODOS/PREDICADOS del método:
 *      P1  if (!secciones || length === 0)     -> retorno temprano (guard)
 *      P2  academicWeekOf(targetDate) + filter (a.weekNumber === activeWeek && a.date !== "")
 *      P3  for (ass of assessments): if (!ass.date) continue  (excluir sin fecha)
 *      P4  secciones.map (loop externo por sección)
 *      P5  if (!sec.horarios || length === 0)  -> sección con horarios vacíos
 *      P6  sec.horarios.map (loop interno por slot)
 *      P7  if (evalsForSlot.length === 0)       -> sin badge
 *      P8  find |evalStartMin - slotStartMin| <= 60  (ventana horaria ±1h)
 *      P9  if (!matchedEval)                     -> sin badge, si coincide -> badge = code || "EVAL"
 *    V(G) = 9 decisiones binarias ⇒ CC = 9 (cumple CC > 4)
 *
 *    | #   | Camino                              | Esperado                            |
 *    |-----|-------------------------------------|-------------------------------------|
 *    | C1  | secciones = []                      | estructura vacía, isHighLoadWeek=F  |
 *    | C2  | assessments = []                    | todos los slots isEvaluation=F      |
 *    | C3  | assessment date=""                  | ignorado, sin badge                 |
 *    |C4+6+7| eval en otra fecha                 | sin badge                           |
 *    | C5  | sección horarios=[]                 | MergedSection con horarios=[]       |
 *    | C8  | eval existe pero desfase > 60min    | sin badge                           |
 *    | C9  | fecha + hora coinciden              | isEvaluation=T, badge="EP1"         |
 *    |C9-fb| eval sin código                     | badge fallback "EVAL"               |
 *    | C10 | 3 evals en semana activa            | isHighLoadWeek=T                    |
 *    |C10-n| 2 evals en semana activa            | isHighLoadWeek=F                    |
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 2) CAJA NEGRA — validateSchedulePayload() (HU09: filtro del horario)
 *    Fuente: src/modules/schedule/schedule.logic.ts:205-233
 *    CAMPOS DE ENTRADA (6, cumple > 4):
 *      1. studentId          (entero positivo)
 *      2. weekNumber         (entero 1-16)
 *      3. dayName            ("Lunes".."Domingo")
 *      4. includeAssessments (boolean)
 *      5. includeSections    (boolean)
 *      6. targetDate         (formato YYYY-MM-DD)
 *
 *    | Campo              | Clase válida        | Clase inválida / límite          |
 *    |--------------------|---------------------|----------------------------------|
 *    | studentId          | 101                 | 0, -1 (no positivo)              |
 *    | weekNumber         | 5                   | 17, 0 (fuera de 1-16)            |
 *    | dayName            | "Lunes"/"Martes"    | "Monday" (inglés), ""           |
 *    | includeAssessments | true                | "true" string, undefined         |
 *    | includeSections    | true                | undefined                        |
 *    | targetDate         | "2026-04-27"        | "27-04-2026", "hoy" (mal formato)|
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 3) PRUEBA UNITARIA — academicWeekOf()
 *    Fuente: src/modules/schedule/schedule.logic.ts:84-94
 *    Qué valida: que una fecha ISO se mapee a su semana académica (1-16),
 *    con -1 fuera del período. Casos: éxito, límites (semana 1 y 16),
 *    flujos alternos (antes/después), y manejo de error (vacío / NaN).
 * ============================================================================
 */

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Slot de clase base: una sesión de Lunes 10-12 en el aula A-101. Sirve para los tests de merge.
const slotLunes = {
  dia: "Lunes",         // día de la semana del slot
  inicio: "10:00:00",   // hora de inicio (se compara contra el startTime de la evaluación)
  fin: "12:00:00",      // hora de fin
  aula: "A-101",        // aula donde se dicta
  color: "#2196F3",     // color visual de la clase
};

// Sección base con un único horario (el slot de Lunes). Es la sección de referencia para casi todos los casos.
const baseSection: Section = {
  idSeccion: "1",                      // id interno de la sección
  codigoSeccion: "SW02",              // código que se usa como clave "fecha::codigoSeccion" en el índice
  curso: "Ingeniería de Software II", // nombre del curso
  horarios: [slotLunes],             // un solo slot: el de Lunes
};

// Evaluación que SÍ cae en la fecha y hora del slot de Lunes: debe producir un badge "EP1".
const evalEnFecha: Assessment = {
  id: "42",                              // id de la evaluación
  courseName: "Ingeniería de Software II", // curso de la evaluación
  sectionCode: "SW02",                   // debe coincidir con codigoSeccion para armar la clave del índice
  code: "EP1",                           // código que termina en el badge (o "EVAL" si va vacío)
  name: "Examen Parcial 1",              // nombre legible
  weekNumber: 5,               // semana 5 = 2026-04-27..05-03 (relevante para el conteo de alta carga)
  date: "2026-04-27",          // Lunes semana 5: misma fecha que targetDate en los casos positivos
  startTime: "10:00:00",       // misma hora que el slot => cae dentro de la ventana ±1h
  endTime: "12:00:00",         // hora de fin de la evaluación
  classroom: "A-101",          // aula de la evaluación
  color: "#F44336",            // color visual de la evaluación
};

// ══════════════════════════════════════════════════════════════════════════════
// 1. PRUEBA DE CAJA BLANCA — mergeScheduleData (CC = 9)
//    Cada bloque it() cubre explícitamente uno o más caminos del grafo de flujo.
// ══════════════════════════════════════════════════════════════════════════════

// [CAJA BLANCA] mergeScheduleData — V(G) = 9. Un it() por camino del grafo (C1..C10).
describe("CAJA BLANCA — mergeScheduleData (CC = 9)", () => {

  /**
   * Camino C1:  secciones null/vacío → retorno temprano sin procesar.
   * Nodo cubierto: guard al inicio de la función.
   */
  it("[C1] Retorna estructura vacía cuando secciones es []", () => {
    const result = mergeScheduleData({ // ejecuta el merge con la lista de secciones vacía
      secciones: [],                   // dispara el guard P1 (length === 0)
      assessments: [evalEnFecha],      // aunque haya evaluaciones, no hay secciones que enriquecer
      targetDate: "2026-04-27",        // fecha objetivo (irrelevante porque se corta antes)
    });
    expect(result.secciones).toHaveLength(0); // verifica que devuelva la lista de secciones vacía (retorno temprano)
    expect(result.isHighLoadWeek).toBe(false); // verifica que el flag de alta carga sea false en el guard
  });

  /**
   * Camino C2:  assessments vacío → todos los slots se procesan
   *             sin encontrar ningún badge (isEvaluation = false para todos).
   */
  it("[C2] Sin evaluaciones: todos los slots quedan con isEvaluation=false", () => {
    const input: MergeInput = {     // arma la entrada del merge
      secciones: [baseSection],     // una sección con su slot de Lunes
      assessments: [],              // sin evaluaciones => el índice queda vacío (P7 siempre verdadero)
      targetDate: "2026-04-27",     // fecha objetivo
    };
    const result = mergeScheduleData(input); // ejecuta el merge
    const slot = result.secciones[0].horarios[0]; // toma el primer (único) slot resultante
    expect(slot.isEvaluation).toBe(false); // verifica que el slot NO se marque como evaluación (no hay evals)
    expect(slot.evalBadge).toBe("");       // verifica que el badge quede vacío
  });

  /**
   * Camino C3:  assessment con date="" es excluido del índice interno
   *             → el slot permanece sin badge aunque el sectionCode coincida.
   */
  it("[C3] Assessment con date='' es ignorado (no produce badge)", () => {
    const evalSinFecha: Assessment = { ...evalEnFecha, date: "" }; // clona la eval pero le borra la fecha => P3 la salta
    const result = mergeScheduleData({
      secciones: [baseSection],   // sección con slot de Lunes
      assessments: [evalSinFecha], // eval sin fecha: nunca entra al índice
      targetDate: "2026-04-27",   // fecha objetivo
    });
    expect(result.secciones[0].horarios[0].isEvaluation).toBe(false); // verifica que el slot no reciba badge porque la eval sin fecha se ignora
  });

  /**
   * Caminos C4 + C6 + C7:
   *   - Loop externo itera por cada sección (C4).
   *   - Loop interno itera por cada slot (C6).
   *   - No hay evaluación para esa fecha+sección (C7) → sin badge.
   */
  it("[C4+C6+C7] Fecha de evaluación distinta a targetDate → sin badge", () => {
    const evalOtraFecha: Assessment = { ...evalEnFecha, date: "2026-05-04" }; // eval movida a otra fecha => la clave no coincide con targetDate
    const result = mergeScheduleData({
      secciones: [baseSection],    // recorre esta sección (loop externo C4)
      assessments: [evalOtraFecha], // eval indexada bajo "2026-05-04::SW02"
      targetDate: "2026-04-27",  // distinta => la búsqueda del slot no la encuentra (C7)
    });
    const slot = result.secciones[0].horarios[0]; // primer slot tras recorrer el loop interno (C6)
    expect(slot.isEvaluation).toBe(false); // verifica que sin coincidencia de fecha no haya evaluación marcada
    expect(slot.evalBadge).toBe("");       // verifica que el badge quede vacío
  });

  /**
   * Camino C5:  Sección sin horarios (horarios=[]) devuelve lista vacía
   *             sin entrar al loop interno.
   */
  it("[C5] Sección con horarios=[] produce MergedSection con horarios=[]", () => {
    const secSinHorarios: Section = { ...baseSection, horarios: [] }; // clona la sección pero sin slots => dispara el guard P5
    const result = mergeScheduleData({
      secciones: [secSinHorarios], // sección sin horarios
      assessments: [evalEnFecha],  // hay eval, pero no hay slots que enriquecer
      targetDate: "2026-04-27",    // fecha objetivo
    });
    expect(result.secciones[0].horarios).toHaveLength(0); // verifica que la sección resultante conserve su lista de horarios vacía
  });

  /**
   * Camino C8:  Hay evaluación en la fecha correcta pero la diferencia
   *             horaria supera 60 min → no se asigna badge.
   */
  it("[C8] Evaluación existe pero desfase horario > 60min → sin badge", () => {
    const evalLejos: Assessment = {
      ...evalEnFecha,          // misma fecha y sección => sí entra al índice
      startTime: "16:00:00",  // slot es a las 10:00 → diferencia 360 min (fuera de la ventana ±60, P8 falla)
    };
    const result = mergeScheduleData({
      secciones: [baseSection],  // sección con slot de Lunes 10:00
      assessments: [evalLejos],  // eval en la misma fecha pero a las 16:00
      targetDate: "2026-04-27",  // fecha objetivo coincide
    });
    expect(result.secciones[0].horarios[0].isEvaluation).toBe(false); // verifica que el desfase horario > 60min impida el badge (matchedEval undefined)
  });

  /**
   * Camino C9:  Evaluación en fecha correcta Y dentro de ventana ±1h
   *             → isEvaluation=true, evalBadge = código de la evaluación.
   */
  it("[C9] Fecha + hora coinciden → badge 'EP1' insertado correctamente", () => {
    const result = mergeScheduleData({
      secciones: [baseSection],  // sección con slot Lunes 10:00
      assessments: [evalEnFecha], // eval misma fecha y misma hora => coincide
      targetDate: "2026-04-27",  // fecha objetivo coincide
    });
    const slot = result.secciones[0].horarios[0]; // slot enriquecido
    expect(slot.isEvaluation).toBe(true); // verifica que el slot se marque como evaluación (camino positivo C9)
    expect(slot.evalBadge).toBe("EP1");   // verifica que el badge tome el código de la evaluación
  });

  /**
   * Camino C9 (variante):  Evaluación sin código → evalBadge cae al fallback "EVAL".
   */
  it("[C9-fallback] Evaluación sin código → evalBadge = 'EVAL'", () => {
    const evalSinCodigo: Assessment = { ...evalEnFecha, code: "" }; // eval que coincide pero sin código => fuerza el fallback code || "EVAL"
    const result = mergeScheduleData({
      secciones: [baseSection],    // sección con slot Lunes
      assessments: [evalSinCodigo], // eval coincidente sin código
      targetDate: "2026-04-27",    // fecha objetivo coincide
    });
    expect(result.secciones[0].horarios[0].evalBadge).toBe("EVAL"); // verifica que sin código el badge use el literal de respaldo "EVAL"
  });

  /**
   * Camino C10 (isHighLoadWeek = true):
   *   ≥ 3 evaluaciones con fecha en la semana activa → alerta de alta carga.
   */
  it("[C10] 3 evaluaciones en la semana activa → isHighLoadWeek = true", () => {
    // 2026-04-27 = semana 4 del período. Todos los evals tienen weekNumber=4.
    const makeEval = (id: string, sec: string): Assessment => ({ // fábrica de evals: solo cambian id y sección
      ...evalEnFecha,   // base común
      id,               // id único por eval
      sectionCode: sec, // sección distinta por eval
      date: "2026-04-27", // misma fecha (dentro de la semana activa)
      weekNumber: 4,   // semana 4 => coincide con academicWeekOf(targetDate)
    });
    const result = mergeScheduleData({
      secciones: [baseSection], // basta una sección para el cálculo global de alta carga
      assessments: [makeEval("1", "SW02"), makeEval("2", "IS01"), makeEval("3", "BD01")], // 3 evals en la semana activa
      targetDate: "2026-04-27", // fecha objetivo => semana activa = 4
    });
    expect(result.isHighLoadWeek).toBe(true); // verifica que con 3 evaluaciones (>= HIGH_LOAD_MIN_ASSESSMENTS) la semana sea de alta carga
  });

  /**
   * Camino C10 (isHighLoadWeek = false):
   *   2 evaluaciones en semana activa → no es alta carga.
   */
  it("[C10-negativo] 2 evaluaciones en semana activa → isHighLoadWeek = false", () => {
    const makeEval = (id: string, sec: string): Assessment => ({ // misma fábrica de evals
      ...evalEnFecha,
      id,
      sectionCode: sec,
      date: "2026-04-27",
      weekNumber: 4,   // semana 4 (activa)
    });
    const result = mergeScheduleData({
      secciones: [baseSection],
      assessments: [makeEval("1", "SW02"), makeEval("2", "IS01")], // solo 2 evals en la semana activa
      targetDate: "2026-04-27",
    });
    expect(result.isHighLoadWeek).toBe(false); // verifica que con 2 evaluaciones (< 3) NO se marque alta carga
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. PRUEBA DE CAJA NEGRA — validateSchedulePayload (> 4 campos de entrada)
//    Se evalúa el comportamiento externo sin conocer la implementación interna.
//    Los 6 campos son: studentId, weekNumber, dayName, includeAssessments,
//                       includeSections, targetDate.
// ══════════════════════════════════════════════════════════════════════════════

// [CAJA NEGRA] validateSchedulePayload — 6 campos (> 4). Clases válidas/ inválidas por campo.
describe("CAJA NEGRA — validateSchedulePayload (6 campos obligatorios)", () => {

  // Payload de referencia con los 6 campos en su clase VÁLIDA. Cada test sobrescribe un campo para forzar su clase inválida.
  const payloadValido: ScheduleFilterPayload = {
    studentId: 101,            // Campo 1 válido: entero positivo
    weekNumber: 5,             // Campo 2 válido: dentro de 1-16
    dayName: "Lunes",          // Campo 3 válido: día en español
    includeAssessments: true,  // Campo 4 válido: boolean
    includeSections: true,     // Campo 5 válido: boolean
    targetDate: "2026-04-27",  // Campo 6 válido: formato YYYY-MM-DD
  };

  it("Payload completamente válido (6 campos correctos) → { valid: true }", () => {
    const result = validateSchedulePayload(payloadValido); // valida el payload todo-válido
    expect(result.valid).toBe(true); // verifica que sin errores el resultado sea valid=true
  });

  it("studentId = 0 → error en campo 1", () => {
    const result = validateSchedulePayload({ ...payloadValido, studentId: 0 }); // 0 no es positivo => clase inválida del campo 1
    expect(result.valid).toBe(false); // verifica que el payload se rechace
    if (!result.valid) expect(result.errors).toContain("studentId debe ser un entero positivo."); // verifica el mensaje exacto del campo 1
  });

  it("weekNumber = 17 (fuera de 1-16) → error en campo 2", () => {
    const result = validateSchedulePayload({ ...payloadValido, weekNumber: 17 }); // 17 supera el límite superior 16 => inválido
    expect(result.valid).toBe(false); // verifica el rechazo
    if (!result.valid) expect(result.errors).toContain("weekNumber debe estar entre 1 y 16."); // verifica el mensaje del campo 2
  });

  it("dayName = 'Martes' (válido) → sin error en campo 3", () => {
    const result = validateSchedulePayload({ ...payloadValido, dayName: "Martes" }); // "Martes" es un día válido (clase válida alterna)
    expect(result.valid).toBe(true); // verifica que otro día válido siga aceptándose
  });

  it("dayName = 'Monday' (inválido, inglés) → error en campo 3", () => {
    const result = validateSchedulePayload({ ...payloadValido, dayName: "Monday" }); // día en inglés no está en VALID_DAYS => inválido
    expect(result.valid).toBe(false); // verifica el rechazo
    if (!result.valid)
      expect(result.errors.some((e) => e.includes("dayName"))).toBe(true); // verifica que exista un error referido al campo dayName
  });

  it("includeAssessments = 'true' (string, no boolean) → error en campo 4", () => {
    const result = validateSchedulePayload({
      ...payloadValido,
      includeAssessments: "true" as unknown as boolean, // string, no boolean => typeof !== 'boolean' => inválido
    });
    expect(result.valid).toBe(false); // verifica el rechazo por tipo incorrecto
    if (!result.valid)
      expect(result.errors).toContain("includeAssessments debe ser boolean."); // verifica el mensaje del campo 4
  });

  it("includeSections = undefined → error en campo 5", () => {
    const result = validateSchedulePayload({ ...payloadValido, includeSections: undefined }); // undefined no es boolean => inválido
    expect(result.valid).toBe(false); // verifica el rechazo
    if (!result.valid)
      expect(result.errors).toContain("includeSections debe ser boolean."); // verifica el mensaje del campo 5
  });

  it("targetDate = '27-04-2026' (formato incorrecto) → error en campo 6", () => {
    const result = validateSchedulePayload({ ...payloadValido, targetDate: "27-04-2026" }); // formato DD-MM-YYYY no pasa el regex ISO => inválido
    expect(result.valid).toBe(false); // verifica el rechazo
    if (!result.valid)
      expect(result.errors).toContain("targetDate debe tener formato YYYY-MM-DD."); // verifica el mensaje del campo 6
  });

  it("Múltiples campos inválidos → acumula todos los errores", () => {
    const result = validateSchedulePayload({ // todos los campos en su clase inválida a la vez
      studentId: -1,                 // negativo => inválido
      weekNumber: 0,                 // fuera de 1-16 => inválido
      dayName: "",                   // vacío => inválido
      includeAssessments: undefined, // no boolean => inválido
      includeSections: undefined,    // no boolean => inválido
      targetDate: "hoy",             // no ISO => inválido
    });
    expect(result.valid).toBe(false); // verifica el rechazo global
    if (!result.valid) expect(result.errors.length).toBeGreaterThanOrEqual(6); // verifica que el validador ACUMULE los 6 errores (no corta al primero)
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. PRUEBAS UNITARIAS — academicWeekOf (≥ 4 casos it)
//    Valida el método aislado: flujo exitoso, flujos alternos, límites y errores.
// ══════════════════════════════════════════════════════════════════════════════

// [UNIT] academicWeekOf — mapea fecha -> semana académica 1-16 (o -1 fuera del período).
describe("UNIT TEST — academicWeekOf", () => {

  it("[Caso 1 — Flujo exitoso] Semana 1: primer día del período (2026-04-06) → 1", () => {
    // La semana académica 1 arranca el 6 de abril de 2026.
    expect(academicWeekOf("2026-04-06")).toBe(1); // verifica que el día de arranque del período sea semana 1
  });

  it("[Caso 2 — Flujo exitoso] Semana 4: 2026-04-27 cae dentro de la semana 4", () => {
    // Semana 4 = 2026-04-27 al 2026-05-03 (21 días desde 2026-04-06 = semana 4).
    expect(academicWeekOf("2026-04-27")).toBe(4); // verifica el cálculo de semana para una fecha intermedia
  });

  it("[Caso 3 — Caso límite superior] Semana 16: último día del período académico", () => {
    // Semana 16 empieza el 2026-07-13 (16 semanas * 7 días desde 2026-04-06).
    const week16Start = new Date(Date.UTC(2026, 3, 6)); // arranca en el origen del período (6 abr 2026, UTC)
    week16Start.setUTCDate(week16Start.getUTCDate() + 15 * 7); // 15 * 7 = 105 días => inicio de la semana 16
    const isoStr = week16Start.toISOString().slice(0, 10); // recorta a formato YYYY-MM-DD
    expect(academicWeekOf(isoStr)).toBe(16); // verifica el límite superior válido (semana 16, aún dentro del período)
  });

  it("[Caso 4 — Flujo alterno] Fecha anterior al inicio del período → -1", () => {
    // 2026-04-05 está un día antes del arranque del ciclo.
    expect(academicWeekOf("2026-04-05")).toBe(-1); // verifica que una fecha antes del origen (diffMs < 0) devuelva -1
  });

  it("[Caso 5 — Flujo alterno] Fecha posterior a semana 16 → -1", () => {
    // 2026-08-01 está fuera de las 16 semanas.
    expect(academicWeekOf("2026-08-01")).toBe(-1); // verifica que pasada la semana 16 devuelva -1
  });

  it("[Caso 6 — Manejo de error] Cadena vacía → -1 (guard de validación)", () => {
    expect(academicWeekOf("")).toBe(-1); // verifica el guard de fecha vacía (retorno -1 inmediato)
  });

  it("[Caso 7 — Manejo de error] String inválido ('no-date') → -1 (guard NaN)", () => {
    // Date('no-date') produce NaN → el guard isNaN lo atrapa y retorna -1.
    const result = academicWeekOf("no-date"); // fecha malformada => new Date(...) => NaN
    expect(result).toBe(-1); // verifica que el guard isNaN atrape la fecha inválida y devuelva -1
  });

  it("[Caso 8 — Límite inferior] Semana 1 último día (2026-04-12) → sigue siendo 1", () => {
    expect(academicWeekOf("2026-04-12")).toBe(1); // verifica el borde superior de la semana 1 (día 7 aún es semana 1)
  });
});
