import { describe, expect, test } from "bun:test";
import { isSessionPast } from "../../src/modules/advising/student/student.logic.js";

/**
 * ============================================================================
 * PRUEBA UNITARIA — isSessionPast(session, now) (HU13: asesorías del alumno)
 * Fuente: src/modules/advising/student/student.logic.ts:21-39
 * ============================================================================
 * Qué valida: decide si una sesión de asesoría YA PASÓ, en hora de Lima (UTC-5).
 * La función tiene dos "modos" según session.kind:
 *   - "extra"      -> sesión con fecha fija (sessionDate): compara fecha y, si es hoy,
 *                     compara la hora de fin (endTime) contra la hora actual de Lima.
 *   - "recurring"  -> sesión semanal (dayOfWeek): pasó SOLO si hoy es ese día de la
 *                     semana Y ya terminó la hora de fin.
 * Además dos guardas defensivas al entrar: endTime vacío o endTime no parseable => false.
 *
 * Casos (10):
 *   extra:
 *     - sessionDate < hoy            -> true  (día ya quedó atrás)
 *     - sessionDate = hoy, fin<ahora -> true  (hoy pero ya terminó)
 *     - sessionDate = hoy, fin>ahora -> false (hoy y aún no termina)
 *     - sessionDate > hoy            -> false (es a futuro)
 *     - sessionDate null             -> false (extra sin fecha: no evaluable)
 *   recurrente:
 *     - dayOfWeek = hoy, fin<ahora   -> true
 *     - dayOfWeek = hoy, fin>ahora   -> false
 *     - dayOfWeek ≠ hoy              -> false
 *   defensivo:
 *     - endTime ""                   -> false (guarda de endTime vacío)
 *     - endTime "xyz"                -> false (guarda de NaN al parsear)
 *
 */

// Fabrica un Date que representa "ahora" partiendo de fecha y hora EN HORA DE LIMA (UTC-5).
// Construimos el instante en UTC con esos componentes y le sumamos 5h para volverlo el
// UTC real que, al restarle 5h dentro de la función, reproduce exactamente la hora de Lima dada.
function makeNow(limaDateStr: string, limaTimeStr: string): Date {
  const ms = Date.UTC(
    Number(limaDateStr.slice(0, 4)),      // año (YYYY) tomado del string de fecha
    Number(limaDateStr.slice(5, 7)) - 1,  // mes 0-based (Date.UTC espera 0=enero), por eso el -1
    Number(limaDateStr.slice(8, 10)),     // día (DD)
    Number(limaTimeStr.slice(0, 2)),      // hora (HH) tomada del string de hora
    Number(limaTimeStr.slice(3, 5)),      // minutos (MM)
  );
  return new Date(ms + 5 * 60 * 60 * 1000); // +5h: convierte el "reloj de Lima" al instante UTC equivalente
}

// Helper/fixture: arma un objeto sesión con valores por defecto y deja sobrescribir solo lo que importe.
const session = (over: {
  kind?: string;               // "extra" (fecha fija) o "recurring" (día de semana)
  sessionDate?: string | null; // fecha YYYY-MM-DD para las "extra"; null si no aplica
  dayOfWeek?: number;          // día ISO de la semana (1=lunes..7=domingo) para las "recurring"
  startTime?: string;          // hora de inicio (no la usa isSessionPast, pero completa el shape)
  endTime?: string;            // hora de fin HH:MM: la clave para decidir si ya terminó
}) => ({
  kind: over.kind ?? "extra",             // por defecto tratamos la sesión como "extra"
  sessionDate: over.sessionDate ?? null,  // por defecto sin fecha (los tests "extra" la fijan)
  dayOfWeek: over.dayOfWeek ?? 1,         // por defecto lunes (relevante solo en "recurring")
  startTime: over.startTime ?? "10:00",   // valor de relleno; no influye en el resultado
  endTime: over.endTime ?? "11:00",       // fin por defecto a las 11:00
});

describe("isSessionPast — extra", () => {
  test("session_date < hoy → true", () => {
    const s = session({ kind: "extra", sessionDate: "2026-06-15", endTime: "11:00" }); // sesión con fecha muy anterior a "hoy"
    const now = makeNow("2026-07-11", "10:00"); // "ahora" = 11-jul 10:00 en Lima
    expect(isSessionPast(s, now)).toBe(true); // verifica que una fecha pasada se considere terminada
  });

  test("session_date = hoy, end_time < ahora → true", () => {
    const s = session({ kind: "extra", sessionDate: "2026-07-11", endTime: "09:00" }); // misma fecha de hoy, pero terminó 09:00
    const now = makeNow("2026-07-11", "10:00"); // ahora son las 10:00: ya pasaron las 09:00
    expect(isSessionPast(s, now)).toBe(true); // verifica que si es hoy y el fin ya pasó, la sesión está en el pasado
  });

  test("session_date = hoy, end_time > ahora → false", () => {
    const s = session({ kind: "extra", sessionDate: "2026-07-11", endTime: "15:00" }); // es hoy, pero termina a las 15:00
    const now = makeNow("2026-07-11", "10:00"); // ahora 10:00: aún faltan horas para el fin
    expect(isSessionPast(s, now)).toBe(false); // verifica que una sesión de hoy que aún no termina NO se marca como pasada
  });

  test("session_date > hoy → false", () => {
    const s = session({ kind: "extra", sessionDate: "2026-07-20", endTime: "11:00" }); // fecha posterior a hoy (futuro)
    const now = makeNow("2026-07-11", "10:00"); // ahora 11-jul: la sesión aún no llega
    expect(isSessionPast(s, now)).toBe(false); // verifica que una sesión futura no cuente como pasada
  });

  test("sessionDate null → false", () => {
    const s = session({ kind: "extra", sessionDate: null, endTime: "11:00" }); // "extra" pero sin fecha asignada
    const now = makeNow("2026-07-11", "10:00"); // "ahora" cualquiera; no debería importar
    expect(isSessionPast(s, now)).toBe(false); // verifica la guarda: sin sessionDate una "extra" no es evaluable => false
  });
});

describe("isSessionPast — recurrente", () => {
  test("day_of_week = hoy, end_time < ahora → true", () => {
    const s = session({ kind: "recurring", dayOfWeek: 6, endTime: "09:00" }); // recurrente los sábados (ISO 6), fin 09:00
    const now = makeNow("2026-07-11", "10:00"); // 11-jul-2026 es sábado (ISO 6) y ya son las 10:00
    expect(isSessionPast(s, now)).toBe(true); // verifica que si hoy ES el día recurrente y ya terminó, cuenta como pasada
  });

  test("day_of_week = hoy, end_time > ahora → false", () => {
    const s = session({ kind: "recurring", dayOfWeek: 6, endTime: "15:00" }); // sábado, pero fin a las 15:00
    const now = makeNow("2026-07-11", "10:00"); // hoy es sábado a las 10:00: aún no termina
    expect(isSessionPast(s, now)).toBe(false); // verifica que el día recurrente correcto pero sin llegar al fin NO es pasada
  });

  test("day_of_week ≠ hoy → false", () => {
    const s = session({ kind: "recurring", dayOfWeek: 1, endTime: "09:00" }); // recurrente los lunes (ISO 1)
    const now = makeNow("2026-07-11", "10:00"); // pero hoy es sábado (ISO 6), no lunes
    expect(isSessionPast(s, now)).toBe(false); // verifica que si hoy no es el día recurrente, no importa la hora: no es pasada
  });
});

describe("isSessionPast — defensivo", () => {
  test("endTime nulo → false", () => {
    const s = session({ kind: "extra", sessionDate: "2026-06-15", endTime: "" }); // fecha pasada pero endTime vacío
    const now = makeNow("2026-07-11", "10:00"); // "ahora" cualquiera
    expect(isSessionPast(s, now)).toBe(false); // verifica la guarda inicial: sin endTime la función corta y devuelve false
  });

  test("endTime inválido → false", () => {
    const s = session({ kind: "extra", sessionDate: "2026-06-15", endTime: "xyz" }); // endTime no parseable a HH:MM
    const now = makeNow("2026-07-11", "10:00"); // "ahora" cualquiera
    expect(isSessionPast(s, now)).toBe(false); // verifica la guarda de NaN: si h/m no son números, devuelve false
  });
});
