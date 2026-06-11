import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { RedisService } from "./cache/redis.service.js";
import { RequestContextMiddleware } from "./context/request-context.middleware.js";
import { PrismaService } from "./database/prisma.service.js";
import { GlobalExceptionFilter } from "./errors/global-exception.filter.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { InternalServiceAuthGuard } from "./internal-auth/internal-service-auth.guard.js";
import { AccessLogMiddleware } from "./logging/access-log.middleware.js";
import { OutboxEventService } from "./outbox/outbox-event.service.js";
import { SecurityHeadersMiddleware } from "./security/security-headers.middleware.js";
import { AdminTenantsController } from "./tenants/admin-tenants.controller.js";
import { TenantsController } from "./tenants/tenants.controller.js";
import { TenantsService } from "./tenants/tenants.service.js";

@Module({
  controllers: [HealthController, TenantsController, AdminTenantsController],
  providers: [
    GlobalExceptionFilter,
    {
      provide: APP_GUARD,
      useClass: InternalServiceAuthGuard
    },
    HealthService,
    PrismaService,
    RedisService,
    OutboxEventService,
    TenantsService
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware, SecurityHeadersMiddleware, AccessLogMiddleware).forRoutes("*");
  }
}
