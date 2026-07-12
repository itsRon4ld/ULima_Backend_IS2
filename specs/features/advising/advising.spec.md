---
name: Advising (docentes y asesorías extra)
description: Rol docente (profesor/JP), asesorías extra puntuales con cupo y conteo de asistentes (HU18)
targets:
  - ../../../src/modules/advising/**
  - ../../../src/modules/course-detail/**
  - ../../../src/shared/middleware/auth-middleware.ts
  - ../../../src/db/schema/schema.ts
---

# Advising — docentes y asesorías extra

Diseño de origen: `~/Desktop/ULIMA++/DISENO_PROFESORES.md` (aprobado 2026-07-05, consejo del JP incluido). Issues: HU18 (frontend #89), HU18_Backend (backend #30), HU18_Frontend (frontend #90).

## User Stories

| ID | Description |
| --- | --- |
| HU18 | Como docente de una sección (profesor o jefe de práctica), quiero iniciar sesión y publicar asesorías extra para mi sección, para reforzar temas antes de las evaluaciones y saber cuántos alumnos asistirán. |

## Modelo de dominio

### BR-ADV-01: Rol técnico único `teacher`, etiqueta derivada
- Profesor y JP comparten el rol técnico `teacher` (ver spec de auth). **No existe enum de tipo docente en la persona**: la etiqueta se deriva de qué columna de `section` referencia al `teacher`.
- `section.teacher_id` → etiqueta **"Profesor"**; `section.jp_id` → etiqueta **"JP"** (display largo: "Jefe de Práctica").
- Derivación de la etiqueta global de un docente (para header/login): si su `teacher.id` aparece como `jp_id` de alguna sección → "JP"; en caso contrario → "Profesor".

### BR-ADV-02: Reglas de exclusividad del JP (constraints de BD)
- Una sección tiene 0 o 1 JP: columna nullable `section.jp_id REFERENCES teacher(id)`.
- El JP no es el profesor de su propia sección: `CHECK (jp_id IS NULL OR jp_id <> teacher_id)`.
  `[@test] ../../../test/advising.logic.test.ts` (caso 3: jp igual a teacher → rechazado)
- Un JP pertenece estrictamente a UNA sección: `CREATE UNIQUE INDEX uq_section_jp ON section(jp_id) WHERE jp_id IS NOT NULL`.
- **Regla de ciclo** (cross-tabla, se valida en lógica de servicio/seed, no en DDL): una persona que figura como `teacher_id` de alguna sección del período activo no puede ser asignada como `jp_id` en ese mismo período.
  `[@test] ../../../test/advising.logic.test.ts` (caso 5)
- El aprovisionamiento de docentes/JP es un proceso administrativo fuera del alcance del producto: se hace por seed aprobado (`src/db/seed/docentes.ts`, ejecutado con `bun run db:seed:docentes`). No hay endpoints de alta.

### BR-ADV-02b: Convención de cuentas docentes (seed)
- **Usuario** (`app_user.code`) = `[primera letra del nombre][apellido paterno]`, en minúsculas, sin tildes, con tope de 8 caracteres — derivado de `teacher.full_name` como `(inicial + apellidoPaternoSinTildes).toLowerCase().slice(0,8)` (ej. "H. Quintana" → `hquintan`).
- **Correo institucional** (`app_user.institutional_email`) = `<usuario>@ulima.edu.pe` (dominio docente, distinto del `@aloe.ulima.edu.pe` de alumnos). El docente puede entrar con Google SSO si su cuenta ya está vinculada mediante `teacher.user_id`; código + contraseña permanece como alternativa.
- **Contraseña** (bcrypt costo 10): profesores `profesor2026`, JPs `jefe2026`.
- Datos concretos de la demo: JP **Aaron Lo Li** → usuario `alo`, `alo@ulima.edu.pe`, `jefe2026`, asignado a la sección de ISW2 de Jeff. El profesor de esa sección ya existe en `teacher`; su cuenta se genera con la misma convención sobre su `full_name` real.

### BR-ADV-03: Asesorías extra (extensión de `course_advising_session`)
- Enum nuevo `advising_kind` = `recurring | extra`. Columna `kind` NOT NULL DEFAULT `'recurring'` — las filas existentes siguen siendo recurrentes.
- `session_date date` (solo para extras: fecha puntual), `capacity integer` (cupo opcional, `CHECK capacity > 0`).
- `CHECK (kind <> 'extra' OR session_date IS NOT NULL)`.
- Para extras, `day_of_week` se deriva de `session_date` (ISO: 1=Lunes … 7=Domingo) al crearla, para que las vistas existentes que ordenan/muestran por día sigan funcionando.
- Los índices únicos existentes `uq_course_advising_session_course` y `uq_course_advising_session_section` se **re-alcance a `kind = 'recurring'`** (dos extras de fechas distintas pueden caer el mismo día de semana a la misma hora). Se agrega unicidad propia de extras: `(section_id, teacher_id, session_date, start_time) WHERE kind = 'extra'`.
- ⚠️ Esto implica `DROP INDEX` + `CREATE INDEX` (metadato, sin pérdida de datos), señalado explícitamente en la migración para aprobación.

### BR-ADV-04: RSVP (tabla compartida con HU17)
- Tabla nueva `advising_rsvp (id, advising_session_id FK, student_id FK, created_at, UNIQUE(advising_session_id, student_id))`.
- HU18 solo la **lee** (conteo y lista de asistentes). Los endpoints de escritura del alumno (confirmar/cancelar) son de **HU17** → BR-ADV-22 (viven en `course-detail`, no en `advising`, porque este módulo está gateado a `teacher`).

## Endpoints — módulo `src/modules/advising/` (capas limpias)

Todos con `authMiddleware` + `requireRole('teacher')`. Un token de alumno recibe `403 FORBIDDEN`.

### BR-ADV-10: GET /advising/me/sections
Secciones donde el docente autenticado dicta (como profesor o JP), para el formulario de creación.
- **Response 200**: `{ "secciones": [ { "sectionId", "courseOfferingId", "courseName", "sectionCode", "rol": "Profesor"|"JP" } ] }`
- Solo secciones del período académico activo.

### BR-ADV-11: GET /advising/me/sessions
Asesorías del docente autenticado (recurrentes + extras), con conteo de confirmados.
- **Response 200**: `{ "sesiones": [ { "id", "sectionId", "courseOfferingId", "courseName", "sectionCode", "kind": "recurring"|"extra", "dia": "Lunes".."Domingo", "fecha": "YYYY-MM-DD"|null, "inicio", "fin", "modality", "aula", "zoom", "nota", "cupo": number|null, "asistentes": number, "rol": "Profesor"|"JP" } ] }`
- `asistentes` = COUNT de `advising_rsvp` por sesión. `rol` según BR-ADV-01 respecto de la sección de la sesión.
- Orden: extras próximas primero (por `session_date, start_time`), luego recurrentes (por `day_of_week, start_time`).

### BR-ADV-12: POST /advising/me/sessions — crear asesoría extra
- **Body** (Zod): `{ "sectionId": int>0, "sessionDate": "YYYY-MM-DD", "startTime": "HH:MM", "endTime": "HH:MM", "modality": "classroom"|"virtual"|"hybrid", "classroom"?: string≤100, "meetingUrl"?: string≤255, "note"?: string, "capacity"?: int>0 }`
- Validaciones de negocio (en `advising.service` con lógica pura en `advising.logic.ts`):
  1. La sección existe y el docente autenticado es su `teacher_id` o su `jp_id`; si no → `403 SECTION_FORBIDDEN`. (Cubre casos 1, 2 y 4 del issue #30: el JP publica en SU sección; en otra → 403.)
     `[@test] ../../../test/advising.logic.test.ts` (casos 1, 2, 4)
  2. `startTime < endTime` → si no, `400 INVALID_TIME_RANGE`.
  3. `sessionDate` dentro del período académico activo (`start_date ≤ sessionDate ≤ end_date`) y no anterior a hoy → `400 DATE_OUT_OF_PERIOD` / `400 DATE_IN_PAST`.
  4. Sin solape con otra asesoría del mismo docente ese día: contra extras propias de la misma `session_date` y contra recurrentes propias del mismo día de semana. Solape = `startA < endB AND startB < endA` → `409 ADVISING_OVERLAP`.
     `[@test] ../../../test/advising.logic.test.ts` (solape: antes/después/contenido/bordes)
  5. `modality = 'classroom'` requiere `classroom`; `'virtual'` requiere `meetingUrl`; `'hybrid'` requiere al menos uno → `400 MISSING_LOCATION`.
  6. Si no hay período académico activo → `409 NO_ACTIVE_PERIOD`.
- Inserta con `kind='extra'`, `day_of_week` derivado de la fecha, `course_offering_id` de la sección.
- **Response 201**: `{ "sesion": { …mismo shape que BR-ADV-11… } }`
- Guarda defensiva común a todo el módulo: si el contexto no trae `teacherId` (no debería ocurrir tras `authMiddleware`+`requireRole('teacher')`) → `401 TEACHER_NOT_FOUND`.

### BR-ADV-13: DELETE /advising/me/sessions/:id
- Si la sesión no existe → `404 ADVISING_NOT_FOUND`.
- Si existe pero `teacher_id` no es el docente autenticado → `403 FORBIDDEN` (caso 7: el JP no borra las del profesor y viceversa).
  `[@test] ../../../test/advising.logic.test.ts` (caso 7)
- Si es `kind='recurring'` → `409 ONLY_EXTRA_DELETABLE` (las recurrentes son carga administrativa).
- Borra también los RSVP asociados (delete en cascada explícito en la misma transacción).
- **Response 200**: `{ "message": "Asesoría eliminada." }`

### BR-ADV-14: GET /advising/me/sessions/:id/attendees
- Mismo control de existencia/propiedad que BR-ADV-13 (404/403).
- **Response 200**: `{ "total": number, "asistentes": [ { "code", "firstName", "lastName" } ] }` ordenado por apellido.

## Vista del alumno — sub-módulo `advising/student/` (HU17)

El listado de asesorías y RSVP del alumno viven en `src/modules/advising/student/`. Ver spec completa en `specs/features/advising-student/advising-student.spec.md`.

### BR-ADV-21: GET /course-detail/sections/:sectionId/contacts
Agrega clave top-level `"jefePractica": { "code", "lastName", "firstName" } | null` (desde `section.jp_id`), entre `docente` y `alumnos`. (Caso 8: JP visible en Contactos.)

## Arquitectura

- Módulo nuevo `src/modules/advising/` con `routes → controller → service → repository` (patrón de `alerts`, el módulo canónico): el service recibe repository + EventBus y NO importa `db`; el repository usa SQL parametrizado con Drizzle.
- Lógica pura testeable en `advising.logic.ts` (sin I/O): validación de rango horario, solape, derivación de día desde fecha, validación de fecha en período, regla de ciclo del JP, validación de ubicación por modalidad. Es la superficie de pruebas de caja blanca (CC > 4) y unitarias (≥ 4 casos) exigidas por la rúbrica.
  `[@test] ../../../test/advising.logic.test.ts`
- Montaje en `src/modules/index.ts`: `app.route("/advising", advisingRoutes)`.

## Seguridad

- `requireRole('teacher')` en todo el módulo; los módulos de alumno (`schedule`, `curriculum`, `alerts`, `grades`, `academic-profile`, `course-detail`, `section-management`) agregan `requireRole('student','delegate','subdelegate')` — un token docente recibe 403 en vez de ejecutar queries con `studentId` NaN (ver spec de auth).
- Ningún endpoint expone `password_hash` ni datos de otros docentes; la lista de asistentes solo la ve el docente dueño de la sesión.
