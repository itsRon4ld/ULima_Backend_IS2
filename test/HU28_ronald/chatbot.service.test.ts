import { describe, expect, test, mock, beforeEach, afterAll } from "bun:test";

afterAll(() => {
  mock.restore();
});

const saveMessageCalls: Array<{ sessionId: string; role: string; content: string }> = [];
const searchChatCalls: Array<{ question: string }> = [];

mock.module("../../src/services/cohere.client.js", () => ({
  cohereClient: {
    classify: async () => [
      {
        input: "x",
        prediction: "grades",
        confidence: 0.9,
        labels: { grades: { confidence: 0.9 } },
      },
    ],
    chatWithHistory: async () => "respuesta del bot",
    generateTitle: async () => "titulo",
  },
}));

const fakeRepo = {
  findSessionById: async (sessionId: string) => ({
    id: sessionId,
    studentId: 2,
    title: "t",
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  saveMessage: async (sessionId: string, role: "user" | "assistant", content: string) => {
    saveMessageCalls.push({ sessionId, role, content });
    return {
      id: "m1",
      sessionId,
      role,
      content,
      createdAt: new Date(),
    };
  },
  touchSession: async () => {},
  getMessages: async () => [],
  getStudentInfo: async () => ({
    fullName: "HURTADO LAGO RONALD ALFREDO",
    careerName: "Ing de Sistemas",
    currentLevel: 8,
  }),
  getActiveAcademicPeriod: async () => ({ id: 1, code: "2026-1" }),
  getAcademicWeeksForActivePeriod: async () => [
    { weekNumber: 14, startDate: "2026-07-06", endDate: "2026-07-12" },
    { weekNumber: 15, startDate: "2026-07-13", endDate: "2026-07-19" },
  ],
  getSchedule: async () => [],
  getCurriculum: async () => [],
  getAlerts: async () => [],
  getAnnouncements: async () => [],
  getClassmates: async () => [],
  getActiveSectionDetails: async () => [
    { sectionId: 1, courseName: "INGENIERÍA DE SOFTWARE II", sectionCode: "856" },
  ],
} as any;

const fakeScheduleService = {
  getAssessments: async () => ({ assessments: [] }),
} as any;

const stubSearchChat = async (question: string, _sections: unknown) => {
  searchChatCalls.push({ question });
  return [
    {
      sectionName: "INGENIERÍA DE SOFTWARE II (856)",
      messages: [
        { senderName: "Profesor", body: "Si se puede usar apuntes", createdAt: 1 },
      ],
    },
  ];
};

const { ChatbotService } = await import("../../src/modules/chatbot/chatbot.service.js");

describe("ChatbotService.ask - el chat se consulta SIEMPRE", () => {
  beforeEach(() => {
    saveMessageCalls.length = 0;
    searchChatCalls.length = 0;
  });

  test("pregunta que NO tiene keyword de chat (solo 'examen') -> igual consulta el chat", async () => {
    const service = new ChatbotService(fakeRepo, fakeScheduleService, stubSearchChat);
    await service.ask("s1", 2, {
      question: "se pueden usar apuntes? escritos a mano en el examen de SoftWare II?",
    });

    expect(searchChatCalls.length).toBe(1);
    expect(searchChatCalls[0].question).toContain("apuntes");
  });

  test("pregunta con keyword de chat explicito -> consulta el chat", async () => {
    const service = new ChatbotService(fakeRepo, fakeScheduleService, stubSearchChat);
    await service.ask("s1", 2, {
      question: "dijeron algo del examen en el grupo?",
    });

    expect(searchChatCalls.length).toBe(1);
  });

  test("pregunta sobre horario -> el chat tambien se consulta", async () => {
    const service = new ChatbotService(fakeRepo, fakeScheduleService, stubSearchChat);
    await service.ask("s1", 2, {
      question: "que clases tengo el lunes?",
    });

    expect(searchChatCalls.length).toBe(1);
  });
});
