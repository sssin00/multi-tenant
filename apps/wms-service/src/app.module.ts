import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { RequestContextMiddleware } from "./context/request-context.middleware.js";
import { PrismaService } from "./database/prisma.service.js";
import { GlobalExceptionFilter } from "./errors/global-exception.filter.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { InternalServiceAuthGuard } from "./internal-auth/internal-service-auth.guard.js";
import { AuthIamInternalClient } from "./internal-clients/auth-iam-internal.client.js";
import { InternalAuthSignerService } from "./internal-clients/internal-auth-signer.service.js";
import { TenantInternalClient } from "./internal-clients/tenant-internal.client.js";
import { AccessLogMiddleware } from "./logging/access-log.middleware.js";
import { OutboxEventService } from "./outbox/outbox-event.service.js";
import { SecurityHeadersMiddleware } from "./security/security-headers.middleware.js";
import { WmsController } from "./wms/wms.controller.js";
import { WmsService } from "./wms/wms.service.js";

@Module({
  controllers: [HealthController, WmsController],
  providers: [
    GlobalExceptionFilter,
    {
      provide: APP_GUARD,
      useClass: InternalServiceAuthGuard
    },
    HealthService,
    PrismaService,
    OutboxEventService,
    InternalAuthSignerService,
    AuthIamInternalClient,
    TenantInternalClient,
    WmsService
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware, SecurityHeadersMiddleware, AccessLogMiddleware).forRoutes("*");
  }
}
