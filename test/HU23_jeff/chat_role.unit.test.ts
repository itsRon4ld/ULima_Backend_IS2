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

const ROLES: ChatParticipantRole[] = [
  "teacher",
  "jp",
  "delegate",
  "subdelegate",
  "student",
];

describe("roleLabel", () => {
  test("cada rol tiene una etiqueta legible en español", () => {
    expect(roleLabel("teacher")).toBe("Profesor");
    expect(roleLabel("jp")).toBe("Jefe de Práctica");
    expect(roleLabel("delegate")).toBe("Delegado");
    expect(roleLabel("subdelegate")).toBe("Subdelegado");
    expect(roleLabel("student")).toBe("Alumno");
  });

  test("todos los roles producen una etiqueta no vacía", () => {
    for (const r of ROLES) expect(roleLabel(r).length).toBeGreaterThan(0);
  });
});

describe("roleWeight", () => {
  test("respeta la jerarquía teacher > jp > delegate > subdelegate > student", () => {
    expect(roleWeight("teacher")).toBe(100);
    expect(roleWeight("jp")).toBe(90);
    expect(roleWeight("delegate")).toBe(70);
    expect(roleWeight("subdelegate")).toBe(60);
    expect(roleWeight("student")).toBe(10);
  });

  test("los pesos son estrictamente decrecientes en el orden jerárquico", () => {
    const ordered: ChatParticipantRole[] = [
      "teacher",
      "jp",
      "delegate",
      "subdelegate",
      "student",
    ];
    for (let i = 1; i < ordered.length; i++) {
      expect(roleWeight(ordered[i - 1]!)).toBeGreaterThan(roleWeight(ordered[i]!));
    }
  });
});

describe("isModeratorRole", () => {
  test("docente, JP, delegado y subdelegado son moderadores; el alumno no", () => {
    expect(isModeratorRole("teacher")).toBe(true);
    expect(isModeratorRole("jp")).toBe(true);
    expect(isModeratorRole("delegate")).toBe(true);
    expect(isModeratorRole("subdelegate")).toBe(true);
    expect(isModeratorRole("student")).toBe(false);
  });
});

describe("studentRoleFromPosition", () => {
  test("null (no representante) ⇒ alumno raso", () => {
    expect(studentRoleFromPosition(null)).toBe("student");
  });
  test("delegate/subdelegate se preservan como rol", () => {
    expect(studentRoleFromPosition("delegate")).toBe("delegate");
    expect(studentRoleFromPosition("subdelegate")).toBe("subdelegate");
  });
});

describe("buildParticipant", () => {
  test("arma uid/userId desde user_id y deriva label/weight/moderator del rol", () => {
    const p = buildParticipant(
      { user_id: 293, full_name: "Lo Li, Aaron" },
      1,
      "jp",
    );
    expect(p).toEqual({
      uid: "293",
      userId: 293,
      sectionId: 1,
      displayName: "Lo Li, Aaron",
      role: "jp",
      roleLabel: "Jefe de Práctica",
      isModerator: true,
      weight: 90,
    });
  });

  test("un alumno raso no es moderador y pesa 10", () => {
    const p = buildParticipant(
      { user_id: 6, full_name: "Sanchez, Jefferson" },
      1,
      "student",
    );
    expect(p.isModerator).toBe(false);
    expect(p.weight).toBe(10);
    expect(p.uid).toBe("6");
  });
});

describe("canIssueToken (autorización)", () => {
  const participant: ChatParticipant = buildParticipant(
    { user_id: 42, full_name: "Test User" },
    1,
    "student",
  );

  test("rechaza si no hay participante (no pertenece a la sección)", () => {
    expect(canIssueToken(null, 42)).toBe(false);
  });

  test("rechaza si el userId del JWT no coincide con el del participante", () => {
    expect(canIssueToken(participant, 999)).toBe(false);
  });

  test("acepta cuando el participante existe y el userId coincide", () => {
    expect(canIssueToken(participant, 42)).toBe(true);
  });
});
