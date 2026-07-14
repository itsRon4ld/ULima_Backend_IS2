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
 * V(G) = P1..P7 (con el corto-circuito de loginTeacher) ≈ 8 puntos de decisión
 * ⇒ V(G) ≈ 8 (> 4). Batería de caminos independientes:
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

const PASSWORD = "correcta2026";
const HASH = bcrypt.hashSync(PASSWORD, 10);

const student = (): AuthUserWithPassword => ({
  id: 11,
  studentId: 101,
  code: "20235218",
  tokenVersion: 4,
  fullName: "Jefferson Sanchez",
  firstName: "Jefferson",
  lastName: "Sanchez",
  institutionalEmail: "20235218@aloe.ulima.edu.pe",
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
  passwordHash: HASH,
});

const teacher = (): TeacherAuthUserWithPassword => ({
  id: 42,
  teacherId: 7,
  code: "hquintan",
  tokenVersion: 3,
  fullName: "Hernan Quintana",
  firstName: "Hernan",
  lastName: "Quintana",
  institutionalEmail: "hquintan@ulima.edu.pe",
  email: "hquintan@ulima.edu.pe",
  role: "teacher",
  teacherLabel: "Profesor",
  setupComplete: true,
  passwordHash: HASH,
});

type Options = {
  student?: AuthUserWithPassword | null;
  teacher?: TeacherAuthUserWithPassword | null;
  hasEnrollment?: boolean;
  representation?: { position: "student" | "delegate" | "subdelegate" | "teacher" } | null;
  nextTokenVersion?: number;
  throwOnFind?: boolean;
};

const makeService = (options: Options = {}) => {
  const calls = { incrementedUserIds: [] as number[], enrollmentStudentIds: [] as number[] };
  const repository = {
    findByCodeWithPassword: async () => {
      if (options.throwOnFind) throw new Error("fallo de BD");
      return options.student ?? null;
    },
    findTeacherByCodeWithPassword: async () => options.teacher ?? null,
    hasActiveEnrollment: async (studentId: number) => {
      calls.enrollmentStudentIds.push(studentId);
      return options.hasEnrollment ?? true;
    },
    findActiveRepresentation: async () => options.representation ?? null,
    incrementTokenVersion: async (userId: number) => {
      calls.incrementedUserIds.push(userId);
      return options.nextTokenVersion ?? 9;
    },
  } as unknown as AuthRepository;
  return { service: new AuthService(repository, new EventBus()), calls };
};

const claimsFrom = (token: string): JwtPayload => {
  const claims = jwt.verify(token, config.auth.jwtSecret);
  if (typeof claims === "string") throw new Error("Se esperaba un JWT con payload JSON");
  return claims;
};

const expectHttpError = async (
  action: Promise<unknown>,
  statusCode: number,
  code: string,
  message: string,
) => {
  try {
    await action;
    throw new Error(`Se esperaba ${statusCode} ${code}`);
  } catch (error) {
    const httpError = error as { statusCode?: number; code?: string; message?: string };
    expect(httpError.statusCode).toBe(statusCode);
    expect(httpError.code).toBe(code);
    expect(httpError.message).toBe(message);
  }
};

describe("CAJA BLANCA · AuthService.login()", () => {
  test("C1: código de docente (no alumno) con contraseña correcta → JWT docente", async () => {
    const { service, calls } = makeService({ student: null, teacher: teacher(), nextTokenVersion: 4 });
    const result = await service.login({ code: "hquintan", password: PASSWORD });
    const claims = claimsFrom(result.token);
    expect(claims.role).toBe("teacher");
    expect(claims.teacherId).toBe(7);
    expect(claims.studentId).toBeUndefined(); // token docente NO lleva studentId
    expect(claims.tokenVersion).toBe(4); // versión nueva (recién incrementada)
    expect(result.tokenType).toBe("Bearer");
    expect(calls.incrementedUserIds).toEqual([42]);
    expect("passwordHash" in result.user).toBe(false); // no se filtra el hash
  });

  test("C2: código inexistente (ni alumno ni docente) → 401 USER_NOT_FOUND", async () => {
    const { service } = makeService({ student: null, teacher: null });
    await expectHttpError(
      service.login({ code: "zzz", password: PASSWORD }),
      401,
      "USER_NOT_FOUND",
      "Código no encontrado en la base de datos.",
    );
  });

  test("C3: docente con contraseña incorrecta → 401 INVALID_PASSWORD", async () => {
    const { service } = makeService({ student: null, teacher: teacher() });
    await expectHttpError(
      service.login({ code: "hquintan", password: "mala" }),
      401,
      "INVALID_PASSWORD",
      "Contraseña incorrecta.",
    );
  });

  test("C4: alumno con contraseña incorrecta → 401 INVALID_PASSWORD", async () => {
    const { service } = makeService({ student: student() });
    await expectHttpError(
      service.login({ code: "20235218", password: "mala" }),
      401,
      "INVALID_PASSWORD",
      "Contraseña incorrecta.",
    );
  });

  test("C5: alumno correcto pero sin matrícula activa → 403 NOT_ENROLLED", async () => {
    const { service, calls } = makeService({ student: student(), hasEnrollment: false });
    await expectHttpError(
      service.login({ code: "20235218", password: PASSWORD }),
      403,
      "NOT_ENROLLED",
      "El estudiante no tiene una matrícula activa.",
    );
    expect(calls.enrollmentStudentIds).toEqual([101]);
  });

  test("C6: alumno con representación activa → rol delegate y JWT de alumno", async () => {
    const { service, calls } = makeService({
      student: student(),
      representation: { position: "delegate" },
      nextTokenVersion: 5,
    });
    const result = await service.login({ code: "20235218", password: PASSWORD });
    const claims = claimsFrom(result.token);
    expect(claims.role).toBe("delegate");
    expect(claims.studentId).toBe(101);
    expect(claims.teacherId).toBeUndefined();
    expect(claims.tokenVersion).toBe(5);
    expect(result.tokenType).toBe("Bearer");
    expect(result.user.role).toBe("delegate");
    expect("passwordHash" in result.user).toBe(false);
    expect(calls.incrementedUserIds).toEqual([11]);
  });

  test("C7: alumno sin representación → rol 'student' por defecto (?? 'student')", async () => {
    const { service } = makeService({ student: student(), representation: null });
    const result = await service.login({ code: "20235218", password: PASSWORD });
    expect(claimsFrom(result.token).role).toBe("student");
    expect(result.user.role).toBe("student");
  });

  test("C8: error no-HttpError del repositorio (fallo de BD) → 500 INTERNAL_ERROR", async () => {
    const { service } = makeService({ throwOnFind: true });
    const consoleError = spyOn(console, "error").mockImplementation(() => {});

    try {
      await expectHttpError(
        service.login({ code: "20235218", password: PASSWORD }),
        500,
        "INTERNAL_ERROR",
        "Error interno del servidor.",
      );
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError.mock.calls[0]?.[0]).toBe("DB Error in auth.service login");
      expect(consoleError.mock.calls[0]?.[1]).toBeInstanceOf(Error);
    } finally {
      consoleError.mockRestore();
    }
  });
});
