import { describe, expect, test } from "bun:test";
import { z } from "zod";

const sectionIdParamSchema = z.object({
  sectionId: z.coerce.number().int().positive(),
});

const sessionIdParamSchema = z.object({
  sessionId: z.coerce.number().int().positive(),
});

const safe = (schema: { safeParse: (v: unknown) => { success: boolean } }, input: unknown) =>
  schema.safeParse(input);

describe("sectionIdParamSchema — caja negra", () => {
  test("válido: sectionId numérico positivo", () => {
    const r = safe(sectionIdParamSchema, { sectionId: 1 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.sectionId).toBe(1);
  });

  test("válido: coerce de string a number", () => {
    const r = safe(sectionIdParamSchema, { sectionId: "42" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.sectionId).toBe(42);
  });

  test("válido: número grande positivo", () => {
    expect(safe(sectionIdParamSchema, { sectionId: 999999 }).success).toBe(true);
  });

  test("inválido: objeto vacío (sin sectionId)", () => {
    expect(safe(sectionIdParamSchema, {}).success).toBe(false);
  });

  test("inválido: sectionId cero (no positivo)", () => {
    expect(safe(sectionIdParamSchema, { sectionId: 0 }).success).toBe(false);
  });

  test("inválido: sectionId negativo", () => {
    expect(safe(sectionIdParamSchema, { sectionId: -1 }).success).toBe(false);
  });

  test("inválido: sectionId decimal (no entero)", () => {
    expect(safe(sectionIdParamSchema, { sectionId: 1.5 }).success).toBe(false);
  });

  test("inválido: sectionId string no numérico", () => {
    expect(safe(sectionIdParamSchema, { sectionId: "abc" }).success).toBe(false);
  });

  test("inválido: sectionId null", () => {
    expect(safe(sectionIdParamSchema, { sectionId: null }).success).toBe(false);
  });
});

describe("sessionIdParamSchema — caja negra", () => {
  test("válido: sessionId numérico positivo", () => {
    const r = safe(sessionIdParamSchema, { sessionId: 1 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.sessionId).toBe(1);
  });

  test("válido: coerce de string a number", () => {
    const r = safe(sessionIdParamSchema, { sessionId: "7" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.sessionId).toBe(7);
  });

  test("inválido: objeto vacío (sin sessionId)", () => {
    expect(safe(sessionIdParamSchema, {}).success).toBe(false);
  });

  test("inválido: sessionId cero", () => {
    expect(safe(sessionIdParamSchema, { sessionId: 0 }).success).toBe(false);
  });

  test("inválido: sessionId negativo", () => {
    expect(safe(sessionIdParamSchema, { sessionId: -5 }).success).toBe(false);
  });

  test("inválido: sessionId decimal", () => {
    expect(safe(sessionIdParamSchema, { sessionId: 3.14 }).success).toBe(false);
  });

  test("inválido: sessionId null", () => {
    expect(safe(sessionIdParamSchema, { sessionId: null }).success).toBe(false);
  });

  test("inválido: sessionId string no numérico", () => {
    expect(safe(sessionIdParamSchema, { sessionId: "xyz" }).success).toBe(false);
  });
});
