import { describe, expect, test } from "bun:test";
import type { EventBus } from "../../src/events/index.js";
import type { AttendanceRiskRepository } from "../../src/modules/attendance-risk/attendance-risk.repository.js";
import { AttendanceRiskService } from "../../src/modules/attendance-risk/attendance-risk.service.js";
import type {
  AttendanceRiskRawRow,
  AttendanceRiskStudentResponse,
} from "../../src/modules/attendance-risk/attendance-risk.types.js";

/**
 * ============================================================================
 * CAJA NEGRA — Clasificación de riesgo por inasistencia (HU22)
 * Fuente: AttendanceRiskService.getAttendanceRisk() — src/modules/attendance-risk/attendance-risk.service.ts
 * ============================================================================
 * Se prueba SOLO desde entrada/salida: se le pasan los datos de un alumno y se
 * verifica su clasificación, sin conocer cómo hace los cálculos internos. Se
 * aísla la BD con un repositorio falso (stub) que devuelve la fila prefabricada.
 *
 * CAMPOS DE ENTRADA de cada fila (más de 4): code, full_name, current_level,
 * absent_hours, total_section_hours, cycle.
 * Regla: límite 25% (ciclos 1-5) / 35% (ciclo 6+); "impedido" si % > límite
 * (comparación ESTRICTA); "en_riesgo" si faltan 2 o 3 faltas; total 0 horas
 * -> "normal" con 0% (guarda contra división por cero).
 *
 * TABLA DE PARTICIÓN DE EQUIVALENCIA + VALORES LÍMITE:
 * | Caso | Entrada (ausente/total h, ciclo) | Resultado esperado                 |
 * |------|----------------------------------|------------------------------------|
 * | CN1  | 30 / 100, ciclo 3                | impedido (30% > 25%)               |
 * | CN2  | 30 / 100, ciclo 6                | en_riesgo a 3 faltas (límite 35%)  |
 * | CN3  | 25 / 100, ciclo 3  (LÍMITE)      | normal (comparación estricta '>')  |
 * | CN4  | 21 / 100, ciclo 3                | en_riesgo a 2 faltas               |
 * | CN5  | 17 / 100, ciclo 3                | normal (a 4 faltas del límite)     |
 * | CN6  | 4 / 0, ciclo 3     (LÍMITE)      | normal, 0% (sin división por cero) |
 */

// EventBus dummy: el test no evalúa eventos, solo la clasificación.
const eventosFalsos = {} as unknown as EventBus;

// Ejecuta getAttendanceRisk con UN solo alumno y devuelve su clasificación.
// El repositorio falso reemplaza la base de datos con los valores del caso.
const clasificar = async (
  horasAusentes: number,
  horasTotales: number,
  ciclo: number,
): Promise<AttendanceRiskStudentResponse> => {
  const alumno: AttendanceRiskRawRow = {
    code: "20230001",
    full_name: "Garcia Lopez, Maria",
    current_level: ciclo,
    absent_hours: String(horasAusentes),        // el repo real entrega horas como string (Postgres)
    total_section_hours: String(horasTotales),
    cycle: ciclo,                               // el ciclo decide el límite (25% vs 35%)
  };

  const repositorio = {
    findStudentsBySectionId: async () => [alumno], // stub: devuelve solo nuestro alumno de prueba
  } as unknown as AttendanceRiskRepository;

  const servicio = new AttendanceRiskService(repositorio, eventosFalsos);
  const respuesta = await servicio.getAttendanceRisk(801); // 801 = sección cualquiera (el stub ignora el id)

  return respuesta.students[0]!;                // nos quedamos con la clasificación del único alumno
};

describe("CAJA NEGRA · getAttendanceRisk (HU22)", () => {
  test("CN1: 30% en ciclo 3 supera el límite de 25%", async () => {
    const resultado = await clasificar(30, 100, 3);

    expect(resultado.status).toBe("impedido");        // 30% > 25% -> impedido
    expect(resultado.absencePercentage).toBe(30);     // el % se calcula bien
    expect(resultado.missingFaltas).toBeNull();       // impedido no muestra "faltas restantes"
  });

  test("CN2: 30% en ciclo 3 está en riesgo porque el límite es 35%", async () => {
    // Mismo 30% que CN1 pero en ciclo 6: el límite sube a 35% -> ya NO es impedido.
    const resultado = await clasificar(30, 100, 6);

    expect(resultado.status).toBe("en_riesgo");        // margen 35-30 = 5h -> ceil(5/2) = 3 faltas
    expect(resultado.missingFaltas).toBe(3);
  });

  test("CN3: 25% exacto en ciclo 3 todavía es normal", async () => {
    // VALOR LÍMITE: justo en el 25%. La comparación es '>' (estricta), no '>='.
    const resultado = await clasificar(25, 100, 3);

    expect(resultado.status).toBe("normal");           // 25% NO supera el límite (margen 0 -> ni 2 ni 3 faltas)
    expect(resultado.absencePercentage).toBe(25);
  });

  test("CN4: 21% en ciclo 3 queda a 2 faltas del límite", async () => {
    const resultado = await clasificar(21, 100, 3);

    expect(resultado.status).toBe("en_riesgo");        // margen 25-21 = 4h -> ceil(4/2) = 2 faltas
    expect(resultado.missingFaltas).toBe(2);
  });

  test("CN5: 17% en ciclo 3 es normal porque faltan 4 faltas", async () => {
    const resultado = await clasificar(17, 100, 3);

    expect(resultado.status).toBe("normal");           // margen 8h -> 4 faltas (ni 2 ni 3) -> normal
    expect(resultado.missingFaltas).toBeNull();
  });

  test("CN6: una sección sin horas devuelve normal y 0%", async () => {
    // VALOR LÍMITE: total_section_hours = 0. No debe dividir por cero.
    const resultado = await clasificar(4, 0, 3);

    expect(resultado.status).toBe("normal");
    expect(resultado.absencePercentage).toBe(0);       // 0% por la guarda, no NaN
    expect(resultado.missingFaltas).toBeNull();
  });
});
