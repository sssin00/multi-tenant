import { createHash, randomBytes } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from "@nestjs/common";

import { getAppConfig } from "../config/app.config.js";
import type { AuthIamRequestContext } from "../context/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { UserStatus, UserType } from "../generated/prisma/enums.js";
import { JwtSigner } from "./jwt-signer.js";
import { PasswordHasher } from "./password-hasher.js";

const ADMIN_LOGIN_PERMISSIONS = new Set([
  "tenant.tenants.read",
  "auth.users.read",
  "auth.roles.read",
  "auth.permissions.read",
  "audit.logs.read"
]);

export interface LoginCommand {
  email?: unknown;
  password?: unknown;
  tenantId?: unknown;
  headerTenantId?: string;
}

export interface TokenPairResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
  tokenType: "Bearer";
}

export type LoginResult = TokenPairResult;

export interface MeResult {
  user: {
    id: string;
    tenantId: string | null;
    email: string;
    displayName: string;
    userType: UserType;
    status: UserStatus;
    createdAt: string;
    updatedAt: string;
  };
  roles: Array<{
    roleId: string;
    roleCode: string;
    warehouseId: string | null;
  }>;
  permissions: string[];
}

export interface RefreshCommand {
  refreshToken?: unknown;
  tenantId?: unknown;
  headerTenantId?: string;
}

export interface RevokeCommand {
  refreshToken?: unknown;
  tenantId?: unknown;
  headerTenantId?: string;
  userId?: string;
}

export interface RevokeResult {
  revoked: boolean;
  revokedCount: number;
}

interface LoginUserRecord {
  id: string;
  tenantId: string | null;
  email: string;
  displayName: string;
  passwordHash: string;
  userType: UserType;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
  userRoles?: Array<{
    role: {
      code: string;
      rolePermissions: Array<{
        permission: {
          code: string;
        };
      }>;
    };
  }>;
}

@Injectable()
export class AuthService {
  private readonly config = getAppConfig();

  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(PasswordHasher)
    private readonly passwordHasher: PasswordHasher,
    @Inject(JwtSigner)
    private readonly jwtSigner: JwtSigner
  ) {}

  async login(command: LoginCommand): Promise<LoginResult> {
    const input = this.validateLoginCommand(command);
    const user = input.tenantId
      ? await this.findTenantLoginUser(input.tenantId, input.email)
      : await this.resolveAdminLoginUser(input.email, input.password);

    if (!user) {
      throw this.invalidCredentials();
    }

    if (user.status !== UserStatus.active) {
      throw new ForbiddenException({
        code: "AUTH_ACCOUNT_LOCKED",
        message: "Account is not active"
      });
    }

    if (input.tenantId && !(await this.passwordHasher.verify(input.password, user.passwordHash))) {
      throw this.invalidCredentials();
    }

    const { accessToken, expiresIn } = this.jwtSigner.signAccessToken(user.id, user.tenantId, user.userType);
    const refreshToken = this.createOpaqueToken();
    const refreshExpiresIn = this.config.auth.refreshTokenTtlSeconds;
    const expiresAt = new Date(Date.now() + refreshExpiresIn * 1000);

    await this.prismaService.refreshToken.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        tokenHash: this.hashRefreshToken(refreshToken),
        expiresAt
      }
    });

    return {
      accessToken,
      expiresIn,
      refreshToken,
      refreshExpiresIn,
      tokenType: "Bearer"
    };
  }

  private async findTenantLoginUser(tenantId: string, email: string): Promise<LoginUserRecord | null> {
    return this.prismaService.authUser.findUnique({
      where: {
        tenantId_email: {
          tenantId,
          email
        }
      }
    });
  }

  private async resolveAdminLoginUser(email: string, password: string): Promise<LoginUserRecord | null> {
    const users = await this.prismaService.authUser.findMany({
      where: {
        email
      },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true
                  }
                }
              }
            }
          }
        }
      },
      orderBy: [
        {
          userType: "desc"
        },
        {
          createdAt: "asc"
        }
      ]
    });

    const matches: LoginUserRecord[] = [];
    for (const user of users) {
      if (!this.isAdminLoginEligible(user)) {
        continue;
      }

      if (await this.passwordHasher.verify(password, user.passwordHash)) {
        matches.push(user);
      }
    }

    if (matches.length > 1) {
      throw new ConflictException({
        code: "AUTH_LOGIN_AMBIGUOUS",
        message: "Multiple administrator accounts match this email",
        details: {
          fields: {
            email: "email matches multiple administrator accounts"
          }
        }
      });
    }

    return matches[0] ?? null;
  }

  private isAdminLoginEligible(user: LoginUserRecord): boolean {
    if (user.userType === UserType.system_admin && user.tenantId === null) {
      return true;
    }

    return user.userRoles?.some((userRole) => {
      if (userRole.role.code === "tenant_admin") {
        return true;
      }

      return userRole.role.rolePermissions.some((rolePermission) =>
        ADMIN_LOGIN_PERMISSIONS.has(rolePermission.permission.code)
      );
    }) ?? false;
  }

  async refresh(command: RefreshCommand): Promise<TokenPairResult> {
    const input = this.validateRefreshCommand(command);
    const tokenHash = this.hashRefreshToken(input.refreshToken);
    const now = new Date();

    return this.prismaService.$transaction(async (tx) => {
      const currentToken = await tx.refreshToken.findUnique({
        where: {
          tokenHash
        },
        include: {
          user: true
        }
      });

      if (
        !currentToken ||
        currentToken.revokedAt ||
        currentToken.expiresAt <= now ||
        currentToken.user.status !== UserStatus.active
      ) {
        throw this.invalidToken();
      }

      if (input.tenantId && currentToken.tenantId !== input.tenantId) {
        throw this.tenantMismatch("refresh_token");
      }

      const { accessToken, expiresIn } = this.jwtSigner.signAccessToken(
        currentToken.userId,
        currentToken.tenantId,
        currentToken.user.userType
      );
      const refreshToken = this.createOpaqueToken();
      const refreshExpiresIn = this.config.auth.refreshTokenTtlSeconds;
      const nextToken = await tx.refreshToken.create({
        data: {
          tenantId: currentToken.tenantId,
          userId: currentToken.userId,
          tokenHash: this.hashRefreshToken(refreshToken),
          expiresAt: new Date(now.getTime() + refreshExpiresIn * 1000)
        }
      });

      await tx.refreshToken.update({
        where: {
          id: currentToken.id
        },
        data: {
          revokedAt: now,
          replacedBy: nextToken.id
        }
      });

      return {
        accessToken,
        expiresIn,
        refreshToken,
        refreshExpiresIn,
        tokenType: "Bearer"
      };
    });
  }

  async me(context: AuthIamRequestContext): Promise<MeResult> {
    const userId = this.requireUserContext(context.userId);
    const user = await this.prismaService.authUser.findUnique({
      where: {
        id: userId
      },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true
                  }
                }
              }
            }
          },
          orderBy: {
            createdAt: "asc"
          }
        }
      }
    });

    if (!user) {
      throw new NotFoundException({
        code: "AUTH_USER_NOT_FOUND",
        message: "User not found"
      });
    }

    if (user.status !== UserStatus.active) {
      throw new ForbiddenException({
        code: "AUTH_ACCOUNT_LOCKED",
        message: "Account is not active"
      });
    }

    if (context.tenantId && user.tenantId !== context.tenantId) {
      throw this.tenantMismatch("jwt_context");
    }

    if (!context.tenantId && user.userType !== UserType.system_admin) {
      this.requireTenantContext(context.tenantId);
    }

    const permissionCodes = new Set<string>();
    if (user.userType === UserType.system_admin) {
      const permissions = await this.prismaService.permission.findMany({
        select: {
          code: true
        },
        orderBy: {
          code: "asc"
        }
      });
      for (const permission of permissions) {
        permissionCodes.add(permission.code);
      }
    } else {
      for (const assignment of user.userRoles) {
        for (const rolePermission of assignment.role.rolePermissions) {
          permissionCodes.add(rolePermission.permission.code);
        }
      }
    }

    return {
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        displayName: user.displayName,
        userType: user.userType,
        status: user.status,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString()
      },
      roles: user.userType === UserType.system_admin
        ? [{ roleId: "system_admin", roleCode: "system_admin", warehouseId: null }]
        : user.userRoles.map((assignment) => ({
          roleId: assignment.role.id,
          roleCode: assignment.role.code,
          warehouseId: assignment.warehouseId
        })),
      permissions: [...permissionCodes].sort()
    };
  }

  async revoke(command: RevokeCommand): Promise<RevokeResult> {
    const input = this.validateRevokeCommand(command);
    const now = new Date();

    if (input.refreshToken) {
      const tokenHash = this.hashRefreshToken(input.refreshToken);
      const refreshToken = await this.prismaService.refreshToken.findUnique({
        where: {
          tokenHash
        }
      });

      if (!refreshToken) {
        return {
          revoked: true,
          revokedCount: 0
        };
      }

      if (input.tenantId && refreshToken.tenantId !== input.tenantId) {
        throw this.tenantMismatch("refresh_token");
      }

      if (input.userId && refreshToken.userId !== input.userId) {
        throw new ForbiddenException({
          code: "FORBIDDEN",
          message: "Forbidden"
        });
      }

      const result = await this.prismaService.refreshToken.updateMany({
        where: {
          id: refreshToken.id,
          revokedAt: null
        },
        data: {
          revokedAt: now
        }
      });

      return {
        revoked: true,
        revokedCount: result.count
      };
    }

    if (!input.userId) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Validation failed",
        details: {
          fields: {
            refreshToken: "refreshToken or authenticated user context is required"
          }
        }
      });
    }

    const result = await this.prismaService.refreshToken.updateMany({
      where: {
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        userId: input.userId,
        revokedAt: null
      },
      data: {
        revokedAt: now
      }
    });

    return {
      revoked: true,
      revokedCount: result.count
    };
  }

  private validateLoginCommand(command: LoginCommand): { email: string; password: string; tenantId?: string } {
    const email = typeof command.email === "string" ? command.email.trim().toLowerCase() : "";
    const password = typeof command.password === "string" ? command.password : "";
    const tenant = this.validateTenant(command.tenantId, command.headerTenantId, false);
    const fields: Record<string, string> = {};

    if (tenant.error) {
      fields.tenantId = tenant.error;
    }

    if (!email) {
      fields.email = "email is required";
    }

    if (!password) {
      fields.password = "password is required";
    }

    if (Object.keys(fields).length > 0) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Validation failed",
        details: {
          fields
        }
      });
    }

    return {
      email,
      password,
      ...(tenant.tenantId ? { tenantId: tenant.tenantId } : {})
    };
  }

  private requireTenantContext(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        code: "TENANT_REQUIRED",
        message: "Tenant is required",
        details: {
          fields: {
            tenantId: "X-Tenant-Id is required"
          }
        }
      });
    }

    return tenantId;
  }

  private requireUserContext(userId: string | undefined): string {
    if (!userId) {
      throw new UnauthorizedException({
        code: "AUTH_INVALID_TOKEN",
        message: "Authenticated user context is required"
      });
    }

    return userId;
  }

  private validateRefreshCommand(command: RefreshCommand): { refreshToken: string; tenantId?: string } {
    const refreshToken = typeof command.refreshToken === "string" ? command.refreshToken.trim() : "";
    const tenant = this.validateTenant(command.tenantId, command.headerTenantId, false);
    const fields: Record<string, string> = {};

    if (tenant.error) {
      fields.tenantId = tenant.error;
    }

    if (!refreshToken) {
      fields.refreshToken = "refreshToken is required";
    }

    if (Object.keys(fields).length > 0) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Validation failed",
        details: {
          fields
        }
      });
    }

    return {
      refreshToken,
      tenantId: tenant.tenantId
    };
  }

  private validateRevokeCommand(command: RevokeCommand): {
    refreshToken?: string;
    tenantId?: string;
    userId?: string;
  } {
    const refreshToken = typeof command.refreshToken === "string" ? command.refreshToken.trim() : undefined;
    const tenant = this.validateTenant(command.tenantId, command.headerTenantId, false);
    const userId = command.userId;
    const fields: Record<string, string> = {};

    if (tenant.error) {
      fields.tenantId = tenant.error;
    }

    if (userId && !this.isUuid(userId)) {
      fields.userId = "userId must be a UUID";
    }

    if (Object.keys(fields).length > 0) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Validation failed",
        details: {
          fields
        }
      });
    }

    return {
      refreshToken,
      tenantId: tenant.tenantId,
      userId
    };
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException({
      code: "AUTH_INVALID_CREDENTIALS",
      message: "Invalid credentials"
    });
  }

  private invalidToken(): UnauthorizedException {
    return new UnauthorizedException({
      code: "AUTH_INVALID_TOKEN",
      message: "Invalid token"
    });
  }

  private createOpaqueToken(): string {
    return randomBytes(48).toString("base64url");
  }

  private hashRefreshToken(token: string): string {
    return createHash("sha256").update(token).digest("base64url");
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private validateTenant(
    bodyTenantId: unknown,
    headerTenantId: string | undefined,
    required: boolean
  ): { tenantId?: string; error?: string } {
    const bodyTenant = typeof bodyTenantId === "string" ? bodyTenantId.trim() : undefined;
    const tenantId = bodyTenant ?? headerTenantId;

    if (bodyTenant && headerTenantId && bodyTenant !== headerTenantId) {
      throw this.tenantMismatch("body_header");
    }

    if (!tenantId) {
      return required ? { error: "tenantId is required" } : {};
    }

    if (!this.isUuid(tenantId)) {
      return { error: "tenantId must be a UUID" };
    }

    return { tenantId };
  }

  private tenantMismatch(source: string): ForbiddenException {
    return new ForbiddenException({
      code: "TENANT_MISMATCH",
      message: "Tenant mismatch",
      details: {
        source
      }
    });
  }
}
