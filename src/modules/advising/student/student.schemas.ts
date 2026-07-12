import { z } from "zod";

export const sectionIdParamSchema = z.object({
  sectionId: z.coerce.number().int().positive(),
});

export const sessionIdParamSchema = z.object({
  sessionId: z.coerce.number().int().positive(),
});
