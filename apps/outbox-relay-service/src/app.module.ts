import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";

import { RequestContextMiddleware } from "./context/request-context.middleware.js";
import { GlobalExceptionFilter } from "./errors/global-exception.filter.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { AccessLogMiddleware } from "./logging/access-log.middleware.js";
import { RelayOperationsController } from "./operations/relay-operations.controller.js";
import { RelayWorkerService } from "./relay/relay-worker.service.js";
import { RelayStatusService } from "./relay/relay-status.service.js";
import { SecurityHeadersMiddleware } from "./security/security-headers.middleware.js";
import { OutboxSourceRegistryService } from "./sources/outbox-source-registry.service.js";

@Module({
  controllers: [HealthController, RelayOperationsController],
  providers: [GlobalExceptionFilter, HealthService, RelayStatusService, RelayWorkerService, OutboxSourceRegistryService]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware, SecurityHeadersMiddleware, AccessLogMiddleware).forRoutes("*");
  }
}
