import { BadRequestException } from "@nestjs/common";

import type { AdminBffRequest } from "../context/request-context.js";

export function requireIdempotencyKey(req: AdminBffRequest): string {
  const value = req.headers["idempotency-key"];
  const key = Array.isArray(value) ? value[0] : value;
  if (!key || key.trim().length === 0) {
    throw new BadRequestException({
      code: "IDEMPOTENCY_KEY_REQUIRED",
      message: "Idempotency-Key header is required"
    });
  }

  return key.trim();
}
