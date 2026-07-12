---
name: Course Detail
description: Consulta de secciones, docentes, matrículas, anuncios, asesorías y contactos de curso (solo lectura)
targets:
  - ../../../src/modules/course-detail/**
  - ../../../src/shared/middleware/auth-middleware.ts
---

# Course Detail

## Scope

Endpoints de solo lectura que exponen el detalle académico de cursos/secciones. Los payloads de request/response están definidos en `docs/specs/api-contracts.md`; esta spec fija la **autorización** requerida.

## Business Rules

### BR-COURSE-DETAIL-01: Autenticación obligatoria
- Todas las rutas de `course-detail` requieren `Authorization: Bearer <JWT>` y pasan por `authMiddleware` (`app.use("*", authMiddleware)`).
- Exponen datos sensibles (secciones, docentes, matrículas con códigos de alumno, contactos): no deben ser accesibles sin sesión válida.
- Si falta el token → `401 MISSING_TOKEN`; si es inválido/expirado/revocado → `401 INVALID_TOKEN`.

### BR-COURSE-DETAIL-02: Sub-petición interna autenticada
- `GET /course-detail/sections/:sectionId` resuelve su data reutilizando `GET /course-detail/sections` mediante una sub-petición interna; ésta debe **reenviar el header `Authorization`** para no fallar el `authMiddleware`.

### BR-COURSE-DETAIL-03: Solo roles de alumno (HU18)
- Todo el módulo agrega `requireRole('student','delegate','subdelegate')`: un token docente recibe `403 FORBIDDEN` (las vistas de docente viven en `/advising/me/*`).

### BR-COURSE-DETAIL-04: Asesorías migradas al módulo advising (HU17)
- El listado de asesorías y el RSVP del alumno migraron a `src/modules/advising/student/` (rutas `/advising/section/...`, `/advising/:sessionId/rsvp`). Ver spec en `specs/features/advising-student/advising-student.spec.md`.
- `GET /course-detail/sections/:sectionId/advising` queda **eliminado** de este módulo.

### BR-COURSE-DETAIL-05: JP en contactos (HU18)
- `GET /course-detail/sections/:sectionId/contacts` agrega la clave top-level `jefePractica` (`{ code, lastName, firstName }` o `null`), derivada de `section.jp_id`.

## Endpoints

Todos bajo `Authorization: Bearer <token>` (ver detalle de payloads en `docs/specs/api-contracts.md`):

- `GET /course-detail/sections`
- `GET /course-detail/sections/:sectionId`
- `GET /course-detail/sections/:sectionId/announcements`
- `GET /course-detail/sections/:sectionId/advising`
- `GET /course-detail/sections/:sectionId/contacts`
- `GET /course-detail/teachers`
- `GET /course-detail/enrollments`

## Notes

- La autorización fina por usuario/rol (que cada alumno solo vea lo que le corresponde) queda como deuda pendiente; esta spec solo garantiza autenticación.

## Test Links

*(No hay tests automatizados enlazados aún.)*
