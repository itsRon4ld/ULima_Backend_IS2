import { beforeEach, describe, expect, test } from "bun:test";
import { ChatController } from "../../src/modules/chat/chat.controller.js";
import type { ChatRepository } from "../../src/modules/chat/chat.repository.js";
import { buildParticipant } from "../../src/modules/chat/chat.logic.js";
import type { ChatParticipant } from "../../src/modules/chat/chat.types.js";
import { firebaseService } from "../../src/services/firebase.service.js";

let mirrored: ChatParticipant[] = [];
firebaseService.upsertChatMember = async (p: ChatParticipant) => {
  mirrored.push(p);
};
firebaseService.generateCustomToken = async (
  uid: string,
  claims: Record<string, unknown> = {},
) => `token:${uid}:${claims.role}:${claims.weight}`;

let softDeletes: Array<{ sectionId: number; messageId: string; patch: unknown }> = [];
let softDeleteExists = true;
firebaseService.softDeleteChatMessage = async (
  sectionId: number,
  messageId: string,
  patch: { deletedBy: string; deletedByUid: string; deletedByRole: string },
) => {
  softDeletes.push({ sectionId, messageId, patch });
  return { existed: softDeleteExists };
};

const fakeRepo = (over: Partial<ChatRepository>): ChatRepository =>
  ({
    findStudentParticipant: async () => null,
    findTeacherParticipant: async () => null,
    ...over,
  }) as unknown as ChatRepository;

const teacher: ChatParticipant = buildParticipant(
  { user_id: 292, full_name: "Quintana Cruz, Hernan" },
  1,
  "teacher",
);
const student: ChatParticipant = buildParticipant(
  { user_id: 6, full_name: "Sanchez, Jefferson" },
  1,
  "student",
);
const delegate: ChatParticipant = buildParticipant(
  { user_id: 7, full_name: "Delegado, Ana" },
  1,
  "delegate",
);

const expectForbidden = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    throw new Error("se esperaba un 403 y no se lanzó");
  } catch (e) {
    const err = e as { statusCode?: number; code?: string };
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe("CHAT_SECTION_FORBIDDEN");
  }
};

beforeEach(() => {
  mirrored = [];
  softDeletes = [];
  softDeleteExists = true;
});

const jp: ChatParticipant = buildParticipant(
  { user_id: 293, full_name: "Lo Li, Aaron" },
  1,
  "jp",
);

const expectDeleteForbidden = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    throw new Error("se esperaba un 403 y no se lanzó");
  } catch (e) {
    const err = e as { statusCode?: number; code?: string };
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe("CHAT_DELETE_FORBIDDEN");
  }
};

describe("ChatController.deleteMessage — autorización (caja blanca)", () => {
  test("profesor titular de la sección ⇒ elimina (lápida) y responde", async () => {
    const c = new ChatController(
      fakeRepo({ findTeacherParticipant: async () => teacher }),
    );
    const res = await c.deleteMessage({
      sectionId: 1,
      messageId: "-Nabc",
      userId: 292,
      teacherId: 292,
    });
    expect(res.deleted).toBe(true);
    expect(res.deletedBy).toBe("Quintana Cruz, Hernan");
    expect(softDeletes.length).toBe(1);
    expect(softDeletes[0].messageId).toBe("-Nabc");
  });

  test("sin teacherId (token no docente) ⇒ 403", async () => {
    const c = new ChatController(fakeRepo({}));
    await expectDeleteForbidden(() =>
      c.deleteMessage({ sectionId: 1, messageId: "-Nabc", userId: 6 }),
    );
    expect(softDeletes.length).toBe(0);
  });

  test("docente que no dicta la sección (repo null) ⇒ 403", async () => {
    const c = new ChatController(
      fakeRepo({ findTeacherParticipant: async () => null }),
    );
    await expectDeleteForbidden(() =>
      c.deleteMessage({ sectionId: 1, messageId: "-Nabc", userId: 292, teacherId: 292 }),
    );
  });

  test("JP de la sección (rol != teacher) ⇒ 403 (solo el profesor titular)", async () => {
    const c = new ChatController(
      fakeRepo({ findTeacherParticipant: async () => jp }),
    );
    await expectDeleteForbidden(() =>
      c.deleteMessage({ sectionId: 1, messageId: "-Nabc", userId: 293, teacherId: 293 }),
    );
    expect(softDeletes.length).toBe(0);
  });

  test("userId del JWT distinto al del participante ⇒ 403 (anti-suplantación)", async () => {
    const c = new ChatController(
      fakeRepo({ findTeacherParticipant: async () => teacher }),
    );
    await expectDeleteForbidden(() =>
      c.deleteMessage({ sectionId: 1, messageId: "-Nabc", userId: 999, teacherId: 292 }),
    );
  });

  test("mensaje inexistente ⇒ 404 CHAT_MESSAGE_NOT_FOUND", async () => {
    softDeleteExists = false;
    const c = new ChatController(
      fakeRepo({ findTeacherParticipant: async () => teacher }),
    );
    try {
      await c.deleteMessage({ sectionId: 1, messageId: "-Nzzz", userId: 292, teacherId: 292 });
      throw new Error("se esperaba 404");
    } catch (e) {
      const err = e as { statusCode?: number; code?: string };
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe("CHAT_MESSAGE_NOT_FOUND");
    }
  });
});

describe("ChatController.createFirebaseToken — autorización (caja blanca)", () => {
  test("docente sin teacherId ⇒ 403", async () => {
    const c = new ChatController(fakeRepo({}));
    await expectForbidden(() =>
      c.createFirebaseToken({ sectionId: 1, userId: 292, role: "teacher" }),
    );
  });

  test("docente que no dicta la sección (repo null) ⇒ 403", async () => {
    const c = new ChatController(
      fakeRepo({ findTeacherParticipant: async () => null }),
    );
    await expectForbidden(() =>
      c.createFirebaseToken({
        sectionId: 1,
        userId: 292,
        role: "teacher",
        teacherId: 292,
      }),
    );
  });

  test("alumno sin studentId ⇒ 403", async () => {
    const c = new ChatController(fakeRepo({}));
    await expectForbidden(() =>
      c.createFirebaseToken({ sectionId: 1, userId: 6, role: "student" }),
    );
  });

  test("userId del JWT distinto al del participante ⇒ 403 (anti-suplantación)", async () => {
    const c = new ChatController(
      fakeRepo({ findStudentParticipant: async () => student }),
    );
    await expectForbidden(() =>
      c.createFirebaseToken({
        sectionId: 1,
        userId: 999,
        role: "student",
        studentId: 6,
      }),
    );
  });

  test("no escribe /members ni firma token cuando rechaza", async () => {
    const c = new ChatController(fakeRepo({}));
    await expectForbidden(() =>
      c.createFirebaseToken({ sectionId: 1, userId: 6, role: "student" }),
    );
    expect(mirrored).toHaveLength(0);
  });
});

describe("ChatController.createFirebaseToken — éxito", () => {
  test("profesor válido ⇒ token + rol/peso de profesor y espejo escrito", async () => {
    const c = new ChatController(
      fakeRepo({ findTeacherParticipant: async () => teacher }),
    );
    const res = await c.createFirebaseToken({
      sectionId: 1,
      userId: 292,
      role: "teacher",
      teacherId: 292,
    });
    expect(res.role).toBe("teacher");
    expect(res.roleLabel).toBe("Profesor");
    expect(res.isModerator).toBe(true);
    expect(res.weight).toBe(100);
    expect(res.uid).toBe("292");
    expect(res.token).toBe("token:292:teacher:100");
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0]!.userId).toBe(292);
  });

  test("alumno raso válido ⇒ no moderador, peso 10", async () => {
    const c = new ChatController(
      fakeRepo({ findStudentParticipant: async () => student }),
    );
    const res = await c.createFirebaseToken({
      sectionId: 1,
      userId: 6,
      role: "student",
      studentId: 6,
    });
    expect(res.isModerator).toBe(false);
    expect(res.weight).toBe(10);
    expect(res.token).toBe("token:6:student:10");
  });

  test("delegado válido ⇒ moderador, peso 70", async () => {
    const c = new ChatController(
      fakeRepo({ findStudentParticipant: async () => delegate }),
    );
    const res = await c.createFirebaseToken({
      sectionId: 1,
      userId: 7,
      role: "student",
      studentId: 7,
    });
    expect(res.role).toBe("delegate");
    expect(res.isModerator).toBe(true);
    expect(res.weight).toBe(70);
  });
});
