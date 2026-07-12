---
name: Refact Advising — reestructuración del módulo docente
description: Mover archivos existentes de `src/modules/advising/` a `src/modules/advising/teacher/` y actualizar `index.ts` para montar ambos sub-routers (teacher + student)
targets:
  - ../../../src/modules/advising/index.ts
  - ../../../src/modules/advising/teacher/**
---

# Refact Advising — reestructuración del módulo

Reorganización interna del módulo `src/modules/advising/` para alojar los sub-módulos `teacher/` y `student/`. Sin cambios de comportamiento.

## Objetivo

El módulo `advising` pasa de tener todos los archivos sueltos en la raíz a una estructura con subdirectorios:

```
Antes:                              Después:
src/modules/advising/               src/modules/advising/
  index.ts                            index.ts           ← reescrito
  advising.routes.ts                  teacher/
  advising.schemas.ts                   index.ts         ← wiring
  advising.types.ts                     teacher.routes.ts
  advising.controller.ts                teacher.schemas.ts
  advising.service.ts                   teacher.types.ts
  advising.repository.ts                teacher.controller.ts
  advising.logic.ts                     teacher.service.ts
                                        teacher.repository.ts
                                        teacher.logic.ts
                                      student/           ← spec aparte
```

## Plan de movimiento

### BR-RF-01: Crear subdirectorio `teacher/`
- Crear `src/modules/advising/teacher/`.

### BR-RF-02: Mover archivos existentes
Renombrar y mover los 7 archivos de dominio:

| Archivo actual | Archivo nuevo |
|----------------|---------------|
| `advising.routes.ts` | `teacher/teacher.routes.ts` |
| `advising.schemas.ts` | `teacher/teacher.schemas.ts` |
| `advising.types.ts` | `teacher/teacher.types.ts` |
| `advising.controller.ts` | `teacher/teacher.controller.ts` |
| `advising.service.ts` | `teacher/teacher.service.ts` |
| `advising.repository.ts` | `teacher/teacher.repository.ts` |
| `advising.logic.ts` | `teacher/teacher.logic.ts` |

### BR-RF-03: Crear `teacher/index.ts`
Wirear las dependencias del docente (mismo patrón que el `index.ts` actual):
```ts
const teacherRepository = new TeacherRepository(db);
const teacherService = new TeacherService(teacherRepository, eventBus);
const teacherController = new TeacherController(teacherService);
export const teacherRoutes = createTeacherRoutes(teacherController);
```

### BR-RF-04: Actualizar `teacher.routes.ts`
- Mantener el mismo Hono router con `authMiddleware` + `requireRole('teacher')`.
- Mantener los mismos paths relativos (`/me/sections`, `/me/sessions`, etc.).
- Actualizar imports: `./teacher.controller.js`, `./teacher.schemas.js`, etc.

### BR-RF-05: Reescribir `advising/index.ts`
Pasar de exportar un solo router a montar ambos sub-routers:
```ts
import { Hono } from "hono";
import { teacherRoutes } from "./teacher/index.js";
import { studentRoutes } from "./student/index.js";

const app = new Hono();
app.route("/me", teacherRoutes);        // /advising/me/... → docente
app.route("/", studentRoutes);          // /advising/section/..., /advising/:sessionId/rsvp → alumno

export const advisingRoutes = app;

export { TeacherController } from "./teacher/index.js";
export { TeacherService } from "./teacher/index.js";
export { TeacherRepository } from "./teacher/index.js";
```

### BR-RF-06: Actualizar imports externos
- `src/modules/index.ts`: el import `advisingRoutes` desde `./advising/index.js` no cambia (el `index.ts` sigue exportando `advisingRoutes`).
- Tests existentes: `test/advising.logic.test.ts` debe actualizar imports de `../src/modules/advising/advising.logic.js` a `../src/modules/advising/teacher/teacher.logic.js`.

## Verificación

- `bun run build` después de los movimientos.
- `bun test` — los tests existentes de `advising.logic.test.ts` deben pasar con los nuevos imports.
- Las rutas del docente deben seguir funcionando exactamente igual (`/advising/me/...`).
