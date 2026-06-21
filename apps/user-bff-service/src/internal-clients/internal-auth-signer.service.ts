import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { loadAppConfig } from "../config/app.config.js";

export interface InternalAuthHeaders {
  "X-Internal-Service-Id": string;
  "X-Internal-Timestamp": string;
  "X-Internal-Signature": string;
}

interface SignInput {
  method: string;
  path: string;
  requestId: string;
  body?: unknown;
  secret: string;
}

@Injectable()
export class InternalAuthSignerService {
  private readonly config = loadAppConfig();

  sign(input: SignInput): InternalAuthHeaders {
    const timestamp = new Date().toISOString();
    const payload = this.createPayload(input.method, input.path, timestamp, input.requestId, input.body);
    const signature = createHmac("sha256", input.secret).update(payload).digest("hex");

    return {
      "X-Internal-Service-Id": this.config.internalAuth.serviceId,
      "X-Internal-Timestamp": timestamp,
      "X-Internal-Signature": signature
    };
  }

  verify(input: SignInput & { timestamp: string; signature: string }): boolean {
    const timestampMs = Date.parse(input.timestamp);
    if (Number.isNaN(timestampMs)) {
      return false;
    }

    const skewMs = this.config.internalAuth.timestampSkewSeconds * 1000;
    if (Math.abs(Date.now() - timestampMs) > skewMs) {
      return false;
    }

    const payload = this.createPayload(input.method, input.path, input.timestamp, input.requestId, input.body);
    const expected = createHmac("sha256", input.secret).update(payload).digest("hex");

    const expectedBuffer = Buffer.from(expected, "hex");
    const actualBuffer = Buffer.from(input.signature, "hex");
    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, actualBuffer);
  }

  private createPayload(method: string, path: string, timestamp: string, requestId: string, body?: unknown): string {
    const bodyHash = createHash("sha256").update(this.canonicalBody(body)).digest("hex");
    return [method.toUpperCase(), path, timestamp, requestId, bodyHash].join("\n");
  }

  private canonicalBody(body: unknown): string {
    if (body === undefined || this.isEmptyObject(body)) {
      return "";
    }

    return JSON.stringify(body);
  }

  private isEmptyObject(value: unknown): value is Record<string, never> {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    );
  }
}
