import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { RequestContextMiddleware } from "./context/request-context.middleware.js";
import { GlobalExceptionFilter } from "./errors/global-exception.filter.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { InternalServiceAuthGuard } from "./internal-auth/internal-service-auth.guard.js";
import { AccessLogMiddleware } from "./logging/access-log.middleware.js";
import { SecurityHeadersMiddleware } from "./security/security-headers.middleware.js";

@Module({
  controllers: [HealthController],
  providers: [
    GlobalExceptionFilter,
    {
      provide: APP_GUARD,
      useClass: InternalServiceAuthGuard
    },
    HealthService
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware, SecurityHeadersMiddleware, AccessLogMiddleware).forRoutes("*");
  }
}
