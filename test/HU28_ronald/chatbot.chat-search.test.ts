import { describe, expect, test, mock, beforeEach } from "bun:test";
import { filterSections } from "../../src/modules/chatbot/chat-search.js";

const SECTIONS = [
  { sectionId: 1, courseName: "INGENIERÍA DE SOFTWARE II", sectionCode: "856" },
  { sectionId: 2, courseName: "APRENDIZAJE DE MÁQUINA / MACHINE LEARNING", sectionCode: "753" },
  { sectionId: 3, courseName: "CIBERSEGURIDAD / CYBERSECURITY", sectionCode: "751" },
  { sectionId: 4, courseName: "GESTIÓN DE OPERACIONES", sectionCode: "756" },
  { sectionId: 5, courseName: "SISTEMAS DE INTELIGENCIA EMPRESARIAL", sectionCode: "751" },
];

describe("filterSections - chat search", () => {
  test("match por nombre completo en minúsculas", () => {
    const result = filterSections("qué se dijo en gestión de operaciones", SECTIONS);
    expect(result.map((s) => s.sectionId)).toContain(4);
  });

  test("match por token parcial: 'software' matchea INGENIERÍA DE SOFTWARE II", () => {
    const result = filterSections("han dicho algo en el grupo de software", SECTIONS);
    expect(result.map((s) => s.sectionId)).toContain(1);
  });

  test("match por token parcial: 'machine' matchea APRENDIZAJE DE MÁQUINA / MACHINE LEARNING", () => {
    const result = filterSections("comentarios en el grupo de machine learning", SECTIONS);
    expect(result.map((s) => s.sectionId)).toContain(2);
  });

  test("match por sectionCode", () => {
    const result = filterSections("algo sobre la sección 856", SECTIONS);
    expect(result.map((s) => s.sectionId)).toContain(1);
  });

  test("ignora palabras cortas y numeros romanos", () => {
    const result = filterSections("qué pasa en el grupo de ciberseguridad", SECTIONS);
    expect(result.map((s) => s.sectionId)).toContain(3);
  });

  test("sin match: cae al fallback de las primeras 3 secciones", () => {
    const result = filterSections("xyz abc sin coincidencia", SECTIONS);
    expect(result.length).toBe(3);
  });
});

describe("searchChatMessages - lectura completa", () => {
  beforeEach(() => {
    mock.restore();
  });

  test("devuelve TODOS los mensajes leídos (no top-K)", async () => {
    const fakeMessages = [
      { id: "m0", senderName: "A", body: "Hola", createdAt: 1 },
      { id: "m1", senderName: "B", body: "Se puede usar apuntes en el examen?", createdAt: 2 },
      { id: "m2", senderName: "C", body: "Miau miau", createdAt: 3 },
    ];

    mock.module("../../src/services/firebase.service.js", () => ({
      firebaseService: { getRecentMessages: async () => fakeMessages },
    }));

    const { searchChatMessages: search } = await import("../../src/modules/chatbot/chat-search.js");
    const results = await search(
      "Se puede usar apuntes en el examen de software? lo han dicho por el grupo?",
      [{ sectionId: 1, courseName: "INGENIERIA DE SOFTWARE II", sectionCode: "856" }],
    );

    expect(results.length).toBe(1);
    expect(results[0].messages.length).toBe(3);
    expect(results[0].messages[1].body).toBe("Se puede usar apuntes en el examen?");
  });

  test("sección sin mensajes: no agrega resultado", async () => {
    mock.module("../../src/services/firebase.service.js", () => ({
      firebaseService: { getRecentMessages: async () => [] },
    }));

    const { searchChatMessages: search } = await import("../../src/modules/chatbot/chat-search.js");
    const results = await search(
      "qué se dijo en el chat?",
      [{ sectionId: 1, courseName: "INGENIERIA DE SOFTWARE II", sectionCode: "856" }],
    );

    expect(results.length).toBe(0);
  });

  test("error de firebase: continua con la siguiente sección, no rompe", async () => {
    mock.module("../../src/services/firebase.service.js", () => ({
      firebaseService: {
        getRecentMessages: async (sectionId: number) => {
          if (sectionId === 1) throw new Error("firebase down");
          return [
            { id: "m0", senderName: "A", body: "ok", createdAt: 1 },
          ];
        },
      },
    }));

    const { searchChatMessages: search } = await import("../../src/modules/chatbot/chat-search.js");
    const results = await search(
      "qué se dijo?",
      [
        { sectionId: 1, courseName: "CURSO A", sectionCode: "100" },
        { sectionId: 2, courseName: "CURSO B", sectionCode: "200" },
      ],
    );

    expect(results.length).toBe(1);
    expect(results[0].sectionName).toContain("CURSO B");
  });
});
