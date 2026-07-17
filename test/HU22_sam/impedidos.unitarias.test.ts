import { describe, expect, test } from "bun:test";
import type { EventBus } from "../../src/events/index.js";
import type { AttendanceRiskRepository } from "../../src/modules/attendance-risk/attendance-risk.repository.js";
import { AttendanceRiskService } from "../../src/modules/attendance-risk/attendance-risk.service.js";
import type { AttendanceRiskRawRow } from "../../src/modules/attendance-risk/attendance-risk.types.js";

/**
 * ============================================================================
 * UNITARIAS — HU22: visualizar lista de impedidos como docente
 * Fuente: src/modules/attendance-risk/attendance-risk.service.ts
 * ============================================================================
 * classifyStudent, splitName y computeSummary son PRIVADAS del módulo (no se
 * exportan), así que se aíslan a través de AttendanceRiskService con un
 * repositorio falso (stub): cada fila prefabricada fuerza un caso de la
 * función. sessionHours = 2 es constante del service.
 *
 * Reglas de negocio bajo prueba:
 *   · límite de inasistencia: 25% (ciclos 1-5) / 35% (ciclo 6+)      [:50]
 *   · "impedido" si % ausencia > límite (comparación ESTRICTA)       [:70]
 *   · "en_riesgo" si faltan 2 o 3 faltas (ceil(horas restantes / 2)) [:87-89]
 *   · total de horas <= 0 -> "normal" con 0% (guarda división por 0) [:53]
 *   · % redondeado a 2 decimales                                     [:79]
 *
 * Los casos frontera (25% exacto, mismo % en ciclo 5 vs 6, margen impar para
 * el ceil) matan los mutantes > → >=, >= → >, ceil → floor.
 *
 * ⭐ CASOS PRIORITARIOS PARA LA RÚBRICA (4):
 *   1. Cambio del límite de inasistencia en ciclo 6 (25% → 35%).
 *   2. Frontera exacta del 25% y comparación estricta.
 *   3. Margen impar calculado con ceil en las faltas restantes.
 *   4. Protección ante una sección con cero horas dictadas.
 * Los demás casos se conservan como cobertura complementaria.
 */

const noopEvents = {} as unknown as EventBus;

const row = (over: Partial<AttendanceRiskRawRow> = {}): AttendanceRiskRawRow => ({
  code: "20230001",
  full_name: "Garcia Lopez, Maria",
  current_level: 5,
  absent_hours: "0",
  total_section_hours: "100",
  cycle: 3,
  ...over,
});

const serviceWith = (rows: AttendanceRiskRawRow[]) =>
  new AttendanceRiskService(
    { findStudentsBySectionId: async () => rows } as unknown as AttendanceRiskRepository,
    noopEvents,
  );

describe("PU-I1 · límite por ciclo y frontera de 'impedido' (HU22)", () => {
  test("ciclo 3 con 30% de ausencia (> 25%) -> impedido, sin faltas restantes", async () => {
    const res = await serviceWith([row({ absent_hours: "30" })]).getAttendanceRisk(1);

    expect(res.students[0].status).toBe("impedido");
    expect(res.students[0].absencePercentage).toBe(30);
    expect(res.students[0].missingFaltas).toBeNull();
  });

  // ⭐ PRIORITARIO 1/4: valida la regla especial del límite para ciclos 6+.
  test("ciclo 6 con el MISMO 30% -> NO impedido (el límite sube a 35%): queda en_riesgo a 3 faltas", async () => {
    // margen = 35h - 30h = 5h -> ceil(5/2) = 3 faltas
    const res = await serviceWith([row({ absent_hours: "30", cycle: 6 })]).getAttendanceRisk(1);

    expect(res.students[0].status).toBe("en_riesgo");
    expect(res.students[0].missingFaltas).toBe(3);
  });

  // ⭐ PRIORITARIO 2/4: prueba la frontera y mata el mutante > → >=.
  test("frontera: exactamente 25% en ciclo 3 -> NO impedido (la comparación es estricta '>')", async () => {
    // margen 0h -> 0 faltas restantes (ni 2 ni 3) -> normal
    const res = await serviceWith([row({ absent_hours: "25" })]).getAttendanceRisk(1);

    expect(res.students[0].status).toBe("normal");
    expect(res.students[0].absencePercentage).toBe(25);
  });

  test("porcentaje redondeado a 2 decimales: 10h/30h -> 33.33% impedido", async () => {
    const res = await serviceWith([
      row({ absent_hours: "10", total_section_hours: "30" }),
    ]).getAttendanceRisk(1);

    expect(res.students[0].status).toBe("impedido");
    expect(res.students[0].absencePercentage).toBe(33.33);
  });
});

describe("PU-I2 · en_riesgo, faltas restantes y guarda de división por cero (HU22)", () => {
  test("a 2 faltas del límite (21h/100h, ciclo 3) -> en_riesgo con missingFaltas = 2", async () => {
    // margen = 25h - 21h = 4h -> ceil(4/2) = 2
    const res = await serviceWith([row({ absent_hours: "21" })]).getAttendanceRisk(1);

    expect(res.students[0].status).toBe("en_riesgo");
    expect(res.students[0].missingFaltas).toBe(2);
  });

  // ⭐ PRIORITARIO 3/4: distingue ceil de floor al calcular faltas restantes.
  test("margen impar: 22h/100h -> ceil(3/2) = 2 faltas -> en_riesgo (mata el mutante ceil→floor)", async () => {
    const res = await serviceWith([row({ absent_hours: "22" })]).getAttendanceRisk(1);

    expect(res.students[0].status).toBe("en_riesgo");
    expect(res.students[0].missingFaltas).toBe(2);
  });

  test("a 4 faltas del límite (17h/100h) -> normal y missingFaltas null", async () => {
    // margen = 8h -> ceil(8/2) = 4 (ni 2 ni 3)
    const res = await serviceWith([row({ absent_hours: "17" })]).getAttendanceRisk(1);

    expect(res.students[0].status).toBe("normal");
    expect(res.students[0].missingFaltas).toBeNull();
  });

  // ⭐ PRIORITARIO 4/4: cubre el dato extremo que podría producir una división por cero.
  test("sección con 0 horas dictadas -> normal con 0% (sin NaN ni división por cero)", async () => {
    const res = await serviceWith([
      row({ absent_hours: "4", total_section_hours: "0" }),
    ]).getAttendanceRisk(1);

    expect(res.students[0].status).toBe("normal");
    expect(res.students[0].absencePercentage).toBe(0);
  });

  test('splitName con coma: "Garcia Lopez, Maria" -> apellidos y nombres separados', async () => {
    const res = await serviceWith([row()]).getAttendanceRisk(1);

    expect(res.students[0].lastName).toBe("Garcia Lopez");
    expect(res.students[0].firstName).toBe("Maria");
  });

  test("splitName sin coma con 4 tokens: los 2 primeros son apellidos", async () => {
    const res = await serviceWith([
      row({ full_name: "Perez Ruiz Juan Carlos" }),
    ]).getAttendanceRisk(1);

    expect(res.students[0].lastName).toBe("Perez Ruiz");
    expect(res.students[0].firstName).toBe("Juan Carlos");
  });

  // ── Casos añadidos tras la 1ª corrida de mutación (Stryker): cada uno mata
  // mutantes que sobrevivieron a la batería original ──────────────────────────

  test("% fraccionario en la rama en_riesgo se redondea a 2 decimales (20h/90h -> 22.22)", async () => {
    // Mata los mutantes aritméticos del redondeo (l.98: *100)/100 -> *100)*100 y /100)/100)
    const res = await serviceWith([
      row({ absent_hours: "20", total_section_hours: "90" }),
    ]).getAttendanceRisk(1);

    expect(res.students[0].status).toBe("en_riesgo");
    expect(res.students[0].absencePercentage).toBe(22.22);
  });

  test("splitName con espacios extra: ' Ana  Torres ' -> 2 tokens limpios (Apellido Nombre)", async () => {
    // Mata los mutantes de trim(), del regex /\s+/ -> /\s/ y de la rama length > 2
    const res = await serviceWith([
      row({ full_name: " Ana  Torres " }),
    ]).getAttendanceRisk(1);

    expect(res.students[0].lastName).toBe("Ana");
    expect(res.students[0].firstName).toBe("Torres");
  });

  test("splitName con un solo token: todo es nombre y el apellido queda vacío", async () => {
    const res = await serviceWith([row({ full_name: "Cher" })]).getAttendanceRisk(1);

    expect(res.students[0].firstName).toBe("Cher");
    expect(res.students[0].lastName).toBe("");
  });

  test("splitName con espacios alrededor de la coma: 'Quispe , Rosa' -> se recortan", async () => {
    const res = await serviceWith([
      row({ full_name: "Quispe , Rosa" }),
    ]).getAttendanceRisk(1);

    expect(res.students[0].lastName).toBe("Quispe");
    expect(res.students[0].firstName).toBe("Rosa");
  });

  test("splitName con dos comas: el resto se re-une conservando la coma interna", async () => {
    const res = await serviceWith([
      row({ full_name: "Quispe, Rosa, Belen" }),
    ]).getAttendanceRisk(1);

    expect(res.students[0].lastName).toBe("Quispe");
    expect(res.students[0].firstName).toBe("Rosa, Belen");
  });
});

describe("PU-I3 · computeSummary: conteos del resumen del docente (HU22)", () => {
  test("2 impedidos + 1 en riesgo + 2 normales -> conteos y total exactos", async () => {
    const rows = [
      row({ code: "1", absent_hours: "30" }), // 30% > 25 -> impedido
      row({ code: "2", absent_hours: "26" }), // 26% > 25 -> impedido
      row({ code: "3", absent_hours: "21" }), // margen 4h -> 2 faltas -> en_riesgo
      row({ code: "4", absent_hours: "0" }),  // margen 25h -> 13 faltas -> normal
      row({ code: "5", absent_hours: "10" }), // margen 15h -> 8 faltas -> normal
    ];

    const { summary } = await serviceWith(rows).getAttendanceRiskSummary(1);

    expect(summary).toEqual({ impedido: 2, en_riesgo: 1, normal: 2, total: 5 });
  });

  test("sección sin alumnos -> resumen en cero", async () => {
    const { summary } = await serviceWith([]).getAttendanceRiskSummary(1);

    expect(summary).toEqual({ impedido: 0, en_riesgo: 0, normal: 0, total: 0 });
  });
});
