import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { chatTokenSchema } from "../../src/modules/chat/chat.schemas.js";
import { deleteParamsSchema } from "../../src/modules/chat/chat.routes.js";

const safe = (schema: { safeParse: (v: unknown) => { success: boolean } }, input: unknown) =>
  schema.safeParse(input);

describe("chatTokenSchema — caja negra", () => {
  test("válido: sectionId numérico positivo", () => {
    const r = safe(chatTokenSchema, { sectionId: 1 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.sectionId).toBe(1);
  });

  test("válido: coerce de string a number", () => {
    const r = safe(chatTokenSchema, { sectionId: "42" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.sectionId).toBe(42);
  });

  test("válido: número grande positivo", () => {
    const r = safe(chatTokenSchema, { sectionId: 999999 });
    expect(r.success).toBe(true);
  });

  test("inválido: objeto vacío (sin sectionId)", () => {
    expect(safe(chatTokenSchema, {}).success).toBe(false);
  });

  test("inválido: sectionId cero (no positivo)", () => {
    expect(safe(chatTokenSchema, { sectionId: 0 }).success).toBe(false);
  });

  test("inválido: sectionId negativo", () => {
    expect(safe(chatTokenSchema, { sectionId: -1 }).success).toBe(false);
  });

  test("inválido: sectionId decimal (no entero)", () => {
    expect(safe(chatTokenSchema, { sectionId: 1.5 }).success).toBe(false);
  });

  test("inválido: sectionId string no numérico", () => {
    expect(safe(chatTokenSchema, { sectionId: "abc" }).success).toBe(false);
  });

  test("inválido: sectionId null", () => {
    expect(safe(chatTokenSchema, { sectionId: null }).success).toBe(false);
  });
});

describe("deleteParamsSchema — caja negra", () => {
  test("válido: params completos", () => {
    const r = safe(deleteParamsSchema, { sectionId: 1, messageId: "-Nabc123" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.sectionId).toBe(1);
      expect(r.data.messageId).toBe("-Nabc123");
    }
  });

  test("válido: coerce de sectionId desde string", () => {
    const r = safe(deleteParamsSchema, { sectionId: "5", messageId: "msg01" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.sectionId).toBe(5);
  });

  test("válido: messageId en borde máximo (200 chars)", () => {
    const r = safe(deleteParamsSchema, { sectionId: 1, messageId: "x".repeat(200) });
    expect(r.success).toBe(true);
  });

  test("válido: messageId en borde mínimo (1 char)", () => {
    const r = safe(deleteParamsSchema, { sectionId: 1, messageId: "a" });
    expect(r.success).toBe(true);
  });

  test("inválido: sin sectionId", () => {
    expect(safe(deleteParamsSchema, { messageId: "abc" }).success).toBe(false);
  });

  test("inválido: sin messageId", () => {
    expect(safe(deleteParamsSchema, { sectionId: 1 }).success).toBe(false);
  });

  test("inválido: sectionId cero", () => {
    expect(safe(deleteParamsSchema, { sectionId: 0, messageId: "abc" }).success).toBe(false);
  });

  test("inválido: sectionId negativo", () => {
    expect(safe(deleteParamsSchema, { sectionId: -1, messageId: "abc" }).success).toBe(false);
  });

  test("inválido: messageId vacío (< 1)", () => {
    expect(safe(deleteParamsSchema, { sectionId: 1, messageId: "" }).success).toBe(false);
  });

  test("inválido: messageId excede 200 caracteres (> max)", () => {
    expect(safe(deleteParamsSchema, { sectionId: 1, messageId: "x".repeat(201) }).success).toBe(false);
  });

  test("inválido: sectionId string no numérico", () => {
    expect(safe(deleteParamsSchema, { sectionId: "xyz", messageId: "abc" }).success).toBe(false);
  });
});

const createTokenInputSchema = z.object({
  sectionId: z.number().int().positive(),
  userId: z.number().int().positive(),
  role: z.enum(["teacher", "student"]),
  studentId: z.number().int().positive().optional(),
  teacherId: z.number().int().positive().optional(),
});

describe("createFirebaseToken — contrato de entrada (5 campos)", () => {
  test("válido: profesor con teacherId presente", () => {
    const r = safe(createTokenInputSchema, {
      sectionId: 1,
      userId: 292,
      role: "teacher",
      teacherId: 292,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.sectionId).toBe(1);
      expect(r.data.userId).toBe(292);
      expect(r.data.role).toBe("teacher");
      expect(r.data.teacherId).toBe(292);
      expect(r.data.studentId).toBeUndefined();
    }
  });

  test("válido: alumno con studentId presente", () => {
    const r = safe(createTokenInputSchema, {
      sectionId: 2,
      userId: 6,
      role: "student",
      studentId: 6,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.role).toBe("student");
      expect(r.data.studentId).toBe(6);
      expect(r.data.teacherId).toBeUndefined();
    }
  });

  test("válido: ambos IDs opcionales presentes (lado servidor decide cuál usar según role)", () => {
    const r = safe(createTokenInputSchema, {
      sectionId: 1,
      userId: 100,
      role: "teacher",
      studentId: 200,
      teacherId: 300,
    });
    expect(r.success).toBe(true);
  });

  test("inválido: falta sectionId (campo requerido)", () => {
    expect(safe(createTokenInputSchema, {
      userId: 100,
      role: "teacher",
      teacherId: 300,
    }).success).toBe(false);
  });

  test("inválido: falta userId (campo requerido)", () => {
    expect(safe(createTokenInputSchema, {
      sectionId: 1,
      role: "student",
      studentId: 6,
    }).success).toBe(false);
  });

  test("inválido: falta role (campo requerido)", () => {
    expect(safe(createTokenInputSchema, {
      sectionId: 1,
      userId: 6,
      studentId: 6,
    }).success).toBe(false);
  });

  test("inválido: role no es 'teacher' ni 'student'", () => {
    expect(safe(createTokenInputSchema, {
      sectionId: 1,
      userId: 6,
      role: "jp",
      studentId: 6,
    }).success).toBe(false);
  });

  test("inválido: sectionId cero (borde inferior, no positivo)", () => {
    expect(safe(createTokenInputSchema, {
      sectionId: 0,
      userId: 100,
      role: "teacher",
      teacherId: 300,
    }).success).toBe(false);
  });

  test("inválido: sectionId negativo", () => {
    expect(safe(createTokenInputSchema, {
      sectionId: -1,
      userId: 100,
      role: "teacher",
      teacherId: 300,
    }).success).toBe(false);
  });

  test("inválido: sectionId decimal (no entero)", () => {
    expect(safe(createTokenInputSchema, {
      sectionId: 1.5,
      userId: 100,
      role: "teacher",
      teacherId: 300,
    }).success).toBe(false);
  });

  test("inválido: userId cero", () => {
    expect(safe(createTokenInputSchema, {
      sectionId: 1,
      userId: 0,
      role: "teacher",
      teacherId: 300,
    }).success).toBe(false);
  });

  test("inválido: userId negativo", () => {
    expect(safe(createTokenInputSchema, {
      sectionId: 1,
      userId: -5,
      role: "student",
      studentId: 6,
    }).success).toBe(false);
  });

  test("inválido: studentId cero cuando role=student", () => {
    expect(safe(createTokenInputSchema, {
      sectionId: 1,
      userId: 6,
      role: "student",
      studentId: 0,
    }).success).toBe(false);
  });

  test("inválido: teacherId negativo cuando role=teacher", () => {
    expect(safe(createTokenInputSchema, {
      sectionId: 1,
      userId: 292,
      role: "teacher",
      teacherId: -1,
    }).success).toBe(false);
  });

  test("válido: sin studentId ni teacherId (el controller los resuelve por role)", () => {
    const r = safe(createTokenInputSchema, {
      sectionId: 1,
      userId: 6,
      role: "student",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.studentId).toBeUndefined();
      expect(r.data.teacherId).toBeUndefined();
    }
  });

  test("válido: sectionId y userId en borde superior grande", () => {
    const r = safe(createTokenInputSchema, {
      sectionId: 999999,
      userId: 999999,
      role: "teacher",
      teacherId: 999999,
    });
    expect(r.success).toBe(true);
  });

  test("inválido: objeto vacío", () => {
    expect(safe(createTokenInputSchema, {}).success).toBe(false);
  });

  test("inválido: campos extra no declarados no rompen el parseo", () => {
    const r = safe(createTokenInputSchema, {
      sectionId: 1,
      userId: 6,
      role: "student",
      studentId: 6,
      extraField: "no debería estar aquí",
    });
    expect(r.success).toBe(true);
  });
});
