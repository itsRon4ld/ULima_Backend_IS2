import { describe, expect, spyOn, test } from "bun:test";
import jwt, { type JwtPayload } from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { config } from "../../src/config/app-config.js";
import { EventBus } from "../../src/events/index.js";
import type { AuthRepository } from "../../src/modules/auth/auth.repository.js";
import { AuthService } from "../../src/modules/auth/auth.service.js";
import type { AuthUserWithPassword, TeacherAuthUserWithPassword } from "../../src/modules/auth/auth.types.js";

/**
 * ============================================================================
 * CAJA BLANCA — AuthService.login() (HU01: iniciar sesión por código+contraseña)
 * Fuente: src/modules/auth/auth.service.ts:56 (+ loginTeacher :107)
 * ============================================================================
 * ⭐ IDEA CENTRAL PARA EXPONER:
 * La suite conoce la estructura interna del método y fabrica el estado exacto
 * del repositorio para obligar a que se ejecute cada recorrido independiente.
 * Solo se reemplaza la persistencia; bcrypt, la firma y la lectura del JWT son
 * reales. Por eso esto es caja blanca y no una simulación del método probado.
 *
 * Método con complejidad ciclomática > 4: se prueba un test por CAMINO
 * independiente (McCabe). Las dependencias (repositorio, bcrypt) se aíslan con
 * un repositorio falso; NO se toca la BD.
 *
 * NODOS/PREDICADOS de login() + loginTeacher():
 *   N1  findByCodeWithPassword(code)
 *   P1  if (!user)  ── V ─▶ loginTeacher(input)     (código no es de alumno)
 *   P2      · loginTeacher: if (!teacher)  ─▶ 401 USER_NOT_FOUND
 *   P3      · loginTeacher: if (!passwordMatches) ─▶ 401 INVALID_PASSWORD
 *           · loginTeacher OK ─▶ JWT docente (teacherId, sin studentId)
 *   P4  if (!passwordMatches)            ─▶ 401 INVALID_PASSWORD   (alumno)
 *   P5  if (!hasActiveEnrollment)        ─▶ 403 NOT_ENROLLED
 *   P6  representation?.position ?? "student"   (rol por representación)
 *   P7  catch: if (e instanceof HttpError) throw ; else ─▶ 500 INTERNAL_ERROR
 *
 * Bajo la convención declarada: 7 decisiones + 1 región base ⇒ V(G) ≈ 8.
 * El valor es aproximado porque el operador `??` puede contarse de forma
 * distinta según la herramienta; la defensa importante son los 8 recorridos
 * ejecutables y observables de la tabla siguiente.
 *
 * | # | Camino                                   | Entrada que lo fuerza             | Esperado             |
 * |---|------------------------------------------|-----------------------------------|----------------------|
 * | C1| N1(null)→P1(V)→loginTeacher OK           | code de docente, pass correcta    | JWT docente          |
 * | C2| ...loginTeacher P2(V)                    | code inexistente (ni alumno/doc.) | 401 USER_NOT_FOUND   |
 * | C3| ...loginTeacher P3(V)                    | code docente, pass incorrecta     | 401 INVALID_PASSWORD |
 * | C4| N1(user)→P4(V)                           | alumno, pass incorrecta           | 401 INVALID_PASSWORD |
 * | C5| ...P4(F)→P5(V)                           | alumno OK, sin matrícula          | 403 NOT_ENROLLED     |
 * | C6| ...P5(F)→P6(representación)              | alumno OK, delegado               | JWT alumno rol delegate |
 * | C7| ...P6(?? "student")                      | alumno OK, sin representación     | JWT alumno rol student  |
 * | C8| P7 (error no-HttpError)                  | el repo lanza (fallo de BD)       | 500 INTERNAL_ERROR   |
 */

// Contraseña en texto plano que usamos en todos los caminos "felices". El servicio la compara con bcrypt.compare contra el HASH de abajo.
const PASSWORD = "correcta2026";
// Hash bcrypt REAL de esa contraseña (costo 10, el mismo que usa app_user). Así el bcrypt.compare del servicio se ejecuta de verdad, no mockeado.
const HASH = bcrypt.hashSync(PASSWORD, 10);

// Fixture de ALUMNO: fabrica el objeto que devolvería findByCodeWithPassword para un estudiante válido. Es función (no constante) para que cada test tenga una copia fresca sin arrastrar mutaciones.
const student = (): AuthUserWithPassword => ({
  id: 11, // id de la fila app_user (lo que el servicio incrementa el tokenVersion)
  studentId: 101, // id de estudiante: lo que va en la claim studentId del JWT
  code: "20235218", // código de alumno con el que inicia sesión
  tokenVersion: 4, // versión previa del token (el servicio la reemplaza por la nueva)
  fullName: "Jefferson Sanchez",
  firstName: "Jefferson",
  lastName: "Sanchez",
  institutionalEmail: "20235218@aloe.ulima.edu.pe", // dominio de alumno @aloe.ulima.edu.pe
  email: "20235218@aloe.ulima.edu.pe",
  role: "student",
  careerId: 1,
  career_id: 1,
  curriculumId: 1,
  currentLevel: 5,
  currentCycle: "2026-1",
  setupComplete: true,
  specialtySetupCompleted: true,
  especialidad_principal: null,
  especialidades_interes: [],
  especialidades: [],
  specialties: [],
  courseProgress: { approvedLevels: [1, 2, 3, 4], approvedElectives: [], currentCourses: [] },
  passwordHash: HASH, // el hash que bcrypt.compare validará; también sirve para comprobar que NO se filtra en la respuesta
});

// Fixture de DOCENTE (HU18): fabrica el objeto que devolvería findTeacherByCodeWithPassword. Nótese que NO tiene studentId (un usuario es alumno O docente, nunca ambos).
const teacher = (): TeacherAuthUserWithPassword => ({
  id: 42, // id de la fila app_user del docente (el que se incrementa)
  teacherId: 7, // id de docente: va en la claim teacherId del JWT
  code: "hquintan", // código docente (inicial + apellido) con el que inicia sesión
  tokenVersion: 3, // versión previa (el servicio la reemplaza)
  fullName: "Hernan Quintana",
  firstName: "Hernan",
  lastName: "Quintana",
  institutionalEmail: "hquintan@ulima.edu.pe", // dominio docente @ulima.edu.pe
  email: "hquintan@ulima.edu.pe",
  role: "teacher",
  teacherLabel: "Profesor",
  setupComplete: true,
  passwordHash: HASH, // mismo hash: la contraseña correcta es PASSWORD también para el docente
});

// Opciones del fabricante de servicio: cada campo controla qué devuelve una dependencia del repositorio, para forzar un camino concreto del método login().
type Options = {
  student?: AuthUserWithPassword | null; // qué devuelve findByCodeWithPassword (null => no es alumno => intenta docente)
  teacher?: TeacherAuthUserWithPassword | null; // qué devuelve findTeacherByCodeWithPassword (null => código inexistente)
  hasEnrollment?: boolean; // si el alumno tiene matrícula activa (false => 403 NOT_ENROLLED)
  representation?: { position: "student" | "delegate" | "subdelegate" | "teacher" } | null; // representación activa => rol del token
  nextTokenVersion?: number; // la nueva versión de token que devuelve incrementTokenVersion
  throwOnFind?: boolean; // si true, el repo LANZA en la primera consulta (simula fallo de BD => 500)
};

// Fabricante del servicio bajo prueba: arma un repositorio FALSO (no toca la BD) cuyas respuestas salen de `options`, y devuelve también `calls` para espiar con qué ids se llamó.
const makeService = (options: Options = {}) => {
  // Espía de llamadas: acumula los ids con los que el servicio invocó incrementTokenVersion y hasActiveEnrollment (para verificar el flujo de datos).
  const calls = { incrementedUserIds: [] as number[], enrollmentStudentIds: [] as number[] };
  const repository = {
    // Búsqueda del alumno por código: si throwOnFind está activo simula un fallo de BD; si no, devuelve el fixture (o null).
    findByCodeWithPassword: async () => {
      if (options.throwOnFind) throw new Error("fallo de BD");
      return options.student ?? null;
    },
    // Búsqueda del docente por código (camino HU18): null cuando el código no existe.
    findTeacherByCodeWithPassword: async () => options.teacher ?? null,
    // Verificación de matrícula activa: registra el studentId consultado y devuelve el flag (por defecto true).
    hasActiveEnrollment: async (studentId: number) => {
      calls.enrollmentStudentIds.push(studentId);
      return options.hasEnrollment ?? true;
    },
    // Representación activa del alumno: define si el rol será delegate/subdelegate o (null) student.
    findActiveRepresentation: async () => options.representation ?? null,
    // Incremento de tokenVersion: registra el userId (para probar que se invalidan sesiones del usuario correcto) y devuelve la versión nueva.
    incrementTokenVersion: async (userId: number) => {
      calls.incrementedUserIds.push(userId);
      return options.nextTokenVersion ?? 9;
    },
  } as unknown as AuthRepository; // forzamos el tipo: solo implementamos los métodos que login() usa
  return { service: new AuthService(repository, new EventBus()), calls }; // servicio real + repo falso; EventBus real porque login no depende de eventos
};

// Helper que verifica y DECODIFICA el JWT emitido, para poder inspeccionar sus claims (role, studentId, teacherId, tokenVersion).
const claimsFrom = (token: string): JwtPayload => {
  const claims = jwt.verify(token, config.auth.jwtSecret); // valida la firma con el MISMO secreto que usó el servicio
  if (typeof claims === "string") throw new Error("Se esperaba un JWT con payload JSON"); // salvaguarda: el payload debe ser objeto, no string
  return claims; // devuelve el objeto de claims para los expect
};

// Helper para los caminos de ERROR: ejecuta la promesa, exige que RECHACE, y comprueba el statusCode/code/message exactos del HttpError.
const expectHttpError = async (
  action: Promise<unknown>,
  statusCode: number,
  code: string,
  message: string,
) => {
  try {
    await action; // dispara el login; si NO lanza, el camino de error falló
    throw new Error(`Se esperaba ${statusCode} ${code}`); // si llegamos aquí, no hubo error => forzamos fallo del test
  } catch (error) {
    const httpError = error as { statusCode?: number; code?: string; message?: string }; // tratamos el error como HttpError para leer sus campos
    expect(httpError.statusCode).toBe(statusCode); // verifica que el código HTTP sea el esperado (401/403/500)
    expect(httpError.code).toBe(code); // verifica el código simbólico del error (USER_NOT_FOUND, etc.)
    expect(httpError.message).toBe(message); // verifica el mensaje exacto que verá el cliente
  }
};

describe("CAJA BLANCA · AuthService.login()", () => {
  // ⭐ C1 es el mejor caso feliz para mostrar: demuestra desvío a docente,
  // tokenVersion nuevo, claims correctos y que passwordHash no sale de la capa.
  // C1 · Camino N1(null)->P1(V)->loginTeacher OK: sin alumno pero con docente y contraseña correcta => JWT docente.
  test("C1: código de docente (no alumno) con contraseña correcta → JWT docente", async () => {
    // student: null fuerza el desvío a loginTeacher; nextTokenVersion: 4 es la versión que se firmará.
    const { service, calls } = makeService({ student: null, teacher: teacher(), nextTokenVersion: 4 });
    const result = await service.login({ code: "hquintan", password: PASSWORD }); // login con código y contraseña correctos del docente
    const claims = claimsFrom(result.token); // decodifica el JWT para inspeccionar sus claims
    expect(claims.role).toBe("teacher"); // verifica que el rol emitido sea docente
    expect(claims.teacherId).toBe(7); // verifica que lleve el teacherId del fixture
    expect(claims.studentId).toBeUndefined(); // verifica que el token docente NO lleve studentId
    expect(claims.tokenVersion).toBe(4); // verifica que use la versión NUEVA recién incrementada (no la vieja 3)
    expect(result.tokenType).toBe("Bearer"); // verifica el tipo de token de la respuesta
    expect(calls.incrementedUserIds).toEqual([42]); // verifica que se invalidaran sesiones del app_user docente (id 42)
    expect("passwordHash" in result.user).toBe(false); // verifica que la respuesta NO filtre el hash de la contraseña
  });

  // C2 · Camino ...loginTeacher P2(V): ni alumno ni docente existen => 401 USER_NOT_FOUND.
  test("C2: código inexistente (ni alumno ni docente) → 401 USER_NOT_FOUND", async () => {
    const { service } = makeService({ student: null, teacher: null }); // ambas búsquedas devuelven null
    await expectHttpError(
      service.login({ code: "zzz", password: PASSWORD }), // código que no corresponde a nadie
      401, // verifica status 401
      "USER_NOT_FOUND", // verifica el código de error
      "Código no encontrado en la base de datos.", // verifica el mensaje exacto
    );
  });

  // C3 · Camino ...loginTeacher P3(V): docente existe pero contraseña no coincide => 401 INVALID_PASSWORD.
  test("C3: docente con contraseña incorrecta → 401 INVALID_PASSWORD", async () => {
    const { service } = makeService({ student: null, teacher: teacher() }); // no es alumno, sí docente
    await expectHttpError(
      service.login({ code: "hquintan", password: "mala" }), // contraseña que no matchea el HASH
      401, // verifica status 401
      "INVALID_PASSWORD", // verifica el código de error
      "Contraseña incorrecta.", // verifica el mensaje exacto
    );
  });

  // C4 · Camino N1(user)->P4(V): alumno existe pero contraseña no coincide => 401 INVALID_PASSWORD.
  test("C4: alumno con contraseña incorrecta → 401 INVALID_PASSWORD", async () => {
    const { service } = makeService({ student: student() }); // findByCodeWithPassword devuelve al alumno
    await expectHttpError(
      service.login({ code: "20235218", password: "mala" }), // contraseña incorrecta del alumno
      401, // verifica status 401
      "INVALID_PASSWORD", // verifica el código de error
      "Contraseña incorrecta.", // verifica el mensaje exacto
    );
  });

  // C5 · Camino ...P4(F)->P5(V): contraseña correcta pero sin matrícula activa => 403 NOT_ENROLLED.
  test("C5: alumno correcto pero sin matrícula activa → 403 NOT_ENROLLED", async () => {
    const { service, calls } = makeService({ student: student(), hasEnrollment: false }); // hasEnrollment: false fuerza el 403
    await expectHttpError(
      service.login({ code: "20235218", password: PASSWORD }), // credenciales correctas
      403, // verifica status 403
      "NOT_ENROLLED", // verifica el código de error
      "El estudiante no tiene una matrícula activa.", // verifica el mensaje exacto
    );
    expect(calls.enrollmentStudentIds).toEqual([101]); // verifica que se consultó la matrícula con el studentId correcto (101)
  });

  // C6 · Camino ...P5(F)->P6(representación): alumno con representación activa => rol delegate en un JWT de alumno.
  test("C6: alumno con representación activa → rol delegate y JWT de alumno", async () => {
    const { service, calls } = makeService({
      student: student(),
      representation: { position: "delegate" }, // representación activa => el rol pasa a "delegate"
      nextTokenVersion: 5, // versión nueva a firmar
    });
    const result = await service.login({ code: "20235218", password: PASSWORD }); // login exitoso del alumno delegado
    const claims = claimsFrom(result.token); // decodifica el JWT
    expect(claims.role).toBe("delegate"); // verifica que el rol del token venga de la representación
    expect(claims.studentId).toBe(101); // verifica que sea un token de ALUMNO (lleva studentId)
    expect(claims.teacherId).toBeUndefined(); // verifica que NO lleve teacherId (no es docente)
    expect(claims.tokenVersion).toBe(5); // verifica que use la versión nueva firmada
    expect(result.tokenType).toBe("Bearer"); // verifica el tipo de token
    expect(result.user.role).toBe("delegate"); // verifica que el objeto user devuelto también tenga rol delegate
    expect("passwordHash" in result.user).toBe(false); // verifica que no se filtre el hash
    expect(calls.incrementedUserIds).toEqual([11]); // verifica que se invalidaran sesiones del app_user alumno (id 11)
  });

  // C7 · Camino ...P6(?? "student"): sin representación => el rol cae al valor por defecto "student".
  test("C7: alumno sin representación → rol 'student' por defecto (?? 'student')", async () => {
    const { service } = makeService({ student: student(), representation: null }); // representation null => rama del ?? "student"
    const result = await service.login({ code: "20235218", password: PASSWORD }); // login exitoso
    expect(claimsFrom(result.token).role).toBe("student"); // verifica que el rol del token sea el default "student"
    expect(result.user.role).toBe("student"); // verifica que el user devuelto también tenga rol student
  });

  // ⭐ C8 prueba una frontera de seguridad: un error interno no filtra detalles
  // de la base de datos y se traduce a una respuesta pública genérica.
  // C8 · Camino P7 (error no-HttpError): el repo lanza un Error genérico => se traduce a 500 INTERNAL_ERROR y se loguea.
  test("C8: error no-HttpError del repositorio (fallo de BD) → 500 INTERNAL_ERROR", async () => {
    const { service } = makeService({ throwOnFind: true }); // throwOnFind hace que findByCodeWithPassword lance
    const consoleError = spyOn(console, "error").mockImplementation(() => {}); // espía console.error y silencia el ruido en la consola del test

    try {
      await expectHttpError(
        service.login({ code: "20235218", password: PASSWORD }), // el fallo de BD debe convertirse en HttpError 500
        500, // verifica status 500
        "INTERNAL_ERROR", // verifica el código de error
        "Error interno del servidor.", // verifica el mensaje genérico (no filtra detalles internos)
      );
      expect(consoleError).toHaveBeenCalledTimes(1); // verifica que el error se logueó exactamente una vez
      expect(consoleError.mock.calls[0]?.[0]).toBe("DB Error in auth.service login"); // verifica el prefijo del log
      expect(consoleError.mock.calls[0]?.[1]).toBeInstanceOf(Error); // verifica que el segundo argumento sea el Error original
    } finally {
      consoleError.mockRestore(); // restaura console.error pase lo que pase (no ensucia otros tests)
    }
  });
});
