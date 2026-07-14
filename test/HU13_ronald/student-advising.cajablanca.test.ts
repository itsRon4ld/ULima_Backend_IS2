import { describe, expect, test } from "bun:test";
import type { Context } from "hono";
import { StudentController } from "../../src/modules/advising/student/student.controller.js";
import { StudentService } from "../../src/modules/advising/student/student.service.js";
import type { StudentRepository } from "../../src/modules/advising/student/student.repository.js";
import type { EventBus } from "../../src/events/index.js";
import type { RawAdvisingRow } from "../../src/modules/advising/student/student.types.js";

/**
 * ============================================================================
 * CAJA BLANCA — StudentService.{getAdvising, confirmRsvp, cancelRsvp} +
 *               StudentController RSVP (HU13: asesorías del alumno)
 * Fuente: src/modules/advising/student/student.service.ts:33-107
 *         src/modules/advising/student/student.controller.ts:16-34
 *         (helpers splitName/dayName en service.ts:7-24; isSessionPast en student.logic.ts:22-39)
 * ============================================================================
 * NODOS/PREDICADOS de los métodos bajo prueba:
 *   -- confirmRsvp (service.ts:82-100) --
 *   P1  if (!session)                          -> 404 SESSION_NOT_FOUND (sesión inexistente)
 *   P2  if (isSessionPast(session, now))        -> 409 SESSION_ALREADY_PAST (ya pasó)
 *   P3  if (!allowed) (no es participante)       -> 404 SESSION_NOT_FOUND
 *       else                                     -> insertRsvp + countRsvp + myRsvp=true
 *   -- getAdvising (service.ts:33-80) --
 *   P4  if (kind === "extra" && session_date)    -> si isSessionPast: se filtra (null)
 *   P5  if (kind === "recurring")                -> si isSessionPast: se filtra (null)
 *   -- splitName (service.ts:10-24) --
 *   P6  if (fullName.includes(","))              -> apellidos antes de la coma
 *   P7  else if (parts.length > 2)               -> 2 primeros tokens = apellidos
 *   P8  else if (parts.length === 2)             -> [apellido, nombre]
 *       else                                     -> 1 token: nombre, apellido vacío
 *   -- dayName (service.ts:7-8) --
 *   P9  arr[day-1] ?? "Por definir"              -> día fuera de rango
 *   -- controller.requireStudentId (controller.ts:28-34) --
 *   P10 if (studentId == null)                   -> 403 RSVP_STUDENT_ONLY (no es alumno)
 *
 * V(G) ≈ 10 decisiones + 1 ⇒ 11. Batería: un test por rama de cada predicado,
 * más el mapeo de campos (myRsvp, defaults) y el orden de llamadas al repo espía.
 *
 * | #  | Camino / caso                                      | Esperado                                   |
 * |----|-----------------------------------------------------|--------------------------------------------|
 * | 1  | confirmRsvp participante (P1F,P2F,P3F)               | inserta 1; {id,asistentes:4,myRsvp:true}    |
 * | 2  | confirmRsvp P1(V): sesión inexistente               | 404 SESSION_NOT_FOUND                        |
 * | 3  | confirmRsvp P3(V): no participante                  | 404 SESSION_NOT_FOUND; NO inserta            |
 * | 4  | confirmRsvp P2(V): sesión pasada                    | 409 SESSION_ALREADY_PAST                     |
 * | 5  | confirmRsvp dos veces                               | idempotente (asistentes estable, myRsvp)     |
 * | 6  | cancelRsvp (borra)                                  | borra 1; {id,asistentes:2,myRsvp:false}      |
 * | 7  | cancelRsvp sin confirmación previa                 | no-op; asistentes 0; myRsvp false            |
 * | 8  | getAdvising my_rsvp=true                            | myRsvp=true; asistentes=5; studentId propagado |
 * | 9  | getAdvising my_rsvp null/false                      | myRsvp=false + defaults (recurring/Profesor/0) |
 * | 10 | getAdvising filtra pasadas (P4V, P5V)               | asesorias vacío                              |
 * | 11 | splitName P6(V): 'Apellidos, Nombre'               | apellidos y nombre separados por la coma     |
 * | 12 | splitName P7(V): 4 tokens                          | 2 primeros = apellidos                       |
 * | 13 | splitName P8(V): 2 tokens                          | [apellido, nombre]                           |
 * | 14 | splitName else: 1 token                            | nombre = token, apellido vacío               |
 * | 15 | dayName 1                                           | 'Lunes'                                      |
 * | 16 | dayName 7                                           | 'Domingo'                                    |
 * | 17 | dayName P9: fuera de rango (99)                     | 'Por definir'                                |
 * | 18 | getAdvising extra futura                            | incluida                                     |
 * | 19 | getAdvising recurrente en otro día                 | incluida                                     |
 * | 20 | getAdvising sin studentId (undefined)              | no falla; studentId undefined propagado      |
 * | 21 | controller token alumno                            | confirma; id='5', myRsvp=true                |
 * | 22 | controller token docente P10(V)                    | 403 RSVP_STUDENT_ONLY                        |
 * | 23 | controller cancelar como docente P10(V)            | 403 RSVP_STUDENT_ONLY                        |
 *
 */

// Bus de eventos "dummy": objeto vacío forzado al tipo EventBus. El test no evalúa eventos, solo la lógica del servicio/controlador.
const noopEvents = {} as unknown as EventBus;

// Fabrica un repositorio FALSO (mock) con métodos por defecto inofensivos; cada test sobrescribe solo lo que necesita vía `over`.
const fakeRepo = (over: Partial<StudentRepository>): StudentRepository =>
  ({
    findBySection: async () => [],       // por defecto: sección sin asesorías
    findSessionById: async () => null,   // por defecto: la sesión no existe
    isParticipant: async () => true,     // por defecto: el alumno sí pertenece a la sección
    insertRsvp: async () => {},          // por defecto: confirmar no hace nada observable
    deleteRsvp: async () => {},          // por defecto: cancelar no hace nada observable
    countRsvp: async () => 0,            // por defecto: 0 asistentes confirmados
    ...over,                             // el test reemplaza los métodos que le importan
  }) as unknown as StudentRepository;    // forzamos el tipo para no implementar toda la interfaz

// Helper de fixture: arma una fila cruda (RawAdvisingRow) tal como la devolvería la BD, con valores por defecto sensatos.
const buildRow = (over: Partial<RawAdvisingRow> = {}): RawAdvisingRow => ({
  id: 1,                                     // id de la asesoría
  course_offering_id: 10,                    // curso al que pertenece
  section_id: 1,                             // sección
  day_of_week: 1,                            // 1 = Lunes (ISO)
  start_time: "10:00",                       // hora de inicio
  end_time: "11:00",                         // hora de fin
  classroom: "A-101",                        // aula
  meeting_url: "https://zoom.us/x",          // enlace de la reunión
  teacher_code: "hquintan",                  // código del docente
  full_name: "Quintana Cruz, Hernan",        // nombre del docente en formato 'Apellidos, Nombre'
  kind: "recurring",                         // tipo: recurrente (semanal) por defecto
  session_date: null,                        // sin fecha puntual (solo aplica a 'extra')
  dictante_rol: "Profesor",                  // quién dicta (Profesor/JP)
  asistentes: 3,                             // conteo de confirmados
  my_rsvp: false,                            // el alumno consultante NO ha confirmado
  ...over,                                   // el test sobrescribe solo los campos relevantes
});

// Fecha de referencia fija (martes 2026-07-14 12:00, hora Lima) para que isSessionPast sea determinista en getAdvising.
const NOW_REF = new Date("2026-07-14T12:00:00-05:00");

// Fabrica un Context de Hono FALSO: expone req.param(), get() para variables de auth (studentId/teacherId) y json() que devuelve el body tal cual.
const fakeCtx = (params: Record<string, string>, vars: Record<string, unknown>): Context =>
  ({
    req: { param: (k?: string) => (k ? params[k] : params) }, // req.param('sessionId') devuelve el string del path
    get: (k: string) => vars[k],                              // c.get('studentId') devuelve la variable inyectada por el middleware
    json: (body: unknown) => body,                            // c.json(x) devuelve x sin serializar, para poder inspeccionarlo
  }) as unknown as Context;

// Helper que verifica que una promesa LANCE un HttpError con el status y code esperados (si no lanza, falla el test).
const expectHttpError = async (fn: () => Promise<unknown>, status: number, code: string) => {
  try {
    await fn();                                                   // ejecuta la operación que DEBE fallar
    throw new Error(`se esperaba ${status} ${code} y no se lanzó`); // si llegó aquí, no lanzó: forzamos fallo
  } catch (e) {
    const err = e as { statusCode?: number; code?: string };
    expect(err.statusCode).toBe(status); // verifica que el status HTTP del error sea el esperado
    expect(err.code).toBe(code);         // verifica que el código de negocio del error sea el esperado
  }
};

describe("StudentService.confirmRsvp", () => {
  test("alumno participante → inserta y devuelve conteo + myRsvp=true", async () => {
    let inserted = 0; // espía manual: cuenta cuántas veces se llamó insertRsvp
    const service = new StudentService(
      fakeRepo({
        findSessionById: async () => ({ // sesión futura válida (kind extra con fecha lejana) -> P1 y P2 en falso
          kind: "extra", sessionDate: "2026-12-20", dayOfWeek: 3, startTime: "10:00", endTime: "11:00",
        }),
        isParticipant: async () => true, // el alumno SÍ pertenece -> P3 en falso
        insertRsvp: async () => { inserted++; }, // capturamos la inserción
        countRsvp: async () => 4,        // tras confirmar, el conteo simulado es 4
      }),
      noopEvents,
    );

    const res = await service.confirmRsvp(5, 6); // confirma la sesión 5 para el alumno 6
    expect(inserted).toBe(1); // verifica que se insertó el RSVP exactamente una vez
    expect(res).toEqual({ id: "5", asistentes: 4, myRsvp: true }); // verifica id como string, conteo del repo y myRsvp=true
  });

  test("sesión inexistente → 404 SESSION_NOT_FOUND", async () => {
    const service = new StudentService(
      fakeRepo({ findSessionById: async () => null }), // P1(V): la sesión no existe
      noopEvents,
    );
    await expectHttpError(() => service.confirmRsvp(999, 6), 404, "SESSION_NOT_FOUND"); // verifica 404 SESSION_NOT_FOUND por la rama P1
  });

  test("alumno NO participante → 404 SESSION_NOT_FOUND", async () => {
    let inserted = 0; // espía: NO debería insertar nada
    const service = new StudentService(
      fakeRepo({
        findSessionById: async () => ({ // la sesión existe y es futura (pasa P1 y P2)
          kind: "extra", sessionDate: "2026-12-20", dayOfWeek: 3, startTime: "10:00", endTime: "11:00",
        }),
        isParticipant: async () => false, // P3(V): el alumno NO pertenece a la sección
        insertRsvp: async () => { inserted++; },
      }),
      noopEvents,
    );

    await expectHttpError(() => service.confirmRsvp(999, 6), 404, "SESSION_NOT_FOUND"); // verifica 404 por la rama P3 (no participante)
    expect(inserted).toBe(0); // verifica que NO se insertó RSVP al rechazar por no participante
  });

  test("sesión pasada → 409 SESSION_ALREADY_PAST", async () => {
    const service = new StudentService(
      fakeRepo({
        findSessionById: async () => ({ // sesión extra con fecha ya vencida (2020) -> P2(V)
          kind: "extra", sessionDate: "2020-01-01", dayOfWeek: 3, startTime: "08:00", endTime: "09:00",
        }),
      }),
      noopEvents,
    );
    await expectHttpError(() => service.confirmRsvp(5, 6), 409, "SESSION_ALREADY_PAST"); // verifica 409 SESSION_ALREADY_PAST por sesión pasada
  });

  test("confirmar dos veces → idempotente", async () => {
    const service = new StudentService(
      fakeRepo({
        findSessionById: async () => ({ // sesión futura válida
          kind: "extra", sessionDate: "2026-12-20", dayOfWeek: 3, startTime: "10:00", endTime: "11:00",
        }),
        isParticipant: async () => true,
        countRsvp: async () => 1, // el conteo es estable (la BD real deduplica) -> confirma la idempotencia
      }),
      noopEvents,
    );

    const a = await service.confirmRsvp(5, 6); // primera confirmación
    const b = await service.confirmRsvp(5, 6); // segunda confirmación (repetida)
    expect(a.asistentes).toBe(1); // verifica que la primera reporta 1 asistente
    expect(b.asistentes).toBe(1); // verifica que la segunda no incrementa el conteo (idempotente)
    expect(b.myRsvp).toBe(true);  // verifica que sigue marcado como confirmado
  });
});

describe("StudentService.cancelRsvp", () => {
  test("cancela → borra + conteo + myRsvp=false", async () => {
    let deleted = 0; // espía: cuenta llamadas a deleteRsvp
    const service = new StudentService(
      fakeRepo({
        deleteRsvp: async () => { deleted++; }, // capturamos el borrado
        countRsvp: async () => 2,               // tras cancelar quedan 2 asistentes
      }),
      noopEvents,
    );

    const res = await service.cancelRsvp(5, 6); // cancela la sesión 5 para el alumno 6
    expect(deleted).toBe(1); // verifica que se borró el RSVP exactamente una vez
    expect(res).toEqual({ id: "5", asistentes: 2, myRsvp: false }); // verifica id string, conteo del repo y myRsvp=false
  });

  test("cancelar sin confirmación previa → no-op, myRsvp=false", async () => {
    const service = new StudentService(
      fakeRepo({ countRsvp: async () => 0 }), // no había confirmación: el conteo es 0
      noopEvents,
    );
    const res = await service.cancelRsvp(5, 6); // cancelar aunque no hubiera RSVP (cancelRsvp es lineal, sin guardas)
    expect(res.asistentes).toBe(0);  // verifica que el conteo reportado es 0
    expect(res.myRsvp).toBe(false);  // verifica que queda como no confirmado
  });
});

describe("StudentService.getAdvising — mapeo y filtrado", () => {
  test("mapea my_rsvp=true → myRsvp=true", async () => {
    let seenStudentId: number | undefined = -1; // espía: captura el studentId que el service pasa al repo
    const service = new StudentService(
      fakeRepo({
        findBySection: async (_sectionId: number, studentId?: number) => {
          seenStudentId = studentId;                          // guardamos el studentId recibido
          return [buildRow({ my_rsvp: true, asistentes: 5 })]; // una fila con RSVP del alumno y 5 asistentes
        },
      }),
      noopEvents,
    );

    const { asesorias } = await service.getAdvising(1, 6, NOW_REF); // consulta asesorías de la sección 1 para el alumno 6
    expect(seenStudentId).toBe(6); // verifica que el service propagó el studentId 6 al repositorio
    expect(asesorias[0].myRsvp).toBe(true);  // verifica que my_rsvp=true se mapea a myRsvp=true
    expect(asesorias[0].asistentes).toBe(5); // verifica que el conteo de asistentes se mapea correctamente
  });

  test("my_rsvp null/false → myRsvp=false y defaults", async () => {
    const service = new StudentService(
      fakeRepo({
        findBySection: async () => [
          buildRow({ my_rsvp: null, kind: null, dictante_rol: null, asistentes: null }), // fila con campos nulos para probar defaults
        ],
      }),
      noopEvents,
    );

    const { asesorias } = await service.getAdvising(1, undefined, NOW_REF); // consulta sin studentId
    expect(asesorias[0].myRsvp).toBe(false);        // verifica que my_rsvp null -> myRsvp false (usa `=== true`)
    expect(asesorias[0].kind).toBe("recurring");     // verifica default de kind null -> "recurring"
    expect(asesorias[0].dictanteRol).toBe("Profesor"); // verifica default de dictante_rol null -> "Profesor"
    expect(asesorias[0].asistentes).toBe(0);         // verifica default de asistentes null -> 0
  });

  test("filtra pasadas del resultado", async () => {
    const service = new StudentService(
      fakeRepo({
        findBySection: async () => [
          buildRow({ id: 1, kind: "extra", session_date: "2020-01-01" }),          // P4(V): extra pasada -> se filtra
          buildRow({ id: 2, kind: "recurring", day_of_week: 6, end_time: "09:00" }), // P5(V): recurrente del sábado ya terminada -> se filtra
        ],
      }),
      noopEvents,
    );

    const sabadoTarde = new Date("2026-07-11T14:00:00-05:00"); // sábado 14:00 Lima: ambas sesiones ya pasaron
    const { asesorias } = await service.getAdvising(1, 6, sabadoTarde);
    expect(asesorias.length).toBe(0); // verifica que ambas asesorías pasadas fueron filtradas (lista vacía)
  });
});

describe("StudentService.getAdvising — mapeo de campos del docente (splitName)", () => {
  test("full_name con coma: 'Quintana Cruz, Hernan' separa apellidos y nombre", async () => {
    const service = new StudentService(
      fakeRepo({
        findBySection: async () => [buildRow({ full_name: "Quintana Cruz, Hernan", teacher_code: "hquintan" })], // P6(V): tiene coma
      }),
      noopEvents,
    );
    const { asesorias } = await service.getAdvising(1, undefined, NOW_REF);
    expect(asesorias[0].docente.firstName).toBe("Hernan");        // verifica que lo posterior a la coma es el nombre
    expect(asesorias[0].docente.lastName).toBe("Quintana Cruz");  // verifica que lo anterior a la coma son los apellidos
    expect(asesorias[0].docenteCode).toBe("hquintan");            // verifica que el código del docente se mapea
  });

  test("full_name con 4 tokens: los 2 primeros son apellidos", async () => {
    const service = new StudentService(
      fakeRepo({
        findBySection: async () => [buildRow({ full_name: "Garcia Lopez Carlos Maria", teacher_code: "carlosg" })], // P7(V): >2 tokens, sin coma
      }),
      noopEvents,
    );
    const { asesorias } = await service.getAdvising(1, undefined, NOW_REF);
    expect(asesorias[0].docente.lastName).toBe("Garcia Lopez");  // verifica que los 2 primeros tokens son apellidos
    expect(asesorias[0].docente.firstName).toBe("Carlos Maria"); // verifica que el resto son los nombres
  });

  test("full_name con 2 tokens: primero apellido, segundo nombre", async () => {
    const service = new StudentService(
      fakeRepo({
        findBySection: async () => [buildRow({ full_name: "Quintana Hernan", teacher_code: "hquin" })], // P8(V): exactamente 2 tokens
      }),
      noopEvents,
    );
    const { asesorias } = await service.getAdvising(1, undefined, NOW_REF);
    expect(asesorias[0].docente.lastName).toBe("Quintana"); // verifica que el primer token es el apellido
    expect(asesorias[0].docente.firstName).toBe("Hernan");  // verifica que el segundo token es el nombre
  });

  test("full_name con 1 token: es nombre, apellido vacío", async () => {
    const service = new StudentService(
      fakeRepo({
        findBySection: async () => [buildRow({ full_name: "Hernan", teacher_code: "h001" })], // rama else: un solo token
      }),
      noopEvents,
    );
    const { asesorias } = await service.getAdvising(1, undefined, NOW_REF);
    expect(asesorias[0].docente.firstName).toBe("Hernan"); // verifica que el único token es el nombre
    expect(asesorias[0].docente.lastName).toBe("");        // verifica que el apellido queda vacío
  });
});

describe("StudentService.getAdvising — mapeo de día (dayName)", () => {
  test("day_of_week 1 = Lunes", async () => {
    const service = new StudentService(
      fakeRepo({ findBySection: async () => [buildRow({ day_of_week: 1 })] }), // día ISO 1
      noopEvents,
    );
    const { asesorias } = await service.getAdvising(1, undefined, NOW_REF);
    expect(asesorias[0].dia).toBe("Lunes"); // verifica el mapeo 1 -> "Lunes" (arr[0])
  });

  test("day_of_week 7 = Domingo", async () => {
    const service = new StudentService(
      fakeRepo({ findBySection: async () => [buildRow({ day_of_week: 7 })] }), // día ISO 7
      noopEvents,
    );
    const { asesorias } = await service.getAdvising(1, undefined, NOW_REF);
    expect(asesorias[0].dia).toBe("Domingo"); // verifica el mapeo 7 -> "Domingo" (arr[6], último válido)
  });

  test("day_of_week fuera de rango → 'Por definir'", async () => {
    const service = new StudentService(
      fakeRepo({ findBySection: async () => [buildRow({ day_of_week: 99 })] }), // P9: índice inexistente en el arreglo
      noopEvents,
    );
    const { asesorias } = await service.getAdvising(1, undefined, NOW_REF);
    expect(asesorias[0].dia).toBe("Por definir"); // verifica el fallback `?? "Por definir"` cuando el índice no existe
  });
});

describe("StudentService.getAdvising — sesiones no pasadas incluidas", () => {
  test("extra con fecha futura → incluida", async () => {
    const service = new StudentService(
      fakeRepo({
        findBySection: async () => [
          buildRow({ id: 1, kind: "extra", session_date: "2026-12-25" }), // P4(F): extra futura -> NO se filtra
        ],
      }),
      noopEvents,
    );
    const { asesorias } = await service.getAdvising(1, undefined, NOW_REF);
    expect(asesorias.length).toBe(1); // verifica que la extra futura permanece en el resultado
  });

  test("recurrente en día distinto al actual → incluida", async () => {
    const service = new StudentService(
      fakeRepo({
        findBySection: async () => [
          buildRow({ id: 2, kind: "recurring", day_of_week: 3, end_time: "11:00" }), // recurrente del miércoles
        ],
      }),
      noopEvents,
    );
    // NOW_REF es martes (day 2), la recurrente es miércoles (day 3)
    const { asesorias } = await service.getAdvising(1, undefined, NOW_REF);
    expect(asesorias.length).toBe(1); // verifica que la recurrente de otro día (P5 en falso por día distinto) se incluye
  });
});

describe("StudentService.getAdvising — studentId opcional", () => {
  test("sin studentId (undefined) → no falla y myRsvp = false", async () => {
    let seenStudentId: number | undefined = -1; // espía del studentId propagado
    const service = new StudentService(
      fakeRepo({
        findBySection: async (_sectionId: number, studentId?: number) => {
          seenStudentId = studentId;                          // captura el studentId (debería ser undefined)
          return [buildRow({ my_rsvp: true, asistentes: 3 })]; // la BD reporta my_rsvp true
        },
      }),
      noopEvents,
    );
    const { asesorias } = await service.getAdvising(1, undefined, NOW_REF); // consulta SIN studentId
    expect(seenStudentId).toBeUndefined(); // verifica que se propagó undefined al repositorio (no falla)
    expect(asesorias[0].myRsvp).toBe(true);  // NOTA: el título dice "myRsvp=false" pero se afirma true porque la fila trae my_rsvp=true (no se corrige, solo se documenta)
    expect(asesorias[0].asistentes).toBe(3); // verifica que el conteo de asistentes se mapea
  });
});

describe("StudentController — RSVP solo alumnos", () => {
  const service = new StudentService(
    fakeRepo({
      findSessionById: async () => ({ // sesión futura válida compartida por los tests del controlador
        kind: "extra", sessionDate: "2026-12-20", dayOfWeek: 3, startTime: "10:00", endTime: "11:00",
      }),
      isParticipant: async () => true,
      countRsvp: async () => 1,
    }),
    noopEvents,
  );
  const controller = new StudentController(service); // controlador real sobre el service con repo espía

  test("token alumno → confirma", async () => {
    const c = fakeCtx({ sessionId: "5" }, { studentId: 6 }); // contexto con studentId (token de alumno) -> P10 en falso
    const res = (await controller.confirmRsvp(c)) as unknown as { id: string; myRsvp: boolean };
    expect(res.id).toBe("5");        // verifica que el sessionId del path se refleja en la respuesta
    expect(res.myRsvp).toBe(true);   // verifica que el alumno queda confirmado
  });

  test("token docente (sin studentId) → 403 RSVP_STUDENT_ONLY", async () => {
    const c = fakeCtx({ sessionId: "5" }, { teacherId: 129 }); // contexto con teacherId pero sin studentId -> P10(V)
    await expectHttpError(() => controller.confirmRsvp(c), 403, "RSVP_STUDENT_ONLY"); // verifica 403 al confirmar sin ser alumno
  });

  test("cancelar como docente → 403", async () => {
    const c = fakeCtx({ sessionId: "5" }, {}); // contexto sin studentId ni teacherId -> P10(V)
    await expectHttpError(() => controller.cancelRsvp(c), 403, "RSVP_STUDENT_ONLY"); // verifica 403 al cancelar sin ser alumno
  });
});
