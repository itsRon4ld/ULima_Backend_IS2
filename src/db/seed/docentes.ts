// Seed HU18 — cuentas docentes (profesor + JP) para la sección de ISW2 de Jeff.
//
// Human-gated: se corre con datos móviles (el wifi de la ULima bloquea el 5432),
// con backup previo, DESPUÉS de aplicar la migración 0004 y ANTES del deploy.
//
//   bun run src/db/seed/docentes.ts            # DRY-RUN: imprime el plan, no escribe
//   bun run src/db/seed/docentes.ts --apply    # aplica en una transacción
//
// Overrides por variable de entorno (por si la derivación automática no calza
// con el nombre real del profesor en la BD):
//   STUDENT_CODE=20235218      código del alumno cuya sección de ISW2 se usa
//   TARGET_SECTION_ID=123      fija la sección objetivo (si hay ambigüedad)
//   PROF_USERNAME=hquintan     fuerza el usuario del profesor
//   JP_FULLNAME="Lo Li, Aron" nombre del JP (formato "Apellidos, Nombres")
//   JP_USERNAME=alo            fuerza el usuario del JP
//
// Contraseñas (REQUERIDAS, sin default en el código para no versionar credenciales):
//   PROF_PASSWORD=...          contraseña de la cuenta del profesor
//   JP_PASSWORD=...            contraseña de la cuenta del JP
//
// Convención de cuenta docente: usuario = inicial del nombre + apellido paterno
// (minúsculas, sin tildes, máx 8 chars); correo <usuario>@ulima.edu.pe;
// contraseña vía env PROF_PASSWORD/JP_PASSWORD (requeridas), bcrypt costo 10.

import "dotenv/config";
import postgres from "postgres";
import bcrypt from "bcryptjs";

// Conexión propia (no importa la config/db de la app, que exige JWT_SECRET y
// otras vars que este seed no usa). Misma URL y mismo driver que producción,
// así que si la app conecta, este script también. Requiere datos móviles: el
// wifi de la ULima bloquea el 5432.
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ Falta DATABASE_URL en .env");
  process.exit(1);
}
const sql = postgres(DATABASE_URL);

const APPLY = process.argv.includes("--apply");
const STUDENT_CODE = process.env.STUDENT_CODE ?? "20235218";
const TARGET_SECTION_ID = process.env.TARGET_SECTION_ID ? Number(process.env.TARGET_SECTION_ID) : null;
const JP_FULLNAME = process.env.JP_FULLNAME ?? "Lo Li, Aron";
// Contraseñas: se leen del entorno, SIN default hardcodeado, para no versionar
// credenciales en un repo público. Definir antes de correr el seed.
const PROF_PASSWORD = process.env.PROF_PASSWORD;
const JP_PASSWORD = process.env.JP_PASSWORD;
if (!PROF_PASSWORD || !JP_PASSWORD) {
  console.error(
    "❌ Falta PROF_PASSWORD y/o JP_PASSWORD en el entorno. " +
      "Defínelas (p.ej. PROF_PASSWORD=... JP_PASSWORD=... bun run src/db/seed/docentes.ts) antes de correr el seed.",
  );
  process.exit(1);
}
/** Enmascara una contraseña para logs (muestra 2 chars + ****). */
const mask = (s: string) => (s.length <= 2 ? "****" : `${s.slice(0, 2)}****`);
const BCRYPT_COST = 10;
const EMAIL_DOMAIN = "@ulima.edu.pe";

const stripDiacritics = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** usuario = inicial(nombre) + apellido paterno, minúsculas, sin tildes, ≤8. */
function deriveUsername(fullName: string): string {
  const raw = fullName.trim();
  let firstName = "";
  let paternalSurname = "";
  if (raw.includes(",")) {
    // "Apellidos, Nombres" → paterno = 1er apellido, nombre = 1er nombre.
    const [surnames, names] = raw.split(",");
    paternalSurname = (surnames ?? "").trim().split(/\s+/)[0] ?? "";
    firstName = (names ?? "").trim().split(/\s+/)[0] ?? "";
  } else {
    // "Nombres Apellidos" → nombre = 1er token, paterno = 2do token
    // (coherente con el ejemplo institucional hquintan = H + Quintan(a)).
    const tokens = raw.split(/\s+/);
    firstName = tokens[0] ?? "";
    paternalSurname = tokens[1] ?? "";
  }
  const user = stripDiacritics(`${firstName.charAt(0)}${paternalSurname}`)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return user.slice(0, 8);
}

type SectionRow = {
  section_id: number;
  section_code: string;
  course_name: string;
  teacher_id: number;
  teacher_name: string;
  jp_id: number | null;
};

async function main() {
  console.log(`\n=== Seed docentes HU18 — ${APPLY ? "APPLY" : "DRY-RUN"} ===\n`);

  const period = (await sql`
    select id, code from academic_period where is_active = true limit 1
  `) as unknown as Array<{ id: number; code: string }>;
  if (period.length === 0) throw new Error("No hay período académico activo.");
  const periodId = period[0].id;
  console.log(`Período activo: ${period[0].code} (id=${periodId})`);

  // Secciones donde Jeff está matriculado (activo) en el período activo.
  const sections = (await sql`
    select sec.id as section_id, sec.code as section_code, c.name as course_name,
           sec.teacher_id, t.full_name as teacher_name, sec.jp_id
    from app_user au
    join student st on st.user_id = au.id
    join enrollment e on e.student_id = st.id and e.status = 'active'
    join section sec on sec.id = e.section_id
    join course_offering co on co.id = sec.course_offering_id and co.academic_period_id = ${periodId}
    join course c on c.id = co.course_id
    join teacher t on t.id = sec.teacher_id
    where au.code = ${STUDENT_CODE}
    order by c.name
  `) as unknown as SectionRow[];

  if (sections.length === 0) {
    throw new Error(`El alumno ${STUDENT_CODE} no tiene secciones activas en el período.`);
  }

  console.log(`\nSecciones activas de ${STUDENT_CODE}:`);
  for (const s of sections) {
    console.log(`  [${s.section_id}] ${s.course_name} — sec ${s.section_code} — prof ${s.teacher_name} (teacher_id=${s.teacher_id})${s.jp_id ? ` — jp_id=${s.jp_id}` : ""}`);
  }

  // Elegir la sección objetivo: por TARGET_SECTION_ID, o la que parezca ISW2.
  let target: SectionRow | undefined;
  if (TARGET_SECTION_ID) {
    target = sections.find((s) => s.section_id === TARGET_SECTION_ID);
    if (!target) throw new Error(`TARGET_SECTION_ID=${TARGET_SECTION_ID} no está entre las secciones del alumno.`);
  } else {
    const isw2 = sections.filter((s) => /software\s*(ii|2)|ingenier[ií]a de software\s*(ii|2)/i.test(s.course_name));
    if (isw2.length === 1) {
      target = isw2[0];
    } else if (isw2.length > 1) {
      throw new Error(`Varias secciones parecen ISW2: ${isw2.map((s) => s.section_id).join(", ")}. Fija TARGET_SECTION_ID.`);
    } else {
      throw new Error(`No se detectó la sección de ISW2 automáticamente. Fija TARGET_SECTION_ID con una de las de arriba.`);
    }
  }
  console.log(`\nSección objetivo: [${target.section_id}] ${target.course_name} (sec ${target.section_code})`);

  // --- Plan de cuentas ---
  const profUsername = process.env.PROF_USERNAME ?? deriveUsername(target.teacher_name);
  const profEmail = `${profUsername}${EMAIL_DOMAIN}`;
  const jpUsername = process.env.JP_USERNAME ?? deriveUsername(JP_FULLNAME);
  const jpEmail = `${jpUsername}${EMAIL_DOMAIN}`;

  console.log(`\nPlan:`);
  console.log(`  Profesor: ${target.teacher_name}`);
  console.log(`    usuario=${profUsername}  correo=${profEmail}  pass=${mask(PROF_PASSWORD)}`);
  console.log(`    → app_user + teacher(id=${target.teacher_id}).user_id`);
  console.log(`  JP: ${JP_FULLNAME}`);
  console.log(`    usuario=${jpUsername}  correo=${jpEmail}  pass=${mask(JP_PASSWORD)}`);
  console.log(`    → teacher nuevo + app_user + section(${target.section_id}).jp_id`);

  // Regla de ciclo: el JP no debe ser profesor de ninguna sección del período.
  // (El JP es un teacher nuevo, así que trivial; se valida igual para el caso
  // en que JP_USERNAME/JP_FULLNAME apunte a alguien ya existente.)
  const jpConflict = (await sql`
    select sec.id from section sec
    join course_offering co on co.id = sec.course_offering_id and co.academic_period_id = ${periodId}
    join teacher t on t.id = sec.teacher_id
    where lower(t.institutional_email) = lower(${jpEmail})
    limit 1
  `) as unknown as Array<{ id: number }>;
  if (jpConflict.length > 0) {
    throw new Error(`Regla de ciclo violada: ${jpEmail} ya es profesor de una sección del período activo; no puede ser JP.`);
  }

  if (!APPLY) {
    console.log(`\n(DRY-RUN) No se escribió nada. Revisa el plan y corre con --apply.\n`);
    return;
  }

  const profHash = await bcrypt.hash(PROF_PASSWORD, BCRYPT_COST);
  const jpHash = await bcrypt.hash(JP_PASSWORD, BCRYPT_COST);

  // Transacción de postgres.js: el callback recibe un `sql` ligado a una única
  // conexión; si algo lanza, hace ROLLBACK automático. (No usar BEGIN crudo
  // sobre el pool: postgres.js lo prohíbe con max>1.)
  let jpTeacherId = 0;
  await sql.begin(async (tx) => {
    // 1. Cuenta del profesor existente (idempotente por code).
    const profUser = (await tx`
      insert into app_user (code, full_name, institutional_email, password_hash, token_version)
      values (${profUsername}, ${target.teacher_name}, ${profEmail}, ${profHash}, 1)
      on conflict (code) do update set code = excluded.code
      returning id
    `) as unknown as Array<{ id: number }>;
    const profUserId = profUser[0].id;
    await tx`
      update teacher set user_id = ${profUserId} where id = ${target.teacher_id} and user_id is null
    `;

    // 2. Teacher del JP (idempotente por email).
    const jpTeacher = (await tx`
      insert into teacher (full_name, institutional_email)
      values (${JP_FULLNAME}, ${jpEmail})
      on conflict (institutional_email) do update set full_name = excluded.full_name
      returning id
    `) as unknown as Array<{ id: number }>;
    jpTeacherId = jpTeacher[0].id;

    // 3. Cuenta del JP.
    const jpUser = (await tx`
      insert into app_user (code, full_name, institutional_email, password_hash, token_version)
      values (${jpUsername}, ${JP_FULLNAME}, ${jpEmail}, ${jpHash}, 1)
      on conflict (code) do update set code = excluded.code
      returning id
    `) as unknown as Array<{ id: number }>;
    const jpUserId = jpUser[0].id;
    await tx`
      update teacher set user_id = ${jpUserId} where id = ${jpTeacherId} and user_id is null
    `;

    // 4. Asignar el JP a la sección (CHECK jp<>teacher + índice único parcial
    //    lo validan a nivel BD; si fallan, la transacción hace rollback).
    await tx`
      update section set jp_id = ${jpTeacherId} where id = ${target.section_id}
    `;
  });

  console.log(`\n✓ Seed aplicado.`);
  console.log(`  Profesor  → login ${profUsername} / ${mask(PROF_PASSWORD)}`);
  console.log(`  JP (${JP_FULLNAME}) → login ${jpUsername} / ${mask(JP_PASSWORD)}`);
  console.log(`  section(${target.section_id}).jp_id = teacher ${jpTeacherId}\n`);
}

main()
  .then(async () => {
    await sql.end();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("\n✗ Seed falló:", e instanceof Error ? e.message : e);
    await sql.end().catch(() => {});
    process.exit(1);
  });
