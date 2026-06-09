import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { Injectable } from "@nestjs/common";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

@Injectable()
export class PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString("base64url");
    const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;

    return `scrypt$${salt}$${derivedKey.toString("base64url")}`;
  }

  async verify(password: string, storedHash: string): Promise<boolean> {
    const [, salt, key] = storedHash.split("$");
    if (!salt || !key) {
      return false;
    }

    const actual = Buffer.from(key, "base64url");
    const expected = (await scrypt(password, salt, actual.length)) as Buffer;
    if (actual.length !== expected.length) {
      return false;
    }

    return timingSafeEqual(actual, expected);
  }
}
