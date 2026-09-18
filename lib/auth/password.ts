import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(password: string) {
  if (password.length < 10) throw new Error("password_too_short");
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, saltText, keyText] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltText || !keyText) return false;

  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(keyText, "base64url");
    const actual = (await scrypt(password, salt, expected.length)) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
