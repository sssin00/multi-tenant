import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Response } from "express";

import { getAppConfig } from "../config/app.config.js";
import type { OutboxRequest } from "../context/request-context.js";

@Injectable()
export class AccessLogMiddleware implements NestMiddleware {
  private readonly config = getAppConfig();

  use(req: OutboxRequest, res: Response, next: NextFunction) {
    const startedAt = process.hrtime.bigint();

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          service: this.config.serviceName,
          env: this.config.env,
          message: "Request completed",
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
          requestId: req.context?.requestId,
          tenantId: req.context?.tenantId,
          userId: req.context?.userId
        })
      );
    });

    next();
  }
}
