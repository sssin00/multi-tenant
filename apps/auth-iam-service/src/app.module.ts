import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { JwtSigner } from "./auth/jwt-signer.js";
import { PasswordHasher } from "./auth/password-hasher.js";
import { RedisService } from "./cache/redis.service.js";
import { RequestContextMiddleware } from "./context/request-context.middleware.js";
import { PrismaService } from "./database/prisma.service.js";
import { GlobalExceptionFilter } from "./errors/global-exception.filter.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { InternalServiceAuthGuard } from "./internal-auth/internal-service-auth.guard.js";
import { AccessLogMiddleware } from "./logging/access-log.middleware.js";
import { OutboxEventService } from "./outbox/outbox-event.service.js";
import { PermissionsController } from "./permissions/permissions.controller.js";
import { PermissionsService } from "./permissions/permissions.service.js";
import { RbacService } from "./permissions/rbac.service.js";
import { SecurityHeadersMiddleware } from "./security/security-headers.middleware.js";
import { UsersController } from "./users/users.controller.js";
import { UsersService } from "./users/users.service.js";

@Module({
  controllers: [HealthController, AuthController, UsersController, PermissionsController],
  providers: [
    GlobalExceptionFilter,
    {
      provide: APP_GUARD,
      useClass: InternalServiceAuthGuard
    },
    HealthService,
    PrismaService,
    RedisService,
    AuthService,
    PasswordHasher,
    JwtSigner,
    OutboxEventService,
    UsersService,
    PermissionsService,
    RbacService
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware, SecurityHeadersMiddleware, AccessLogMiddleware).forRoutes("*");
  }
}
