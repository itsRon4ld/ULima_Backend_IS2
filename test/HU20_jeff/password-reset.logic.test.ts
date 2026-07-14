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

const NOW = new Date("2026-07-04T12:00:00.000Z");

const minutesFromNow = (minutes: number) => new Date(NOW.getTime() + minutes * 60 * 1000);

const baseToken = (otp: string) => ({
  tokenHash: hashOtp(otp),
  expiresAt: minutesFromNow(OTP_EXPIRATION_MINUTES),
  usedAt: null as Date | null,
  attempts: 0,
  now: NOW,
});

describe("generateOtp", () => {
  test("siempre genera 6 dígitos (incluye ceros a la izquierda)", () => {
    for (let i = 0; i < 1000; i++) {
      const otp = generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
      expect(otp).toHaveLength(OTP_LENGTH);
    }
  });

  test("genera valores distintos (no constante)", () => {
    const values = new Set(Array.from({ length: 50 }, () => generateOtp()));
    expect(values.size).toBeGreaterThan(1);
  });
});

describe("hashOtp", () => {
  test("retorna SHA-256 hex de 64 caracteres y es determinístico", () => {
    const hash = hashOtp("123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashOtp("123456"));
    // Vector conocido de SHA-256("123456").
    expect(hash).toBe("8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92");
    expect(hashOtp("654321")).not.toBe(hash);
  });
});

describe("validateResetToken", () => {
  test("caso feliz: OTP correcto, vigente, sin uso previo ni intentos agotados", () => {
    const result = validateResetToken({ ...baseToken("123456"), candidateOtp: "123456" });
    expect(result).toEqual({ status: "ok" });
  });

  test("expirado: now posterior a expiresAt", () => {
    const result = validateResetToken({
      ...baseToken("123456"),
      expiresAt: minutesFromNow(-1),
      candidateOtp: "123456",
    });
    expect(result).toEqual({ status: "expired" });
  });

  test("expirado: exactamente en el instante de expiración", () => {
    const result = validateResetToken({
      ...baseToken("123456"),
      expiresAt: NOW,
      candidateOtp: "123456",
    });
    expect(result).toEqual({ status: "expired" });
  });

  test("ya usado: usedAt no nulo tiene prioridad sobre todo lo demás", () => {
    const result = validateResetToken({
      ...baseToken("123456"),
      usedAt: minutesFromNow(-5),
      candidateOtp: "123456",
    });
    expect(result).toEqual({ status: "already_used" });
  });

  test("intentos agotados: attempts en el máximo bloquea aunque el OTP sea correcto", () => {
    const result = validateResetToken({
      ...baseToken("123456"),
      attempts: MAX_RESET_ATTEMPTS,
      candidateOtp: "123456",
    });
    expect(result).toEqual({ status: "too_many_attempts" });
  });

  test("un intento antes del máximo todavía permite validar", () => {
    const result = validateResetToken({
      ...baseToken("123456"),
      attempts: MAX_RESET_ATTEMPTS - 1,
      candidateOtp: "123456",
    });
    expect(result).toEqual({ status: "ok" });
  });

  test("mismatch: OTP incorrecto no coincide con el hash almacenado", () => {
    const result = validateResetToken({ ...baseToken("123456"), candidateOtp: "654321" });
    expect(result).toEqual({ status: "mismatch" });
  });
});

describe("validateNewPassword", () => {
  test("rechaza contraseñas de menos de 8 caracteres", () => {
    expect(validateNewPassword("")).toBe(false);
    expect(validateNewPassword("abc1234")).toBe(false);
    expect("abc1234".length).toBe(MIN_PASSWORD_LENGTH - 1);
  });

  test("acepta contraseñas de 8 caracteres o más", () => {
    expect(validateNewPassword("abcd1234")).toBe(true);
    expect(validateNewPassword("una-clave-larga-segura")).toBe(true);
  });
});

describe("maskEmail", () => {
  test("enmascara la parte local dejando los primeros 4 caracteres", () => {
    expect(maskEmail("20235218@aloe.ulima.edu.pe")).toBe("2023****@aloe.ulima.edu.pe");
  });

  test("parte local corta: deja al menos 1 carácter visible", () => {
    expect(maskEmail("ab@aloe.ulima.edu.pe")).toBe("a****@aloe.ulima.edu.pe");
  });
});
