import { describe, expect, test } from "bun:test";
import { buildContext } from "../../src/modules/chatbot/context-builder.js";
import type { ChatbotIntent, ChatbotMessageRow } from "../../src/modules/chatbot/chatbot.types.js";

// ============================================================================
// CAJA NEGRA — buildContext() del chatbot ULimaBot (HU28, itsRon4ld)
// ----------------------------------------------------------------------------
// Funcionalidad con 14 campos de entrada (> 4):
//   studentName, careerName, currentLevel, history, intents, dateContext,
//   scheduleData, curriculumData, alertsData, announcementsData,
//   classmatesData, chatSearchResults, localGrades, question.
//
// Se prueba por PARTICION DE EQUIVALENCIA y VALORES LIMITE sin conocer la
// implementacion, observando solo el texto del contexto que arma la funcion.
// Regla de negocio central: un bloque de datos aparece solo si su intent esta
// presente Y su dato no es vacio. chatSearchResults es la excepcion (siempre
// que exista). Ver context-builder.ts.
// ============================================================================

const baseDate = { today: "2026-07-13" };

// Fabrica un params completo y valido; cada test sobrescribe lo que necesita.
function make(over: Partial<Parameters<typeof buildContext>[0]> = {}) {
  return buildContext({
    studentName: "Ana Torres",
    careerName: "Ingenieria de Sistemas",
    currentLevel: 5,
    history: [] as ChatbotMessageRow[],
    intents: [] as ChatbotIntent[],
    dateContext: baseDate,
    question: "Hola",
    ...over,
  });
}

describe("[CAJA NEGRA] buildContext — perfil del alumno (campos studentName, careerName, currentLevel)", () => {
  test("CV1 perfil completo: nombre, carrera y ciclo aparecen en el mensaje", () => {
    const { message, preamble } = make({ studentName: "Luis Rojas", careerName: "Derecho", currentLevel: 8 });
    expect(message).toContain("Luis Rojas");
    expect(message).toContain("Derecho");
    expect(message).toContain("Ciclo actual: 8");
    expect(preamble).toContain("ULimaBot");
  });

  test("CNV1 currentLevel = null: la linea de ciclo se OMITE (valor limite del perfil)", () => {
    const { message } = make({ currentLevel: null });
    expect(message).toContain("Ana Torres");
    expect(message).not.toContain("Ciclo actual");
  });
});

describe("[CAJA NEGRA] buildContext — bloques por intent + dato (schedule, curriculum, alerts, grades)", () => {
  test("CV2 intent 'schedule' + scheduleData presente: se incluye el bloque de horario", () => {
    const { message } = make({ intents: ["schedule"], scheduleData: { dia: "Lunes", curso: "ISW2" } });
    expect(message).toContain("DATOS DE HORARIO Y EVALUACIONES");
    expect(message).toContain("ISW2");
  });

  test("CNV2 intent 'schedule' SIN scheduleData: el bloque de horario se OMITE", () => {
    const { message } = make({ intents: ["schedule"], scheduleData: undefined });
    expect(message).not.toContain("DATOS DE HORARIO");
  });

  test("CNV3 scheduleData presente SIN intent 'schedule': el bloque se OMITE (falta la intencion)", () => {
    const { message } = make({ intents: [], scheduleData: { dia: "Martes" } });
    expect(message).not.toContain("DATOS DE HORARIO");
  });

  test("CV3 intent 'curriculum' + curriculumData: se incluye el bloque de malla", () => {
    const { message } = make({ intents: ["curriculum"], curriculumData: { avance: "60%" } });
    expect(message).toContain("DATOS DE MALLA CURRICULAR");
    expect(message).toContain("60%");
  });

  test("CV4 intent 'alerts' + alertsData: se incluye el bloque de alertas", () => {
    const { message } = make({ intents: ["alerts"], alertsData: [{ tipo: "academic_risk" }] });
    expect(message).toContain("DATOS DE ALERTAS");
    expect(message).toContain("academic_risk");
  });

  test("CV5 intent 'grades' + localGrades: se incluye el bloque de notas personales", () => {
    const { message } = make({ intents: ["grades"], localGrades: { promedio: 14.2 } });
    expect(message).toContain("DATOS DE NOTAS PERSONALES");
    expect(message).toContain("14.2");
  });
});

describe("[CAJA NEGRA] buildContext — chatSearchResults (excepcion: no depende de intent)", () => {
  test("CV6 chatSearchResults presente SIN intent: SIEMPRE se incluye el bloque de chat", () => {
    const { message } = make({ intents: [], chatSearchResults: [{ autor: "Pia", texto: "hola grupo" }] });
    expect(message).toContain("MENSAJES DEL CHAT DE LA SECCION");
    expect(message).toContain("hola grupo");
  });

  test("CNV4 chatSearchResults ausente: el bloque de chat se OMITE", () => {
    const { message } = make({ chatSearchResults: undefined });
    expect(message).not.toContain("MENSAJES DEL CHAT");
  });
});

describe("[CAJA NEGRA] buildContext — history (bloque de conversacion y valor limite slice -10)", () => {
  test("CV7 history con mensajes: aparece el historial con roles traducidos", () => {
    const history: ChatbotMessageRow[] = [
      { role: "user", content: "que nota saque" } as ChatbotMessageRow,
      { role: "assistant", content: "tu promedio es 14" } as ChatbotMessageRow,
    ];
    const { message } = make({ history });
    expect(message).toContain("HISTORIAL DE LA CONVERSACION");
    expect(message).toContain("Alumno: que nota saque");
    expect(message).toContain("ULimaBot: tu promedio es 14");
  });

  test("CNV5 history vacio: no se agrega bloque de historial", () => {
    const { message } = make({ history: [] });
    expect(message).not.toContain("HISTORIAL DE LA CONVERSACION");
  });

  test("LIMITE history de 11 mensajes: solo se conservan los ultimos 10 (el mas viejo se descarta)", () => {
    const history: ChatbotMessageRow[] = Array.from({ length: 11 }, (_, i) =>
      ({ role: "user", content: `msg-${i}` }) as ChatbotMessageRow,
    );
    const { message } = make({ history });
    expect(message).not.toContain("msg-0");
    expect(message).toContain("msg-1");
    expect(message).toContain("msg-10");
  });
});

describe("[CAJA NEGRA] buildContext — dateContext y question (campos siempre presentes)", () => {
  test("CV8 dateContext con periodo y semana: se incluyen ambas lineas", () => {
    const { message } = make({
      dateContext: {
        today: "2026-07-13",
        academicPeriodCode: "2026-1",
        currentWeekNumber: 14,
        currentWeekRange: "13/07 - 19/07",
      },
    });
    expect(message).toContain("Periodo academico: 2026-1");
    expect(message).toContain("Hoy: 2026-07-13");
    expect(message).toContain("Semana actual: 14");
  });

  test("CNV6 dateContext minimo (solo today): sin lineas de periodo ni semana, pero 'Hoy' presente", () => {
    const { message } = make({ dateContext: { today: "2026-07-13" } });
    expect(message).toContain("Hoy: 2026-07-13");
    expect(message).not.toContain("Periodo academico");
    expect(message).not.toContain("Semana actual");
  });

  test("CV9 question siempre se agrega al final del contexto", () => {
    const { message } = make({ question: "cuantos creditos me faltan" });
    expect(message).toContain("PREGUNTA DEL ALUMNO");
    expect(message.trimEnd().endsWith("cuantos creditos me faltan")).toBe(true);
  });
});
