# Base de datos ULima++ — documentación exhaustiva

*Actualizada 2026-07-12, verificada contra el schema (`src/db/schema/schema.ts`) y la BD viva (PostgreSQL 18.3 en AWS RDS). 34 tablas, 11 enums, 7 migraciones registradas.*

> **Para qué sirve este doc:** saber **dónde vive cada cosa**. Si te preguntas "¿dónde está el JP?", "¿dónde se guardan las notas?", "¿de dónde sale el delegado?" — la respuesta está aquí. Empieza por la sección [2. ¿Dónde vive cada cosa?](#2-dónde-vive-cada-cosa-faq).

---

## 1. Visión general

- **Motor:** PostgreSQL **18.3** (AWS RDS, `api-mobile-db.cbk2ge28uibe.us-east-2.rds.amazonaws.com:5432/postgres`, SSL requerido). Credenciales en `.env` (`DATABASE_URL`) — nunca commitearlas.
- **ORM:** Drizzle. El schema canónico es **`src/db/schema/schema.ts`** (fuente de verdad del modelo). Las relaciones drizzle están intencionalmente omitidas (`src/db/relations/index.ts`); los repos usan SQL parametrizado.
- **Migraciones:** carpeta `drizzle/` (`0000_baseline` = re-baseline TT04 del 2026-07-07 + incrementales). Flujo oficial: `bun run db:generate` → revisar el SQL → **backup** → `bun run db:migrate` (runner `src/db/migrate.ts`; el CLI `drizzle-kit migrate` NO se usa). `db:push` **prohibido**. Registro en `drizzle.__drizzle_migrations`. Runbook: `MIGRATIONS.md`.
- **Red:** el wifi de la ULima bloquea el puerto 5432 → conectarse con datos móviles. `pg_dump` local (v16 Homebrew) NO puede dumpear el server v18 (mismatch de versión); usar cliente pg18 o snapshot lógico de conteos si la migración es puramente aditiva.
- **Una sola BD compartida** entre todos los despliegues (el Vercel del fork de Ronald y cualquier entorno local apuntan a la misma RDS). Cuidado con datos de prueba.

### Mapa por dominios

```
IDENTIDAD            ACADÉMICO (catálogo)          MATRÍCULA / SECCIÓN            NOTAS
app_user ─┬─ student   career ─ curriculum          academic_period                assessment_type
          └─ teacher   curriculum_course            └ course_offering ─ syllabus   assessment (del syllabus)
user_social_link      course, specialty                └ section (teacher, jp)     student_score   (OFICIAL)
password_reset_token  course_prerequisite               └ enrollment (student)     simulated_grades (ALUMNO)
                      curriculum_course_specialty          └ section_representative
MALLA DEL ALUMNO                                           └ advising_rsvp (vía sesión)
student_specialty     HORARIO / ASESORÍAS           COMUNICACIÓN
student_course_progress  academic_week              announcement (del representante)
student_curriculum_simulation  schedule_session     alert (por alumno)
                      course_advising_session       [chatbot_session/message — fuera de schema, ver §6]
```

---

## 2. ¿Dónde vive cada cosa? (FAQ)

### 👤 ¿Dónde está el JP (jefe de práctica)?

**El JP NO es un rol guardado en ninguna persona. Es una columna de la sección: `section.jp_id` → FK a `teacher.id`.**

- Un JP **es una fila de `teacher`** como cualquier profesor. Lo que lo hace "JP" es que **alguna sección lo referencia en `jp_id`**.
- La misma persona podría ser profesor titular de una sección y JP de otra — la etiqueta se deriva **por sección**: si `section.teacher_id = X` ⇒ X es "Profesor" ahí; si `section.jp_id = X` ⇒ X es "JP" ahí. Regla en código: `case when sec.jp_id = :teacherId then 'JP' else 'Profesor' end`.
- Restricciones que lo gobiernan (en `section`):
  - `chk_section_jp_not_teacher`: el JP no puede ser el titular de su propia sección (`jp_id <> teacher_id`).
  - `uq_section_jp` (índice único parcial): **un JP pertenece a UNA sola sección** (ignora NULLs).
  - `jp_id` es **nullable**: la mayoría de secciones no tienen JP.
- Estado real hoy: **una sola sección con JP** — sección `id=1`, código **856** (INGENIERÍA DE SOFTWARE II): titular QUINTANA CRUZ (teacher 129, login `hquintan`), **JP = Lo Li, Aron (teacher 176, login `alo`)**.
- El **login** del JP no vive en `teacher` sino en `app_user`, enlazado por `teacher.user_id` (nullable: solo 2 de 175 teachers tienen cuenta). El JWT docente lleva `teacherId`, y `requireRole("teacher")` cubre a profesor y JP por igual; los permisos finos se comprueban contra `teacher_id`/`jp_id` de la sección.

### 📝 ¿Dónde se guardan las notas?

**En DOS tablas distintas, según quién las pone** (¡no mezclarlas!):

| Tabla | Quién escribe | Qué es | Módulo backend |
|---|---|---|---|
| **`student_score`** | El **profesor/JP** | Notas **OFICIALES** por evaluación | `official-grades` (HU29) |
| **`simulated_grades`** | El **propio alumno** | Notas **simuladas** de la calculadora (proyección) | `simulated-grades` (HU06) |

- Ambas cuelgan de `(enrollment_id, assessment_id)` con unique, `value` numeric(5,2) 0..20.
- **La nota final NO se almacena**: siempre se calcula en el cliente como promedio ponderado (Σ nota×peso/100, pesos de `assessment.weight`).
- Las evaluaciones en sí (`assessment`: código EV01…, nombre, semana, peso) cuelgan del **sílabo** (`syllabus`), no de la sección.

### 🧑‍🎓 ¿Dónde está el delegado / subdelegado?

En **`section_representative`**: fila con `section_id` + `enrollment_id` (la matrícula del alumno, no el alumno directo) + `position` (`delegate`/`subdelegate`) + `is_active`. Único parcial: una posición activa por sección. El "rol" `delegate`/`subdelegate` del JWT se **deriva** de esta tabla al loguear — no vive en `app_user`.

### 🔑 ¿Dónde viven las cuentas y roles?

- **`app_user`** = credenciales de TODOS (alumnos y docentes): `code` (login), `password_hash`, `google_id`, `token_version` (para invalidar JWTs), `networking_opt_in`.
- **`student`** (perfil académico, FK `user_id`) y **`teacher`** (FK `user_id` **nullable**) cuelgan de ella. El rol del JWT se deriva: si el `code` es de un student ⇒ alumno (o delegate/subdelegate según `section_representative`); si es de un teacher ⇒ `teacher`.
- No existe tabla de roles ni admin. Roles válidos: `student`, `delegate`, `subdelegate`, `teacher`.

### 🗓️ ¿Dónde está el horario?

- **Clases:** `schedule_session` (por sección: día 1–7, hora inicio/fin, aula, `color_hex` — el color del curso en la UI sale de aquí).
- **Semanas del ciclo:** `academic_week` (1–17 del período activo; la "semana 14" de una evaluación es `assessment.week_number` contra esto).
- **Asesorías:** `course_advising_session` — ver siguiente.

### 🤝 ¿Dónde están las asesorías?

En **`course_advising_session`**: cuelga de `course_offering` (y opcionalmente `section`), con `teacher_id` (quién la dicta), `kind` = `recurring` (semanal, `session_date` NULL) o `extra` (puntual, `session_date` obligatoria por CHECK), día/horas, `modality` (classroom/virtual/hybrid), `capacity` (NULL = sin límite). Las confirmaciones de asistencia (HU17) están en **`advising_rsvp`** (`advising_session_id` + `student_id`, único).
⚠️ El alumno las consume vía `/course-detail/sections/:id/advising` (módulo `course-detail`), NO vía `/advising/*` (que es solo docente).

### 🧩 ¿Dónde está la malla y el avance del alumno?

- **Catálogo:** `curriculum` (1 por carrera) → `curriculum_course` (curso posicionado: ciclo, orden, créditos, categoría) → `course_prerequisite` (tipo `course` o `completed_cycle`, con CHECKs de exclusión mutua).
- **Avance REAL:** `student_course_progress` (`in_progress/approved/failed/withdrawn`).
- **Simulación "¿y si…?" (HU19):** `student_curriculum_simulation` (`planned/simulated_completed/simulated_available`) — **nunca** modifica matrícula, notas ni progreso real.
- **Especialidades:** catálogo `specialty` (por carrera); elección del alumno en `student_specialty` (PK compuesta, única `primary` activa por alumno); cursos que aplican a una especialidad en `curriculum_course_specialty`.

### 📣 ¿Dónde están los anuncios y alertas?

- **`announcement`**: publicados por un **representante** (`section_representative_id` — o sea, salen de un delegado/subdelegado de la sección).
- **`alert`**: por alumno, `type` `academic_risk` (avance evaluado >55% y promedio <10.5) o `high_load` (3+ evaluaciones en una misma `academic_week`). También las usa `notify-grades` (aviso de notas publicadas, se detecta duplicado por **título**).

### 💬 ¿Dónde está el chat?

**NO está en esta BD.** El chat en vivo por sección (HU23) vive en **Firebase Realtime Database** (`ulima-plus-chat`); el backend solo emite tokens (`/chat/token`) y espeja miembros. En Postgres no hay tablas de chat. (Las tablas `chatbot_*` son otra cosa — ver §6.)

### 🔒 ¿Dónde están los tokens de reset de contraseña?

`password_reset_token`: hash SHA-256 del OTP de 6 dígitos (nunca en claro), `expires_at`, `used_at`, `attempts`.

---

## 3. Tablas, una por una

Formato: **tabla** — qué es. Columnas clave. Restricciones. Quién escribe / quién lee (módulo).

### Identidad

- **`app_user`** — credenciales y datos de cuenta de TODOS los usuarios. `code` (unique, login), `full_name`, `institutional_email` (unique), `password_hash` (bcrypt), `google_id`, `token_version` (invalida JWTs al rotar), `networking_opt_in` (carnet HU25, default false). *Escribe:* `auth` (google_id, token_version), `password-reset`. *Lee:* todos los módulos vía JWT.
- **`student`** — perfil académico del alumno. `user_id` (unique→app_user), `career_id`, `curriculum_id`, `current_level` (CHECK 1..10 o NULL), `specialty_setup_completed`. *Escribe:* `academic-profile` (setup). 201 filas.
- **`teacher`** — docentes (dato mayormente **referencial**: 175 filas, solo 2 con cuenta). `teacher_code` (unique, nullable), `full_name`, `institutional_email`, `user_id` (unique, **nullable** → app_user; solo si tiene login, HU18). *Escribe:* seeds. *Lee:* section, advising, official-grades, course-detail.
- **`user_social_link`** — redes del carnet networking (HU25). Una fila por (user, platform), enum `social_platform`. Mostrar solo si `networking_opt_in`. 0 filas aún.
- **`password_reset_token`** — OTPs de reset hasheados (SHA-256), con expiración, uso e intentos.

### Catálogo académico

- **`career`** — carreras. Hoy 1: `SIS` Ingeniería de Sistemas.
- **`curriculum`** — malla (1 por carrera, `career_id` unique). Hoy 1.
- **`course`** — catálogo global de cursos: `code` (unique), `name`, `default_credit` (CHECK >0), `origin_faculty` (cursos de otra facultad).
- **`curriculum_course`** — curso **posicionado en la malla**: `cycle`, `display_order`, `credit`, `category` (enum EEGG/común/facultad/electivo). Unique (curriculum, course). ⚠️ Casi todo el dominio malla referencia **esta** tabla (no `course`): prerequisitos, progreso, simulación, especialidades del curso.
- **`course_prerequisite`** — prerequisitos: tipo `course` (apunta a otro `curriculum_course`) o `completed_cycle` (exige ciclo N completo). CHECK de exclusión mutua entre ambas formas; sin auto-prerequisito.
- **`specialty`** — especialidades por carrera (7). `curriculum_course_specialty` — qué cursos de la malla pertenecen a cada especialidad (PK compuesta).

### Alumno: malla, especialidad, simulación

- **`student_specialty`** — elección del alumno: PK (student, specialty), `selection_type` (`primary`/`interest`), única `primary` activa por alumno (índice parcial).
- **`student_course_progress`** — avance REAL de malla: (student, curriculum_course) unique, enum `in_progress/approved/failed/withdrawn`. *Escribe:* seeds/HU04 (alcance en discusión). *Lee:* curriculum, malla del front.
- **`student_curriculum_simulation`** — simulación de malla HU19 (marcar aprobado/disponible hipotético). No toca datos reales. *Escribe/lee:* `curriculum` (`PUT/DELETE /curriculum/me/simulation`).

### Período, secciones, matrícula

- **`academic_period`** — ciclos. `is_active` con **único parcial: solo UN período activo**. Hoy: `2026-1` (2026-04-06 → 2026-07-30).
- **`academic_week`** — semanas 1..17 del período (unique por período+número). Da fechas a la "semana N" de las evaluaciones.
- **`course_offering`** — curso ofertado en un período: unique (period, course). El **sílabo y las asesorías cuelgan de aquí**, no de la sección.
- **`syllabus`** — sílabo del offering (unique 1:1): `drive_file_id`/`drive_file_url` (el PDF vive en Google Drive; el front lo renderiza).
- **`section`** — sección de un offering: `code` (ej. "856"), **`teacher_id`** (titular, NOT NULL) y **`jp_id`** (JP, nullable — ver FAQ §2). CHECKs: jp≠titular; JP en una sola sección.
- **`enrollment`** — matrícula (student, section) unique, `status` (`active/withdrawn/completed`), horas de asistencia (`attended/absent/total`, CHECK asistidas+ausentes ≤ total). **Es el ancla de casi todo lo "por alumno en un curso"**: notas (ambas tablas), representantes.
- **`section_representative`** — delegado/subdelegado (ver FAQ §2).

### Horario y asesorías

- **`schedule_session`** — bloques de clase por sección (día 1..7, horas, aula, `color_hex`). Unique (section, day, start).
- **`course_advising_session`** — asesorías (ver FAQ §2): recurrentes y extras, con únicos parciales por tipo y CHECK extra⇒fecha.
- **`advising_rsvp`** — "Asistiré" del alumno (HU17): unique (session, student), `created_at`.

### Notas

- **`assessment_type`** — catálogo de tipos (67: PROY, EXAM, etc.).
- **`assessment`** — evaluación del sílabo: `code` (EV01…, unique por syllabus), `name`, `week_number` (CHECK >0), `weight` (CHECK 0<w≤100). 315 filas.
- **`student_score`** — nota **OFICIAL** (profesor/JP, módulo `official-grades`): (enrollment, assessment) unique, `value` 0..20 **nullable** (histórico seed). *Escribe:* `PUT /official-grades/teacher/sections/:id/scores` (valida dueño de sección y pertenencia). *Lee:* alumno vía `GET /official-grades/me`; HU24 lee su "estado de carga".
- **`simulated_grades`** — nota **simulada del alumno** (calculadora, módulo `simulated-grades`): (enrollment, assessment) unique, `value` 0..20 **NOT NULL**, `updated_at`. *Escribe/lee:* solo el propio alumno (`GET/PUT/DELETE /simulated-grades/me`). Migración `0003`.

### Comunicación

- **`announcement`** — anuncios de representantes (HU12): FK a `section_representative`, `published_at`, `is_active`.
- **`alert`** — alertas por alumno (HU08 + notify-grades): enum `academic_risk`/`high_load`, `is_read`.

---

## 4. Enums (11)

| Enum | Valores | Usado en |
|---|---|---|
| `advising_kind` | `recurring`, `extra` | course_advising_session |
| `advising_modality` | `classroom`, `virtual`, `hybrid` | course_advising_session |
| `alert_type` | `academic_risk`, `high_load` | alert |
| `course_category` | `general_studies`, `common`, `faculty`, `elective` | curriculum_course |
| `curriculum_simulation_status` | `planned`, `simulated_completed`, `simulated_available` | student_curriculum_simulation |
| `enrollment_status` | `active`, `withdrawn`, `completed` | enrollment |
| `prerequisite_type` | `course`, `completed_cycle` | course_prerequisite |
| `representative_position` | `delegate`, `subdelegate` | section_representative |
| `social_platform` | `linkedin`, `instagram`, `github`, `x`, `website`, `other` | user_social_link |
| `student_course_status` | `in_progress`, `approved`, `failed`, `withdrawn` | student_course_progress |
| `student_specialty_type` | `primary`, `interest` | student_specialty |

---

## 5. Reglas de oro (invariantes de dominio)

1. **Notas oficiales ≠ simuladas**: el alumno jamás escribe `student_score`; el docente jamás escribe `simulated_grades`.
2. **La nota final no se persiste** — siempre ponderada en el cliente.
3. **El rol no se guarda**: `teacher` vs `student` por qué tabla enlaza `app_user`; Profesor vs JP por columna de `section`; delegado por `section_representative`.
4. **La simulación de malla no toca datos reales** (matrícula/progreso/notas).
5. **Un solo período activo** (índice único parcial) — todos los "del ciclo actual" filtran por él.
6. **`curriculum_course` es el eje de la malla**, no `course`.
7. **Todo lo "por alumno en un curso" ancla en `enrollment`**, no en (student, section) sueltos.
8. **IDs de autorización salen del JWT** (`studentId`/`teacherId`), nunca del body.

---

## 6. Discrepancias schema ↔ BD viva (estado 2026-07-12)

- **`chatbot_session` / `chatbot_message` existen en la BD pero NO en `src/db/schema/schema.ts`** (ni en las migraciones de este repo). Las creó el backend del chatbot (HU28) desarrollado en el fork de Ronald (`itsRon4ld`, rama `ronald` — cohere + rate-limit). FKs: session→student (CASCADE), message→session (CASCADE). Si el chatbot se adopta en meltiruiz, hay que incorporar estas tablas al schema y regularizar la migración; mientras tanto, `drizzle-kit generate` local NO las ve (cuidado: un `db:push` las destruiría — otra razón por la que está prohibido).
- `drizzle.__drizzle_migrations` registra **7** migraciones aunque este repo tiene 4 archivos (`0000`–`0003`): las extra son del fork de Ronald. El runner de drizzle no se confunde (aplica por hash), pero no "limpiar" esa tabla.

## 7. Operativa rápida

```bash
bun run db:generate        # generar migración desde schema.ts (revisar SQL SIEMPRE)
bun run db:migrate         # aplicar pendientes (runner src/db/migrate.ts)
bun run db:seed:docentes   # seed de docentes
# Conexión manual:
psql "$DATABASE_URL"       # requiere datos móviles (wifi ULima bloquea 5432)
```

- Backup pre-migración: cliente pg18 (`brew install postgresql@18`) o, si la migración es solo aditiva, snapshot de conteos (`SELECT relname, n_live_tup FROM pg_stat_user_tables`) + script de rollback.
- Freeze de DDL 48 h antes de una demo.
- Cuentas de prueba: alumno RONALD HURTADO (`20231483`, student 2); docentes `hquintan` (titular 856) y `alo` (JP 856). Las contraseñas NO se documentan aquí: se fijan vía env (`PROF_PASSWORD`/`JP_PASSWORD`) al correr el seed y se comunican fuera de banda.
