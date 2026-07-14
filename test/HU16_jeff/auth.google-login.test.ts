import { describe, expect, test } from "bun:test";
import jwt from "jsonwebtoken";
import { config } from "../../src/config/app-config.js";
import { EventBus } from "../../src/events/index.js";
import type { AuthRepository } from "../../src/modules/auth/auth.repository.js";
import { AuthService, type GoogleTokenVerifier } from "../../src/modules/auth/auth.service.js";
import type { AuthUser, TeacherAuthUser } from "../../src/modules/auth/auth.types.js";

type GooglePayload = {
  email?: string;
  sub?: string;
};

type RepositoryCalls = {
  studentEmails: string[];
  teacherEmails: string[];
  linkedGoogleIds: Array<{ userId: number; googleId: string }>;
  enrollmentStudentIds: number[];
  representationStudentIds: number[];
  incrementedUserIds: number[];
};

type FakeRepositoryOptions = {
  student?: AuthUser | null;
  teacher?: TeacherAuthUser | null;
  hasActiveEnrollment?: boolean;
  representation?: { position: "student" | "delegate" | "subdelegate" | "teacher" } | null;
  nextTokenVersion?: number;
};

const student: AuthUser = {
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
  courseProgress: {
    approvedLevels: [1, 2, 3, 4],
    approvedElectives: [],
    currentCourses: [],
  },
};

const teacher: TeacherAuthUser = {
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
};

// El verificador real espera GoogleIdTokenPayload | undefined; aquí devolvemos un
// payload simplificado (y null), así que casteamos como se hace con el repo fake.
const verifierFor = (payload: GooglePayload | null) =>
  ({
    verifyIdToken: async ({ idToken }: { idToken: string }) => {
      expect(idToken).toBe("google-id-token");
      return { getPayload: () => payload };
    },
  }) as unknown as GoogleTokenVerifier;

const fakeRepository = (options: FakeRepositoryOptions = {}) => {
  const calls: RepositoryCalls = {
    studentEmails: [],
    teacherEmails: [],
    linkedGoogleIds: [],
    enrollmentStudentIds: [],
    representationStudentIds: [],
    incrementedUserIds: [],
  };

  const repository = {
    findByEmail: async (email: string) => {
      calls.studentEmails.push(email);
      return options.student ?? null;
    },
    findTeacherByEmail: async (email: string) => {
      calls.teacherEmails.push(email);
      return options.teacher ?? null;
    },
    linkGoogleId: async (userId: number, googleId: string) => {
      calls.linkedGoogleIds.push({ userId, googleId });
    },
    hasActiveEnrollment: async (studentId: number) => {
      calls.enrollmentStudentIds.push(studentId);
      return options.hasActiveEnrollment ?? true;
    },
    findActiveRepresentation: async (studentId: number) => {
      calls.representationStudentIds.push(studentId);
      return options.representation ?? null;
    },
    incrementTokenVersion: async (userId: number) => {
      calls.incrementedUserIds.push(userId);
      return options.nextTokenVersion ?? 5;
    },
  } as unknown as AuthRepository;

  return { repository, calls };
};

const createService = (
  payload: GooglePayload | null,
  options: FakeRepositoryOptions = {},
) => {
  const { repository, calls } = fakeRepository(options);
  const service = new AuthService(
    repository,
    new EventBus(),
    verifierFor(payload),
  );
  return { service, calls };
};

// El JWT firma `sub` con el id numérico y agrega claims propios; jsonwebtoken tipa
// `sub` como string, así que describimos aquí la forma real del payload decodificado.
type DecodedClaims = {
  sub?: number;
  studentId?: number;
  teacherId?: number;
  role?: string;
  tokenVersion?: number;
  [key: string]: unknown;
};

const claimsFrom = (token: string): DecodedClaims => {
  const claims = jwt.verify(token, config.auth.jwtSecret);
  if (typeof claims === "string") throw new Error("Se esperaba un JWT con payload JSON");
  return claims as unknown as DecodedClaims;
};

const expectHttpError = async (
  action: Promise<unknown>,
  statusCode: number,
  code: string,
) => {
  try {
    await action;
    throw new Error(`Se esperaba ${statusCode} ${code}`);
  } catch (error) {
    const httpError = error as { statusCode?: number; code?: string };
    expect(httpError.statusCode).toBe(statusCode);
    expect(httpError.code).toBe(code);
  }
};

describe("AuthService.loginWithGoogle", () => {
  test("alumno @aloe.ulima.edu.pe conserva flujo de matrícula y emite JWT de alumno", async () => {
    const { service, calls } = createService(
      {
        email: "20235218@aloe.ulima.edu.pe",
        sub: "google-student-101",
      },
      { student, nextTokenVersion: 8 },
    );

    const result = await service.loginWithGoogle({ idToken: "google-id-token" });
    const claims = claimsFrom(result.token);

    expect(result.user.role).toBe("student");
    expect(result.user.tokenVersion).toBe(8);
    expect(claims.sub).toBe(student.id);
    expect(claims.studentId).toBe(student.studentId);
    expect(claims.teacherId).toBeUndefined();
    expect(claims.role).toBe("student");
    expect(claims.tokenVersion).toBe(8);

    expect(calls.studentEmails).toEqual(["20235218@aloe.ulima.edu.pe"]);
    expect(calls.teacherEmails).toEqual([]);
    expect(calls.linkedGoogleIds).toEqual([
      { userId: student.id, googleId: "google-student-101" },
    ]);
    expect(calls.enrollmentStudentIds).toEqual([student.studentId]);
    expect(calls.representationStudentIds).toEqual([student.studentId]);
    expect(calls.incrementedUserIds).toEqual([student.id]);
  });

  test("docente @ulima.edu.pe se normaliza, omite reglas de alumno y emite JWT docente", async () => {
    const { service, calls } = createService(
      {
        email: "  HQUINTAN@ULIMA.EDU.PE  ",
        sub: "google-teacher-7",
      },
      { teacher, nextTokenVersion: 9 },
    );

    const result = await service.loginWithGoogle({ idToken: "google-id-token" });
    const claims = claimsFrom(result.token);

    expect(result.user.role).toBe("teacher");
    const teacherUser = result.user as TeacherAuthUser;
    expect(teacherUser.teacherId).toBe(teacher.teacherId);
    expect(teacherUser.teacherLabel).toBe("Profesor");
    expect(result.user.setupComplete).toBe(true);
    expect(result.user.tokenVersion).toBe(9);
    expect(claims.sub).toBe(teacher.id);
    expect(claims.teacherId).toBe(teacher.teacherId);
    expect(claims.studentId).toBeUndefined();
    expect(claims.role).toBe("teacher");
    expect(claims.tokenVersion).toBe(9);

    expect(calls.teacherEmails).toEqual(["hquintan@ulima.edu.pe"]);
    expect(calls.studentEmails).toEqual([]);
    expect(calls.linkedGoogleIds).toEqual([
      { userId: teacher.id, googleId: "google-teacher-7" },
    ]);
    expect(calls.enrollmentStudentIds).toEqual([]);
    expect(calls.representationStudentIds).toEqual([]);
    expect(calls.incrementedUserIds).toEqual([teacher.id]);
  });

  test("alumno institucional sin perfil vinculado recibe USER_NOT_FOUND", async () => {
    const { service, calls } = createService({
      email: "desconocido@aloe.ulima.edu.pe",
      sub: "google-unknown-student",
    });

    await expectHttpError(
      service.loginWithGoogle({ idToken: "google-id-token" }),
      401,
      "USER_NOT_FOUND",
    );

    expect(calls.studentEmails).toEqual(["desconocido@aloe.ulima.edu.pe"]);
    expect(calls.teacherEmails).toEqual([]);
    expect(calls.linkedGoogleIds).toEqual([]);
    expect(calls.incrementedUserIds).toEqual([]);
  });

  test("alumno sin matrícula activa conserva NOT_ENROLLED y no emite sesión", async () => {
    const { service, calls } = createService(
      { email: "20235218@aloe.ulima.edu.pe" },
      { student, hasActiveEnrollment: false },
    );

    await expectHttpError(
      service.loginWithGoogle({ idToken: "google-id-token" }),
      403,
      "NOT_ENROLLED",
    );

    expect(calls.studentEmails).toEqual(["20235218@aloe.ulima.edu.pe"]);
    expect(calls.enrollmentStudentIds).toEqual([student.studentId]);
    expect(calls.representationStudentIds).toEqual([]);
    expect(calls.incrementedUserIds).toEqual([]);
  });

  test("docente institucional sin perfil vinculado recibe USER_NOT_FOUND", async () => {
    const { service, calls } = createService({
      email: "desconocido@ulima.edu.pe",
      sub: "google-unknown-teacher",
    });

    await expectHttpError(
      service.loginWithGoogle({ idToken: "google-id-token" }),
      401,
      "USER_NOT_FOUND",
    );

    expect(calls.teacherEmails).toEqual(["desconocido@ulima.edu.pe"]);
    expect(calls.studentEmails).toEqual([]);
    expect(calls.linkedGoogleIds).toEqual([]);
    expect(calls.enrollmentStudentIds).toEqual([]);
    expect(calls.representationStudentIds).toEqual([]);
    expect(calls.incrementedUserIds).toEqual([]);
  });

  for (const invalidEmail of [
    "persona@gmail.com",
    "persona@ulima.edu.pe.evil.example",
    "persona@aloe.ulima.edu.pe.evil.example",
    "persona@evilulima.edu.pe",
  ]) {
    test(`rechaza dominio inválido sin consultar perfiles: ${invalidEmail}`, async () => {
      const { service, calls } = createService({
        email: invalidEmail,
        sub: "google-invalid-domain",
      });

      await expectHttpError(
        service.loginWithGoogle({ idToken: "google-id-token" }),
        403,
        "INVALID_DOMAIN",
      );

      expect(calls.studentEmails).toEqual([]);
      expect(calls.teacherEmails).toEqual([]);
      expect(calls.linkedGoogleIds).toEqual([]);
      expect(calls.enrollmentStudentIds).toEqual([]);
      expect(calls.representationStudentIds).toEqual([]);
      expect(calls.incrementedUserIds).toEqual([]);
    });
  }

  test("payload de Google sin email recibe INVALID_TOKEN sin consultar perfiles", async () => {
    const { service, calls } = createService({ sub: "google-without-email" });

    await expectHttpError(
      service.loginWithGoogle({ idToken: "google-id-token" }),
      401,
      "INVALID_TOKEN",
    );

    expect(calls.studentEmails).toEqual([]);
    expect(calls.teacherEmails).toEqual([]);
    expect(calls.linkedGoogleIds).toEqual([]);
    expect(calls.incrementedUserIds).toEqual([]);
  });

  test("token rechazado por Google recibe INVALID_TOKEN en vez de INTERNAL_ERROR", async () => {
    const { repository, calls } = fakeRepository();
    const service = new AuthService(repository, new EventBus(), {
      verifyIdToken: async () => {
        throw new Error("firma o expiración inválida");
      },
    });

    await expectHttpError(
      service.loginWithGoogle({ idToken: "google-id-token" }),
      401,
      "INVALID_TOKEN",
    );

    expect(calls.studentEmails).toEqual([]);
    expect(calls.teacherEmails).toEqual([]);
    expect(calls.incrementedUserIds).toEqual([]);
  });

  test("correo vacío tras normalizar recibe INVALID_TOKEN", async () => {
    const { service, calls } = createService({ email: "   " });

    await expectHttpError(
      service.loginWithGoogle({ idToken: "google-id-token" }),
      401,
      "INVALID_TOKEN",
    );

    expect(calls.studentEmails).toEqual([]);
    expect(calls.teacherEmails).toEqual([]);
    expect(calls.incrementedUserIds).toEqual([]);
  });
});
