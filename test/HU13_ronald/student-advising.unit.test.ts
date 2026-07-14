import { describe, expect, test } from "bun:test";
import { isSessionPast } from "../../src/modules/advising/student/student.logic.js";

function makeNow(limaDateStr: string, limaTimeStr: string): Date {
  const ms = Date.UTC(
    Number(limaDateStr.slice(0, 4)),
    Number(limaDateStr.slice(5, 7)) - 1,
    Number(limaDateStr.slice(8, 10)),
    Number(limaTimeStr.slice(0, 2)),
    Number(limaTimeStr.slice(3, 5)),
  );
  return new Date(ms + 5 * 60 * 60 * 1000);
}

const session = (over: {
  kind?: string;
  sessionDate?: string | null;
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
}) => ({
  kind: over.kind ?? "extra",
  sessionDate: over.sessionDate ?? null,
  dayOfWeek: over.dayOfWeek ?? 1,
  startTime: over.startTime ?? "10:00",
  endTime: over.endTime ?? "11:00",
});

describe("isSessionPast — extra", () => {
  test("session_date < hoy → true", () => {
    const s = session({ kind: "extra", sessionDate: "2026-06-15", endTime: "11:00" });
    const now = makeNow("2026-07-11", "10:00");
    expect(isSessionPast(s, now)).toBe(true);
  });

  test("session_date = hoy, end_time < ahora → true", () => {
    const s = session({ kind: "extra", sessionDate: "2026-07-11", endTime: "09:00" });
    const now = makeNow("2026-07-11", "10:00");
    expect(isSessionPast(s, now)).toBe(true);
  });

  test("session_date = hoy, end_time > ahora → false", () => {
    const s = session({ kind: "extra", sessionDate: "2026-07-11", endTime: "15:00" });
    const now = makeNow("2026-07-11", "10:00");
    expect(isSessionPast(s, now)).toBe(false);
  });

  test("session_date > hoy → false", () => {
    const s = session({ kind: "extra", sessionDate: "2026-07-20", endTime: "11:00" });
    const now = makeNow("2026-07-11", "10:00");
    expect(isSessionPast(s, now)).toBe(false);
  });

  test("sessionDate null → false", () => {
    const s = session({ kind: "extra", sessionDate: null, endTime: "11:00" });
    const now = makeNow("2026-07-11", "10:00");
    expect(isSessionPast(s, now)).toBe(false);
  });
});

describe("isSessionPast — recurrente", () => {
  test("day_of_week = hoy, end_time < ahora → true", () => {
    const s = session({ kind: "recurring", dayOfWeek: 6, endTime: "09:00" });
    const now = makeNow("2026-07-11", "10:00");
    expect(isSessionPast(s, now)).toBe(true);
  });

  test("day_of_week = hoy, end_time > ahora → false", () => {
    const s = session({ kind: "recurring", dayOfWeek: 6, endTime: "15:00" });
    const now = makeNow("2026-07-11", "10:00");
    expect(isSessionPast(s, now)).toBe(false);
  });

  test("day_of_week ≠ hoy → false", () => {
    const s = session({ kind: "recurring", dayOfWeek: 1, endTime: "09:00" });
    const now = makeNow("2026-07-11", "10:00");
    expect(isSessionPast(s, now)).toBe(false);
  });
});

describe("isSessionPast — defensivo", () => {
  test("endTime nulo → false", () => {
    const s = session({ kind: "extra", sessionDate: "2026-06-15", endTime: "" });
    const now = makeNow("2026-07-11", "10:00");
    expect(isSessionPast(s, now)).toBe(false);
  });

  test("endTime inválido → false", () => {
    const s = session({ kind: "extra", sessionDate: "2026-06-15", endTime: "xyz" });
    const now = makeNow("2026-07-11", "10:00");
    expect(isSessionPast(s, now)).toBe(false);
  });
});
