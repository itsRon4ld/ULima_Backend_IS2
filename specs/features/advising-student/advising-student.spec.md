---
name: Advising Student — RSVP del alumno
description: Listado de asesorías y confirmación/cancelación de asistencia del alumno (HU17). Sub-módulo `student/` dentro de `src/modules/advising/`.
targets:
  - ../../../src/modules/advising/student/**
  - ../../../src/modules/advising/index.ts
  - ../../../src/modules/course-detail/course-detail.routes.ts
  - ../../../src/modules/course-detail/course-detail.repository.ts
  - ../../../src/modules/course-detail/course-detail.service.ts
  - ../../../src/modules/index.ts
  - ../../../test/student-advising.logic.test.ts
  - ../../../test/student-advising.rsvp.test.ts
---

# Advising Student — RSVP del alumno

Sub-módulo `student/` dentro de `src/modules/advising/`. Reemplaza los endpoints de asesorías y RSVP que vivían en `course-detail`.

## User Stories

| ID | Description |
| --- | --- |
| HU17 | Como alumnado, quiero confirmar si asistiré a una asesoría de mis cursos y poder retirar esa confirmación, para que el docente sepa con cuántos alumnos contará. |

## Modelo de dominio

### BR-AS-01: Roles permitidos
- Solo tokens con `studentId` (roles `student`, `delegate`, `subdelegate`) pueden listar y hacer RSVP.
- Un token docente no lleva `studentId` → `403 RSVP_STUDENT_ONLY` en cualquier endpoint.
- `authMiddleware` + `requireRole('student', 'delegate', 'subdelegate')` en el sub-router `student/`.

### BR-AS-02: Asesorías visibles para el alumno
- El alumno ve asesorías donde `cas.course_offering_id` coincide con el de su sección, y `cas.section_id IS NULL` (curso completo) o `cas.section_id = sectionId` (su sección específica).
- Se listan tanto `kind = 'recurring'` como `kind = 'extra'`.
- **No se listan asesorías ya pasadas** (ver BR-AS-05).
- Orden: extras primero (por `session_date, start_time`), luego recurrentes (por `day_of_week, start_time`).

### BR-AS-03: Confirmar asistencia
- `POST /advising/:sessionId/rsvp` con `studentId` del JWT, nunca del body.
- Solo si el alumno participa de la asesoría (matrícula activa en una sección que comparte `course_offering_id` y respeta `section_id` si está fijo). Si no participa → `404 SESSION_NOT_FOUND`.
- **No se puede confirmar si la asesoría ya pasó** → `409 SESSION_ALREADY_PAST` (ver BR-AS-05).
- Idempotente: `INSERT ... ON CONFLICT (advising_session_id, student_id) DO NOTHING`.
- Response `200`: `{ "id": string, "asistentes": number, "myRsvp": true }`.

### BR-AS-04: Cancelar asistencia
- `DELETE /advising/:sessionId/rsvp` con `studentId` del JWT.
- Siempre permitido, incluso en asesorías pasadas.
- Idempotente: cancelar sin confirmación previa es no-op.
- Response `200`: `{ "id": string, "asistentes": number, "myRsvp": false }`.

### BR-AS-05: Detección de asesoría pasada
Función pura en `student.logic.ts`:
```
isSessionPast(session, now: Date): boolean
```

| Tipo | Condición | Resultado |
|------|-----------|-----------|
| `extra` | `session_date < today` | `true` |
| `extra` | `session_date = today AND end_time <= now` | `true` |
| `extra` | resto de casos | `false` |
| `recurring` | `day_of_week = today(ISODOW) AND end_time <= now` | `true` |
| `recurring` | resto de casos | `false` |
| cualquier | `start_time` o `end_time` nulos (defensivo) | `false` |

- `ISODOW`: 1 = Lunes … 7 = Domingo (coincide con `day_of_week` del schema).
- Se usa en: (a) `repository.findBySection` para filtrar del listado, (b) `service.confirmRsvp` para rechazar el POST.

### BR-AS-06: Conteo de asistentes y myRsvp
- `asistentes`: `SELECT COUNT(*) FROM advising_rsvp WHERE advising_session_id = $1`.
- `myRsvp`: `EXISTS (SELECT 1 FROM advising_rsvp WHERE advising_session_id = cas.id AND student_id = $studentId)`. Solo se evalúa si hay `studentId`; con docente es `false`.
- Ambos se recalculan tras cada operación de escritura y se devuelven en el response.

## Endpoints — sub-router `student/`

Montado en `src/modules/advising/index.ts` con `requireRole('student', 'delegate', 'subdelegate')`.

### BR-AS-10: GET /advising/section/:sectionId
Lista asesorías (recurrentes + extras) visibles para la sección, excluyendo pasadas.

- **Params** (Zod): `sectionId: z.coerce.number().int().positive()`
- **Response 200**:
```json
{
  "asesorias": [
    {
      "id": "string",
      "courseId": "string",
      "docenteCode": "string",
      "docente": { "code": "string", "firstName": "string", "lastName": "string" },
      "dia": "Lunes" | "Martes" | "Miércoles" | "Jueves" | "Viernes" | "Sábado" | "Domingo",
      "inicio": "HH:MM:SS",
      "fin": "HH:MM:SS",
      "aula": "string",
      "zoom": "string",
      "kind": "recurring" | "extra",
      "fecha": "YYYY-MM-DD" | null,
      "dictanteRol": "Profesor" | "JP",
      "asistentes": "number",
      "myRsvp": "boolean"
    }
  ]
}
```

### BR-AS-11: POST /advising/:sessionId/rsvp
Confirma asistencia del alumno autenticado.

- **Params** (Zod): `sessionId: z.coerce.number().int().positive()`
- **Response 200**: `{ "id": "string", "asistentes": "number", "myRsvp": true }`
- **Errores**:
  - `403 RSVP_STUDENT_ONLY` — token sin `studentId` (docente)
  - `404 SESSION_NOT_FOUND` — sesión inexistente o alumno no participa
  - `409 SESSION_ALREADY_PAST` — la asesoría ya ocurrió

### BR-AS-12: DELETE /advising/:sessionId/rsvp
Cancela asistencia del alumno autenticado.

- **Params** (Zod): `sessionId: z.coerce.number().int().positive()`
- **Response 200**: `{ "id": "string", "asistentes": "number", "myRsvp": false }`
- **Errores**:
  - `403 RSVP_STUDENT_ONLY` — token sin `studentId` (docente)

## Arquitectura

Sub-módulo `src/modules/advising/student/` con `routes → controller → service → repository`.
El service recibe `repository + EventBus` y NO importa `db` directamente. El repository usa SQL parametrizado con Drizzle.

### Archivos

| Archivo | Responsabilidad |
|---------|----------------|
| `student/index.ts` | Wiring (repo → service → controller → routes) |
| `student/student.routes.ts` | Hono: 3 endpoints con `requireRole('student',...)` |
| `student/student.schemas.ts` | Zod: `sectionIdParamSchema`, `sessionIdParamSchema` |
| `student/student.types.ts` | DTOs: `RawAdvisingRow`, `AdvisingResponse`, `AdvisingResult`, `RsvpResult` |
| `student/student.controller.ts` | Adaptador HTTP, `requireStudentId()` |
| `student/student.service.ts` | Lógica: `getAdvising`, `confirmRsvp`, `cancelRsvp` |
| `student/student.repository.ts` | SQL: `findBySection`, `findSessionById`, `isParticipant`, `insertRsvp`, `deleteRsvp`, `countRsvp` |
| `student/student.logic.ts` | Función pura: `isSessionPast(session, now)` |

### Montaje en `advising/index.ts`

```ts
const app = new Hono();
app.route("/me", teacherRoutes);        // requireRole('teacher')
app.route("/", studentRoutes);          // requireRole('student', ...)
```

Esto produce las rutas `/advising/me/...` (docente) y `/advising/section/...`, `/advising/:sessionId/rsvp` (alumno).

### Limpieza de course-detail

Se eliminan de `src/modules/course-detail/course-detail.routes.ts`:
- `app.get("/sections/:sectionId/advising", ...)` — movido a `GET /advising/section/:sectionId`
- `app.post("/advising/:sessionId/rsvp", ...)` — movido a `POST /advising/:sessionId/rsvp`
- `app.delete("/advising/:sessionId/rsvp", ...)` — movido a `DELETE /advising/:sessionId/rsvp`
- Funciones inline `splitName` duplicadas en routes.

Se eliminan de `course-detail.repository.ts` y `course-detail.service.ts` los métodos: `isAdvisingParticipant`, `insertRsvp`, `deleteRsvp`, `countRsvp`.

Se elimina `test/course-detail.rsvp.test.ts`.

## Tests

### test/student-advising.logic.test.ts
[@test] `../../../test/student-advising.logic.test.ts`
1. Extra con `session_date` < hoy → `true`
2. Extra con `session_date` = hoy y `end_time` < ahora → `true`
3. Extra con `session_date` = hoy y `end_time` > ahora → `false`
4. Extra con `session_date` > hoy → `false`
5. Recurrente con `day_of_week` = hoy y `end_time` < ahora → `true`
6. Recurrente con `day_of_week` = hoy y `end_time` > ahora → `false`
7. Recurrente con `day_of_week` ≠ hoy → `false`
8. `start_time` o `end_time` nulos → `false` (defensivo)

### test/student-advising.rsvp.test.ts
[@test] `../../../test/student-advising.rsvp.test.ts`
1. confirmar exitoso → inserta + conteo + `myRsvp: true`
2. confirmar sin participación → `404 SESSION_NOT_FOUND`
3. confirmar sesión pasada → `409 SESSION_ALREADY_PAST`
4. confirmar idempotente (dos veces) → mismo conteo
5. cancelar exitoso → borra + conteo + `myRsvp: false`
6. cancelar sin confirmación previa → no-op, `myRsvp: false`
7. docente intenta confirmar → `403 RSVP_STUDENT_ONLY`
8. docente intenta cancelar → `403 RSVP_STUDENT_ONLY`
9. GET mapea `myRsvp` correctamente (true / false / null→false)

## Seguridad

- `studentId` siempre del JWT, nunca del body ni params.
- `requireRole('student','delegate','subdelegate')` en el sub-router.
- Ningún endpoint expone datos de otros alumnos; el conteo `asistentes` es agregado (COUNT sin nombres).
- El repository usa SQL parametrizado.
