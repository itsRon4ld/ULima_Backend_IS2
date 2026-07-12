import type { Context } from "hono";
import { validateParams } from "../../shared/middleware/validate-dto.js";
import type { CourseDetailService } from "./course-detail.service.js";
import { sectionIdParamSchema } from "./course-detail.schemas.js";

export class CourseDetailController {
  constructor(readonly service: CourseDetailService) {}

  async getAnnouncements(c: Context) {
    const { sectionId } = validateParams(c, sectionIdParamSchema);
    return c.json(await this.service.getAnnouncements(sectionId));
  }

  async getContacts(c: Context) {
    const { sectionId } = validateParams(c, sectionIdParamSchema);
    return c.json(await this.service.getContacts(sectionId));
  }
}
