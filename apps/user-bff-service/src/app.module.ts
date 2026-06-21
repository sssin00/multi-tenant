import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { AppContextController } from "./app-context/app-context.controller.js";
import { AccessLogMiddleware } from "./logging/access-log.middleware.js";
import { AppAuditPublisher } from "./audit/app-audit.publisher.js";
import { AppAuditService } from "./audit/app-audit.service.js";
import { AppPermissionGuard } from "./auth/app-permission.guard.js";
import { AuditLogInternalClient } from "./internal-clients/audit-log-internal.client.js";
import { AuthIamInternalClient } from "./internal-clients/auth-iam-internal.client.js";
import { GlobalExceptionFilter } from "./errors/global-exception.filter.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { InternalAuthSignerService } from "./internal-clients/internal-auth-signer.service.js";
import { InternalHttpClient } from "./internal-clients/internal-http.client.js";
import { RequestContextMiddleware } from "./context/request-context.middleware.js";
import { SecurityHeadersMiddleware } from "./security/security-headers.middleware.js";
import { TenantInternalClient } from "./internal-clients/tenant-internal.client.js";
import { TenantStatusGuard } from "./tenants/tenant-status.guard.js";
import { WmsInternalClient } from "./internal-clients/wms-internal.client.js";
import { WmsScreenController } from "./wms/wms-screen.controller.js";
import { WmsScreenService } from "./wms/wms-screen.service.js";

@Module({
  controllers: [HealthController, AppContextController, WmsScreenController],
  providers: [
    HealthService,
    InternalAuthSignerService,
    InternalHttpClient,
    AuditLogInternalClient,
    AppAuditPublisher,
    AppAuditService,
    AuthIamInternalClient,
    TenantInternalClient,
    WmsInternalClient,
    WmsScreenService,
    TenantStatusGuard,
    AppPermissionGuard,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter
    }
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware, SecurityHeadersMiddleware, AccessLogMiddleware).forRoutes("*");
  }
}
