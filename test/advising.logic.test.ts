// Pruebas de la lógica pura de asesorías (HU18). Cubren las reglas de dominio
// del issue #30 (casos 3/5 de exclusividad del JP se validan aquí; 1/2/4/7 son
// de autorización en el service; 8 es de presentación) y las de creación:
// rango horario, fecha, ubicación por modalidad y SOLAPE en las 4 posiciones
// (antes/después/contenido/bordes) que pide la rúbrica de prueba unitaria.

import { describe, expect, test } from "bun:test";
import {
  hasRequiredLocation,
  isoDayOfWeek,
  isDateInPast,
  isDateWithinPeriod,
  isValidTimeRange,
  jpViolatesCycleRule,
  limaDateString,
  rangesOverlap,
  validateCreateAdvising,
  type ExistingAdvising,
} from "../src/modules/advising/teacher/teacher.logic.js";

describe("isoDayOfWeek", () => {
  test("mapea a ISO 1=Lunes … 7=Domingo sin desfase horario", () => {
    expect(isoDayOfWeek("2026-07-06")).toBe(1); // lunes
    expect(isoDayOfWeek("2026-07-11")).toBe(6); // sábado
    expect(isoDayOfWeek("2026-07-12")).toBe(7); // domingo
  });
});

describe("isValidTimeRange", () => {
  test("inicio antes de fin", () => {
    expect(isValidTimeRange("10:00", "11:00")).toBe(true);
    expect(isValidTimeRange("11:00", "11:00")).toBe(false);
    expect(isValidTimeRange("12:00", "11:00")).toBe(false);
  });
  test("acepta segundos en el formato", () => {
    expect(isValidTimeRange("10:00:00", "10:30:00")).toBe(true);
  });
});

describe("rangesOverlap (solape en las 4 posiciones)", () => {
  const base = { start: "10:00", end: "11:00" };
  test("empieza antes y termina dentro → solapa", () => {
    expect(rangesOverlap(base, { start: "09:30", end: "10:30" })).toBe(true);
  });
  test("empieza dentro y termina después → solapa", () => {
    expect(rangesOverlap(base, { start: "10:30", end: "11:30" })).toBe(true);
  });
  test("contenido dentro → solapa", () => {
    expect(rangesOverlap(base, { start: "10:15", end: "10:45" })).toBe(true);
  });
  test("contiene al otro → solapa", () => {
    expect(rangesOverlap(base, { start: "09:00", end: "12:00" })).toBe(true);
  });
  test("bordes que se tocan → NO solapa", () => {
    expect(rangesOverlap(base, { start: "11:00", end: "12:00" })).toBe(false);
    expect(rangesOverlap(base, { start: "09:00", end: "10:00" })).toBe(false);
  });
  test("disjuntos → NO solapa", () => {
    expect(rangesOverlap(base, { start: "12:00", end: "13:00" })).toBe(false);
  });
});

describe("fecha en período", () => {
  test("dentro del rango inclusive", () => {
    expect(isDateWithinPeriod("2026-07-06", "2026-03-01", "2026-07-31")).toBe(true);
    expect(isDateWithinPeriod("2026-03-01", "2026-03-01", "2026-07-31")).toBe(true);
    expect(isDateWithinPeriod("2026-07-31", "2026-03-01", "2026-07-31")).toBe(true);
  });
  test("fuera del rango", () => {
    expect(isDateWithinPeriod("2026-08-01", "2026-03-01", "2026-07-31")).toBe(false);
    expect(isDateWithinPeriod("2026-02-28", "2026-03-01", "2026-07-31")).toBe(false);
  });
  test("pasado respecto de hoy", () => {
    expect(isDateInPast("2026-07-05", "2026-07-06")).toBe(true);
    expect(isDateInPast("2026-07-06", "2026-07-06")).toBe(false);
    expect(isDateInPast("2026-07-07", "2026-07-06")).toBe(false);
  });
});

describe("limaDateString", () => {
  test("convierte un instante UTC a la fecha en Lima (UTC-5)", () => {
    // 2026-07-07 03:00Z → 2026-07-06 22:00 en Lima.
    expect(limaDateString(new Date("2026-07-07T03:00:00.000Z"))).toBe("2026-07-06");
    // 2026-07-07 12:00Z → 2026-07-07 07:00 en Lima.
    expect(limaDateString(new Date("2026-07-07T12:00:00.000Z"))).toBe("2026-07-07");
  });
});

describe("hasRequiredLocation", () => {
  test("classroom exige aula", () => {
    expect(hasRequiredLocation("classroom", "T-501", null)).toBe(true);
    expect(hasRequiredLocation("classroom", "  ", null)).toBe(false);
    expect(hasRequiredLocation("classroom", null, "https://zoom")).toBe(false);
  });
  test("virtual exige enlace", () => {
    expect(hasRequiredLocation("virtual", null, "https://zoom")).toBe(true);
    expect(hasRequiredLocation("virtual", "T-501", null)).toBe(false);
  });
  test("hybrid exige al menos uno", () => {
    expect(hasRequiredLocation("hybrid", "T-501", null)).toBe(true);
    expect(hasRequiredLocation("hybrid", null, "https://zoom")).toBe(true);
    expect(hasRequiredLocation("hybrid", null, null)).toBe(false);
  });
});

describe("jpViolatesCycleRule (caso 5 del issue #30)", () => {
  test("persona que es profesor del ciclo no puede ser JP", () => {
    expect(jpViolatesCycleRule(7, [3, 7, 9])).toBe(true);
  });
  test("persona que no dicta en el ciclo sí puede ser JP", () => {
    expect(jpViolatesCycleRule(5, [3, 7, 9])).toBe(false);
  });
});

describe("validateCreateAdvising", () => {
  const period = { periodStart: "2026-03-01", periodEnd: "2026-07-31" };
  const today = "2026-07-06";
  const okInput = {
    sessionDate: "2026-07-10",
    startTime: "10:00",
    endTime: "11:00",
    modality: "classroom" as const,
    classroom: "T-501",
    meetingUrl: null,
  };

  test("caso feliz → ok con el día derivado de la fecha", () => {
    const r = validateCreateAdvising({ input: okInput, today, ...period, ownExisting: [] });
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.dayOfWeek).toBe(5); // 2026-07-10 es viernes
  });

  test("rango horario inválido tiene precedencia", () => {
    const r = validateCreateAdvising({
      input: { ...okInput, startTime: "11:00", endTime: "10:00" },
      today,
      ...period,
      ownExisting: [],
    });
    expect(r.status).toBe("invalid_time");
  });

  test("fecha pasada", () => {
    const r = validateCreateAdvising({
      input: { ...okInput, sessionDate: "2026-07-05" },
      today,
      ...period,
      ownExisting: [],
    });
    expect(r.status).toBe("date_in_past");
  });

  test("fecha fuera del período", () => {
    const r = validateCreateAdvising({
      input: { ...okInput, sessionDate: "2026-08-15" },
      today,
      ...period,
      ownExisting: [],
    });
    expect(r.status).toBe("date_out_of_period");
  });

  test("falta ubicación según modalidad", () => {
    const r = validateCreateAdvising({
      input: { ...okInput, classroom: null, meetingUrl: null },
      today,
      ...period,
      ownExisting: [],
    });
    expect(r.status).toBe("missing_location");
  });

  test("solape con una extra propia de la misma fecha", () => {
    const ownExisting: ExistingAdvising[] = [
      { kind: "extra", dayOfWeek: 5, sessionDate: "2026-07-10", startTime: "10:30", endTime: "11:30" },
    ];
    const r = validateCreateAdvising({ input: okInput, today, ...period, ownExisting });
    expect(r.status).toBe("overlap");
  });

  test("solape con una recurrente propia del mismo día de semana", () => {
    // 2026-07-10 es viernes (día 5).
    const ownExisting: ExistingAdvising[] = [
      { kind: "recurring", dayOfWeek: 5, sessionDate: null, startTime: "10:15", endTime: "10:45" },
    ];
    const r = validateCreateAdvising({ input: okInput, today, ...period, ownExisting });
    expect(r.status).toBe("overlap");
  });

  test("no solapa con una extra de OTRA fecha aunque coincida la hora", () => {
    const ownExisting: ExistingAdvising[] = [
      { kind: "extra", dayOfWeek: 5, sessionDate: "2026-07-17", startTime: "10:00", endTime: "11:00" },
    ];
    const r = validateCreateAdvising({ input: okInput, today, ...period, ownExisting });
    expect(r.status).toBe("ok");
  });

  test("no solapa con una recurrente de OTRO día de semana", () => {
    const ownExisting: ExistingAdvising[] = [
      { kind: "recurring", dayOfWeek: 1, sessionDate: null, startTime: "10:00", endTime: "11:00" },
    ];
    const r = validateCreateAdvising({ input: okInput, today, ...period, ownExisting });
    expect(r.status).toBe("ok");
  });

  test("bordes que se tocan no cuentan como solape", () => {
    const ownExisting: ExistingAdvising[] = [
      { kind: "extra", dayOfWeek: 5, sessionDate: "2026-07-10", startTime: "11:00", endTime: "12:00" },
    ];
    const r = validateCreateAdvising({ input: okInput, today, ...period, ownExisting });
    expect(r.status).toBe("ok");
  });
});
