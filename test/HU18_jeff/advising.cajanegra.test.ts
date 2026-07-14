import { describe, expect, test } from "bun:test";
import {
  validateCreateAdvising,
  type CreateAdvisingInput,
  type ExistingAdvising,
} from "../../src/modules/advising/teacher/teacher.logic.js";

/**
 * ============================================================================
 * CAJA NEGRA — Publicar asesoría extra como docente (HU18)
 * Fuente: validateCreateAdvising() — src/modules/advising/teacher/teacher.logic.ts:77
 * ============================================================================
 * ⭐ IDEA CENTRAL PARA EXPONER:
 * Los 15 casos se eligieron desde clases válidas, inválidas y fronteras. El
 * oráculo observa únicamente el `status` público de la función; no depende de
 * su algoritmo interno. Esta es caja negra de la unidad de validación, no una
 * prueba end-to-end del endpoint, la autenticación o la base de datos.
 *
 * Se derivan los casos desde los REQUISITOS (no del código): el formulario del
 * docente tiene MÁS DE 4 CAMPOS DE ENTRADA y el validador aplica un ORDEN DE
 * PRECEDENCIA fijo.
 *
 * CAMPOS DE ESTA UNIDAD (6): sessionDate, startTime, endTime, modality,
 * classroom, meetingUrl. El payload HTTP completo tiene otros campos, pero no
 * intervienen en la función seleccionada y por eso no forman parte de la tabla.
 * PRECEDENCIA: invalid_time > date_in_past > date_out_of_period > missing_location > overlap.
 *
 * TABLA DE PARTICIÓN DE EQUIVALENCIA + VALORES LÍMITE:
 * | Campo        | Clase válida                  | Clases NO válidas / límite                        |
 * |--------------|-------------------------------|---------------------------------------------------|
 * | rango horario| start < end                   | start > end; LÍMITE start == end → invalid_time   |
 * | sessionDate  | hoy .. periodEnd (inclusive)  | < hoy → date_in_past; LÍMITE == hoy → válido;     |
 * |              |                               | > periodEnd → date_out_of_period; LÍMITE ==periodEnd válido |
 * | modality+loc | classroom→aula; virtual→url;  | vacío o solo espacios (trim) → missing_location   |
 * |              | hybrid→aula OR url            |                                                   |
 * | solape       | sin solape / bordes que tocan | rango que solapa una asesoría propia → overlap    |
 */

const BASE = {
  today: "2026-06-01",
  periodStart: "2026-03-16",
  periodEnd: "2026-07-15",
};

const input = (over: Partial<CreateAdvisingInput> = {}): CreateAdvisingInput => ({
  sessionDate: "2026-06-10", // futuro, dentro del período
  startTime: "10:00",
  endTime: "12:00",
  modality: "hybrid",
  classroom: "A-501",
  meetingUrl: null,
  ...over,
});

const validate = (over: Partial<CreateAdvisingInput> = {}, ownExisting: ExistingAdvising[] = []) =>
  validateCreateAdvising({ input: input(over), ownExisting, ...BASE });

const extra = (startTime: string, endTime: string, sessionDate = "2026-06-10"): ExistingAdvising => ({
  kind: "extra",
  dayOfWeek: 3,
  sessionDate,
  startTime,
  endTime,
});

describe("CAJA NEGRA · validateCreateAdvising() (HU18)", () => {
  // Caso base: mantiene válidos los seis campos y sirve de referencia para que
  // cada caso posterior cambie una sola clase de equivalencia cuando sea posible.
  test("CV1: todos los campos válidos → ok + día derivado", () => {
    const r = validate();
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.dayOfWeek).toBeGreaterThanOrEqual(1);
  });

  test("CNV1: hora inicio > hora fin → invalid_time", () => {
    expect(validate({ startTime: "12:00", endTime: "10:00" }).status).toBe("invalid_time");
  });

  // ⭐ FRONTERA PRINCIPAL: la igualdad pertenece a la clase inválida porque el
  // requisito exige una duración estrictamente positiva (inicio < fin).
  test("CNV2 (valor límite): hora inicio == hora fin → invalid_time", () => {
    expect(validate({ startTime: "10:00", endTime: "10:00" }).status).toBe("invalid_time");
  });

  test("CNV3: fecha anterior a hoy → date_in_past", () => {
    expect(validate({ sessionDate: "2026-05-01" }).status).toBe("date_in_past");
  });

  test("CV2 (valor límite): fecha == hoy → válido (no es pasado)", () => {
    expect(validate({ sessionDate: "2026-06-01" }).status).toBe("ok");
  });

  test("CNV4: fecha después del fin de período → date_out_of_period", () => {
    expect(validate({ sessionDate: "2026-08-01" }).status).toBe("date_out_of_period");
  });

  test("CV3 (valor límite): fecha == fin de período → válido (borde inclusivo)", () => {
    expect(validate({ sessionDate: "2026-07-15" }).status).toBe("ok");
  });

  test("CNV5: modalidad presencial sin aula → missing_location", () => {
    expect(validate({ modality: "classroom", classroom: "" }).status).toBe("missing_location");
  });

  test("CNV6 (valor límite): aula solo con espacios (trim) → missing_location", () => {
    expect(validate({ modality: "classroom", classroom: "   " }).status).toBe("missing_location");
  });

  test("CV4: modalidad virtual con enlace de reunión → ok", () => {
    expect(validate({ modality: "virtual", classroom: null, meetingUrl: "https://meet.ulima/abc" }).status).toBe("ok");
  });

  test("CNV7: modalidad virtual sin enlace → missing_location", () => {
    expect(validate({ modality: "virtual", classroom: null, meetingUrl: "" }).status).toBe("missing_location");
  });

  test("CNV8: rango que solapa una asesoría propia de la misma fecha → overlap", () => {
    expect(validate({}, [extra("11:00", "13:00")]).status).toBe("overlap");
  });

  test("CV5 (valor límite): bordes que se tocan (fin == inicio del nuevo) → NO solapa (ok)", () => {
    expect(validate({}, [extra("08:00", "10:00")]).status).toBe("ok");
  });

  // ⭐ La precedencia evita respuestas ambiguas cuando una entrada viola dos
  // reglas simultáneamente: debe aparecer siempre el primer error del contrato.
  test("Precedencia: rango inválido tiene prioridad sobre fecha pasada", () => {
    expect(validate({ startTime: "12:00", endTime: "10:00", sessionDate: "2026-05-01" }).status).toBe("invalid_time");
  });

  test("Precedencia: falta de ubicación tiene prioridad sobre solape", () => {
    expect(validate({ modality: "classroom", classroom: "" }, [extra("11:00", "13:00")]).status).toBe("missing_location");
  });
});
