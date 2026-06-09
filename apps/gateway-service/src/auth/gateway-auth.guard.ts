import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { GatewayRequest } from "../context/request-context.js";
import { JwtVerifier } from "./jwt-verifier.js";
import { IS_PUBLIC_ROUTE } from "./public.decorator.js";

@Injectable()
export class GatewayAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(JwtVerifier)
    private readonly jwtVerifier: JwtVerifier
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass()
    ]);

    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<GatewayRequest>();
    if (!req.path.startsWith("/api/v1/")) {
      return true;
    }

    const token = this.readBearerToken(req);
    const claims = this.jwtVerifier.verify(token);
    req.context.userId = claims.sub;

    if (req.context.tenantId && req.context.tenantId !== claims.tenantId) {
      throw new ForbiddenException({
        code: "TENANT_MISMATCH",
        message: "Tenant mismatch",
        details: {
          source: "jwt_header"
        }
      });
    }

    req.context.tenantId = claims.tenantId;
    return true;
  }

  private readBearerToken(req: GatewayRequest): string {
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Missing bearer token"
      });
    }

    return authorization.slice("Bearer ".length).trim();
  }
}
