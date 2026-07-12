import { describe, expect, test } from "bun:test";
import type { Context } from "hono";
import { StudentController } from "../src/modules/advising/student/student.controller.js";
import { StudentService } from "../src/modules/advising/student/student.service.js";
import type { StudentRepository } from "../src/modules/advising/student/student.repository.js";
import type { EventBus } from "../src/events/index.js";
import type { RawAdvisingRow } from "../src/modules/advising/student/student.types.js";

const noopEvents = {} as unknown as EventBus;

const fakeRepo = (over: Partial<StudentRepository>): StudentRepository =>
  ({
    findBySection: async () => [],
    findSessionById: async () => null,
    isParticipant: async () => true,
    insertRsvp: async () => {},
    deleteRsvp: async () => {},
    countRsvp: async () => 0,
    ...over,
  }) as unknown as StudentRepository;

const buildRow = (over: Partial<RawAdvisingRow> = {}): RawAdvisingRow => ({
  id: 1,
  course_offering_id: 10,
  section_id: 1,
  day_of_week: 1,
  start_time: "10:00",
  end_time: "11:00",
  classroom: "A-101",
  meeting_url: "https://zoom.us/x",
  teacher_code: "hquintan",
  full_name: "Quintana Cruz, Hernan",
  kind: "recurring",
  session_date: null,
  dictante_rol: "Profesor",
  asistentes: 3,
  my_rsvp: false,
  ...over,
});

const fakeCtx = (params: Record<string, string>, vars: Record<string, unknown>): Context =>
  ({
    req: { param: () => params },
    get: (k: string) => vars[k],
    json: (body: unknown) => body,
  }) as unknown as Context;

const expectHttpError = async (fn: () => Promise<unknown>, status: number, code: string) => {
  try {
    await fn();
    throw new Error(`se esperaba ${status} ${code} y no se lanzó`);
  } catch (e) {
    const err = e as { statusCode?: number; code?: string };
    expect(err.statusCode).toBe(status);
    expect(err.code).toBe(code);
  }
};

describe("StudentService.confirmRsvp", () => {
  test("alumno participante → inserta y devuelve conteo + myRsvp=true", async () => {
    let inserted = 0;
    const service = new StudentService(
      fakeRepo({
        findSessionById: async () => ({
          kind: "extra", sessionDate: "2026-12-20", dayOfWeek: 3, startTime: "10:00", endTime: "11:00",
        }),
        isParticipant: async () => true,
        insertRsvp: async () => { inserted++; },
        countRsvp: async () => 4,
      }),
      noopEvents,
    );

    const res = await service.confirmRsvp(5, 6);
    expect(inserted).toBe(1);
    expect(res).toEqual({ id: "5", asistentes: 4, myRsvp: true });
  });

  test("sesión inexistente → 404 SESSION_NOT_FOUND", async () => {
    const service = new StudentService(
      fakeRepo({ findSessionById: async () => null }),
      noopEvents,
    );
    await expectHttpError(() => service.confirmRsvp(999, 6), 404, "SESSION_NOT_FOUND");
  });

  test("alumno NO participante → 404 SESSION_NOT_FOUND", async () => {
    let inserted = 0;
    const service = new StudentService(
      fakeRepo({
        findSessionById: async () => ({
          kind: "extra", sessionDate: "2026-12-20", dayOfWeek: 3, startTime: "10:00", endTime: "11:00",
        }),
        isParticipant: async () => false,
        insertRsvp: async () => { inserted++; },
      }),
      noopEvents,
    );

    await expectHttpError(() => service.confirmRsvp(999, 6), 404, "SESSION_NOT_FOUND");
    expect(inserted).toBe(0);
  });

  test("sesión pasada → 409 SESSION_ALREADY_PAST", async () => {
    const service = new StudentService(
      fakeRepo({
        findSessionById: async () => ({
          kind: "extra", sessionDate: "2020-01-01", dayOfWeek: 3, startTime: "08:00", endTime: "09:00",
        }),
      }),
      noopEvents,
    );
    await expectHttpError(() => service.confirmRsvp(5, 6), 409, "SESSION_ALREADY_PAST");
  });

  test("confirmar dos veces → idempotente", async () => {
    const service = new StudentService(
      fakeRepo({
        findSessionById: async () => ({
          kind: "extra", sessionDate: "2026-12-20", dayOfWeek: 3, startTime: "10:00", endTime: "11:00",
        }),
        isParticipant: async () => true,
        countRsvp: async () => 1,
      }),
      noopEvents,
    );

    const a = await service.confirmRsvp(5, 6);
    const b = await service.confirmRsvp(5, 6);
    expect(a.asistentes).toBe(1);
    expect(b.asistentes).toBe(1);
    expect(b.myRsvp).toBe(true);
  });
});

describe("StudentService.cancelRsvp", () => {
  test("cancela → borra + conteo + myRsvp=false", async () => {
    let deleted = 0;
    const service = new StudentService(
      fakeRepo({
        deleteRsvp: async () => { deleted++; },
        countRsvp: async () => 2,
      }),
      noopEvents,
    );

    const res = await service.cancelRsvp(5, 6);
    expect(deleted).toBe(1);
    expect(res).toEqual({ id: "5", asistentes: 2, myRsvp: false });
  });

  test("cancelar sin confirmación previa → no-op, myRsvp=false", async () => {
    const service = new StudentService(
      fakeRepo({ countRsvp: async () => 0 }),
      noopEvents,
    );
    const res = await service.cancelRsvp(5, 6);
    expect(res.asistentes).toBe(0);
    expect(res.myRsvp).toBe(false);
  });
});

describe("StudentService.getAdvising", () => {
  test("mapea my_rsvp=true → myRsvp=true", async () => {
    let seenStudentId: number | undefined = -1;
    const service = new StudentService(
      fakeRepo({
        findBySection: async (_sectionId: number, studentId?: number) => {
          seenStudentId = studentId;
          return [buildRow({ my_rsvp: true, asistentes: 5 })];
        },
      }),
      noopEvents,
    );

    const { asesorias } = await service.getAdvising(1, 6);
    expect(seenStudentId).toBe(6);
    expect(asesorias[0].myRsvp).toBe(true);
    expect(asesorias[0].asistentes).toBe(5);
  });

  test("my_rsvp null/false → myRsvp=false y defaults", async () => {
    const service = new StudentService(
      fakeRepo({
        findBySection: async () => [
          buildRow({ my_rsvp: null, kind: null, dictante_rol: null, asistentes: null }),
        ],
      }),
      noopEvents,
    );

    const { asesorias } = await service.getAdvising(1);
    expect(asesorias[0].myRsvp).toBe(false);
    expect(asesorias[0].kind).toBe("recurring");
    expect(asesorias[0].dictanteRol).toBe("Profesor");
    expect(asesorias[0].asistentes).toBe(0);
  });

  test("filtra pasadas del resultado", async () => {
    const service = new StudentService(
      fakeRepo({
        findBySection: async () => [
          buildRow({ id: 1, kind: "extra", session_date: "2020-01-01" }),
          buildRow({ id: 2, kind: "recurring", day_of_week: 6, end_time: "09:00" }),
        ],
      }),
      noopEvents,
    );

    const { asesorias } = await service.getAdvising(1, 6);
    expect(asesorias.length).toBe(0);
  });
});

describe("StudentController — RSVP solo alumnos", () => {
  const service = new StudentService(
    fakeRepo({
      findSessionById: async () => ({
        kind: "extra", sessionDate: "2026-12-20", dayOfWeek: 3, startTime: "10:00", endTime: "11:00",
      }),
      isParticipant: async () => true,
      countRsvp: async () => 1,
    }),
    noopEvents,
  );
  const controller = new StudentController(service);

  test("token alumno → confirma", async () => {
    const c = fakeCtx({ sessionId: "5" }, { studentId: 6 });
    const res = (await controller.confirmRsvp(c)) as { id: string; myRsvp: boolean };
    expect(res.id).toBe("5");
    expect(res.myRsvp).toBe(true);
  });

  test("token docente (sin studentId) → 403 RSVP_STUDENT_ONLY", async () => {
    const c = fakeCtx({ sessionId: "5" }, { teacherId: 129 });
    await expectHttpError(() => controller.confirmRsvp(c), 403, "RSVP_STUDENT_ONLY");
  });

  test("cancelar como docente → 403", async () => {
    const c = fakeCtx({ sessionId: "5" }, {});
    await expectHttpError(() => controller.cancelRsvp(c), 403, "RSVP_STUDENT_ONLY");
  });
});
