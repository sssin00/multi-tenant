import { createHash, createHmac } from "node:crypto";

import { Injectable } from "@nestjs/common";

import { getAppConfig } from "../config/app.config.js";

export type InternalAuthTarget = "auth-iam-service" | "tenant-service" | "audit-log-service";

export interface InternalAuthSignCommand {
  target: InternalAuthTarget;
  method: string;
  originalUrl: string;
  requestId: string;
  body?: unknown;
}

@Injectable()
export class InternalAuthSignerService {
  private readonly config = getAppConfig();

  sign(command: InternalAuthSignCommand): Record<string, string> {
    if (!this.config.internalAuth.enabled) {
      return {};
    }

    const secret = this.secretForTarget(command.target);
    const timestamp = new Date().toISOString();
    const bodyHash = createHash("sha256").update(this.canonicalBody(command.body)).digest("hex");
    const payload = [
      command.method.toUpperCase(),
      command.originalUrl,
      timestamp,
      command.requestId,
      bodyHash
    ].join("\n");
    const signature = createHmac("sha256", secret).update(payload).digest("hex");

    return {
      "X-Internal-Service-Id": this.config.internalAuth.serviceId,
      "X-Internal-Timestamp": timestamp,
      "X-Internal-Signature": signature
    };
  }

  private secretForTarget(target: InternalAuthTarget): string {
    if (target === "auth-iam-service" && this.config.internalAuth.authIamSecret) {
      return this.config.internalAuth.authIamSecret;
    }

    if (target === "tenant-service" && this.config.internalAuth.tenantSecret) {
      return this.config.internalAuth.tenantSecret;
    }

    if (target === "audit-log-service" && this.config.internalAuth.auditLogSecret) {
      return this.config.internalAuth.auditLogSecret;
    }

    throw new Error(`${target} internal auth secret is not configured`);
  }

  private canonicalBody(body: unknown): string {
    if (body === undefined) {
      return "";
    }

    return JSON.stringify(body);
  }
}
