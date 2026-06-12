import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Response } from "express";

import { getAppConfig } from "../config/app.config.js";
import type { AdminBffRequest } from "../context/request-context.js";

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  private readonly config = getAppConfig();

  use(req: AdminBffRequest, res: Response, next: NextFunction) {
    if (!this.config.securityHeaders.enabled) {
      next();
      return;
    }

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");

    if (req.secure || req.headers["x-forwarded-proto"] === "https") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }

    next();
  }
}
