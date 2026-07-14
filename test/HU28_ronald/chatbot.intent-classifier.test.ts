import { describe, expect, test } from "bun:test";
import { classifyByKeywords } from "../../src/modules/chatbot/intent-classifier.js";

describe("classifyByKeywords - chat intent", () => {
  test("'Han dicho algo del examen en el grupo de software?' incluye chat", () => {
    const intents = classifyByKeywords("Han dicho algo del examen en el grupo de software?");
    expect(intents).toContain("chat");
  });

  test("'dijeron algo del examen' incluye chat", () => {
    const intents = classifyByKeywords("dijeron algo del examen en el chat");
    expect(intents).toContain("chat");
  });

  test("'escribieron en el grupo' incluye chat", () => {
    const intents = classifyByKeywords("escribieron en el grupo sobre la tarea");
    expect(intents).toContain("chat");
  });

  test("'comentarios en el grupo' incluye chat", () => {
    const intents = classifyByKeywords("comentarios en el grupo de soft ii");
    expect(intents).toContain("chat");
  });
});
