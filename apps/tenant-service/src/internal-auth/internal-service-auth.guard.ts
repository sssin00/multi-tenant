import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { getAppConfig } from "../config/app.config.js";
import type { TenantRequest } from "../context/request-context.js";
import { INTERNAL_SERVICE_AUTH, type InternalServiceAuthOptions } from "./internal-service.decorator.js";

@Injectable()
export class InternalServiceAuthGuard implements CanActivate {
  private readonly config = getAppConfig();

  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<InternalServiceAuthOptions | undefined>(INTERNAL_SERVICE_AUTH, [
      context.getHandler(),
      context.getClass()
    ]);

    if (!options) {
      return true;
    }

    if (!this.config.internalAuth.enabled) {
      return true;
    }

    if (!this.config.internalAuth.secret) {
      throw new ServiceUnavailableException({
        code: "TENANT_INTERNAL_AUTH_NOT_READY",
        message: "Internal service authentication is not configured"
      });
    }

    const req = context.switchToHttp().getRequest<TenantRequest>();
    const serviceId = this.readHeader(req, "x-internal-service-id");
    const timestamp = this.readHeader(req, "x-internal-timestamp");
    const signature = this.readHeader(req, "x-internal-signature");

    if (!serviceId || !timestamp || !signature) {
      throw new UnauthorizedException({
        code: "TENANT_INTERNAL_AUTH_REQUIRED",
        message: "Internal service authentication is required"
      });
    }

    this.assertServiceAllowed(serviceId, options);
    this.assertTimestampFresh(timestamp);

    const expectedSignature = this.sign(req, timestamp);
    if (!this.safeEqual(signature, expectedSignature)) {
      throw new UnauthorizedException({
        code: "TENANT_INTERNAL_SIGNATURE_INVALID",
        message: "Internal service signature is invalid"
      });
    }

    return true;
  }

  private assertServiceAllowed(serviceId: string, options: InternalServiceAuthOptions) {
    if (!this.config.internalAuth.allowedServices.includes(serviceId)) {
      throw new ForbiddenException({
        code: "TENANT_INTERNAL_SERVICE_FORBIDDEN",
        message: "Internal service is not allowed"
      });
    }

    if (options.allowedServices && !options.allowedServices.includes(serviceId)) {
      throw new ForbiddenException({
        code: "TENANT_INTERNAL_SERVICE_FORBIDDEN",
        message: "Internal service is not allowed for this API"
      });
    }
  }

  private assertTimestampFresh(timestamp: string) {
    const value = Date.parse(timestamp);
    if (!Number.isFinite(value)) {
      throw new UnauthorizedException({
        code: "TENANT_INTERNAL_TIMESTAMP_INVALID",
        message: "Internal service timestamp is invalid"
      });
    }

    const skewMs = Math.abs(Date.now() - value);
    if (skewMs > this.config.internalAuth.timestampSkewSeconds * 1000) {
      throw new UnauthorizedException({
        code: "TENANT_INTERNAL_TIMESTAMP_EXPIRED",
        message: "Internal service timestamp is expired"
      });
    }
  }

  private sign(req: TenantRequest, timestamp: string): string {
    const bodyHash = createHash("sha256").update(this.canonicalBody(req.body)).digest("hex");
    const requestId = req.context?.requestId ?? "";
    const payload = [req.method.toUpperCase(), req.originalUrl, timestamp, requestId, bodyHash].join("\n");

    return createHmac("sha256", this.config.internalAuth.secret ?? "").update(payload).digest("hex");
  }

  private canonicalBody(body: unknown): string {
    if (body === undefined) {
      return "";
    }

    return JSON.stringify(body);
  }

  private safeEqual(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
  }

  private readHeader(req: TenantRequest, headerName: string): string | undefined {
    const value = req.headers[headerName];
    if (Array.isArray(value)) {
      return value[0];
    }

    return value;
  }
}
