import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { InternalAuditLogsController } from "./audit-logs/internal-audit-logs.controller.js";
import { AuditLogsRepository } from "./audit-logs/audit-logs.repository.js";
import { AuditLogsService } from "./audit-logs/audit-logs.service.js";
import { AuditLogEventConsumer } from "./audit-events/audit-log-event.consumer.js";
import { SqsAuditEventWorker } from "./audit-events/sqs-audit-event.worker.js";
import { RequestContextMiddleware } from "./context/request-context.middleware.js";
import { PrismaService } from "./database/prisma.service.js";
import { GlobalExceptionFilter } from "./errors/global-exception.filter.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { InternalServiceAuthGuard } from "./internal-auth/internal-service-auth.guard.js";
import { AccessLogMiddleware } from "./logging/access-log.middleware.js";
import { SecurityHeadersMiddleware } from "./security/security-headers.middleware.js";

@Module({
  controllers: [HealthController, InternalAuditLogsController],
  providers: [
    GlobalExceptionFilter,
    {
      provide: APP_GUARD,
      useClass: InternalServiceAuthGuard
    },
    HealthService,
    PrismaService,
    AuditLogsRepository,
    AuditLogsService,
    AuditLogEventConsumer,
    SqsAuditEventWorker
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware, SecurityHeadersMiddleware, AccessLogMiddleware).forRoutes("*");
  }
}
