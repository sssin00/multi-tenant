import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { AdminAuditService } from "./audit/admin-audit.service.js";
import { AdminAuditLogsController } from "./audit/admin-audit-logs.controller.js";
import { AdminPermissionGuard } from "./auth/admin-permission.guard.js";
import { RequestContextMiddleware } from "./context/request-context.middleware.js";
import { AdminDashboardController } from "./dashboard/admin-dashboard.controller.js";
import { GlobalExceptionFilter } from "./errors/global-exception.filter.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { AuditLogInternalClient } from "./internal-clients/audit-log-internal.client.js";
import { AuthIamInternalClient } from "./internal-clients/auth-iam-internal.client.js";
import { InternalAuthSignerService } from "./internal-clients/internal-auth-signer.service.js";
import { TenantInternalClient } from "./internal-clients/tenant-internal.client.js";
import { AccessLogMiddleware } from "./logging/access-log.middleware.js";
import { AdminAccessControlScreenController } from "./rbac/admin-access-control-screen.controller.js";
import { AdminRbacController } from "./rbac/admin-rbac.controller.js";
import { SecurityHeadersMiddleware } from "./security/security-headers.middleware.js";
import { AdminMeController } from "./session/admin-me.controller.js";
import { AdminTenantsController } from "./tenants/admin-tenants.controller.js";
import { TenantStatusGuard } from "./tenants/tenant-status.guard.js";
import { AdminUsersController } from "./users/admin-users.controller.js";

@Module({
  controllers: [
    HealthController,
    AdminTenantsController,
    AdminUsersController,
    AdminRbacController,
    AdminAccessControlScreenController,
    AdminDashboardController,
    AdminMeController,
    AdminAuditLogsController
  ],
  providers: [
    GlobalExceptionFilter,
    AdminAuditService,
    HealthService,
    AuditLogInternalClient,
    AuthIamInternalClient,
    TenantInternalClient,
    InternalAuthSignerService,
    {
      provide: APP_GUARD,
      useClass: TenantStatusGuard
    },
    {
      provide: APP_GUARD,
      useClass: AdminPermissionGuard
    }
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware, SecurityHeadersMiddleware, AccessLogMiddleware).forRoutes("*");
  }
}
