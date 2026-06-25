export interface ApiEnvelope<T> {
  success: boolean;
  requestId: string;
  timestamp: string;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PageData<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

export interface AdminSession {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  refreshExpiresIn?: number;
  tokenType: "Bearer";
  tenantId: string | null;
  user: {
    userId: string;
    email: string;
    displayName: string;
  };
}

export interface DataResult<T> {
  data: T;
  source: "api" | "sample";
  requestId?: string;
  message?: string;
}

export interface AdminMe {
  user: {
    id: string;
    tenantId: string | null;
    email: string;
    displayName: string;
    status: string;
  };
  tenant: {
    tenantId: string | null;
    status: string;
  };
  roles: Array<{
    roleId: string;
    roleCode: string;
    warehouseId: string | null;
  }>;
  permissions: string[];
  enabledModules: string[];
  navigation: Array<{
    key: string;
    label: string;
    path: string;
  }>;
}

export interface AdminDashboardData {
  admin: {
    userId?: string;
    tenantId?: string | null;
    roles: Array<{
      roleId: string;
      roleCode: string;
      warehouseId: string | null;
    }>;
    permissions: string[];
  };
  tenantSummary: {
    total: number;
    statusCounts: Record<string, number>;
    enabledModules: Record<string, number>;
    recentItems: TenantItem[];
  };
  accessSummary: {
    usersTotal: number;
    rolesTotal: number;
    permissionsTotal: number;
    lockedUsers: number;
    roleSamples: RoleItem[];
    permissionSamples: PermissionItem[];
  };
  auditSummary: {
    total: number;
    recentItems: AuditLogItem[];
  };
  riskSummary: {
    provisioningTenants: number;
    suspendedTenants: number;
    lockedUsers: number;
    failedAuditLogs: number;
  };
}

export interface TenantItem {
  tenantId: string;
  code: string;
  name: string;
  status: string;
  domains: string[];
  enabledModules: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TenantDetail extends Omit<TenantItem, "domains"> {
  dbStrategy?: string;
  domains: TenantDomainItem[];
  settings: Record<string, unknown>;
}

export interface TenantDomainItem {
  domainId: string;
  tenantId: string;
  domain: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserItem {
  userId?: string;
  id?: string;
  tenantId: string | null;
  email: string;
  displayName: string;
  status: string;
  userType?: string;
  roleCodes?: string[];
  lastLoginAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface UserRoleItem {
  userRoleId?: string;
  id?: string;
  userId: string;
  roleId: string;
  roleCode?: string;
  warehouseId: string | null;
  createdAt?: string;
}

export interface RoleItem {
  roleId?: string;
  id?: string;
  tenantId?: string | null;
  code: string;
  name: string;
  description?: string | null;
  permissionCodes?: string[];
  permissions?: string[];
}

export interface PermissionItem {
  permissionId?: string;
  id?: string;
  code: string;
  description?: string | null;
}

export interface AccessControlData {
  users: PageData<UserItem>;
  roles: PageData<RoleItem>;
  permissions: PageData<PermissionItem>;
}

export interface AuditLogItem {
  auditId: string;
  occurredAt: string;
  tenantId: string;
  actor: {
    type: string;
    userId?: string;
  };
  action: string;
  resource: {
    type: string;
    id: string;
  };
  result: string;
  requestId: string;
}
