import { describe, expect, test } from "bun:test";
import {
  buildParticipant,
  canIssueToken,
  isModeratorRole,
  roleLabel,
  roleWeight,
  studentRoleFromPosition,
} from "../../src/modules/chat/chat.logic.js";
import type {
  ChatParticipant,
  ChatParticipantRole,
} from "../../src/modules/chat/chat.types.js";

/**
 * ============================================================================
 * PRUEBA UNITARIA — Lógica pura de roles del chat por sección (HU23)
 * Fuente: src/modules/chat/chat.logic.ts
 * ============================================================================
 * Se prueban de forma AISLADA las funciones puras que derivan el rol de chat de
 * cada participante (sin Firebase ni BD): etiqueta legible, peso jerárquico,
 * quién es moderador, el rol del alumno según su representación, el armado del
 * participante y la autorización para emitir token.
 *
 * Qué valida cada grupo:
 *   - roleLabel()             : cada rol -> su etiqueta en español (5 roles).
 *   - roleWeight()            : jerarquía teacher(100) > jp(90) > delegate(70) > subdelegate(60) > student(10).
 *   - isModeratorRole()       : moderan todos MENOS el alumno raso.
 *   - studentRoleFromPosition(): null -> "student"; delegate/subdelegate se preservan.
 *   - buildParticipant()      : arma uid/userId/label/weight/moderator desde la fila.
 *   - canIssueToken()         : autoriza SOLO si el participante existe Y el userId coincide (anti-suplantación).
 */

// Los 5 roles válidos del chat, para recorrerlos en los tests que aplican a todos.
const ROLES: ChatParticipantRole[] = [
  "teacher",
  "jp",
  "delegate",
  "subdelegate",
  "student",
];

describe("roleLabel", () => {
  test("cada rol tiene una etiqueta legible en español", () => {
    expect(roleLabel("teacher")).toBe("Profesor");        // profesor titular
    expect(roleLabel("jp")).toBe("Jefe de Práctica");     // JP
    expect(roleLabel("delegate")).toBe("Delegado");       // delegado del salón
    expect(roleLabel("subdelegate")).toBe("Subdelegado"); // subdelegado
    expect(roleLabel("student")).toBe("Alumno");          // alumno raso
  });

  test("todos los roles producen una etiqueta no vacía", () => {
    for (const r of ROLES) expect(roleLabel(r).length).toBeGreaterThan(0); // ningún rol se queda sin etiqueta
  });
});

describe("roleWeight", () => {
  test("respeta la jerarquía teacher > jp > delegate > subdelegate > student", () => {
    expect(roleWeight("teacher")).toBe(100);     // mayor autoridad
    expect(roleWeight("jp")).toBe(90);
    expect(roleWeight("delegate")).toBe(70);
    expect(roleWeight("subdelegate")).toBe(60);
    expect(roleWeight("student")).toBe(10);      // menor autoridad
  });

  test("los pesos son estrictamente decrecientes en el orden jerárquico", () => {
    const ordered: ChatParticipantRole[] = [
      "teacher",
      "jp",
      "delegate",
      "subdelegate",
      "student",
    ];
    for (let i = 1; i < ordered.length; i++) {   // recorre pares consecutivos de la jerarquía
      expect(roleWeight(ordered[i - 1]!)).toBeGreaterThan(roleWeight(ordered[i]!)); // cada rol pesa MÁS que el siguiente
    }
  });
});

describe("isModeratorRole", () => {
  test("docente, JP, delegado y subdelegado son moderadores; el alumno no", () => {
    expect(isModeratorRole("teacher")).toBe(true);     // modera
    expect(isModeratorRole("jp")).toBe(true);          // modera
    expect(isModeratorRole("delegate")).toBe(true);    // modera
    expect(isModeratorRole("subdelegate")).toBe(true); // modera
    expect(isModeratorRole("student")).toBe(false);    // el alumno raso NO modera (solo borra lo suyo)
  });
});

describe("studentRoleFromPosition", () => {
  test("null (no representante) ⇒ alumno raso", () => {
    expect(studentRoleFromPosition(null)).toBe("student"); // sin cargo -> alumno
  });
  test("delegate/subdelegate se preservan como rol", () => {
    expect(studentRoleFromPosition("delegate")).toBe("delegate");       // el cargo se conserva
    expect(studentRoleFromPosition("subdelegate")).toBe("subdelegate");
  });
});

describe("buildParticipant", () => {
  test("arma uid/userId desde user_id y deriva label/weight/moderator del rol", () => {
    const p = buildParticipant(
      { user_id: 293, full_name: "Lo Li, Aron" }, // fila (JP de la demo)
      1,                                          // sectionId
      "jp",                                       // rol
    );
    expect(p).toEqual({
      uid: "293",                    // uid = user_id como string (para Firebase)
      userId: 293,                   // userId numérico
      sectionId: 1,
      displayName: "Lo Li, Aron",    // nombre mostrado
      role: "jp",
      roleLabel: "Jefe de Práctica", // derivado de roleLabel(rol)
      isModerator: true,             // derivado de isModeratorRole(rol)
      weight: 90,                    // derivado de roleWeight(rol)
    });
  });

  test("un alumno raso no es moderador y pesa 10", () => {
    const p = buildParticipant(
      { user_id: 6, full_name: "Sanchez, Jefferson" },
      1,
      "student",
    );
    expect(p.isModerator).toBe(false); // el alumno no modera
    expect(p.weight).toBe(10);         // peso mínimo
    expect(p.uid).toBe("6");           // uid es el user_id en string
  });
});

describe("canIssueToken (autorización)", () => {
  // Participante de referencia: alumno 42 de la sección 1.
  const participant: ChatParticipant = buildParticipant(
    { user_id: 42, full_name: "Test User" },
    1,
    "student",
  );

  test("rechaza si no hay participante (no pertenece a la sección)", () => {
    expect(canIssueToken(null, 42)).toBe(false); // sin participante -> no se emite token
  });

  test("rechaza si el userId del JWT no coincide con el del participante", () => {
    expect(canIssueToken(participant, 999)).toBe(false); // anti-suplantación: el id del token no es el del participante
  });

  test("acepta cuando el participante existe y el userId coincide", () => {
    expect(canIssueToken(participant, 42)).toBe(true); // pertenece a la sección Y el id coincide -> OK
  });
});
