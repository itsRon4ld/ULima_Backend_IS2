import { describe, expect, test } from "bun:test";
import {
  generateOtp,
  hashOtp,
  maskEmail,
  MAX_RESET_ATTEMPTS,
  MIN_PASSWORD_LENGTH,
  OTP_EXPIRATION_MINUTES,
  OTP_LENGTH,
  validateNewPassword,
  validateResetToken,
} from "../../src/modules/auth/password-reset.logic.js";

/**
 * ============================================================================
 * PRUEBA UNITARIA + CAJA NEGRA — Lógica de restablecimiento de contraseña (HU20)
 * Fuente: src/modules/auth/password-reset.logic.ts
 * ============================================================================
 * Se prueban de forma AISLADA las funciones puras del flujo de "olvidé mi
 * contraseña" (sin BD, sin correo): generación/hash del OTP, validación del
 * token de restablecimiento y de la nueva contraseña, y enmascarado del correo.
 *
 * Qué valida cada grupo:
 *   - generateOtp()      : el código siempre tiene 6 dígitos y no es constante.
 *   - hashOtp()          : SHA-256 hex determinístico (solo se guarda el hash).
 *   - validateResetToken(): CAJA NEGRA/BLANCA por estados del token — recorre
 *     cada rama (ok / expired / already_used / too_many_attempts / mismatch) y
 *     sus VALORES LÍMITE (expira en el instante exacto, intentos == máximo,
 *     un intento antes del máximo). Precedencia: usado > expirado > intentos > hash.
 *   - validateNewPassword(): partición por longitud (< 8 rechaza, >= 8 acepta).
 *   - maskEmail()        : enmascara la parte local dejando 4 (o >= 1) visibles.
 *
 * Casos: generateOtp 2 · hashOtp 1 · validateResetToken 7 · validateNewPassword 2 · maskEmail 2.
 */

// Instante "ahora" FIJO para todos los tests: así las comparaciones de expiración
// son deterministas (no dependen del reloj real al correr la prueba).
const NOW = new Date("2026-07-04T12:00:00.000Z");

// Helper: devuelve una fecha desplazada N minutos respecto a NOW (N negativo = pasado).
const minutesFromNow = (minutes: number) => new Date(NOW.getTime() + minutes * 60 * 1000);

// Fabrica el estado "sano" de un token de reset para un OTP dado: hash correcto,
// vigente (expira dentro de la ventana), sin usar y sin intentos. Cada test
// sobrescribe solo el campo que quiere romper (expiresAt, usedAt, attempts, etc.).
const baseToken = (otp: string) => ({
  tokenHash: hashOtp(otp),                          // solo se persiste el hash del OTP, nunca el OTP en claro
  expiresAt: minutesFromNow(OTP_EXPIRATION_MINUTES), // vigente: vence dentro de la ventana de expiración
  usedAt: null as Date | null,                      // aún no se ha usado
  attempts: 0,                                      // sin intentos fallidos previos
  now: NOW,                                         // referencia de tiempo fija (para comparar contra expiresAt)
});

describe("generateOtp", () => {
  test("siempre genera 6 dígitos (incluye ceros a la izquierda)", () => {
    for (let i = 0; i < 1000; i++) {              // se repite 1000 veces para pillar OTPs con ceros a la izquierda
      const otp = generateOtp();                  // genera un código nuevo
      expect(otp).toMatch(/^\d{6}$/);             // debe ser exactamente 6 dígitos (ni menos por perder el cero inicial)
      expect(otp).toHaveLength(OTP_LENGTH);       // y su longitud debe ser la constante OTP_LENGTH (6)
    }
  });

  test("genera valores distintos (no constante)", () => {
    const values = new Set(Array.from({ length: 50 }, () => generateOtp())); // 50 OTPs metidos en un Set (colapsa repetidos)
    expect(values.size).toBeGreaterThan(1);       // si fuera constante el Set tendría tamaño 1; exigimos variedad
  });
});

describe("hashOtp", () => {
  test("retorna SHA-256 hex de 64 caracteres y es determinístico", () => {
    const hash = hashOtp("123456");               // hashea un OTP conocido
    expect(hash).toMatch(/^[0-9a-f]{64}$/);       // SHA-256 en hex = 64 caracteres hexadecimales
    expect(hash).toBe(hashOtp("123456"));         // determinístico: el mismo input da el mismo hash
    // Vector conocido de SHA-256("123456"): fija el algoritmo exacto (si cambia, el hash cambia).
    expect(hash).toBe("8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92");
    expect(hashOtp("654321")).not.toBe(hash);     // otro OTP produce un hash distinto (sin colisión)
  });
});

describe("validateResetToken", () => {
  test("caso feliz: OTP correcto, vigente, sin uso previo ni intentos agotados", () => {
    const result = validateResetToken({ ...baseToken("123456"), candidateOtp: "123456" }); // token sano + OTP correcto
    expect(result).toEqual({ status: "ok" });     // camino feliz: pasa la validación
  });

  test("expirado: now posterior a expiresAt", () => {
    const result = validateResetToken({
      ...baseToken("123456"),
      expiresAt: minutesFromNow(-1),              // el token venció hace 1 minuto
      candidateOtp: "123456",                     // el OTP es correcto, pero ya no importa
    });
    expect(result).toEqual({ status: "expired" }); // rama "expired"
  });

  test("expirado: exactamente en el instante de expiración", () => {
    const result = validateResetToken({
      ...baseToken("123456"),
      expiresAt: NOW,                             // VALOR LÍMITE: expira justo en "ahora"
      candidateOtp: "123456",
    });
    expect(result).toEqual({ status: "expired" }); // el borde cuenta como expirado (comparación now >= expiresAt)
  });

  test("ya usado: usedAt no nulo tiene prioridad sobre todo lo demás", () => {
    const result = validateResetToken({
      ...baseToken("123456"),
      usedAt: minutesFromNow(-5),                 // el token ya se usó hace 5 min (un solo uso)
      candidateOtp: "123456",
    });
    expect(result).toEqual({ status: "already_used" }); // PRECEDENCIA: "usado" se evalúa antes que expiración/intentos
  });

  test("intentos agotados: attempts en el máximo bloquea aunque el OTP sea correcto", () => {
    const result = validateResetToken({
      ...baseToken("123456"),
      attempts: MAX_RESET_ATTEMPTS,               // VALOR LÍMITE: ya se alcanzó el tope de intentos
      candidateOtp: "123456",                     // aunque el OTP sea correcto, no debe pasar
    });
    expect(result).toEqual({ status: "too_many_attempts" }); // rama de bloqueo por intentos
  });

  test("un intento antes del máximo todavía permite validar", () => {
    const result = validateResetToken({
      ...baseToken("123456"),
      attempts: MAX_RESET_ATTEMPTS - 1,           // VALOR LÍMITE: uno menos que el tope -> aún permitido
      candidateOtp: "123456",
    });
    expect(result).toEqual({ status: "ok" });     // en el borde inferior todavía valida
  });

  test("mismatch: OTP incorrecto no coincide con el hash almacenado", () => {
    const result = validateResetToken({ ...baseToken("123456"), candidateOtp: "654321" }); // OTP distinto al del hash
    expect(result).toEqual({ status: "mismatch" }); // rama final: el hash no coincide
  });
});

describe("validateNewPassword", () => {
  test("rechaza contraseñas de menos de 8 caracteres", () => {
    expect(validateNewPassword("")).toBe(false);        // vacía: inválida
    expect(validateNewPassword("abc1234")).toBe(false); // 7 caracteres: inválida
    expect("abc1234".length).toBe(MIN_PASSWORD_LENGTH - 1); // deja explícito que 7 = mínimo(8) - 1 (valor límite)
  });

  test("acepta contraseñas de 8 caracteres o más", () => {
    expect(validateNewPassword("abcd1234")).toBe(true);              // 8 caracteres justos: válida (borde inferior)
    expect(validateNewPassword("una-clave-larga-segura")).toBe(true); // más larga: válida
  });
});

describe("maskEmail", () => {
  test("enmascara la parte local dejando los primeros 4 caracteres", () => {
    // "20235218@..." -> deja "2023", oculta el resto de la parte local, conserva el dominio.
    expect(maskEmail("20235218@aloe.ulima.edu.pe")).toBe("2023****@aloe.ulima.edu.pe");
  });

  test("parte local corta: deja al menos 1 carácter visible", () => {
    // Parte local de 2 caracteres: no puede dejar 4, así que deja al menos 1 ("a").
    expect(maskEmail("ab@aloe.ulima.edu.pe")).toBe("a****@aloe.ulima.edu.pe");
  });
});
