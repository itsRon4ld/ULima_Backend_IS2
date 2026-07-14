import { describe, expect, test } from "bun:test";
import { buildContext } from "../../src/modules/chatbot/context-builder.js";

describe("buildContext - bloque del chat", () => {
  test("incluye mensajes del chat aunque el intent NO sea 'chat' (BR-CB-06)", () => {
    const result = buildContext({
      studentName: "Ronald",
      careerName: "Ing Sistemas",
      currentLevel: 8,
      history: [],
      intents: ["grades", "schedule"],
      dateContext: { today: "2026-07-12" },
      chatSearchResults: [
        {
          sectionName: "INGENIERÍA DE SOFTWARE II (856)",
          messages: [
            { senderName: "Profesor", body: "Si se puede usar apuntes", createdAt: 1 },
          ],
        },
      ],
      question: "se pueden usar apuntes en el examen?",
    });

    expect(result.message).toContain("MENSAJES DEL CHAT DE LA SECCION");
    expect(result.message).toContain("Si se puede usar apuntes");
  });

  test("omite el bloque si no hay mensajes (chatSearchResults es null)", () => {
    const result = buildContext({
      studentName: "Ronald",
      careerName: "Ing Sistemas",
      currentLevel: 8,
      history: [],
      intents: ["schedule"],
      dateContext: { today: "2026-07-12" },
      question: "que clases tengo?",
    });

    expect(result.message).not.toContain("MENSAJES DEL CHAT DE LA SECCION");
  });
});
