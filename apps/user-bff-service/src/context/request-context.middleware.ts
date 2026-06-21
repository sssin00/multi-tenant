import type { NextFunction, Response } from "express";
import { Injectable, NestMiddleware } from "@nestjs/common";
import { createRequestId, loadAppConfig } from "../config/app.config.js";
import type { RequestWithContext } from "./request-context.js";

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly config = loadAppConfig();

  use(req: RequestWithContext, res: Response, next: NextFunction): void {
    const requestId = this.readHeader(req, this.config.requestIdHeader) ?? createRequestId();
    const tenantId = this.readHeader(req, this.config.tenantHeader);
    const userId = this.readHeader(req, "x-user-id");
    const authorization = this.readHeader(req, "authorization");

    req.context = {
      requestId,
      ...(tenantId ? { tenantId } : {}),
      ...(userId ? { userId } : {}),
      ...(authorization ? { authorization } : {})
    };

    res.setHeader("X-Request-Id", requestId);
    if (tenantId) {
      res.setHeader("X-Tenant-Id", tenantId);
    }

    next();
  }

  private readHeader(req: RequestWithContext, name: string): string | undefined {
    const value = req.headers[name.toLowerCase()];
    if (Array.isArray(value)) {
      return value[0];
    }

    return value;
  }
}
