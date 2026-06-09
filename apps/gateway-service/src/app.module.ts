import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { GatewayAuthGuard } from "./auth/gateway-auth.guard.js";
import { JwtVerifier } from "./auth/jwt-verifier.js";
import { RequestContextMiddleware } from "./context/request-context.middleware.js";
import { GlobalExceptionFilter } from "./errors/global-exception.filter.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { AccessLogMiddleware } from "./logging/access-log.middleware.js";
import { ProxyController } from "./proxy/proxy.controller.js";
import { ProxyService } from "./proxy/proxy.service.js";
import { RateLimitGuard } from "./rate-limit/rate-limit.guard.js";
import { RedisRateLimitService } from "./rate-limit/redis-rate-limit.service.js";
import { SecurityHeadersMiddleware } from "./security/security-headers.middleware.js";
import { TenantStatusGuard } from "./tenant/tenant-status.guard.js";
import { TenantStatusService } from "./tenant/tenant-status.service.js";

@Module({
  controllers: [HealthController, ProxyController],
  providers: [
    GlobalExceptionFilter,
    HealthService,
    JwtVerifier,
    ProxyService,
    RedisRateLimitService,
    TenantStatusService,
    {
      provide: APP_GUARD,
      useClass: GatewayAuthGuard
    },
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard
    },
    {
      provide: APP_GUARD,
      useClass: TenantStatusGuard
    }
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware, SecurityHeadersMiddleware, AccessLogMiddleware).forRoutes("*");
  }
}
