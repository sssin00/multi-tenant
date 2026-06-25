import type {
  AccessControlData,
  AdminDashboardData,
  AdminMe,
  AdminSession,
  AuditLogItem,
  PageData,
  TenantItem,
  UserRoleItem
} from "./api-types";

const sampleTenantId = "11111111-1111-4111-8111-111111111111";

export const sampleSession: AdminSession = {
  accessToken: "sample-admin-access-token",
  refreshToken: "sample-refresh-token",
  expiresIn: 1800,
  refreshExpiresIn: 1209600,
  tokenType: "Bearer",
  tenantId: null,
  user: {
    userId: "admin-user-001",
    email: "admin@example.com",
    displayName: "관리자"
  }
};

export const sampleMe: AdminMe = {
  user: {
    id: "admin-user-001",
    tenantId: null,
    email: "admin@example.com",
    displayName: "관리자",
    status: "active"
  },
  tenant: {
    tenantId: null,
    status: "system_admin"
  },
  roles: [
    {
      roleId: "role-system-admin",
      roleCode: "system_admin",
      warehouseId: null
    }
  ],
  permissions: [
    "tenant.tenants.read",
    "tenant.tenants.updateStatus",
    "auth.users.read",
    "auth.roles.read",
    "auth.permissions.read",
    "audit.logs.read"
  ],
  enabledModules: ["auth", "tenant", "wms"],
  navigation: [
    { key: "dashboard", label: "관리 대시보드", path: "/dashboard" },
    { key: "tenants", label: "고객사 관리", path: "/tenants" },
    { key: "access-control", label: "사용자 관리", path: "/access-control" },
    { key: "roles", label: "역할/권한", path: "/roles" },
    { key: "audit-logs", label: "감사 로그", path: "/audit-logs" },
    { key: "risk-actions", label: "위험 작업", path: "/risk-actions" }
  ]
};

export const sampleTenants: PageData<TenantItem> = {
  page: 1,
  size: 20,
  total: 3,
  items: [
    {
      tenantId: "11111111-1111-4111-8111-111111111111",
      code: "DEMO0001",
      name: "Demo Tenant",
      status: "active",
      domains: ["demo.example.com"],
      enabledModules: ["auth", "tenant", "wms"],
      createdAt: "2026-06-11T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z"
    },
    {
      tenantId: "22222222-2222-4222-8222-222222222222",
      code: "ACME0001",
      name: "ACME Korea",
      status: "provisioning",
      domains: ["factory.acme.co.kr"],
      enabledModules: ["auth", "tenant"],
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z"
    },
    {
      tenantId: "33333333-3333-4333-8333-333333333333",
      code: "HOLD0001",
      name: "Hold Tenant",
      status: "suspended",
      domains: ["hold.example.com"],
      enabledModules: ["auth"],
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-21T04:30:00.000Z"
    }
  ]
};

export const sampleAccessControl: AccessControlData = {
  users: {
    page: 1,
    size: 20,
    total: 3,
    items: [
      {
        userId: "admin-user-001",
        tenantId: sampleSession.tenantId,
        email: "admin@example.com",
        displayName: "관리자",
        status: "active",
        userType: "general_user",
        roleCodes: ["tenant_admin"],
        lastLoginAt: "2026-06-23T04:10:00.000Z"
      },
      {
        userId: "operator-user-001",
        tenantId: sampleSession.tenantId,
        email: "operator@example.com",
        displayName: "창고 운영자",
        status: "active",
        userType: "general_user",
        roleCodes: ["wms_manager"],
        lastLoginAt: "2026-06-23T02:30:00.000Z"
      },
      {
        userId: "locked-user-001",
        tenantId: sampleSession.tenantId,
        email: "locked@example.com",
        displayName: "잠금 사용자",
        status: "locked",
        userType: "general_user",
        roleCodes: ["viewer"],
        lastLoginAt: null
      }
    ]
  },
  roles: {
    page: 1,
    size: 100,
    total: 3,
    items: [
      {
        roleId: "role-tenant-admin",
        code: "tenant_admin",
        name: "테넌트 관리자",
        permissionCodes: ["tenant.tenants.read", "auth.users.read", "audit.logs.read"]
      },
      {
        roleId: "role-wms-manager",
        code: "wms_manager",
        name: "WMS 관리자",
        permissionCodes: ["wms.inventory.read", "wms.outbound.pack"]
      }
    ]
  },
  permissions: {
    page: 1,
    size: 100,
    total: 5,
    items: [
      { permissionId: "perm-tenant-read", code: "tenant.tenants.read", description: "테넌트 조회" },
      { permissionId: "perm-tenant-status", code: "tenant.tenants.updateStatus", description: "테넌트 상태 변경" },
      { permissionId: "perm-users-read", code: "auth.users.read", description: "사용자 조회" },
      { permissionId: "perm-roles-read", code: "auth.roles.read", description: "역할 조회" },
      { permissionId: "perm-audit-read", code: "audit.logs.read", description: "감사 로그 조회" }
    ]
  }
};

export const sampleUserRoles: { items: UserRoleItem[] } = {
  items: [
    {
      userRoleId: "sample-user-role-admin",
      id: "sample-user-role-admin",
      userId: "admin-user-001",
      roleId: "role-tenant-admin",
      roleCode: "tenant_admin",
      warehouseId: null,
      createdAt: "2026-06-22T00:00:00.000Z"
    }
  ]
};

export const sampleAuditLogs: PageData<AuditLogItem> = {
  page: 1,
  size: 20,
  total: 3,
  items: [
    {
      auditId: "audit-001",
      occurredAt: "2026-06-22T01:10:00.000Z",
      tenantId: sampleTenantId,
      actor: { type: "user", userId: "admin-user-001" },
      action: "tenant.status.updated",
      resource: { type: "tenant", id: "22222222-2222-4222-8222-222222222222" },
      result: "success",
      requestId: "req-admin-status-001"
    },
    {
      auditId: "audit-002",
      occurredAt: "2026-06-22T01:20:00.000Z",
      tenantId: sampleTenantId,
      actor: { type: "user", userId: "admin-user-001" },
      action: "auth.user.created",
      resource: { type: "user", id: "operator-user-001" },
      result: "success",
      requestId: "req-admin-user-001"
    },
    {
      auditId: "audit-003",
      occurredAt: "2026-06-22T01:30:00.000Z",
      tenantId: sampleTenantId,
      actor: { type: "user", userId: "admin-user-001" },
      action: "auth.role.permissions.replaced",
      resource: { type: "role", id: "role-wms-manager" },
      result: "success",
      requestId: "req-admin-role-001"
    }
  ]
};

export const sampleDashboard: AdminDashboardData = {
  admin: {
    userId: sampleSession.user.userId,
    tenantId: sampleSession.tenantId,
    roles: sampleMe.roles,
    permissions: sampleMe.permissions
  },
  tenantSummary: {
    total: sampleTenants.total,
    statusCounts: {
      active: 1,
      provisioning: 1,
      suspended: 1
    },
    enabledModules: {
      auth: 3,
      tenant: 2,
      wms: 1
    },
    recentItems: sampleTenants.items
  },
  accessSummary: {
    usersTotal: sampleAccessControl.users.total,
    rolesTotal: sampleAccessControl.roles.total,
    permissionsTotal: sampleAccessControl.permissions.total,
    lockedUsers: 1,
    roleSamples: sampleAccessControl.roles.items,
    permissionSamples: sampleAccessControl.permissions.items
  },
  auditSummary: {
    total: sampleAuditLogs.total,
    recentItems: sampleAuditLogs.items
  },
  riskSummary: {
    provisioningTenants: 1,
    suspendedTenants: 1,
    lockedUsers: 1,
    failedAuditLogs: 0
  }
};
