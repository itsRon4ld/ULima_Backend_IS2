// Seed — roster + delegados/subdelegados de varias secciones (selección de delegados).
//
// Human-gated: correr con datos móviles (el wifi de la ULima bloquea el 5432) y
// con backup previo (pg_dump de app_user/student/enrollment/section_representative).
//
//   bun run src/db/seed/delegados_secciones.ts                       # DRY-RUN de TODAS (no escribe)
//   bun run src/db/seed/delegados_secciones.ts --only=auditoria-851  # DRY-RUN de una sola
//   bun run src/db/seed/delegados_secciones.ts --apply               # aplica TODAS
//   bun run src/db/seed/delegados_secciones.ts --only=isw1-752 --apply
//
// Cada sección corre en su PROPIA transacción (una falla no afecta a las demás).
// Por sección deja EXACTAMENTE su roster (matrícula activa) + delegado/subdelegado:
//  - crea los alumnos que falten (app_user + student + enrollment); password vía
//    env STUDENT_PASSWORD (requerida, sin default en el código).
//  - conserva a los que ya existan (reusa por `code`; NO toca su carrera ni otras secciones).
//  - QUITA de la sección a quien NO esté en su lista (borra solo su enrollment aquí
//    y sus hijas: representante/notas oficiales/notas simuladas).
//  - fija un delegado y un subdelegado ACTIVO por sección.
//
// Las secciones deben EXISTIR ya en la BD (section.teacher_id es NOT NULL: no se
// fabrica profesor/período aquí). Si una no resuelve, se reporta y se salta.
// Se resuelve por code + nombre del curso (hay dos secciones "752": Ing. de
// Software I y Gestión de Operaciones; el nombre las distingue).
//
// ⚠️ Alumnos NUEVOS: se crean con CAREER_ID/CURRICULUM_ID (env, default 1/1 =
// Ing. de Sistemas; todas estas secciones son de esa malla) y current_level NULL.
import "dotenv/config";
import postgres from "postgres";
import bcrypt from "bcryptjs";

const APPLY = process.argv.includes("--apply");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").split("=")[1] || null;
const BCRYPT_COST = 10;
const EMAIL_DOMAIN = "aloe.ulima.edu.pe";
const CAREER_ID = Number(process.env.CAREER_ID ?? 1);          // 1 = Ingeniería de Sistemas
const CURRICULUM_ID = Number(process.env.CURRICULUM_ID ?? 1);  // 1 = Malla Ing. de Sistemas

const STUDENT_PASSWORD = process.env.STUDENT_PASSWORD;
if (!STUDENT_PASSWORD) {
  console.error("❌ Falta STUDENT_PASSWORD en el entorno. Defínela antes de correr el seed.");
  process.exit(1);
}

type Position = "delegate" | "subdelegate";
type SectionSeed = {
  key: string;             // slug único (para --only)
  label: string;           // nombre legible
  code: string;            // section.code
  courseNameLike: string;  // patrón para upper(course.name) LIKE (sin tildes)
  target: Array<[string, string]>;        // [código, "APELLIDOS NOMBRES"]
  assign: Array<{ code: string; position: Position }>;
};

const SECTIONS: SectionSeed[] = [
  {
    key: "auditoria-851",
    label: "AUDITORÍA Y CONTROL DE SISTEMAS - 851",
    code: "851",
    courseNameLike: "%AUDITOR%CONTROL%SISTEMA%",
    assign: [
      { code: "20233903", position: "delegate" },     // GARAY SALINAS GABRIELA NICOLE
      { code: "20235218", position: "subdelegate" },  // SANCHEZ PALACIOS JEFFERSON ANGELO
    ],
    target: [
      ["20193755", "ALARCON CUENCA ANDRES JOSUE"],
      ["20220086", "ALMEYDA CORDERO RENATO MATIAS"],
      ["20192420", "AVALOS LOA Y PARDO BRYAN JESUS"],
      ["20220353", "BOCANEGRA CARRION MARCO ANTONIO"],
      ["20230460", "BUTRON BERNAL PAOLA ANDREA"],
      ["20230509", "CALLA FLORES YAMYL DAVID"],
      ["20223243", "CAMPOS QUISPE LEONEL ALBERTO"],
      ["20222909", "CARAMANTIN CRUZ LEANDRO AARON"],
      ["20230720", "CHANG MERINO ANGEL RAEL VALENTINO"],
      ["20192693", "DEUDOR FERNANDEZ ROLANDO GUSTAVO"],
      ["20194079", "FALCON FLORES ALEJANDRA MARIANA"],
      ["20200812", "FLORES UZATEGUI ADRIAN ALEXANDER"],
      ["20233903", "GARAY SALINAS GABRIELA NICOLE"],
      ["20160657", "GUTIERREZ ALZA JOHAO ANDREE"],
      ["20224815", "GUTIERREZ CADILLO LUIS FRANCISCO"],
      ["20221190", "GUTIERREZ TORIBIO JAIRO"],
      ["20221464", "MACEDO BOBADILLA GABRIEL ALONSO"],
      ["20201287", "MARZAL MONTOYA DIEGO ALONSO"],
      ["20231874", "MOLINA AGUI JOAQUIN ALONSO"],
      ["20204671", "MONTALVAN CHOQUEHUANCA SERGIO ENRIQUE"],
      ["20221730", "NUÑEZ DEL PRADO VEGA JOSE FRANCISCO"],
      ["20221804", "ORTEGA ESCURRA MATEO ANTONIO"],
      ["20223851", "PAZ PEÑA JOSE GONZALO"],
      ["20193267", "PORTUGUEZ DEL PINO OMAR SEBASTIAN"],
      ["20222182", "RODENAS RODENAS ROBERTO VICTOR"],
      ["20235176", "SAAVEDRA PASCUAL ROY SEBASTIAN"],
      ["20222309", "SALAZAR CARPIO ALVARO BRUNO"],
      ["20235189", "SALAZAR PAITAN DIEGO ALEXANDER"],
      ["20235218", "SANCHEZ PALACIOS JEFFERSON ANGELO"],
      ["20225487", "TANIGUCHI VENTURA KATSUO"],
      ["20232909", "TELLO AGUILAR FARID JAIR"],
      ["20222527", "TINOCO RAMIREZ GABRIEL ALEJANDRO"],
      ["20233714", "TORRES HURTADO ANDRE SEBASTIAN"],
      ["20222579", "TRIGOSO ROLDAN MAURICIO ANTONIO"],
      ["20224131", "TTITO ROFFINELLA LEONARDO"],
      ["20184566", "VALVERDE HUAMANI EDUARDO JOSE"],
      ["20203801", "VASQUEZ ROJAS GIANCARLO ANDRE"],
    ],
  },
  {
    key: "bigdata-852",
    label: "ANALÍTICA CON BIG DATA - 852",
    code: "852",
    courseNameLike: "%ANAL%BIG%DATA%",
    assign: [
      { code: "20213505", position: "delegate" },     // DIAZ VALLEJOS WALTER ANDRES
      { code: "20233903", position: "subdelegate" },  // GARAY SALINAS GABRIELA NICOLE
    ],
    target: [
      ["20220031", "AGUILAR LUNA RENZO PAOLO"],
      ["20220109", "ALVAREZ DOMINGUEZ SEBASTIAN ALONSO"],
      ["20210390", "BUENAÑO LA TORRE LEONARDO FABRIZIO"],
      ["20223232", "CALDERON GARMA KEVIN POOL"],
      ["20102285", "CHAMORRO MICUILLA DAVID ALEJANDRO"],
      ["20220746", "CUEVAS SERRATO JORGE ADRIAN"],
      ["20213505", "DIAZ VALLEJOS WALTER ANDRES"],
      ["20223492", "GABINO CHAMORRO JAREN SAMIR"],
      ["20203913", "GALVEZ ARRASCUE RODRIGO ALONSO"],
      ["20221043", "GARAY ESPINOSA JOAQUIN OCTAVIO"],
      ["20221044", "GARAY POMA KOTLER AARON"],
      ["20233903", "GARAY SALINAS GABRIELA NICOLE"],
      ["20221122", "GONZALES OLIVERA ANTHONY DAVID"],
      ["20221260", "HUANCAYA RAMIREZ ANDREW LUIS"],
      ["20201118", "LANDA FLORES MARCELO ALEJANDRO"],
      ["20214950", "LEVANO CUTIÑO RAUL GUILLERMO"],
      ["20203122", "LINARES UGARTE RODRIGO"],
      ["20233916", "LUNA MORAN FRANCO ANTONIO"],
      ["20221483", "MALPARTIDA HUAMAN MANUEL EDUARDO"],
      ["20211590", "MAMANI VALVERDE YERSON DANIEL"],
      ["20223718", "MELCHOR APONTE FRANCO STEVEN"],
      ["20221693", "MUÑANTE DURAND HAROLD ENRIQUE"],
      ["20221964", "PINAYA VARGAS SOFIA"],
      ["20221977", "PLACIDO CHAMBI FABRICIO EDUARDO"],
      ["20222052", "QUISPE COLQUICOCHA LICET VALERIA"],
      ["20222070", "RAMIREZ AGREDA IAN ALEXANDER"],
      ["20184344", "RAMIREZ MILLA MAURICIO JESUS"],
      ["20172526", "RAMOS MENDOZA DIEGO RONALDO"],
      ["20213171", "TAVARA MINAYA FRANCO ANDRE"],
      ["20222540", "TORIBIO SALCEDO ALEJANDRO DANIEL"],
      ["20222596", "UCEDA YACILA GUSTAVO ALEJANDRO"],
      ["20212853", "VENEGAS OCHOA CHRISTIAN YAEL"],
      ["20212903", "VILLALVA GOMEZ DIANA SOFIA"],
      ["20222848", "YSIDRO PALOMINO GABRIEL WALTER"],
    ],
  },
  {
    key: "isw1-752",
    label: "INGENIERÍA DE SOFTWARE I - 752",
    code: "752",
    courseNameLike: "%INGENIER%SOFTWARE%",
    assign: [
      { code: "20233903", position: "delegate" },     // GARAY SALINAS GABRIELA NICOLE
      { code: "20224068", position: "subdelegate" },  // SOLORZANO ORMEÑO GONZALO SEBASTIAN
    ],
    target: [
      ["20240028", "ADRIANZEN VIA RENZO UBALDO"],
      ["20253851", "AGUILAR PORTURAS SERGIO FABIAN"],
      ["20240252", "ARRIARAN BOGGIO ALEJANDRO ANDRES"],
      ["20230299", "BANCES DELGADILLO RONALD FABRIZIO"],
      ["20210255", "BARBOZA PAREDES DIEGO"],
      ["20224518", "BARRETO IBRAHIM REAID YUSEF"],
      ["20220353", "BOCANEGRA CARRION MARCO ANTONIO"],
      ["20230460", "BUTRON BERNAL PAOLA ANDREA"],
      ["20230489", "CACERES VELAZCO LUCIANA EMMA"],
      ["20235945", "CALLUPE PERALES ADRIANA HILDA"],
      ["20230622", "CASOLDA ALEGRIA MARIEL FERNANDA"],
      ["20230714", "CHAN HUANG KEVIN"],
      ["20230725", "CHAPMAN LOPEZ SEBASTIAN RICARDO"],
      ["20230810", "COLONIA ROJAS ROBERT ANDRE"],
      ["20220748", "CURAHUA MEJIA LOURDES TRINIDAD"],
      ["20231022", "DURAN ALE MARISOL VALERIA"],
      ["20231218", "GARATE HUAMAN SEBASTIAN ANDRE"],
      ["20233903", "GARAY SALINAS GABRIELA NICOLE"],
      ["20231284", "GONZALES CHAVEZ LEONARDO FABRIZIO STEFANO"],
      ["20225503", "HERRERA PAREDES VICTORIA ROMINA"],
      ["20231576", "LAU MORA RAFAEL ADRIAN"],
      ["20192972", "LEDESMA GUERRERO ESTEBAN ARTURO"],
      ["20231596", "LEON DEL VILLAR PIERO SEBASTIAN"],
      ["20231714", "MALDONADO SOTO ANGELO GABRIEL"],
      ["20211606", "MAÑUICO JAUREGUI ALESSANDRA COSETTE"],
      ["20231805", "MELENDEZ JULCA WALTER SEBASTIAN"],
      ["20224973", "MERA INCIO ALVARO DIEGO"],
      ["20234801", "MEZA MOLLEAPAZA YAGAMI JAROL JHIROSHI"],
      ["20231874", "MOLINA AGUI JOAQUIN ALONSO"],
      ["20232119", "PACHECO CASTRO PEDRO IVAN"],
      ["20235056", "RADO DELGADO JEAN CARLO DE JESUS"],
      ["20222182", "RODENAS RODENAS ROBERTO VICTOR"],
      ["20243171", "SAAVEDRA NOLASCO ALEXANDER MAXIMO"],
      ["20224068", "SOLORZANO ORMEÑO GONZALO SEBASTIAN"],
      ["20225487", "TANIGUCHI VENTURA KATSUO"],
      ["20232907", "TEJADA MONTESINOS MARTIN RODRIGO"],
      ["20235290", "TERAN LINARES JULIO CESAR"],
      ["20222521", "THOMPSON OBANDO RODRIGO SEBASTIAN"],
      ["20233078", "VALVERDE NORIEGA ALEJANDRO NORBERTO"],
      ["20246205", "VILLAR CORDOVA ALVA MATIAS GONZALO"],
    ],
  },
  {
    key: "conocimiento-751",
    label: "INGENIERÍA DEL CONOCIMIENTO - 751",
    code: "751",
    courseNameLike: "%INGENIER%CONOCIMIENTO%",
    assign: [
      { code: "20200446", position: "delegate" },     // CASTAÑEDA ARREGUI RICARDO FABRICIO
      { code: "20221122", position: "subdelegate" },  // GONZALES OLIVERA ANTHONY DAVID
    ],
    target: [
      ["20214485", "ALARCON CABRERA MATIAS GUILLERMO"],
      ["20200121", "ANGULO SUAREZ DIEGO ALEJANDRO"],
      ["20210171", "ARIAS CARRION PABLO DANIEL"],
      ["20223148", "ARRASCO JUAREZ HECTOR GIANMARCO"],
      ["20210390", "BUENAÑO LA TORRE LEONARDO FABRIZIO"],
      ["20230489", "CACERES VELAZCO LUCIANA EMMA"],
      ["20220454", "CAMACHO DAVILA LUIS MATHIAS"],
      ["20200446", "CASTAÑEDA ARREGUI RICARDO FABRICIO"],
      ["20210614", "CHAVEZ CAMPOVERDE JOSIAS AXEL"],
      ["20213418", "CHAVEZ PRIETO ALEKSEY SKRIABIN"],
      ["20210714", "CORDOVA BARBA FRANCO VALENTINO"],
      ["20214714", "CORDOVA TORRES DIEGO MANUEL"],
      ["20202799", "CORREA DELGADO CRISTIAN BRANDOM"],
      ["20220746", "CUEVAS SERRATO JORGE ADRIAN"],
      ["20210981", "FERNANDEZ CERNA AARON BRYAN"],
      ["20223492", "GABINO CHAMORRO JAREN SAMIR"],
      ["20233903", "GARAY SALINAS GABRIELA NICOLE"],
      ["20231226", "GARCIA BAUTISTA DIEGO SEBASTIAN"],
      ["20211095", "GARCIA HERRERA JAVIER ANDRES"],
      ["20221122", "GONZALES OLIVERA ANTHONY DAVID"],
      ["20211165", "GOÑAS CASTRO ROBER ANDRE"],
      ["20221162", "GUEVARA CASTAÑEDA MATHIAS MANUEL"],
      ["20201118", "LANDA FLORES MARCELO ALEJANDRO"],
      ["20211454", "LEON VILELA PATRICK ALONSO"],
      ["20203122", "LINARES UGARTE RODRIGO"],
      ["20211484", "LLALLICO CRUZ RICARDO JOSUE"],
      ["20211606", "MAÑUICO JAUREGUI ALESSANDRA COSETTE"],
      ["20211689", "MENDO FERREYRA HENRY ANDRE"],
      ["20224973", "MERA INCIO ALVARO DIEGO"],
      ["20234801", "MEZA MOLLEAPAZA YAGAMI JAROL JHIROSHI"],
      ["20221751", "OBRADOVICH LUNA ERICK"],
      ["20222052", "QUISPE COLQUICOCHA LICET VALERIA"],
      ["20222070", "RAMIREZ AGREDA IAN ALEXANDER"],
      ["20214398", "RAMIREZ PEREZ ERNESTO ALDAIR"],
      ["20203612", "SALIRROSAS IBAÑEZ DIEGO ALONSO"],
      ["20212544", "SARANGO CASTILLO ANA VALENTINA"],
      ["20224062", "SIPION GUILLEN CLAUDIA PATRICIA"],
      ["20202036", "SUITO ARTAZA LUCIANA VANESSA"],
      ["20235290", "TERAN LINARES JULIO CESAR"],
      ["20202255", "VILCHEZ LUNASCO LEONARDO MANUEL"],
    ],
  },
  {
    key: "distribuidos-853",
    label: "SISTEMAS DISTRIBUIDOS - 853",
    code: "853",
    courseNameLike: "%SISTEMAS%DISTRIBUIDOS%",
    assign: [
      { code: "20233903", position: "delegate" },     // GARAY SALINAS GABRIELA NICOLE
      { code: "20221252", position: "subdelegate" },  // HUAMAN SALHUANA NEIL NELSON
    ],
    target: [
      ["20220031", "AGUILAR LUNA RENZO PAOLO"],
      ["20210076", "ALFARO ECHEGARAY JOAQUIN"],
      ["20233424", "ALVARADO PADILLA ANDRES ALONSO"],
      ["20223148", "ARRASCO JUAREZ HECTOR GIANMARCO"],
      ["20214543", "ASTO MALLQUI FERNANDO JESUS"],
      ["20224387", "CHAVEZ RODRIGUEZ FABRICIO MARTIN"],
      ["20210983", "FERNANDEZ FALCON ITALO"],
      ["20194095", "FLORINDEZ SANCHEZ NIKOLAS DANTE"],
      ["20221043", "GARAY ESPINOSA JOAQUIN OCTAVIO"],
      ["20221044", "GARAY POMA KOTLER AARON"],
      ["20233903", "GARAY SALINAS GABRIELA NICOLE"],
      ["20213013", "GONZALES NUÑEZ LEANDRO PAOLO"],
      ["20221252", "HUAMAN SALHUANA NEIL NELSON"],
      ["20224280", "JARA ESPINOZA RODRIGO"],
      ["20221423", "LOPEZ HERNANDEZ ALESSANDRA MICHELLE"],
      ["20231714", "MALDONADO SOTO ANGELO GABRIEL"],
      ["20221483", "MALPARTIDA HUAMAN MANUEL EDUARDO"],
      ["20201373", "MINAURO NUÑEZ CARLOS ESTEBAN"],
      ["20221621", "MIYAHIRA COLLAZOS FELIX ALONSO"],
      ["20223756", "MONTENEGRO CARRILLO SEBASTIAN"],
      ["20221693", "MUÑANTE DURAND HAROLD ENRIQUE"],
      ["20221751", "OBRADOVICH LUNA ERICK"],
      ["20212201", "QUISPE VALDEZ MARIA CRISTINA"],
      ["20232405", "RAMIREZ QUIROZ MARCO JESUS"],
      ["20214404", "TAYPE ROJAS DANIEL ALONSO"],
      ["20212673", "TIZA HUARINGA JAIRO GABRIEL"],
      ["20222540", "TORIBIO SALCEDO ALEJANDRO DANIEL"],
      ["20222596", "UCEDA YACILA GUSTAVO ALEJANDRO"],
      ["20202209", "VELA LARREA DAVID ENRIQUE"],
      ["20202241", "VICUÑA GUERRERO CLIFF ARTHUR"],
      ["20212895", "VILCHEZ GARRIDO JAIME ANTONIO"],
      ["20222848", "YSIDRO PALOMINO GABRIEL WALTER"],
    ],
  },
  {
    key: "operaciones-752",
    label: "GESTIÓN DE OPERACIONES - 752",
    code: "752",
    courseNameLike: "%GESTI%OPERAC%",
    assign: [
      { code: "20236236", position: "delegate" },     // GIANELLA PAZOS MATIAS DANILO
      { code: "20232565", position: "subdelegate" },  // ROJAS ANDAMAYO LEONARDO ANGEL DE JESUS
    ],
    target: [
      ["20240004", "ABANTO YOUNG DIEGO ALONSO"],
      ["20244391", "ALZAMORA RAMOS ENITH JOANNE"],
      ["20234035", "ARGAMONTE QUISPE YADIRA ALEXANDRA"],
      ["20246419", "ASTORGA DEL CASTILLO JOHAN ANDRE"],
      ["20182293", "BALBIN REYMUNDO TAMARA HAITANA"],
      ["20223223", "CABANILLAS COILA ALEJANDRO MARCELO"],
      ["20223277", "CASTAÑEDA CAMARGO FREEL PAOLO"],
      ["20224619", "CASTAÑEDA MATEO SHERLOCK CRISTOPHER"],
      ["20230782", "CHULAU GONZALES MAURICIO MATIAS"],
      ["20224276", "ESPINOZA RODRIGUEZ LUIS MARCELO"],
      ["20233903", "GARAY SALINAS GABRIELA NICOLE"],
      ["20236236", "GIANELLA PAZOS MATIAS DANILO"],
      ["20231396", "HERNANDEZ MONSEFU KEITEL MANUEL"],
      ["20225503", "HERRERA PAREDES VICTORIA ROMINA"],
      ["20231470", "HUAYHUA MARTINEZ JOSE DANIEL"],
      ["20236333", "JIMENEZ ORIHUELA ALBERT LIZANDRO VALENTINO"],
      ["20211606", "MAÑUICO JAUREGUI ALESSANDRA COSETTE"],
      ["20231730", "MAQUEIRA BARCELLI MELISSA"],
      ["20224973", "MERA INCIO ALVARO DIEGO"],
      ["20221998", "MONTERO GUTIERREZ SEBASTIAN ANGEL"],
      ["20231986", "NAVARRO HERNANDEZ GIANFRANCO"],
      ["20232134", "PAJUELO GUEVARA MATIAS"],
      ["20233839", "PEREZ ARTEAGA LEANDRO NAHUEL"],
      ["20232260", "PINGO MENDOZA JUSTIN ANGELO"],
      ["20235029", "PORTILLO LOPEZ DOMINICK SHAQUEEL"],
      ["20232375", "QUISPE MARQUEZ RAUL ANGEL"],
      ["20232565", "ROJAS ANDAMAYO LEONARDO ANGEL DE JESUS"],
      ["20235206", "SANCHEZ AGURTO LUIGGI SEBASTIAN"],
      ["20222384", "SANTISTEBAN CARMELO ANDREA CAROLINA"],
      ["20232838", "SOTO GOMEZ ADOLFO MARTIN"],
      ["20222521", "THOMPSON OBANDO RODRIGO SEBASTIAN"],
      ["20222527", "TINOCO RAMIREZ GABRIEL ALEJANDRO"],
      ["20222707", "VEGAS CARBAJAL MATHIAS JUAN"],
      ["20235599", "VELASQUEZ CHAVEZ LUIS ANDRE"],
    ],
  },
  {
    key: "programacion-web-654",
    label: "PROGRAMACIÓN WEB - 654",
    code: "654",
    courseNameLike: "%PROGRAMA%WEB%",
    assign: [
      { code: "20244597", position: "delegate" },     // PLASENCIA SANTIVAÑEZ ELINA SOLANGE
      { code: "20233329", position: "subdelegate" },  // ZAVALETA OLIVERA JHANDEL ARIEL MOISES
    ],
    target: [
      ["20230015", "ACEVEDO CAYCHO GIUSEPPE ANGELO"],
      ["20224412", "ACHARTE MEZA ALEXANDER"],
      ["20233963", "ALARCON DUEÑAS PIERO JOSE"],
      ["20235818", "ARAUJO LLONTOP JOSHUA JORGE"],
      ["20230331", "BARTRA MARINA GONZALO FABRIZZIO"],
      ["20200318", "BURGA VELASQUEZ JORGE RODRIGO"],
      ["20230600", "CARRASCO OJEDA JIMMY ADRIAN"],
      ["20230714", "CHAN HUANG KEVIN"],
      ["20233466", "CHICCORI SANCHEZ AIDAN ABEL JESUS"],
      ["20230774", "CHIU CUEVA DIEGO ALEJANDRO"],
      ["20230810", "COLONIA ROJAS ROBERT ANDRE"],
      ["20230836", "CORDOVA AMEZ YAHEL JAIR"],
      ["20224732", "ELERA RIOS ALEXIS FABIAN"],
      ["20231040", "ENCISO ROJAS ANDRIY HITOSHI"],
      ["20231173", "FRANCO RODRIGUEZ RENZO MATHIAS"],
      ["20233507", "GRADOS SANCHEZ JUAN DIEGO"],
      ["20231364", "GUTIERREZ MENDOZA RIZAL MAXIMILIANO"],
      ["20231425", "HIYAGON ZAPATA MARIA JOSE"],
      ["20231470", "HUAYHUA MARTINEZ JOSE DANIEL"],
      ["20231527", "JIMENEZ FERNANDEZ ANGEL JESUS"],
      ["20236417", "MANTILLA CRUZADO VALENTINO"],
      ["20231889", "MONROY FERNANDEZ SERGIO NICOLAS"],
      ["20225019", "NAKANDAKARI PACHERRE KENYI JOSE"],
      ["20236575", "PALOMINO APOLINARIO GIANLUCA GONZALO"],
      ["20232151", "PALTI FLORES IVAN EDUARDO"],
      ["20232224", "PEREZ FARFAN RENATO GABRIEL"],
      ["20244597", "PLASENCIA SANTIVAÑEZ ELINA SOLANGE"],
      ["20232400", "RAMIREZ PECHENINA ANDREA"],
      ["20232411", "RAMOS ALVARADO TATIANA ALEXANDRA"],
      ["20232541", "RODRIGUEZ GERONIMO JOSE ANTONIO"],
      ["20232597", "ROMERO BERTO JOHN RAUL"],
      ["20244541", "SALAZAR VENTO NEIL ANTHONY"],
      ["20222331", "SALDARRIAGA MENDOZA SEBASTIAN STEFANO"],
      ["20232739", "SANDOVAL LOPEZ DIEGO MATHIAS"],
      ["20236805", "SANDOVAL RODRIGUEZ JOSE GIANMARKO STUARDO"],
      ["20215413", "UGAZ GUTIERREZ ORLANDO ANDRE"],
      ["20233030", "VALDERRAMA CRUZ NICOLAS"],
      ["20233050", "VALENCIA BERRIOS JOHANN DAVID"],
      ["20233279", "YANCACHAJLLA RINZA AXIEL DAVID RAUL"],
      ["20233329", "ZAVALETA OLIVERA JHANDEL ARIEL MOISES"],
    ],
  },
];

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

async function resolveSection(db: postgres.TransactionSql, cfg: SectionSeed): Promise<number> {
  const rows = await db`
    select s.id
    from section s
    join course_offering co on co.id = s.course_offering_id
    join course c on c.id = co.course_id
    where s.code = ${cfg.code} and upper(c.name) like ${cfg.courseNameLike}`;
  if (rows.length !== 1) {
    throw new Error(
      `Se esperaba 1 sección ${cfg.code} de "${cfg.label}"; encontradas: ${rows.length}. ` +
      `Debe existir primero (con profesor/período); este seed no la crea.`,
    );
  }
  return rows[0].id as number;
}

type Summary = {
  label: string;
  sectionId: number;
  created: number;
  kept: number;
  removed: number;
  roster: number;
  delegate: string;
  subdelegate: string;
};

async function runSection(
  db: postgres.TransactionSql,
  cfg: SectionSeed,
  passwordHash: string,
): Promise<Summary> {
  const sectionId = await resolveSection(db, cfg);
  const targetCodes = cfg.target.map((t) => t[0]);
  const created: string[] = [];
  const kept: string[] = [];

  // 1) Alta/asegurado del roster.
  for (const [code, fullName] of cfg.target) {
    const email = `${code}@${EMAIL_DOMAIN}`;
    const existing = await db`select id from app_user where code = ${code}`;
    let userId: number;
    if (existing.length === 0) {
      const [u] = await db`
        insert into app_user (code, full_name, institutional_email, password_hash, token_version)
        values (${code}, ${fullName}, ${email}, ${passwordHash}, 1)
        returning id`;
      userId = u.id;
      created.push(code);
    } else {
      userId = existing[0].id;
      kept.push(code);
    }

    let studentRows = await db`select id from student where user_id = ${userId}`;
    if (studentRows.length === 0) {
      studentRows = await db`
        insert into student (user_id, career_id, curriculum_id)
        values (${userId}, ${CAREER_ID}, ${CURRICULUM_ID})
        returning id`;
    }
    const studentId = studentRows[0].id as number;

    await db`
      insert into enrollment (student_id, section_id, status)
      values (${studentId}, ${sectionId}, 'active')
      on conflict (student_id, section_id) do update set status = 'active'`;
  }

  // 2) Quitar de la sección a quienes NO están en la lista (solo su enrollment aquí).
  const toRemove = await db`
    select e.id as enrollment_id, au.code, au.full_name
    from enrollment e
    join student st on st.id = e.student_id
    join app_user au on au.id = st.user_id
    where e.section_id = ${sectionId}
      and au.code <> all(${targetCodes})`;
  for (const r of toRemove) {
    await db`delete from section_representative where enrollment_id = ${r.enrollment_id}`;
    await db`delete from student_score where enrollment_id = ${r.enrollment_id}`;
    await db`delete from simulated_grades where enrollment_id = ${r.enrollment_id}`;
    await db`delete from enrollment where id = ${r.enrollment_id}`;
  }

  // 3) Delegado / subdelegado (un ACTIVO por posición; enrollment_id único).
  for (const { code, position } of cfg.assign) {
    const [enr] = await db`
      select e.id as enrollment_id
      from enrollment e
      join student st on st.id = e.student_id
      join app_user au on au.id = st.user_id
      where e.section_id = ${sectionId} and au.code = ${code}`;
    if (!enr) throw new Error(`El representante ${code} no quedó matriculado en ${cfg.label}`);

    await db`
      update section_representative
      set is_active = false
      where section_id = ${sectionId} and position = ${position}
        and is_active = true and enrollment_id <> ${enr.enrollment_id}`;
    await db`
      insert into section_representative (section_id, enrollment_id, position, is_active)
      values (${sectionId}, ${enr.enrollment_id}, ${position}, true)
      on conflict (enrollment_id)
        do update set position = excluded.position, is_active = true`;
  }

  // 4) Estado final.
  const finalRoster = await db`
    select au.code, au.full_name
    from enrollment e
    join student st on st.id = e.student_id
    join app_user au on au.id = st.user_id
    where e.section_id = ${sectionId}
    order by au.full_name`;
  const reps = await db`
    select sr.position, au.code, au.full_name
    from section_representative sr
    join enrollment e on e.id = sr.enrollment_id
    join student st on st.id = e.student_id
    join app_user au on au.id = st.user_id
    where sr.section_id = ${sectionId} and sr.is_active = true`;

  if (finalRoster.length !== cfg.target.length) {
    throw new Error(`Roster final ${finalRoster.length}, se esperaban ${cfg.target.length} en ${cfg.label}`);
  }

  const repOf = (p: Position) => {
    const r = reps.find((x) => x.position === p);
    return r ? `${r.code} ${r.full_name}` : "—";
  };

  console.log(`\n=== ${cfg.label}  (section.id ${sectionId}) ===`);
  console.log(`  creados ${created.length}, ya existían ${kept.length}, quitados ${toRemove.length}, roster ${finalRoster.length}`);
  if (toRemove.length) {
    console.log("  quitados de la sección:");
    console.table(toRemove.map((r) => ({ code: r.code, full_name: r.full_name })));
  }
  if (created.length) console.log("  cuentas NUEVAS (revisar carrera):", created.join(", "));
  console.log(`  delegado    → ${repOf("delegate")}`);
  console.log(`  subdelegado → ${repOf("subdelegate")}`);

  return {
    label: cfg.label,
    sectionId,
    created: created.length,
    kept: kept.length,
    removed: toRemove.length,
    roster: finalRoster.length,
    delegate: repOf("delegate"),
    subdelegate: repOf("subdelegate"),
  };
}

async function seedOne(cfg: SectionSeed, passwordHash: string): Promise<Summary | null> {
  try {
    if (APPLY) {
      return await sql.begin((tx) => runSection(tx, cfg, passwordHash));
    }
    // DRY-RUN: correr dentro de una transacción que se revierte.
    let summary: Summary | null = null;
    try {
      await sql.begin(async (tx) => {
        summary = await runSection(tx, cfg, passwordHash);
        throw new Error("__DRYRUN_ROLLBACK__");
      });
    } catch (e) {
      if ((e as Error).message !== "__DRYRUN_ROLLBACK__") throw e;
    }
    return summary;
  } catch (e) {
    console.error(`\n❌ ${cfg.label}: ${(e as Error).message}`);
    return null;
  }
}

async function main() {
  const selected = ONLY ? SECTIONS.filter((s) => s.key === ONLY) : SECTIONS;
  if (ONLY && selected.length === 0) {
    console.error(`--only=${ONLY} no coincide. Claves válidas: ${SECTIONS.map((s) => s.key).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(APPLY ? "== APLICANDO (una transacción por sección) ==" : "== DRY-RUN (rollback por sección, no escribe) ==");
  console.log(`Secciones: ${selected.map((s) => s.key).join(", ")}\n`);

  const passwordHash = await bcrypt.hash(STUDENT_PASSWORD!, BCRYPT_COST);
  const summaries: Summary[] = [];
  for (const cfg of selected) {
    const s = await seedOne(cfg, passwordHash);
    if (s) summaries.push(s);
  }

  console.log("\n== RESUMEN ==");
  console.table(summaries.map((s) => ({
    seccion: s.label,
    creados: s.created,
    existian: s.kept,
    quitados: s.removed,
    roster: s.roster,
    delegado: s.delegate,
    subdelegado: s.subdelegate,
  })));
  const ok = summaries.length;
  const total = selected.length;
  console.log(`\n${ok}/${total} secciones ${APPLY ? "aplicadas" : "validadas (dry-run)"}.`);
  if (ok < total) {
    console.log("⚠️ Hubo secciones con error (ver arriba). Nada de esas se escribió.");
    process.exitCode = 1;
  }
  if (!APPLY) console.log("(DRY-RUN: nada se escribió. Correr con --apply para aplicar.)");
}

try {
  await main();
} finally {
  await sql.end();
}
