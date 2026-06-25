#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const config = {
  gatewayBaseUrl: process.env.LOCAL_GATEWAY_URL ?? "http://127.0.0.1:3000",
  authBaseUrl: process.env.LOCAL_AUTH_IAM_SERVICE_URL ?? "http://127.0.0.1:3001",
  tenantBaseUrl: process.env.LOCAL_TENANT_SERVICE_URL ?? "http://127.0.0.1:3002",
  wmsBaseUrl: process.env.LOCAL_WMS_SERVICE_URL ?? "http://127.0.0.1:3005",
  auditBaseUrl: process.env.LOCAL_AUDIT_LOG_SERVICE_URL ?? "http://127.0.0.1:3006",
  outboxBaseUrl: process.env.LOCAL_OUTBOX_RELAY_SERVICE_URL ?? "http://127.0.0.1:3007",
  tenantId: process.env.LOCAL_VERIFY_TENANT_ID ?? "11111111-1111-4111-8111-111111111111",
  email: process.env.LOCAL_VERIFY_EMAIL ?? "admin@demo.local",
  password: process.env.LOCAL_VERIFY_PASSWORD ?? "Test1234!",
  iterations: Number(process.env.LOCAL_SYSTEM_TEST_ITERATIONS ?? process.argv.find((arg) => arg.startsWith("--iterations="))?.split("=")[1] ?? "1"),
  reportPath: process.env.LOCAL_SYSTEM_TEST_REPORT ?? `docs/test-logs/${todayKst()}/system-test-scenarios-local-verification.html`
};

const state = {
  accessToken: "",
  refreshToken: "",
  userId: "",
  createdTenantId: "",
  createdDomainId: "",
  createdUserId: "",
  tenantAdminRoleId: "",
  tenantAdminUserId: "",
  tenantAdminAccessToken: "",
  tenantUserRoleId: "",
  tenantUserId: "",
  tenantUserAccessToken: "",
  appContextRequestId: "",
  appNavigationRequestId: "",
  permissionId: "",
  permissionCode: "",
  roleId: "",
  userRoleId: ""
};

const records = [];
const startedAt = new Date();

async function main() {
  mkdirSync(dirname(config.reportPath), { recursive: true });
  writeReport("running");

  for (let iteration = 1; iteration <= config.iterations; iteration += 1) {
    await runIteration(iteration);
  }

  writeReport("passed");
  console.log(`Local system scenario verification passed: ${config.reportPath}`);
}

async function runIteration(iteration) {
  const suffix = `${Date.now()}-${iteration}`;

  await scenario(iteration, "SETUP-READY-001", "외부 노출 서비스 readiness 확인", async () => {
    const targets = [
      ["gateway-service", `${config.gatewayBaseUrl}/ready`],
      ["auth-iam-service", `${config.authBaseUrl}/ready`],
      ["tenant-service", `${config.tenantBaseUrl}/ready`],
      ["wms-service", `${config.wmsBaseUrl}/ready`],
      ["audit-log-service", `${config.auditBaseUrl}/ready`],
      ["outbox-relay-service", `${config.outboxBaseUrl}/ready`]
    ];
    const statuses = [];
    for (const [service, url] of targets) {
      const response = await request("GET", url, { requestId: requestId(iteration, "ready", service) });
      assert(response.status === 200, `${service} ready expected 200, got ${response.status}`);
      statuses.push(`${service}=200`);
    }
    return statuses.join(", ");
  });

  await scenario(iteration, "SETUP-SEED-003", "seed 관리자 로그인과 JWT claim 확인", async () => {
    const login = await api("POST", "/api/auth/login", {
      requestId: requestId(iteration, "login"),
      tenantId: config.tenantId,
      body: {
        tenantId: config.tenantId,
        email: config.email,
        password: config.password
      }
    });
    assert(login.status === 200, `login expected 200, got ${login.status}`);
    assert(login.body.success === true, "login success should be true");
    state.accessToken = login.body.data.accessToken;
    state.refreshToken = login.body.data.refreshToken;
    const claims = decodeJwtPayload(state.accessToken);
    const claimKeys = Object.keys(claims).sort();
    assert(JSON.stringify(claimKeys) === JSON.stringify(["aud", "exp", "iat", "iss", "sub", "tenantId", "type"].sort()), `unexpected JWT claims: ${claimKeys.join(", ")}`);
    assert(claims.tenantId === config.tenantId, "JWT tenantId should match seed tenant");
    state.userId = claims.sub;
    return `userId=${state.userId}, claims=${claimKeys.join(",")}`;
  });

  await scenario(iteration, "AUTH-TOKEN-001", "refresh token rotation", async () => {
    const oldRefreshToken = state.refreshToken;
    const refresh = await api("POST", "/api/auth/token/refresh", {
      requestId: requestId(iteration, "refresh"),
      tenantId: config.tenantId,
      body: {
        tenantId: config.tenantId,
        refreshToken: oldRefreshToken
      }
    });
    assert(refresh.status === 200, `refresh expected 200, got ${refresh.status}`);
    state.accessToken = refresh.body.data.accessToken;
    state.refreshToken = refresh.body.data.refreshToken;

    const reuse = await api("POST", "/api/auth/token/refresh", {
      requestId: requestId(iteration, "refresh-reuse"),
      tenantId: config.tenantId,
      body: {
        tenantId: config.tenantId,
        refreshToken: oldRefreshToken
      },
      allowFailure: true
    });
    assert(reuse.status === 401 || reuse.status === 403, `old refresh token reuse should fail, got ${reuse.status}`);
    return `newRefreshIssued=true, oldRefreshReuseStatus=${reuse.status}`;
  });

  await scenario(iteration, "AUTH-LOGIN-002", "tenant header/body mismatch 차단", async () => {
    const mismatch = await request("POST", `${config.gatewayBaseUrl}/api/auth/login`, {
      requestId: requestId(iteration, "tenant-mismatch"),
      tenantId: "00000000-0000-4000-8000-000000000000",
      body: {
        tenantId: config.tenantId,
        email: config.email,
        password: config.password
      },
      allowFailure: true
    });
    assert(mismatch.status === 403, `tenant mismatch expected 403, got ${mismatch.status}`);
    assert(mismatch.body.error?.code === "TENANT_MISMATCH", `expected TENANT_MISMATCH, got ${mismatch.body.error?.code}`);
    return `status=${mismatch.status}, code=${mismatch.body.error.code}`;
  });

  await scenario(iteration, "NEG-TENANT-002", "JWT/header tenant mismatch 차단", async () => {
    const response = await request("GET", `${config.gatewayBaseUrl}/api/admin/tenants?page=1&size=20`, {
      requestId: requestId(iteration, "jwt-header-tenant-mismatch"),
      tenantId: "00000000-0000-4000-8000-000000000000",
      accessToken: state.accessToken,
      allowFailure: true
    });
    assert(response.status === 403, `JWT/header tenant mismatch expected 403, got ${response.status}`);
    assert(response.body.error?.code === "TENANT_MISMATCH", `expected TENANT_MISMATCH, got ${response.body.error?.code}`);
    return `status=${response.status}, code=${response.body.error.code}`;
  });

  await scenario(iteration, "TENANT-ADM-001", "tenant 목록 조회", async () => {
    const response = await admin("GET", "/api/admin/tenants?page=1&size=20", { requestId: requestId(iteration, "tenant-list") });
    assertListEnvelope(response);
    assert(response.body.data.items.some((item) => item.tenantId === config.tenantId), "seed tenant should be included");
    return `total=${response.body.data.total}, seedTenantFound=true`;
  });

  await scenario(iteration, "TENANT-ADM-002", "tenant 신규 생성", async () => {
    const response = await admin("POST", "/api/admin/tenants", {
      requestId: requestId(iteration, "tenant-create"),
      idempotencyKey: `system-tenant-create-${suffix}`,
      body: {
        name: `System Test Tenant ${suffix}`,
        domain: `system-${suffix}.localhost`
      },
      expectedStatus: 201
    });
    state.createdTenantId = response.body.data.tenantId;
    assert(state.createdTenantId, "created tenantId should exist");
    return `tenantId=${state.createdTenantId}, code=${response.body.data.code}`;
  });

  await scenario(iteration, "TENANT-ADM-003", "tenant 기본 정보 수정", async () => {
    const response = await admin("PATCH", `/api/admin/tenants/${state.createdTenantId}`, {
      requestId: requestId(iteration, "tenant-update"),
      idempotencyKey: `system-tenant-update-${suffix}`,
      body: {
        name: `System Test Tenant Updated ${suffix}`
      }
    });
    assert(response.body.data.name.includes("Updated"), "tenant name should be updated");
    return `tenantId=${state.createdTenantId}, name=${response.body.data.name}`;
  });

  await scenario(iteration, "TENANT-ADM-004", "tenant 상태 변경", async () => {
    const suspended = await admin("PATCH", `/api/admin/tenants/${state.createdTenantId}/status`, {
      requestId: requestId(iteration, "tenant-suspend"),
      idempotencyKey: `system-tenant-suspend-${suffix}`,
      body: {
        status: "suspended",
        reason: "system scenario verification"
      }
    });
    assert(suspended.body.data.status === "suspended", "tenant should be suspended");
    const active = await admin("PATCH", `/api/admin/tenants/${state.createdTenantId}/status`, {
      requestId: requestId(iteration, "tenant-active"),
      idempotencyKey: `system-tenant-active-${suffix}`,
      body: {
        status: "active",
        reason: "system scenario verification restore"
      }
    });
    assert(active.body.data.status === "active", "tenant should be active again");
    return `tenantId=${state.createdTenantId}, statuses=suspended->active`;
  });

  await scenario(iteration, "TENANT-ADM-005", "tenant module 교체", async () => {
    const response = await admin("PUT", `/api/admin/tenants/${state.createdTenantId}/modules`, {
      requestId: requestId(iteration, "tenant-modules"),
      idempotencyKey: `system-tenant-modules-${suffix}`,
      body: {
        enabledModules: ["auth", "tenant", "wms"]
      }
    });
    assert(response.body.data.enabledModules.includes("wms"), "wms module should be enabled");
    return `tenantId=${state.createdTenantId}, modules=${response.body.data.enabledModules.join(",")}`;
  });

  await scenario(iteration, "TENANT-ADM-006", "tenant domain 추가와 비활성화", async () => {
    const add = await admin("POST", `/api/admin/tenants/${state.createdTenantId}/domains`, {
      requestId: requestId(iteration, "tenant-domain-add"),
      idempotencyKey: `system-tenant-domain-add-${suffix}`,
      body: {
        domain: `extra-${suffix}.localhost`
      },
      expectedStatus: 201
    });
    state.createdDomainId = add.body.data.domainId;
    assert(state.createdDomainId, "domainId should exist");
    const remove = await admin("DELETE", `/api/admin/tenants/${state.createdTenantId}/domains/${state.createdDomainId}`, {
      requestId: requestId(iteration, "tenant-domain-delete"),
      idempotencyKey: `system-tenant-domain-delete-${suffix}`
    });
    assert(remove.body.success === true, "domain delete should succeed");
    return `domainId=${state.createdDomainId}`;
  });

  await scenario(iteration, "AUTH-USER-001", "사용자 생성", async () => {
    const response = await admin("POST", "/api/admin/users", {
      requestId: requestId(iteration, "user-create"),
      idempotencyKey: `system-user-create-${suffix}`,
      body: {
        email: `system-user-${suffix}@demo.local`,
        displayName: "System Scenario User",
        password: "Test1234!",
        status: "active"
      },
      expectedStatus: 201
    });
    state.createdUserId = readEntityId(response.body.data, "userId");
    assert(state.createdUserId, "created userId should exist");
    assert(response.body.data.tenantId === config.tenantId, "created user tenantId should match");
    assert(response.body.data.userType === "general_user", "omitted userType should default to general_user");
    return `userId=${state.createdUserId}, userType=${response.body.data.userType}, tenantId=${response.body.data.tenantId}`;
  });

  await scenario(iteration, "AUTH-USER-001A", "일반 사용자 tenant 필수와 system_admin 생성 차단", async () => {
    const general = await admin("POST", "/api/admin/users", {
      requestId: requestId(iteration, "user-type-general"),
      idempotencyKey: `system-user-type-general-${suffix}`,
      body: {
        email: `system-general-user-${suffix}@demo.local`,
        displayName: "System Scenario General User",
        password: "Test1234!",
        userType: "general_user",
        status: "active"
      },
      expectedStatus: 201
    });
    assert(general.body.data.tenantId === config.tenantId, "general_user tenantId should match");
    assert(general.body.data.userType === "general_user", "explicit userType should be general_user");

    const systemAdmin = await admin("POST", "/api/admin/users", {
      requestId: requestId(iteration, "user-type-system-admin"),
      idempotencyKey: `system-user-type-system-admin-${suffix}`,
      body: {
        email: `system-admin-user-${suffix}@demo.local`,
        displayName: "System Scenario System Admin",
        password: "Test1234!",
        userType: "system_admin",
        status: "active"
      },
      allowFailure: true
    });
    assert(systemAdmin.status === 400, `system_admin create expected 400, got ${systemAdmin.status}`);
    assert(systemAdmin.body.error?.code === "VALIDATION_FAILED", `expected VALIDATION_FAILED, got ${systemAdmin.body.error?.code}`);
    assert(systemAdmin.body.error?.details?.fields?.userType, "system_admin validation should include userType field");
    return `generalUserId=${readEntityId(general.body.data, "userId")}, userType=${general.body.data.userType}, systemAdminStatus=${systemAdmin.status}`;
  });

  await scenario(iteration, "AUTH-USER-002", "사용자 정보 수정", async () => {
    const response = await admin("PATCH", `/api/admin/users/${state.createdUserId}`, {
      requestId: requestId(iteration, "user-update"),
      idempotencyKey: `system-user-update-${suffix}`,
      body: {
        displayName: `System Scenario User Updated ${iteration}`
      }
    });
    assert(response.body.data.displayName.includes("Updated"), "displayName should be updated");
    return `userId=${state.createdUserId}, displayName=${response.body.data.displayName}`;
  });

  await scenario(iteration, "AUTH-USER-003", "사용자 상태 변경과 복구", async () => {
    const locked = await admin("PATCH", `/api/admin/users/${state.createdUserId}/status`, {
      requestId: requestId(iteration, "user-lock"),
      idempotencyKey: `system-user-lock-${suffix}`,
      body: {
        status: "locked",
        reason: "system scenario verification"
      }
    });
    assert(locked.body.data.status === "locked", "user should be locked");
    const active = await admin("PATCH", `/api/admin/users/${state.createdUserId}/status`, {
      requestId: requestId(iteration, "user-active"),
      idempotencyKey: `system-user-active-${suffix}`,
      body: {
        status: "active",
        reason: "system scenario verification restore"
      }
    });
    assert(active.body.data.status === "active", "user should be active again");
    return `userId=${state.createdUserId}, statuses=locked->active`;
  });

  await scenario(iteration, "ACCESS-PERM-001", "permission 생성과 목록 조회", async () => {
    state.permissionCode = `scenario.permission.verify${Date.now()}${iteration}`;
    const create = await admin("POST", "/api/admin/permissions", {
      requestId: requestId(iteration, "permission-create"),
      idempotencyKey: `system-permission-create-${suffix}`,
      body: {
        code: state.permissionCode,
        description: "System scenario permission"
      },
      expectedStatus: 201
    });
    state.permissionId = readEntityId(create.body.data, "permissionId");
    const list = await admin("GET", "/api/admin/permissions?page=1&size=100", { requestId: requestId(iteration, "permission-list") });
    assertListEnvelope(list);
    assert(list.body.data.items.some((item) => item.code === state.permissionCode), "created permission should be listed");
    return `permissionId=${state.permissionId}, code=${state.permissionCode}`;
  });

  await scenario(iteration, "ACCESS-ROLE-001", "role 생성", async () => {
    const response = await admin("POST", "/api/admin/roles", {
      requestId: requestId(iteration, "role-create"),
      idempotencyKey: `system-role-create-${suffix}`,
      body: {
        code: `scenario_role_${suffix}`.replace(/-/g, "_"),
        name: "System Scenario Role",
        description: "Role created by local system scenario"
      },
      expectedStatus: 201
    });
    state.roleId = readEntityId(response.body.data, "roleId");
    assert(state.roleId, "roleId should exist");
    return `roleId=${state.roleId}`;
  });

  await scenario(iteration, "ACCESS-ROLE-002", "role permission 교체", async () => {
    const response = await admin("PUT", `/api/admin/roles/${state.roleId}/permissions`, {
      requestId: requestId(iteration, "role-permissions"),
      idempotencyKey: `system-role-permissions-${suffix}`,
      body: {
        permissionCodes: [state.permissionCode]
      }
    });
    assert(response.body.success === true, "role permission replace should succeed");
    return `roleId=${state.roleId}, permission=${state.permissionCode}`;
  });

  await scenario(iteration, "GWBFF-CONN-002", "gateway에서 Admin BFF screen data 조합", async () => {
    const path = `/api/admin/access-control/screen-data?page=1&size=20&roleSize=100&permissionSize=100&permissionCode=${encodeURIComponent(state.permissionCode)}`;
    const response = await admin(
      "GET",
      path,
      { requestId: requestId(iteration, "admin-screen-data") }
    );
    assert(response.body.success === true, "screen data success should be true");
    assertPageData(response.body.data.users, "users");
    assertPageData(response.body.data.roles, "roles");
    assertPageData(response.body.data.permissions, "permissions");
    assert(
      response.body.data.permissions.items.some((item) => item.code === state.permissionCode),
      "screen data permissions should include created permission"
    );
    return `users=${response.body.data.users.total}, roles=${response.body.data.roles.total}, permissions=${response.body.data.permissions.total}`;
  });

  await scenario(iteration, "ACCESS-ASSIGN-001", "사용자 role 부여와 회수", async () => {
    const assign = await admin("POST", `/api/admin/users/${state.createdUserId}/roles`, {
      requestId: requestId(iteration, "user-role-assign"),
      idempotencyKey: `system-user-role-assign-${suffix}`,
      body: {
        roleId: state.roleId
      },
      expectedStatus: 201
    });
    state.userRoleId = readEntityId(assign.body.data, "userRoleId");
    assert(state.userRoleId, "userRoleId should exist");
    const list = await admin("GET", `/api/admin/users/${state.createdUserId}/roles`, { requestId: requestId(iteration, "user-role-list") });
    assert(list.body.data.items.some((item) => readEntityId(item, "userRoleId") === state.userRoleId), "assigned role should be listed");
    const remove = await admin("DELETE", `/api/admin/user-roles/${state.userRoleId}`, {
      requestId: requestId(iteration, "user-role-delete"),
      idempotencyKey: `system-user-role-delete-${suffix}`
    });
    assert(remove.body.success === true, "user role delete should succeed");
    return `userRoleId=${state.userRoleId}, removed=true`;
  });

  await scenario(iteration, "ACCESS-ROLE-003", "tenant_admin role 부여와 관리자 API 허용", async () => {
    const roles = await admin("GET", "/api/admin/roles?code=tenant_admin&page=1&size=20", {
      requestId: requestId(iteration, "tenant-admin-role-list")
    });
    assertListEnvelope(roles);
    const tenantAdminRole = roles.body.data.items.find((item) => item.code === "tenant_admin");
    assert(tenantAdminRole, "seed tenant_admin role should exist");
    state.tenantAdminRoleId = readEntityId(tenantAdminRole, "roleId");

    const userEmail = `scenario-tenant-admin-${suffix}@demo.local`;
    const user = await admin("POST", "/api/admin/users", {
      requestId: requestId(iteration, "tenant-admin-user-create"),
      idempotencyKey: `system-tenant-admin-user-create-${suffix}`,
      body: {
        email: userEmail,
        displayName: "Scenario Tenant Admin",
        password: "Test1234!",
        userType: "general_user",
        status: "active"
      },
      expectedStatus: 201
    });
    state.tenantAdminUserId = readEntityId(user.body.data, "userId");
    assert(state.tenantAdminUserId, "tenant admin userId should exist");

    const assign = await admin("POST", `/api/admin/users/${state.tenantAdminUserId}/roles`, {
      requestId: requestId(iteration, "tenant-admin-role-assign"),
      idempotencyKey: `system-tenant-admin-role-assign-${suffix}`,
      body: {
        roleId: state.tenantAdminRoleId
      },
      expectedStatus: 201
    });
    assert(assign.body.data.roleCode === "tenant_admin", "assigned role should be tenant_admin");
    assert(assign.body.data.warehouseId === null, "tenant_admin should be assigned at tenant scope");

    const login = await loginAs(userEmail, "Test1234!", iteration, "tenant-admin-login");
    state.tenantAdminAccessToken = login.accessToken;
    const tenants = await api("GET", "/api/admin/tenants?page=1&size=20", {
      requestId: requestId(iteration, "tenant-admin-tenants-list"),
      tenantId: config.tenantId,
      accessToken: state.tenantAdminAccessToken
    });
    assertListEnvelope(tenants);
    return `tenantAdminUserId=${state.tenantAdminUserId}, roleId=${state.tenantAdminRoleId}, adminListTotal=${tenants.body.data.total}`;
  });

  await scenario(iteration, "ACCESS-ROLE-004", "tenant_user role 부여와 관리자 API 차단", async () => {
    const roleCode = `tenant_user_${suffix}`.replace(/-/g, "_");
    const role = await admin("POST", "/api/admin/roles", {
      requestId: requestId(iteration, "tenant-user-role-create"),
      idempotencyKey: `system-tenant-user-role-create-${suffix}`,
      body: {
        code: roleCode,
        name: "Scenario Tenant User",
        description: "Tenant user role for scenario app access"
      },
      expectedStatus: 201
    });
    state.tenantUserRoleId = readEntityId(role.body.data, "roleId");
    assert(state.tenantUserRoleId, "tenant user roleId should exist");

    const rolePermissions = await admin("PUT", `/api/admin/roles/${state.tenantUserRoleId}/permissions`, {
      requestId: requestId(iteration, "tenant-user-role-permissions"),
      idempotencyKey: `system-tenant-user-role-permissions-${suffix}`,
      body: {
        permissionCodes: ["wms.inventory.read"]
      }
    });
    assert(rolePermissions.body.data.permissions.includes("wms.inventory.read"), "tenant_user role should include wms.inventory.read");

    const userEmail = `scenario-tenant-user-${suffix}@demo.local`;
    const user = await admin("POST", "/api/admin/users", {
      requestId: requestId(iteration, "tenant-user-create"),
      idempotencyKey: `system-tenant-user-create-${suffix}`,
      body: {
        email: userEmail,
        displayName: "Scenario Tenant User",
        password: "Test1234!",
        userType: "general_user",
        status: "active"
      },
      expectedStatus: 201
    });
    state.tenantUserId = readEntityId(user.body.data, "userId");
    assert(state.tenantUserId, "tenant userId should exist");

    const assign = await admin("POST", `/api/admin/users/${state.tenantUserId}/roles`, {
      requestId: requestId(iteration, "tenant-user-role-assign"),
      idempotencyKey: `system-tenant-user-role-assign-${suffix}`,
      body: {
        roleId: state.tenantUserRoleId
      },
      expectedStatus: 201
    });
    assert(assign.body.data.roleCode === roleCode, "assigned tenant_user role code should match");

    const login = await loginAs(userEmail, "Test1234!", iteration, "tenant-user-login");
    state.tenantUserAccessToken = login.accessToken;
    const appContext = await api("GET", "/api/app/me", {
      requestId: requestId(iteration, "tenant-user-app-me"),
      tenantId: config.tenantId,
      accessToken: state.tenantUserAccessToken
    });
    assert(appContext.body.data.permissions.roles.some((item) => item.roleCode === roleCode), "app context should include tenant_user role");
    assert(appContext.body.data.permissions.permissions.includes("wms.inventory.read"), "app context should include wms.inventory.read");

    const navigation = await api("GET", "/api/app/navigation", {
      requestId: requestId(iteration, "tenant-user-navigation"),
      tenantId: config.tenantId,
      accessToken: state.tenantUserAccessToken
    });
    assert(navigation.body.data.items.some((item) => item.id === "wms-inventory"), "tenant_user should see WMS inventory navigation");

    const adminDenied = await api("GET", "/api/admin/tenants?page=1&size=20", {
      requestId: requestId(iteration, "tenant-user-admin-denied"),
      tenantId: config.tenantId,
      accessToken: state.tenantUserAccessToken,
      allowFailure: true
    });
    assert(adminDenied.status === 403, `tenant_user admin API expected 403, got ${adminDenied.status}`);
    assert(adminDenied.body.error?.code === "FORBIDDEN", `expected FORBIDDEN, got ${adminDenied.body.error?.code}`);

    return `tenantUserId=${state.tenantUserId}, roleCode=${roleCode}, appNavigation=wms-inventory, adminStatus=${adminDenied.status}`;
  });

  await scenario(iteration, "USER-BFF-001", "사용자 app context와 navigation 조합", async () => {
    state.appContextRequestId = requestId(iteration, "tenant-user-app-context-expanded", suffix);
    state.appNavigationRequestId = requestId(iteration, "tenant-user-navigation-expanded", suffix);

    const appContext = await api("GET", "/api/app/me", {
      requestId: state.appContextRequestId,
      tenantId: config.tenantId,
      accessToken: state.tenantUserAccessToken
    });
    assert(appContext.body.data.user.userId === state.tenantUserId, "app context userId should match tenant user");
    assert(appContext.body.data.tenant.tenantId === config.tenantId, "app context tenantId should match");
    assert(appContext.body.data.tenant.enabledModules.includes("wms"), "app context should include wms module");
    assert(appContext.body.data.permissions.permissions.includes("wms.inventory.read"), "app context should include wms.inventory.read");

    const navigation = await api("GET", "/api/app/navigation", {
      requestId: state.appNavigationRequestId,
      tenantId: config.tenantId,
      accessToken: state.tenantUserAccessToken
    });
    const itemIds = navigation.body.data.items.map((item) => item.id);
    assert(itemIds.includes("wms-inventory"), "navigation should include WMS inventory item");
    assert(!itemIds.includes("wms-warehouses"), "navigation should hide warehouses without manage permission");
    assert(!itemIds.includes("wms-materials"), "navigation should hide materials without manage permission");
    return `appUser=${state.tenantUserId}, navigation=${itemIds.join(",")}`;
  });

  await scenario(iteration, "ACCESS-ADMIN-001", "system_admin, tenant_admin, tenant_user 범위 분리", async () => {
    const systemAdminRole = await admin("POST", "/api/admin/roles", {
      requestId: requestId(iteration, "system-admin-role-create-denied"),
      idempotencyKey: `system-system-admin-role-create-${suffix}`,
      body: {
        code: "system_admin",
        name: "System Admin",
        description: "System admin must not be tenant-scoped"
      },
      allowFailure: true
    });
    assert(systemAdminRole.status === 403, `system_admin tenant role expected 403, got ${systemAdminRole.status}`);
    assert(systemAdminRole.body.error?.code === "AUTH_ADMIN_SCOPE_MISMATCH", `expected AUTH_ADMIN_SCOPE_MISMATCH, got ${systemAdminRole.body.error?.code}`);

    const systemPermissionCode = `system.users.manage${Date.now()}${iteration}`;
    const systemPermission = await admin("POST", "/api/admin/permissions", {
      requestId: requestId(iteration, "system-permission-create"),
      idempotencyKey: `system-system-permission-create-${suffix}`,
      body: {
        code: systemPermissionCode,
        description: "System permission catalog entry for tenant mapping denial"
      },
      expectedStatus: 201
    });
    assert(readEntityId(systemPermission.body.data, "permissionId"), "system permission should be created in catalog");

    const systemPermissionMapping = await admin("PUT", `/api/admin/roles/${state.roleId}/permissions`, {
      requestId: requestId(iteration, "system-permission-mapping-denied"),
      idempotencyKey: `system-system-permission-mapping-${suffix}`,
      body: {
        permissionCodes: [systemPermissionCode]
      },
      allowFailure: true
    });
    assert(systemPermissionMapping.status === 403, `system permission mapping expected 403, got ${systemPermissionMapping.status}`);
    assert(systemPermissionMapping.body.error?.code === "AUTH_ADMIN_SCOPE_MISMATCH", `expected AUTH_ADMIN_SCOPE_MISMATCH, got ${systemPermissionMapping.body.error?.code}`);

    const tenantAdminWarehouseAssign = await admin("POST", `/api/admin/users/${state.tenantAdminUserId}/roles`, {
      requestId: requestId(iteration, "tenant-admin-warehouse-scope-denied"),
      idempotencyKey: `system-tenant-admin-warehouse-scope-${suffix}`,
      body: {
        roleId: state.tenantAdminRoleId,
        warehouseId: "44444444-4444-4444-8444-444444444444"
      },
      allowFailure: true
    });
    assert(tenantAdminWarehouseAssign.status === 403, `tenant_admin warehouse scope expected 403, got ${tenantAdminWarehouseAssign.status}`);
    assert(tenantAdminWarehouseAssign.body.error?.code === "AUTH_ADMIN_SCOPE_MISMATCH", `expected AUTH_ADMIN_SCOPE_MISMATCH, got ${tenantAdminWarehouseAssign.body.error?.code}`);

    return `systemAdminRoleStatus=${systemAdminRole.status}, systemPermissionMapping=${systemPermissionMapping.status}, tenantAdminWarehouseScope=${tenantAdminWarehouseAssign.status}`;
  });

  await scenario(iteration, "NEG-VALID-001", "validation error envelope", async () => {
    const response = await admin("POST", "/api/admin/users", {
      requestId: requestId(iteration, "validation"),
      idempotencyKey: `system-validation-${suffix}`,
      body: {
        email: "not-an-email"
      },
      allowFailure: true
    });
    assert(response.status === 400, `validation expected 400, got ${response.status}`);
    assert(response.body.error?.code === "VALIDATION_FAILED", `expected VALIDATION_FAILED, got ${response.body.error?.code}`);
    assert(response.body.error?.details?.fields, "validation fields should be present");
    return `status=${response.status}, code=${response.body.error.code}`;
  });

  await scenario(iteration, "NEG-IDEMP-001", "mutation idempotency key 검증", async () => {
    const response = await api("POST", "/api/admin/users", {
      requestId: requestId(iteration, "idempotency-missing"),
      tenantId: config.tenantId,
      accessToken: state.accessToken,
      body: {
        email: `missing-idempotency-${suffix}@demo.local`,
        displayName: "Missing Idempotency",
        password: "Test1234!",
        status: "active"
      },
      allowFailure: true
    });
    assert(response.status === 400, `missing idempotency expected 400, got ${response.status}`);
    assert(response.body.error?.code === "IDEMPOTENCY_KEY_REQUIRED", `expected IDEMPOTENCY_KEY_REQUIRED, got ${response.body.error?.code}`);
    return `status=${response.status}, code=${response.body.error.code}`;
  });

  await scenario(iteration, "NEG-AUTH-001", "권한 없는 API 차단", async () => {
    const response = await request("GET", `${config.gatewayBaseUrl}/api/admin/tenants?page=1&size=20`, {
      requestId: requestId(iteration, "unauthorized-admin"),
      tenantId: config.tenantId,
      allowFailure: true
    });
    assert(response.status === 401, `missing token expected 401, got ${response.status}`);
    return `status=${response.status}, code=${response.body.error?.code ?? "n/a"}`;
  });

  await scenario(iteration, "WMS-FLOW-001", "WMS 로컬 통합 시나리오 일괄 검증", async () => {
    const result = spawnSync("pnpm", ["test:wms:local"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 20
    });
    assert(result.status === 0, `pnpm test:wms:local failed\n${tail(result.stdout)}\n${tail(result.stderr)}`);
    assert(result.stdout.includes("Local WMS integration verification passed"), "WMS verification pass marker missing");
    assert(result.stdout.includes("WMS-INV-001"), "WMS inventory envelope scenario marker missing");
    assert(result.stdout.includes("WMS-SNAP-006"), "WMS snapshot empty filter scenario marker missing");
    return "WMS-INT-001..005, WMS-INV-001, WMS-PACK/SNAP regressions passed";
  });

  await scenario(iteration, "USER-BFF-004", "WMS 화면 조회 API 조합", async () => {
    const warehouses = await api("GET", "/api/app/wms/warehouses?page=1&size=20", {
      requestId: requestId(iteration, "wms-app-warehouses"),
      tenantId: config.tenantId,
      accessToken: state.accessToken
    });
    assertListEnvelope(warehouses);

    const materials = await api("GET", "/api/app/wms/materials?page=1&size=20", {
      requestId: requestId(iteration, "wms-app-materials"),
      tenantId: config.tenantId,
      accessToken: state.accessToken
    });
    assertListEnvelope(materials);

    const locations = await api("GET", "/api/app/wms/locations?page=1&size=20", {
      requestId: requestId(iteration, "wms-app-locations"),
      tenantId: config.tenantId,
      accessToken: state.accessToken
    });
    assertListEnvelope(locations);
    assert(locations.body.data.items.length >= 1, "locations should include generated rows");
    assert(locations.body.data.items.every((item) => typeof item.warehouseId === "string"), "location warehouseId should be present");

    const inventorySummary = await api("GET", "/api/app/wms/inventory-summary?page=1&size=20", {
      requestId: requestId(iteration, "wms-app-inventory-summary"),
      tenantId: config.tenantId,
      accessToken: state.accessToken
    });
    assert(inventorySummary.body.data.pageTotals, "inventory summary should include pageTotals");
    assertQuantityTotals(inventorySummary.body.data.pageTotals, "inventorySummary.pageTotals");
    assertPageData(inventorySummary.body.data.inventory, "inventorySummary.inventory");
    const firstInventoryItem = inventorySummary.body.data.inventory.items[0];
    assert(firstInventoryItem, "inventory summary should include at least one row for filter verification");

    const inventorySnapshots = await api("GET", `/api/app/wms/inventory-snapshots?snapshotDate=${todayKst()}&page=1&size=20`, {
      requestId: requestId(iteration, "wms-app-inventory-snapshots"),
      tenantId: config.tenantId,
      accessToken: state.accessToken
    });
    assert(inventorySnapshots.body.data.pageTotals, "inventory snapshots should include pageTotals");
    assertQuantityTotals(inventorySnapshots.body.data.pageTotals, "inventorySnapshots.pageTotals");
    assertPageData(inventorySnapshots.body.data.snapshots, "inventorySnapshots.snapshots");
    assert(inventorySnapshots.body.data.snapshots.items.length >= 1, "inventory snapshots should include generated rows");

    const filteredSnapshots = await api(
      "GET",
      `/api/app/wms/inventory-snapshots?snapshotDate=${todayKst()}&warehouseId=${firstInventoryItem.warehouseId}&locationId=${firstInventoryItem.locationId}&itemId=${firstInventoryItem.materialId}&page=1&size=20`,
      {
        requestId: requestId(iteration, "wms-app-inventory-snapshots-filtered"),
        tenantId: config.tenantId,
        accessToken: state.accessToken
      }
    );
    assertPageData(filteredSnapshots.body.data.snapshots, "filteredInventorySnapshots.snapshots");
    assert(filteredSnapshots.body.data.snapshots.items.length >= 1, "filtered inventory snapshots should include generated rows");
    assert(
      filteredSnapshots.body.data.snapshots.items.every(
        (item) =>
          item.warehouseId === firstInventoryItem.warehouseId &&
          item.locationId === firstInventoryItem.locationId &&
          item.materialId === firstInventoryItem.materialId
      ),
      "filtered inventory snapshots should match warehouse/location/material filters"
    );

    const outboundPackings = await api("GET", "/api/app/wms/outbound-packings?page=1&size=20", {
      requestId: requestId(iteration, "wms-app-outbound-packings"),
      tenantId: config.tenantId,
      accessToken: state.accessToken
    });
    assertListEnvelope(outboundPackings);
    assert(outboundPackings.body.data.items.length >= 1, "outbound packings should include generated rows");
    assert(outboundPackings.body.data.items.every((item) => typeof item.packageCount === "number"), "packing packageCount should be numeric");

    const outboundAllocations = await api("GET", "/api/app/wms/outbound-allocations?page=1&size=20", {
      requestId: requestId(iteration, "wms-app-outbound-allocations"),
      tenantId: config.tenantId,
      accessToken: state.accessToken
    });
    assertListEnvelope(outboundAllocations);
    assert(outboundAllocations.body.data.items.length >= 1, "outbound allocations should include generated rows");
    assert(outboundAllocations.body.data.items.every((item) => typeof item.orderNo === "string"), "allocation orderNo should be present");

    const dashboard = await api("GET", "/api/app/wms/dashboard", {
      requestId: requestId(iteration, "wms-app-dashboard"),
      tenantId: config.tenantId,
      accessToken: state.accessToken
    });
    assert(Number.isInteger(dashboard.body.data.inventory.totalBalances), "dashboard totalBalances should be an integer");
    assert(Number.isInteger(dashboard.body.data.inventory.sampledBalanceCount), "dashboard sampledBalanceCount should be an integer");
    assertQuantityTotals(dashboard.body.data.inventory.pageTotals, "dashboard.inventory.pageTotals");
    assert(dashboard.body.data.operations.outboundAllocations.canView === true, "admin should see outbound allocation queue");
    assert(Number.isInteger(dashboard.body.data.operations.outboundAllocations.total), "dashboard outbound allocation total should be an integer");
    assert(Number.isInteger(dashboard.body.data.operations.outboundAllocations.sampledCount), "dashboard outbound allocation sampledCount should be an integer");
    assert(dashboard.body.data.operations.outboundPackings.canView === true, "admin should see outbound packing queue");
    assert(Number.isInteger(dashboard.body.data.operations.outboundPackings.total), "dashboard outbound packing total should be an integer");
    assert(Number.isInteger(dashboard.body.data.operations.outboundPackings.sampledCount), "dashboard outbound packing sampledCount should be an integer");
    assert(dashboard.body.data.visibleActions.inventory === true, "dashboard visibleActions.inventory should be true");
    assert(dashboard.body.data.visibleActions.warehouses === true, "admin should see warehouse action");
    assert(dashboard.body.data.visibleActions.materials === true, "admin should see material action");

    const tenantUserInventory = await api("GET", "/api/app/wms/inventory-summary?page=1&size=20", {
      requestId: requestId(iteration, "tenant-user-wms-app-inventory"),
      tenantId: config.tenantId,
      accessToken: state.tenantUserAccessToken
    });
    assertPageData(tenantUserInventory.body.data.inventory, "tenantUser.inventorySummary.inventory");

    const tenantUserDashboard = await api("GET", "/api/app/wms/dashboard", {
      requestId: requestId(iteration, "tenant-user-wms-app-dashboard"),
      tenantId: config.tenantId,
      accessToken: state.tenantUserAccessToken
    });
    assert(tenantUserDashboard.body.data.operations.outboundAllocations.canView === false, "tenant_user should not see outbound allocation queue");
    assert(tenantUserDashboard.body.data.operations.outboundAllocations.total === null, "tenant_user outbound allocation total should be null");
    assert(tenantUserDashboard.body.data.operations.outboundPackings.canView === false, "tenant_user should not see outbound packing queue");
    assert(tenantUserDashboard.body.data.operations.outboundPackings.total === null, "tenant_user outbound packing total should be null");

    const tenantUserWarehouses = await api("GET", "/api/app/wms/warehouses?page=1&size=20", {
      requestId: requestId(iteration, "tenant-user-wms-app-warehouses-denied"),
      tenantId: config.tenantId,
      accessToken: state.tenantUserAccessToken,
      allowFailure: true
    });
    assert(tenantUserWarehouses.status === 403, `tenant_user warehouse screen expected 403, got ${tenantUserWarehouses.status}`);
    assert(tenantUserWarehouses.body.error?.code === "FORBIDDEN", `expected FORBIDDEN, got ${tenantUserWarehouses.body.error?.code}`);

    const tenantUserLocations = await api("GET", "/api/app/wms/locations?page=1&size=20", {
      requestId: requestId(iteration, "tenant-user-wms-app-locations-denied"),
      tenantId: config.tenantId,
      accessToken: state.tenantUserAccessToken,
      allowFailure: true
    });
    assert(tenantUserLocations.status === 403, `tenant_user location screen expected 403, got ${tenantUserLocations.status}`);
    assert(tenantUserLocations.body.error?.code === "FORBIDDEN", `expected FORBIDDEN, got ${tenantUserLocations.body.error?.code}`);

    const tenantUserPackings = await api("GET", "/api/app/wms/outbound-packings?page=1&size=20", {
      requestId: requestId(iteration, "tenant-user-wms-app-packings-denied"),
      tenantId: config.tenantId,
      accessToken: state.tenantUserAccessToken,
      allowFailure: true
    });
    assert(tenantUserPackings.status === 403, `tenant_user outbound packing screen expected 403, got ${tenantUserPackings.status}`);
    assert(tenantUserPackings.body.error?.code === "FORBIDDEN", `expected FORBIDDEN, got ${tenantUserPackings.body.error?.code}`);

    const tenantUserAllocations = await api("GET", "/api/app/wms/outbound-allocations?page=1&size=20", {
      requestId: requestId(iteration, "tenant-user-wms-app-allocations-denied"),
      tenantId: config.tenantId,
      accessToken: state.tenantUserAccessToken,
      allowFailure: true
    });
    assert(tenantUserAllocations.status === 403, `tenant_user outbound allocation screen expected 403, got ${tenantUserAllocations.status}`);
    assert(tenantUserAllocations.body.error?.code === "FORBIDDEN", `expected FORBIDDEN, got ${tenantUserAllocations.body.error?.code}`);

    return `warehouses=${warehouses.body.data.total}, locations=${locations.body.data.total}, materials=${materials.body.data.total}, inventory=${inventorySummary.body.data.inventory.total}, snapshots=${inventorySnapshots.body.data.snapshots.total}, filteredSnapshots=${filteredSnapshots.body.data.snapshots.total}, allocations=${outboundAllocations.body.data.total}, packings=${outboundPackings.body.data.total}, tenantUserWarehouseStatus=${tenantUserWarehouses.status}, tenantUserLocationStatus=${tenantUserLocations.status}, tenantUserPackingStatus=${tenantUserPackings.status}, tenantUserAllocationStatus=${tenantUserAllocations.status}`;
  });

  await scenario(iteration, "OBS-AUDIT-002", "app shell 감사 로그 requestId 조회", async () => {
    const appContextAudit = await waitForAdminAuditLog(state.appContextRequestId, "userBff.appContext.loaded");
    const navigationAudit = await waitForAdminAuditLog(state.appNavigationRequestId, "userBff.navigation.loaded");
    assert(appContextAudit.actor.userId === state.tenantUserId, "app context audit actor should match tenant user");
    assert(navigationAudit.actor.userId === state.tenantUserId, "navigation audit actor should match tenant user");
    return `appContextAudit=${appContextAudit.auditId}, navigationAudit=${navigationAudit.auditId}`;
  });

  await scenario(iteration, "OBS-AUDIT-003", "User BFF app audit EventBridge routing CDK 검증", async () => {
    const result = spawnSync("pnpm", [
      "--filter",
      "@multi-tenant/infra-cdk",
      "exec",
      "cdk",
      "synth",
      "-c",
      "userBffAppAuditPublisherType=eventbridge",
      "-c",
      "userBffAuditEventBridgeBusName=multi-tenant-dev-event-bus"
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 50
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert(result.status === 0, `EventBridge CDK synth failed\n${tail(result.stdout)}\n${tail(result.stderr)}`);
    assert(output.includes("UserBffAppAuditToSqsRule"), "User BFF app audit EventBridge rule should be synthesized");
    assert(output.includes("multi-tenant-dev-event-bus"), "EventBridge bus name should be present");
    assert(output.includes("userBff.appContext.loaded"), "app context detail-type should be routed");
    assert(output.includes("userBff.navigation.loaded"), "navigation detail-type should be routed");
    assert(output.includes("AuditEventQueue"), "EventBridge rule should target audit event SQS queue");
    assert(output.includes("events:PutEvents"), "User BFF task role should include events:PutEvents");
    assert(output.includes("USER_BFF_APP_AUDIT_PUBLISHER_TYPE"), "User BFF publisher type env should be synthesized");
    assert(output.includes("Value: eventbridge"), "User BFF publisher type should be eventbridge");
    return "EventBridge rule, detail-type filters, audit SQS target, PutEvents grant synthesized";
  });

  await scenario(iteration, "OBS-OUTBOX-002", "outbox relay SQS publish와 audit 저장", async () => {
    const result = await runOutboxSqsVerification();
    assert(result.stdout.includes("Local outbox SQS verification passed"), "outbox SQS pass marker missing");
    return "outbox pending->published and audit log stored with compose workers isolated";
  });

  await scenario(iteration, "OBS-AUDIT-001", "감사 로그 관리자 조회", async () => {
    const response = await admin("GET", "/api/admin/audit-logs?page=1&size=20", { requestId: requestId(iteration, "audit-list") });
    assertListEnvelope(response);
    return `total=${response.body.data.total}`;
  });
}

async function runOutboxSqsVerification() {
  runCompose(["stop", "outbox-relay-service", "audit-log-service"], "stop compose outbox/audit services");
  try {
    const result = spawnSync("pnpm", ["test:outbox:sqs:local"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 20
    });
    assert(result.status === 0, `pnpm test:outbox:sqs:local failed\n${tail(result.stdout)}\n${tail(result.stderr)}`);
    return result;
  } finally {
    runCompose(["up", "-d", "audit-log-service", "outbox-relay-service"], "restart compose outbox/audit services");
    await waitForReadyUrl(`${config.auditBaseUrl}/ready`, "audit-log-service");
    await waitForReadyUrl(`${config.outboxBaseUrl}/ready`, "outbox-relay-service");
  }
}

function runCompose(args, label) {
  const result = spawnSync("docker", ["compose", "-f", "docker/local/docker-compose.yml", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20
  });
  assert(result.status === 0, `${label} failed\n${tail(result.stdout)}\n${tail(result.stderr)}`);
}

async function waitForReadyUrl(url, label) {
  const deadline = Date.now() + 90_000;
  let lastStatus = "n/a";
  while (Date.now() < deadline) {
    try {
      const response = await request("GET", url, { requestId: requestId(0, "compose-ready", label) });
      lastStatus = String(response.status);
      if (response.status === 200 && response.body.status === "ready") {
        return;
      }
    } catch (error) {
      lastStatus = error.message;
    }
    await sleep(1_000);
  }
  throw new Error(`${label} did not become ready after compose restart: ${lastStatus}`);
}

async function scenario(iteration, scenarioId, title, fn) {
  const started = new Date();
  try {
    const evidence = await fn();
    records.push({
      iteration,
      scenarioId,
      title,
      result: "passed",
      evidence,
      startedAt: started,
      endedAt: new Date()
    });
    writeReport("running");
    console.log(`[pass] #${iteration} ${scenarioId} ${title}`);
  } catch (error) {
    records.push({
      iteration,
      scenarioId,
      title,
      result: "failed",
      evidence: error instanceof Error ? error.message : String(error),
      startedAt: started,
      endedAt: new Date()
    });
    writeReport("failed");
    throw error;
  }
}

async function admin(method, path, options = {}) {
  return api(method, path, {
    accessToken: state.accessToken,
    tenantId: config.tenantId,
    ...options
  });
}

async function waitForAdminAuditLog(requestIdValue, action) {
  assert(requestIdValue, `${action} audit requestId should be captured before audit verification`);
  const deadline = Date.now() + 30_000;
  let lastTotal = 0;

  while (Date.now() < deadline) {
    const response = await admin(
      "GET",
      `/api/admin/audit-logs?page=1&size=20&requestId=${encodeURIComponent(requestIdValue)}&action=${encodeURIComponent(action)}`,
      { requestId: requestId(0, "audit-wait", action) }
    );
    assertListEnvelope(response);
    lastTotal = response.body.data.total;
    const item = response.body.data.items.find((entry) => entry.requestId === requestIdValue && entry.action === action);
    if (item) {
      return item;
    }

    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for audit action ${action} requestId=${requestIdValue}, lastTotal=${lastTotal}`);
}

async function loginAs(email, password, iteration, name) {
  const response = await api("POST", "/api/auth/login", {
    requestId: requestId(iteration, name),
    tenantId: config.tenantId,
    body: {
      tenantId: config.tenantId,
      email,
      password
    }
  });
  assert(response.body.data.accessToken, `${email} login should return access token`);
  return response.body.data;
}

async function api(method, path, options = {}) {
  const response = await request(method, `${config.gatewayBaseUrl}${path}`, options);
  if (!options.allowFailure) {
    assert(response.status === (options.expectedStatus ?? 200), `${method} ${path} expected ${options.expectedStatus ?? 200}, got ${response.status}: ${JSON.stringify(response.body)}`);
    assert(response.body.success === true, `${method} ${path} success should be true`);
  }
  return response;
}

async function request(method, url, options = {}) {
  const headers = {
    Accept: "application/json",
    "X-Request-Id": options.requestId ?? `system-${Date.now()}`
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.tenantId) {
    headers["X-Tenant-Id"] = options.tenantId;
  }
  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }
  const response = await fetchWithRetry(url, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  }, {
    retryable: method === "GET" || method === "HEAD" || Boolean(options.idempotencyKey)
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return {
    status: response.status,
    headers: response.headers,
    body
  };
}

async function fetchWithRetry(url, init, options = {}) {
  const attempts = options.retryable ? 2 : 1;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }
      await sleep(150);
    }
  }

  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function assertListEnvelope(response) {
  assert(response.status === 200, `list expected 200, got ${response.status}`);
  assert(response.body.success === true, "list success should be true");
  assert(Array.isArray(response.body.data.items), "data.items should be an array");
  assert(Number.isInteger(response.body.data.page), "data.page should be an integer");
  assert(Number.isInteger(response.body.data.size), "data.size should be an integer");
  assert(Number.isInteger(response.body.data.total), "data.total should be an integer");
  assert(!("meta" in response.body), "response should not include meta");
}

function assertPageData(value, label) {
  assert(value && typeof value === "object", `${label} page data should be an object`);
  assert(Array.isArray(value.items), `${label}.items should be an array`);
  assert(Number.isInteger(value.page), `${label}.page should be an integer`);
  assert(Number.isInteger(value.size), `${label}.size should be an integer`);
  assert(Number.isInteger(value.total), `${label}.total should be an integer`);
}

function assertQuantityTotals(value, label) {
  assert(value && typeof value === "object", `${label} should be an object`);
  for (const key of ["quantity", "allocatedQuantity", "availableQuantity"]) {
    assert(typeof value[key] === "string", `${label}.${key} should be a string`);
    assert(Number.isFinite(Number(value[key])), `${label}.${key} should be numeric`);
  }
}

function decodeJwtPayload(token) {
  const [, payload] = token.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function requestId(iteration, name, detail = "") {
  const suffix = detail ? `-${detail}` : "";
  return `system-scenario-${iteration}-${name}${suffix}`.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
}

function readEntityId(value, alias) {
  if (typeof value !== "object" || value === null) {
    return "";
  }

  const record = value;
  return typeof record.id === "string" ? record.id : typeof record[alias] === "string" ? record[alias] : "";
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function tail(value) {
  return String(value ?? "").split("\n").slice(-80).join("\n");
}

function todayKst() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function writeReport(status) {
  const passed = records.filter((record) => record.result === "passed").length;
  const failed = records.filter((record) => record.result === "failed").length;
  const rows = records.map((record) => `
              <tr>
                <td><code>${escapeHtml(String(record.iteration))}</code></td>
                <td><code>${escapeHtml(record.scenarioId)}</code></td>
                <td>${escapeHtml(record.title)}</td>
                <td><span class="tag ${record.result === "passed" ? "done" : "todo"}">${escapeHtml(record.result)}</span></td>
                <td>${escapeHtml(record.evidence)}</td>
                <td>${escapeHtml(record.endedAt.toISOString())}</td>
              </tr>`).join("");

  const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>전체 시스템 로컬 테스트 기록</title>
    <link rel="stylesheet" href="../../assets-docs.css" />
  </head>
  <body>
    <main>
      <header>
        <p class="eyebrow">System Test Log</p>
        <h1>전체 시스템 로컬 테스트 기록</h1>
        <p class="lead">
          로컬 배포 후 seed, tenant, 인증, 사용자, 권한, WMS, outbox/audit 시나리오를 실행한 기록입니다.
          이 파일은 각 시나리오가 끝날 때마다 갱신됩니다.
        </p>
      </header>

      <section>
        <h2>실행 요약</h2>
        <table>
          <tbody>
            <tr><th>상태</th><td><span class="tag ${status === "passed" ? "done" : "todo"}">${escapeHtml(status)}</span></td></tr>
            <tr><th>시작</th><td>${escapeHtml(startedAt.toISOString())}</td></tr>
            <tr><th>마지막 갱신</th><td>${escapeHtml(new Date().toISOString())}</td></tr>
            <tr><th>반복 횟수</th><td><code>${escapeHtml(String(config.iterations))}</code></td></tr>
            <tr><th>통과</th><td><code>${passed}</code></td></tr>
            <tr><th>실패</th><td><code>${failed}</code></td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>항목별 결과</h2>
        <div class="wide-table">
          <table>
            <thead>
              <tr><th>iteration</th><th>scenarioId</th><th>title</th><th>result</th><th>evidence</th><th>endedAt</th></tr>
            </thead>
            <tbody>${rows}
            </tbody>
          </table>
        </div>
      </section>

      <p class="footer"><a href="../../test-scenarios/system-test-scenarios.html">전체 시스템 테스트 시나리오로 이동</a> · <a href="../../index.html">문서 대시보드로 돌아가기</a></p>
    </main>
  </body>
</html>
`;
  writeFileSync(config.reportPath, html);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
