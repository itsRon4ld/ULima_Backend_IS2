/**
 * HU8 – Alertas de Riesgo Académico y Carga de Evaluaciones
 * Archivo : test/HU08_julio/alertas.test.ts
 * Runner  : bun test (compatible con Jest API)
 *
 * Rúbrica cubierta:
 *   [A] CAJA BLANCA  → AlertsService.getAlertsForStudent() (CC ≥ 5)
 *   [B] CAJA NEGRA   → EnrollmentWithScore payloads con > 4 campos de entrada
 *   [C] UNIT TESTS   → aggregateCourseScores, personalAverage, isAcademicRisk (≥ 4 casos)
 *
 * Umbrales del sistema (alerts.logic.ts):
 *   ACADEMIC_RISK_MIN_PROGRESS = 55  (avance evaluado en %)
 *   ACADEMIC_RISK_MAX_AVERAGE  = 10.5 (promedio personal /20)
 *   HIGH_LOAD_THRESHOLD        = 3   (evaluaciones por semana)
 */

import { describe, test, expect, mock } from "bun:test"; // API de pruebas de Bun: describe agrupa, test define casos, expect afirma, mock espía funciones
import {
  aggregateCourseScores, // función pura que agrupa filas de notas por curso
  isAcademicRisk,         // función pura que decide si un curso está en riesgo académico
  personalAverage,        // función pura que calcula el promedio ponderado personal
  ACADEMIC_RISK_MIN_PROGRESS, // constante de umbral de avance (55%)
  ACADEMIC_RISK_MAX_AVERAGE,  // constante de umbral de promedio (10.5)
  type ScoreRow,          // tipo de una fila de nota (lo importamos solo para tipar los fixtures)
} from "../../src/modules/alerts/alerts.logic.js"; // SUT de lógica pura (sin BD)
import { AlertsService } from "../../src/modules/alerts/alerts.service.js"; // SUT de servicio (orquesta lógica + repositorio)
import type { EnrollmentWithScore, StoredAlert } from "../../src/modules/alerts/alerts.repository.js"; // tipos del repositorio para tipar fixtures

/**
 * ============================================================================
 * ARCHIVO MIXTO — 3 técnicas sobre el módulo de alertas (HU8)
 * Fuente: src/modules/alerts/alerts.service.ts:50-101  y  src/modules/alerts/alerts.logic.ts:37-113
 * ============================================================================
 * Este archivo cubre las tres técnicas de la rúbrica sobre el mismo módulo:
 *
 *   [A] CAJA BLANCA  → AlertsService.getAlertsForStudent(): se recorren los
 *       caminos del grafo de control (riesgo académico, riesgo crítico y alta
 *       carga, cada uno con la rama "ya existe la alerta / no existe"). V(G) = 9.
 *
 *   [B] CAJA NEGRA   → aggregateCourseScores() sobre payloads EnrollmentWithScore
 *       de > 4 campos: partición de equivalencia + valores límite de los umbrales.
 *
 *   [C] UNIT TESTS   → lógica pura de alerts.logic.ts (aggregateCourseScores,
 *       personalAverage, isAcademicRisk) más markAlertAsRead del servicio.
 *
 * Cada describe lleva encima un sub-encabezado corto con su técnica y su V(G) o
 * sus campos de entrada.
 */

// ---------------------------------------------------------------------------
// Helpers de fixtures
// ---------------------------------------------------------------------------
// Fábrica de matrículas con nota: valores por defecto sanos que cada test
// sobrescribe solo en los campos que le importan (patrón "Object Mother").
const makeEnrollment = (over: Partial<EnrollmentWithScore> = {}): EnrollmentWithScore => ({
  enrollment_id: 1,          // id de matrícula por defecto
  course_id: 100,            // id de curso por defecto
  course_name: "Cálculo I",  // nombre del curso (se usa para armar el título de la alerta)
  section_code: "SEC-01",    // código de sección (puede ser null en algunos casos)
  assessment_id: 10,         // id de evaluación (null significa "fila sin evaluación" → se ignora)
  assessment_weight: "30",   // peso de la evaluación como string (Postgres lo devuelve así)
  score_value: "8",          // nota como string; null significa "aún no calificado"
  ...over,                   // permite que cada test sobrescriba solo lo que necesita
});

// Fábrica de alertas ya almacenadas (StoredAlert). No se usa en los asserts de
// este archivo pero deja lista la forma del dato por si un caso la necesita.
const makeStoredAlert = (over: Partial<StoredAlert> = {}): StoredAlert => ({
  id: 1,                                     // id de la alerta
  studentId: 1,                              // alumno dueño de la alerta
  type: "academic_risk",                     // tipo de alerta
  title: "Riesgo Académico: Cálculo I",      // título
  message: "Tu promedio es bajo",            // mensaje
  isRead: false,                             // si ya fue leída
  createdAt: new Date("2026-07-01"),         // fecha de creación
  ...over,                                   // sobrescritura por test
});

// Fábrica de filas de nota (ScoreRow) para probar la lógica pura de agregación.
const makeScoreRow = (over: Partial<ScoreRow> = {}): ScoreRow => ({
  course_id: 1,              // id del curso al que agrupar
  course_name: "Cálculo I",  // nombre del curso
  assessment_id: 10,         // id de evaluación (null → fila ignorada)
  assessment_weight: 30,     // peso de la evaluación
  score_value: 8,            // nota (null → no calificado, no suma)
  ...over,                   // sobrescritura por test
});

// Mock base del repositorio de alertas: cada método es un espía (mock) que por
// defecto devuelve vacío/negativo, de modo que ningún test toca la BD real y
// podemos verificar CON QUÉ argumentos se llamó a createAlert.
const makeRepo = () => ({
  getActiveEnrollmentsWithScores: mock(async () => [] as EnrollmentWithScore[]), // por defecto: sin matrículas
  getHighLoadWeeks: mock(async () => [] as Array<{ week_number: number; assessment_count: number }>), // por defecto: sin semanas cargadas
  getAlerts: mock(async () => [] as StoredAlert[]), // por defecto: sin alertas previas
  getActivePeriodStart: mock(async () => null as Date | null), // por defecto: sin período activo
  findAlertByTitle: mock(async () => false), // por defecto: la alerta NO existe (deja crear)
  createAlert: mock(async () => undefined),  // espía clave: capturamos sus llamadas para verificar qué alertas se crean
  markAlertAsRead: mock(async () => true),   // por defecto: marcar como leída tiene éxito
});

// Mock del EventBus: solo necesita un emit espía; el servicio lo recibe pero
// aquí no verificamos eventos de negocio.
const makeEvents = () => ({ emit: mock(() => undefined) });

// ===========================================================================
// [A] CAJA BLANCA — AlertsService.getAlertsForStudent()
// Fuente: src/modules/alerts/alerts.service.ts:50-101
// ===========================================================================
// Complejidad Ciclomática del método:
//   Nodo 1: entrada
//   Nodo 2: for (group of courseGroups)                      → +1
//   Nodo 3:   if isCriticalRisk(...)                         → +1
//   Nodo 4:     if (!exists) → createAlert crítico           → +1
//   Nodo 5:       ternario req > 20 (mensaje imposible/req)  → +1
//   Nodo 6:   if isAcademicRisk(...)                         → +1
//   Nodo 7:     if (!exists) → createAlert                   → +1
//   Nodo 8: for (week of highLoadWeeks)                      → +1
//   Nodo 9:   if (!exists) → createAlert                     → +1
//   CC = 1 + 8 = 9  (> 4 ✓)
//
// Caminos cubiertos (9 caminos para V(G) = 9):
//   Path 1 – sin enrollments ni semanas de alta carga         (loops vacíos)
//   Path 2 – riesgo académico detectado, alerta NO existe     (crea alerta)
//   Path 3 – riesgo académico detectado, alerta YA existe     (no duplica)
//   Path 4 – alta carga detectada, alerta NO existe           (crea alerta)
//   Path 5 – alta carga detectada, alerta YA existe           (no duplica)
//   Path 6 – múltiples cursos: algunos en riesgo, otros no
//   Path 7 – riesgo CRÍTICO (req ≤ 20), alerta NO existe      (crea crítica, no académica)
//   Path 8 – riesgo CRÍTICO imposible (req > 20)              (mensaje "ya no es posible")
//   Path 9 – riesgo CRÍTICO, alerta YA existe                 (no duplica)
describe("[CAJA BLANCA] AlertsService.getAlertsForStudent – caminos del grafo de control", () => {

  test("Path 1 – sin enrollments ni semanas cargadas: no crea alertas", async () => {
    const repo = makeRepo(); // repo con TODO vacío por defecto (sin matrículas ni semanas)
    const svc = new AlertsService(repo as any, makeEvents() as any); // instancia el servicio con el repo espía

    await svc.getAlertsForStudent(1); // ejecuta el flujo completo para el alumno 1

    expect(repo.createAlert).not.toHaveBeenCalled(); // verifica que sin datos NO se crea ninguna alerta (ambos bucles vacíos)
  });

  test("Path 2 – riesgo académico detectado y alerta no existe: crea alerta academic_risk", async () => {
    const repo = makeRepo();
    // avance = 70%, promedio = 8 → riesgo (70 > 55 && 8 < 10.5)
    repo.getActiveEnrollmentsWithScores.mockImplementation(async () => [ // el repo devuelve un curso en riesgo
      makeEnrollment({ assessment_weight: "70", score_value: "8" }), // 70% de avance con nota 8 → cumple ambos umbrales
    ]);
    repo.findAlertByTitle.mockImplementation(async () => false); // no existe aún → debe crearse
    const svc = new AlertsService(repo as any, makeEvents() as any);

    await svc.getAlertsForStudent(1); // ejecuta el flujo

    expect(repo.createAlert).toHaveBeenCalledWith( // verifica que se creó la alerta con el tipo, título y mensaje esperados
      1,                                  // studentId
      "academic_risk",                    // tipo de alerta
      "Riesgo Académico: Cálculo I",      // título con el nombre del curso
      expect.stringContaining("Cálculo I"), // el mensaje menciona el curso
    );
  });

  test("Path 3 – riesgo académico detectado pero alerta ya existe: NO duplica", async () => {
    const repo = makeRepo();
    repo.getActiveEnrollmentsWithScores.mockImplementation(async () => [ // mismo curso en riesgo que Path 2
      makeEnrollment({ assessment_weight: "70", score_value: "8" }),
    ]);
    repo.findAlertByTitle.mockImplementation(async () => true); // ya existe la alerta → rama de no-duplicar
    const svc = new AlertsService(repo as any, makeEvents() as any);

    await svc.getAlertsForStudent(1);

    expect(repo.createAlert).not.toHaveBeenCalled(); // verifica que al existir ya, NO se vuelve a crear (idempotencia)
  });

  test("Path 4 – alta carga detectada y alerta no existe: crea alerta high_load", async () => {
    const repo = makeRepo();
    repo.getHighLoadWeeks.mockImplementation(async () => [ // el repo reporta una semana con 3 evaluaciones
      { week_number: 8, assessment_count: 3 },
    ]);
    repo.findAlertByTitle.mockImplementation(async () => false); // la alerta de alta carga no existe aún
    const svc = new AlertsService(repo as any, makeEvents() as any);

    await svc.getAlertsForStudent(1);

    expect(repo.createAlert).toHaveBeenCalledWith( // verifica que se crea la alerta de alta carga con sus datos
      1,                                // studentId
      "high_load",                      // tipo alta carga
      "Alta Carga: Semana 8",           // título con el número de semana
      expect.stringContaining("3"),     // el mensaje incluye la cantidad de evaluaciones
    );
  });

  test("Path 5 – alta carga detectada pero alerta ya existe: NO duplica", async () => {
    const repo = makeRepo();
    repo.getHighLoadWeeks.mockImplementation(async () => [ // semana con 4 evaluaciones
      { week_number: 8, assessment_count: 4 },
    ]);
    repo.findAlertByTitle.mockImplementation(async () => true); // ya existe → no debe duplicar
    const svc = new AlertsService(repo as any, makeEvents() as any);

    await svc.getAlertsForStudent(1);

    expect(repo.createAlert).not.toHaveBeenCalled(); // verifica idempotencia también en la rama de alta carga
  });

  test("Path 6 – múltiples cursos: solo crea alerta para el curso en riesgo", async () => {
    const repo = makeRepo();
    repo.getActiveEnrollmentsWithScores.mockImplementation(async () => [ // dos cursos: uno en riesgo, otro sano
      // Curso 1: en riesgo (70% avance, promedio 8)
      makeEnrollment({ course_id: 1, course_name: "Cálculo I", assessment_weight: "70", score_value: "8" }),
      // Curso 2: no en riesgo (promedio 15)
      makeEnrollment({ course_id: 2, course_name: "Programación", assessment_weight: "70", score_value: "15" }),
    ]);
    repo.findAlertByTitle.mockImplementation(async () => false); // ninguna alerta existe aún
    const svc = new AlertsService(repo as any, makeEvents() as any);

    await svc.getAlertsForStudent(1);

    // Solo debe crear 1 alerta (Cálculo I), no para Programación
    expect(repo.createAlert).toHaveBeenCalledTimes(1); // verifica que se creó exactamente una alerta (no la del curso sano)
    expect(repo.createAlert).toHaveBeenCalledWith(1, "academic_risk", "Riesgo Académico: Cálculo I", expect.any(String)); // verifica que la única alerta es la del curso en riesgo
  });

  test("Path 7 – riesgo CRÍTICO (req ≤ 20) y alerta no existe: crea la crítica y omite la académica", async () => {
    const repo = makeRepo();
    // graded = 50 (30+20), suma ponderada = 8*30 + 1.5*20 = 270, resta 50 sin calificar.
    // req = (10.5*100 - 270) / 50 = 15.6 > 15 → crítico, y 15.6 ≤ 20 → mensaje con la nota requerida.
    repo.getActiveEnrollmentsWithScores.mockImplementation(async () => [ // curso con notas bajas y peso restante
      makeEnrollment({ assessment_id: 10, assessment_weight: "30", score_value: "8" }),   // eval calificada 8
      makeEnrollment({ assessment_id: 11, assessment_weight: "20", score_value: "1.5" }), // eval calificada 1.5
      makeEnrollment({ assessment_id: 12, assessment_weight: "50", score_value: null }),  // eval sin nota → peso restante
    ]);
    repo.findAlertByTitle.mockImplementation(async () => false); // no existe la alerta crítica aún
    const svc = new AlertsService(repo as any, makeEvents() as any);

    await svc.getAlertsForStudent(1);

    // Se crea SOLO la alerta crítica (la precedencia evita duplicar con la académica).
    expect(repo.createAlert).toHaveBeenCalledTimes(1); // verifica que crítica tiene precedencia: una sola alerta, no dos
    expect(repo.createAlert).toHaveBeenCalledWith( // verifica el contenido de la alerta crítica
      1,                                   // studentId
      "academic_risk",                     // tipo (las críticas se guardan como academic_risk con título "Riesgo Crítico")
      "Riesgo Crítico: Cálculo I",         // título de riesgo crítico
      expect.stringContaining("15.6"),     // el mensaje incluye la nota requerida calculada (15.6)
    );
  });

  test("Path 8 – riesgo CRÍTICO imposible (req > 20): el mensaje indica que ya no se puede aprobar", async () => {
    const repo = makeRepo();
    // graded = 50 con suma 0 (todo desaprobado con 0), resta 50.
    // req = (10.5*100 - 0) / 50 = 21 > 20 → rama del mensaje "ya no es posible".
    repo.getActiveEnrollmentsWithScores.mockImplementation(async () => [ // notas en 0 y mitad del peso sin calificar
      makeEnrollment({ assessment_id: 10, assessment_weight: "50", score_value: "0" }),  // eval calificada 0
      makeEnrollment({ assessment_id: 11, assessment_weight: "50", score_value: null }), // eval restante
    ]);
    repo.findAlertByTitle.mockImplementation(async () => false); // no existe aún
    const svc = new AlertsService(repo as any, makeEvents() as any);

    await svc.getAlertsForStudent(1);

    expect(repo.createAlert).toHaveBeenCalledWith( // verifica que cuando req > 20 el mensaje es el de "irrecuperable"
      1,                                          // studentId
      "academic_risk",                            // tipo
      "Riesgo Crítico: Cálculo I",                // título crítico
      expect.stringContaining("ya no es posible"), // el mensaje avisa que aprobar ya no es posible
    );
  });

  test("Path 9 – riesgo CRÍTICO pero la alerta ya existe: NO duplica", async () => {
    const repo = makeRepo();
    repo.getActiveEnrollmentsWithScores.mockImplementation(async () => [ // mismo escenario crítico que Path 7
      makeEnrollment({ assessment_id: 10, assessment_weight: "30", score_value: "8" }),
      makeEnrollment({ assessment_id: 11, assessment_weight: "20", score_value: "1.5" }),
      makeEnrollment({ assessment_id: 12, assessment_weight: "50", score_value: null }),
    ]);
    repo.findAlertByTitle.mockImplementation(async () => true); // ya existe → rama de no-duplicar
    const svc = new AlertsService(repo as any, makeEvents() as any);

    await svc.getAlertsForStudent(1);

    expect(repo.createAlert).not.toHaveBeenCalled(); // verifica que la alerta crítica tampoco se duplica si ya existe
  });
});

// ===========================================================================
// [B] CAJA NEGRA — aggregateCourseScores() con payload EnrollmentWithScore (> 4 campos)
// Fuente: src/modules/alerts/alerts.logic.ts:37-71
// ===========================================================================
// CAMPOS DE ENTRADA (7 del payload EnrollmentWithScore):
//   1. enrollment_id      – identificador de matrícula
//   2. course_id          – identificador del curso (clave de agrupación)
//   3. course_name        – nombre del curso (se usa para el título de la alerta)
//   4. section_code       – código de sección (puede ser null)
//   5. assessment_id      – null si no hay evaluación → se ignora en agregación
//   6. assessment_weight  – peso de la evaluación (string o número)
//   7. score_value        – calificación (string, número o null si no calificado)
//
// | Campo            | Clase válida                 | Clase inválida / límite            |
// |------------------|------------------------------|------------------------------------|
// | assessment_id    | número (10)                  | null → fila ignorada               |
// | score_value      | número/string ("11", 12)     | null → no suma a gradedWeight       |
// | assessment_weight| número o string ("35")       | conversión Number() de string       |
// | course_id        | agrupa por igual id          | ids distintos → grupos separados    |
// | gradedWeight     | > 55 es riesgo               | == 55 exacto (frontera, no riesgo)  |
// Técnica: partición de equivalencia + valores límite de umbrales.
describe("[CAJA NEGRA] aggregateCourseScores con payloads EnrollmentWithScore", () => {

  test("BN-1 – payload completo y válido: acumula peso y suma ponderada", () => {
    const rows: ScoreRow[] = [ // dos evaluaciones calificadas del mismo curso
      makeScoreRow({ course_id: 1, assessment_weight: 40, score_value: 12 }), // peso 40, nota 12
      makeScoreRow({ course_id: 1, assessment_weight: 30, score_value: 9 }),  // peso 30, nota 9
    ];

    const result = aggregateCourseScores(rows); // agrega las filas por curso

    expect(result[0].gradedWeight).toBe(70); // verifica que el peso calificado suma 40+30 = 70
    expect(result[0].weightedSum).toBe(40 * 12 + 30 * 9); // verifica la suma ponderada (nota*peso) acumulada
    expect(result[0].numExamenes).toBe(2); // verifica que se contaron 2 evaluaciones calificadas
  });

  test("BN-2 – assessment_id null: fila ignorada en la agregación", () => {
    const rows: ScoreRow[] = [
      makeScoreRow({ assessment_id: null, assessment_weight: 40, score_value: null }), // sin evaluación → clase inválida, se ignora
      makeScoreRow({ assessment_id: 5, assessment_weight: 30, score_value: 14 }),       // válida
    ];

    const result = aggregateCourseScores(rows);

    expect(result[0].gradedWeight).toBe(30); // verifica que solo cuenta la fila con assessment_id válido (30)
    expect(result[0].numExamenes).toBe(1);   // verifica que la fila con id null no se contó
  });

  test("BN-3 – score_value null (sin calificar): fila ignorada en la agregación", () => {
    const rows: ScoreRow[] = [
      makeScoreRow({ assessment_id: 1, assessment_weight: 50, score_value: null }), // hay evaluación pero sin nota → no suma
    ];

    const result = aggregateCourseScores(rows);

    expect(result[0].gradedWeight).toBe(0); // verifica que una eval sin nota NO suma al peso calificado
    expect(result[0].numExamenes).toBe(0);  // verifica que no se cuenta como examen calificado
  });

  test("BN-4 – peso y nota como string (PostgreSQL los devuelve así): convierte correctamente", () => {
    const rows: ScoreRow[] = [
      makeScoreRow({ assessment_weight: "35", score_value: "11" }), // valores como string (caso real de Postgres)
    ];

    const result = aggregateCourseScores(rows);

    expect(result[0].gradedWeight).toBe(35);        // verifica que Number("35") se acumuló como 35 numérico
    expect(result[0].weightedSum).toBe(35 * 11);    // verifica que Number("11")*35 se calculó correctamente
  });

  test("BN-5 – múltiples cursos en la misma respuesta: agrupa correctamente por course_id", () => {
    const rows: ScoreRow[] = [ // tres filas de dos cursos distintos
      makeScoreRow({ course_id: 1, course_name: "Cálculo I", assessment_weight: 40, score_value: 10 }),
      makeScoreRow({ course_id: 2, course_name: "Física I", assessment_weight: 60, score_value: 8 }),
      makeScoreRow({ course_id: 1, course_name: "Cálculo I", assessment_weight: 30, score_value: 12 }),
    ];

    const result = aggregateCourseScores(rows);

    expect(result).toHaveLength(2); // verifica que se formaron 2 grupos (course_id 1 y 2)
    const calc = result.find(g => g.courseId === 1)!; // localiza el grupo de Cálculo I
    expect(calc.gradedWeight).toBe(70); // verifica que las dos filas del curso 1 sumaron su peso (40+30)
    expect(calc.numExamenes).toBe(2);   // verifica que el curso 1 agrupó sus 2 evaluaciones
  });

  test("BN-6 – valor de avance en el límite exacto (55%): NO debe ser riesgo académico", () => {
    // Borde: gradedWeight === 55 exactamente → isAcademicRisk requiere > 55
    const result = isAcademicRisk(55, 55 * 8); // promedio = 8 < 10.5 pero avance no supera umbral
    expect(result).toBe(false); // verifica el valor límite: con avance == 55 exacto NO hay riesgo (umbral es estricto >)
  });

  test("BN-7 – avance 55.01% y promedio < 10.5: SÍ es riesgo académico", () => {
    // Superamos el borde por un decimal
    expect(isAcademicRisk(55.01, 55.01 * 10)).toBe(true); // verifica que apenas pasado el umbral (55.01) con promedio 10 sí hay riesgo
  });
});

// ===========================================================================
// [C] UNIT TESTS — lógica pura de alertas académicas (alerts.logic.ts)
// Fuente: src/modules/alerts/alerts.logic.ts (aggregateCourseScores, personalAverage, isAcademicRisk)
//         + AlertsService.markAlertAsRead (src/modules/alerts/alerts.service.ts:103-105)
// ===========================================================================
// Qué valida: funciones puras aisladas (agregación, promedio ponderado con
// guarda de división por cero, decisión de riesgo con umbrales estrictos), la
// delegación de markAlertAsRead al repositorio y las constantes de umbral.
describe("[UNIT TEST] Lógica pura de alertas académicas (alerts.logic.ts)", () => {

  // --- aggregateCourseScores ---
  test("UT-1 – lista vacía: retorna arreglo vacío", () => {
    expect(aggregateCourseScores([])).toHaveLength(0); // verifica que sin filas el resultado es un arreglo vacío
  });

  test("UT-2 – un solo registro válido: grupoId = course_id, numExamenes = 1", () => {
    const result = aggregateCourseScores([makeScoreRow()]); // una sola fila con los valores por defecto
    expect(result[0].courseId).toBe(1);   // verifica que el grupo toma el course_id de la fila
    expect(result[0].numExamenes).toBe(1); // verifica que cuenta 1 evaluación
  });

  // --- personalAverage ---
  test("UT-3 – gradedWeight = 0: retorna 0 (evita división por cero)", () => {
    expect(personalAverage(0, 0)).toBe(0);   // verifica la guarda: sin peso calificado el promedio es 0, no NaN
    expect(personalAverage(0, 500)).toBe(0); // weightedSum es ignorado — verifica que aún con suma > 0, peso 0 → promedio 0
  });

  test("UT-4 – promedio ponderado correcto: (nota * peso) / peso total", () => {
    // (12 * 30 + 8 * 20) / 50 = (360 + 160) / 50 = 10.4
    expect(personalAverage(50, 520)).toBeCloseTo(10.4); // verifica el cálculo del promedio ponderado (tolerancia de flotante)
  });

  // --- isAcademicRisk ---
  test("UT-5 – Escenario 1 HU3: avance > 55% y promedio < 10.5 → RIESGO", () => {
    // avance = 60%, promedio = 10 → es riesgo
    expect(isAcademicRisk(60, 60 * 10)).toBe(true); // verifica que con ambos umbrales cumplidos SÍ es riesgo
  });

  test("UT-6 – promedio exactamente 10.5: NO es riesgo (umbral es estricto < 10.5)", () => {
    expect(isAcademicRisk(60, 60 * 10.5)).toBe(false); // verifica el borde: promedio == 10.5 exacto NO es riesgo (umbral estricto)
  });

  test("UT-7 – promedio 11 (aprobando): NO es riesgo aunque avance sea alto", () => {
    expect(isAcademicRisk(80, 80 * 11)).toBe(false); // verifica que un promedio aprobatorio anula el riesgo aunque el avance sea alto
  });

  test("UT-8 – sin avance calificado (0%): NO es riesgo", () => {
    expect(isAcademicRisk(0, 0)).toBe(false); // verifica que sin avance (0%) no se dispara la alerta (falla el umbral de avance)
  });

  // --- markAlertAsRead (AlertsService) ---
  test("UT-9 – markAlertAsRead delegado al repositorio: retorna true si existe", async () => {
    const repo = makeRepo();
    repo.markAlertAsRead.mockImplementation(async () => true); // el repo confirma que la alerta se marcó
    const svc = new AlertsService(repo as any, makeEvents() as any);

    const result = await svc.markAlertAsRead(1, 42); // marca la alerta 42 del alumno 1

    expect(result).toBe(true); // verifica que el servicio propaga el true del repositorio
    expect(repo.markAlertAsRead).toHaveBeenCalledWith(1, 42); // verifica que delega con los mismos argumentos (studentId, alertId)
  });

  test("UT-10 – markAlertAsRead: retorna false si la alerta no pertenece al alumno", async () => {
    const repo = makeRepo();
    repo.markAlertAsRead.mockImplementation(async () => false); // el repo indica que no se marcó (no pertenece al alumno)
    const svc = new AlertsService(repo as any, makeEvents() as any);

    const result = await svc.markAlertAsRead(99, 42); // intenta marcar con un alumno que no es dueño

    expect(result).toBe(false); // verifica que el servicio propaga el false (no autorizado / inexistente)
  });

  // --- Escenario 2 HU3: Alta carga ---
  test("UT-11 – Escenario 2 HU3: ≥ 3 evaluaciones en misma semana → crea alerta high_load", async () => {
    const repo = makeRepo();
    repo.getHighLoadWeeks.mockImplementation(async () => [ // el repo reporta una semana con 3 evaluaciones
      { week_number: 5, assessment_count: 3 },
    ]);
    repo.findAlertByTitle.mockImplementation(async () => false); // la alerta no existe aún
    const svc = new AlertsService(repo as any, makeEvents() as any);

    await svc.getAlertsForStudent(1);

    expect(repo.createAlert).toHaveBeenCalledWith( // verifica que se crea la alerta de alta carga con el mensaje exacto
      1,                                              // studentId
      "high_load",                                    // tipo alta carga
      "Alta Carga: Semana 5",                         // título con la semana
      "Tienes 3 evaluaciones programadas en la semana 5 de tu ciclo.", // mensaje literal esperado
    );
  });

  test("UT-12 – constantes de umbral no han sido modificadas accidentalmente", () => {
    expect(ACADEMIC_RISK_MIN_PROGRESS).toBe(55);   // verifica que el umbral de avance sigue en 55 (guard test de regresión)
    expect(ACADEMIC_RISK_MAX_AVERAGE).toBe(10.5);  // verifica que el umbral de promedio sigue en 10.5
  });
});
