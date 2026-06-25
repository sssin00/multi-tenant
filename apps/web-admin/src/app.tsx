import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Building2,
  CalendarX2,
  CheckCircle2,
  CircleHelp,
  ClipboardList,
  CloudCog,
  Download,
  Filter,
  Gauge,
  LockKeyhole,
  LogOut,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  ShieldCheck,
  ShieldPlus,
  UserCog,
  UserRound,
  Users,
  X
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import {
  ApiError,
  assignUserRole,
  clearSession,
  createTenant,
  createUser,
  getAccessControlData,
  getAdminDashboard,
  getAdminMe,
  getAuditLogs,
  getTenant,
  getTenants,
  loadSession,
  login,
  replaceRolePermissions,
  replaceTenantModules,
  updateTenant,
  updateTenantStatus,
  updateUser,
  updateUserStatus,
  type AdminListQuery
} from "./api-client";
import type {
  AccessControlData,
  AdminDashboardData,
  AdminMe,
  AdminSession,
  AuditLogItem,
  DataResult,
  PageData,
  TenantItem,
  TenantDetail,
  RoleItem,
  UserItem
} from "./api-types";
import styles from "./app.module.css";

const menuItems = [
  { key: "dashboard", to: "/dashboard", label: "관리 대시보드", icon: Gauge },
  { key: "tenants", to: "/tenants", label: "고객사 관리", icon: Building2 },
  { key: "access-control", to: "/access-control", label: "사용자 관리", icon: UserCog },
  { key: "roles", to: "/roles", label: "역할/권한", icon: ShieldPlus },
  { key: "audit-logs", to: "/audit-logs", label: "감사 로그", icon: ClipboardList },
  { key: "risk-actions", to: "/risk-actions", label: "위험 작업", icon: AlertTriangle }
] as const;

const tenantCreateModuleOptions = [
  { code: "auth", label: "Auth" },
  { code: "tenant", label: "Tenant" },
  { code: "wms", label: "WMS" }
] as const;
const tenantRequiredCreateModuleCodes = ["auth", "tenant"] as const;
const defaultTenantCreateModules = [...tenantRequiredCreateModuleCodes, "wms"];
const bootstrapSystemAdminUserId = "99999999-9999-4999-8999-999999999999";
const tenantStatusOptions = [
  { value: "provisioning", label: "준비 중" },
  { value: "active", label: "활성" },
  { value: "suspended", label: "중지" },
  { value: "deleted", label: "삭제" }
] as const;

type MenuItem = (typeof menuItems)[number];
type NavigationMenuItem = {
  key: string;
  to: string;
  label: string;
  icon: MenuItem["icon"];
};
type CreateUserTarget = "system_admin" | "tenant_admin" | "tenant_user";

const menuByKey = new Map<string, MenuItem>(menuItems.map((item) => [item.key, item]));

type FilterValues = Record<string, string>;
type SearchField = {
  name: string;
  label: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
};

const tenantSearchFields: SearchField[] = [
  { name: "keyword", label: "검색어", placeholder: "고객사 이름 또는 도메인 검색" },
  {
    name: "status",
    label: "상태",
    options: [
      { value: "", label: "전체" },
      { value: "provisioning", label: "준비중" },
      { value: "active", label: "활성" },
      { value: "suspended", label: "중지" },
      { value: "deleted", label: "삭제" }
    ]
  },
  {
    name: "moduleCode",
    label: "모듈",
    options: [
      { value: "", label: "전체" },
      { value: "auth", label: "Auth" },
      { value: "tenant", label: "Tenant" },
      { value: "wms", label: "WMS" }
    ]
  }
];
const accessSearchFields: SearchField[] = [
  { name: "keyword", label: "검색어", placeholder: "이름 또는 이메일 검색" },
  {
    name: "tenantFilter",
    label: "테넌트",
    options: [
      { value: "", label: "전체" }
    ]
  },
  { name: "roleCode", label: "역할", placeholder: "tenant_admin" },
  {
    name: "userStatus",
    label: "상태",
    options: [
      { value: "", label: "전체" },
      { value: "active", label: "활성" },
      { value: "inactive", label: "중지" },
      { value: "locked", label: "잠금" }
    ]
  }
];
const auditSearchFields: SearchField[] = [
  { name: "action", label: "액션", placeholder: "admin.user.created" },
  { name: "resourceType", label: "리소스 유형", placeholder: "auth_user" },
  { name: "requestId", label: "요청 ID", placeholder: "requestId" }
];

export function App() {
  const [session, setSession] = useState<AdminSession | null>(() => loadSession());

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginScreen onLogin={setSession} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/dashboard" replace />} />
      <Route
        path="/*"
        element={
          <AppShell
            session={session}
            onLogout={() => {
              clearSession();
              setSession(null);
            }}
          />
        }
      />
    </Routes>
  );
}

function LoginScreen({ onLogin }: { onLogin: (session: AdminSession) => void }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState(() => window.localStorage.getItem("web-admin.remembered-id") ?? "");
  const [password, setPassword] = useState("");
  const [rememberId, setRememberId] = useState(() => Boolean(window.localStorage.getItem("web-admin.remembered-id")));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setNotice(null);

    try {
      const result = await login({ email, password });
      if (rememberId) {
        window.localStorage.setItem("web-admin.remembered-id", email.trim());
      } else {
        window.localStorage.removeItem("web-admin.remembered-id");
      }
      onLogin(result.data);
      navigate("/dashboard", { replace: true });
    } catch (error) {
      setNotice(loginErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.loginPage}>
      <section className={styles.loginPanel} aria-labelledby="login-title">
        <div className={styles.loginHeader}>
          <CloudCog className={styles.loginLogo} size={32} aria-hidden="true" />
          <h1 id="login-title">시스템 관리자 로그인</h1>
          <p className={styles.loginCopy}>서비스 관리를 위해 계정 정보를 입력해주세요.</p>
        </div>
        <form className={styles.loginForm} onSubmit={handleSubmit}>
          <label>
            <span>아이디</span>
            <span className={styles.loginInput}>
              <UserRound size={22} aria-hidden="true" />
              <input
                autoComplete="username"
                type="email"
                placeholder="아이디를 입력하세요"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </span>
          </label>
          <label>
            <span>비밀번호</span>
            <span className={styles.loginInput}>
              <LockKeyhole size={22} aria-hidden="true" />
              <input
                autoComplete="current-password"
                type="password"
                placeholder="비밀번호를 입력하세요"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </span>
          </label>
          <div className={styles.loginOptions}>
            <label className={styles.rememberId}>
              <input
                type="checkbox"
                checked={rememberId}
                onChange={(event) => setRememberId(event.target.checked)}
              />
              <span>아이디 저장</span>
            </label>
            <button className={styles.forgotPassword} type="button">
              비밀번호를 잊으셨나요?
            </button>
          </div>
          <button className={styles.loginSubmit} type="submit" disabled={isSubmitting}>
            {isSubmitting ? "확인 중" : "로그인"}
            <ArrowRight size={18} aria-hidden="true" />
          </button>
          {notice ? <p className={styles.formNotice}>{notice}</p> : null}
        </form>
      </section>
    </main>
  );
}

function AppShell({ session, onLogout }: { session: AdminSession; onLogout: () => void }) {
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ["admin-me", session.accessToken], queryFn: getAdminMe, retry: false });
  const [globalSearch, setGlobalSearch] = useState("");

  if (me.isLoading) {
    return <SessionState title="세션 초기화" description="관리자 정보와 권한 요약을 확인하고 있습니다." onLogout={onLogout} />;
  }

  if (me.error || !me.data) {
    return (
      <SessionState
        title="세션 확인 실패"
        description={loginErrorMessage(me.error)}
        onLogout={onLogout}
      />
    );
  }

  const admin = me.data.data;
  const navigation = buildMenu(admin.navigation);
  const adminRoles = joinOrDash(admin.roles.map((role) => role.roleCode));
  const canOpenRiskActions = navigation.some((item) => item.to === "/risk-actions");

  function handleGlobalSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = globalSearch.trim().toLowerCase();
    const route = routeForSearch(keyword, navigation);
    navigate(route);
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brandBlock}>
          <div className={styles.brandIcon}>
            <ShieldCheck size={24} />
          </div>
          <div>
            <strong>시스템 설계자</strong>
            <span>{adminRoles}</span>
          </div>
        </div>
        <nav className={styles.nav} aria-label="관리자 메뉴">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className={styles.sidebarTools}>
          {canOpenRiskActions ? (
            <NavLink to="/risk-actions" className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navItemActive : ""}`}>
              <Settings size={18} />
              <span>설정</span>
            </NavLink>
          ) : null}
          <button className={`${styles.navItem} ${styles.navItemButton}`} type="button">
            <CircleHelp size={18} />
            <span>고객 지원</span>
          </button>
        </div>
        <div className={styles.tenantBox}>
          <span>관리 테넌트</span>
          <strong>{admin.tenant.tenantId ? shortId(admin.tenant.tenantId) : "전체 테넌트"}</strong>
          <span>{statusLabel(admin.tenant.status)}</span>
        </div>
      </aside>
      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <form className={styles.globalSearch} onSubmit={handleGlobalSearch}>
            <Search size={18} aria-hidden="true" />
            <input
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="테넌트, 사용자 또는 설정을 검색하세요..."
              aria-label="관리 메뉴 검색"
            />
          </form>
          <div className={styles.userBox}>
            <button className={styles.iconButton} type="button" aria-label="알림">
              <Bell size={18} />
              <span className={styles.notificationDot} />
            </button>
            <button className={styles.iconButton} type="button" aria-label="도움말">
              <CircleHelp size={18} />
            </button>
            <div className={styles.avatarBox}>
              {admin.user.displayName.slice(0, 1)}
            </div>
            <div className={styles.userText}>
              <strong>{admin.user.displayName}</strong>
              <span>{admin.user.email}</span>
            </div>
            <button className={styles.iconButton} type="button" onClick={onLogout} aria-label="로그아웃">
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className={styles.content}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<RequireNavigation navigation={navigation} path="/dashboard"><DashboardScreen /></RequireNavigation>} />
            <Route path="/tenants" element={<RequireNavigation navigation={navigation} path="/tenants"><TenantsScreen /></RequireNavigation>} />
            <Route path="/access-control" element={<RequireNavigation navigation={navigation} path="/access-control"><AccessControlScreen admin={admin} /></RequireNavigation>} />
            <Route path="/roles" element={<RequireNavigation navigation={navigation} path="/roles"><RolesScreen /></RequireNavigation>} />
            <Route path="/audit-logs" element={<RequireNavigation navigation={navigation} path="/audit-logs"><AuditLogsScreen /></RequireNavigation>} />
            <Route path="/risk-actions" element={<RequireNavigation navigation={navigation} path="/risk-actions"><RiskActionsScreen /></RequireNavigation>} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function SessionState({ title, description, onLogout }: { title: string; description: string; onLogout: () => void }) {
  return (
    <main className={styles.loginPage}>
      <section className={styles.sessionPanel} aria-live="polite">
        <div>
          <p className={styles.eyebrow}>Admin Console</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <button type="button" onClick={onLogout}>로그인으로 돌아가기</button>
      </section>
    </main>
  );
}

function RequireNavigation({
  navigation,
  path,
  children
}: {
  navigation: NavigationMenuItem[];
  path: string;
  children: ReactNode;
}) {
  if (!navigation.some((item) => item.to === path)) {
    return (
      <Screen title="접근 제한" description="현재 권한으로 접근할 수 없는 관리자 메뉴입니다.">
        <div className={styles.stateBox}>필요 권한이 있는 계정으로 다시 로그인하거나 관리자에게 권한 부여를 요청하세요.</div>
      </Screen>
    );
  }

  return <>{children}</>;
}

function buildMenu(navigation: AdminMe["navigation"]): NavigationMenuItem[] {
  return navigation.flatMap((item) => {
    const base = menuByKey.get(item.key);
    if (!base) {
      return [];
    }

    return [{
      key: item.key,
      to: item.path,
      label: item.label,
      icon: base.icon
    }];
  });
}

function routeForSearch(keyword: string, navigation: NavigationMenuItem[]): string {
  if (!keyword) {
    return "/dashboard";
  }

  const candidates = [
    { path: "/tenants", keywords: ["테넌트", "고객사", "tenant", "client"] },
    { path: "/access-control", keywords: ["사용자", "유저", "user", "권한"] },
    { path: "/roles", keywords: ["역할", "role", "permission", "권한"] },
    { path: "/audit-logs", keywords: ["감사", "로그", "audit", "log"] },
    { path: "/risk-actions", keywords: ["위험", "설정", "setting", "risk"] },
    { path: "/dashboard", keywords: ["대시", "dashboard", "요약"] }
  ];

  const allowed = new Set(navigation.map((item) => item.to));
  return candidates.find((candidate) =>
    allowed.has(candidate.path) && candidate.keywords.some((item) => keyword.includes(item))
  )?.path ?? "/dashboard";
}

function DashboardScreen() {
  const navigate = useNavigate();
  const dashboard = useQuery({ queryKey: ["admin-dashboard"], queryFn: getAdminDashboard });

  function exportReport(data: AdminDashboardData) {
    const blob = new Blob([JSON.stringify({
      exportedAt: new Date().toISOString(),
      tenantSummary: data.tenantSummary,
      accessSummary: data.accessSummary,
      auditSummary: {
        total: data.auditSummary.total,
        recentItems: data.auditSummary.recentItems
      },
      riskSummary: data.riskSummary
    }, null, 2)], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `admin-dashboard-report-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  return (
    <section className={styles.dashboardPage}>
      <ResultState query={dashboard}>
        {(result) => (
          <>
            <div className={styles.dashboardHero}>
              <div>
                <h2>대시보드 개요</h2>
                <p>시스템 전체 지표 및 테넌트 활동 요약.</p>
              </div>
              <div className={styles.dashboardActions}>
                <button type="button" className={styles.outlineAction} onClick={() => exportReport(result.data)}>
                  <Download size={16} />
                  보고서 내보내기
                </button>
              </div>
            </div>

            <div className={styles.dashboardMetricGrid}>
              <DashboardMetric
                title="총 테넌트 수"
                value={formatInteger(result.data.tenantSummary.total)}
                detail="최근 집계 기준"
                trend={trendLabel(result.data.tenantSummary.total)}
                icon={<Building2 size={46} />}
              />
              <DashboardMetric
                title="활성 사용자 수"
                value={formatCompact(result.data.accessSummary.usersTotal)}
                detail="모든 테넌트 대상"
                trend={trendLabel(result.data.accessSummary.usersTotal)}
                icon={<Users size={48} />}
              />
              <DashboardMetric
                title="시스템 상태"
                value={`${healthPercent(result.data)}%`}
                detail={`평균 부하: ${Math.max(0, Math.min(100, 100 - riskAlertCount(result.data) * 7))}%`}
                icon={<Settings size={48} />}
                health
              />
              <DashboardMetric
                title="위험 알림"
                value={formatInteger(riskAlertCount(result.data))}
                detail={riskAlertCount(result.data) > 0 ? "알림 세부정보 보기" : "조치 필요 없음"}
                danger={riskAlertCount(result.data) > 0}
                badge={riskAlertCount(result.data) > 0 ? "조치 필요" : "정상"}
                icon={<AlertTriangle size={50} />}
              />
            </div>

            <div className={styles.dashboardMainGrid}>
              <section className={styles.growthPanel}>
                <header>
                  <div>
                    <h3>테넌트 성장 및 활동</h3>
                    <p>최근 상태와 전체 집계를 기반으로 한 운영 추세입니다.</p>
                  </div>
                  <span>최근 30일</span>
                </header>
                <TenantGrowthChart data={result.data} />
              </section>

              <section className={styles.auditPanel}>
                <header>
                  <div>
                    <h3>감사 로그 요약</h3>
                    <p>최근 변경성 이벤트와 위험 신호.</p>
                  </div>
                  <Filter size={18} />
                </header>
                <DashboardAuditSummary items={result.data.auditSummary.recentItems} />
                <button type="button" className={styles.loadMoreAction} onClick={() => navigate("/audit-logs")}>
                  이전 로그 불러오기
                </button>
              </section>
            </div>
          </>
        )}
      </ResultState>
    </section>
  );
}

function DashboardMetric({
  title,
  value,
  detail,
  trend,
  badge,
  icon,
  danger,
  health
}: {
  title: string;
  value: string;
  detail: string;
  trend?: string;
  badge?: string;
  icon: ReactNode;
  danger?: boolean;
  health?: boolean;
}) {
  return (
    <article className={`${styles.dashboardMetricCard} ${danger ? styles.dashboardMetricDanger : ""}`}>
      <div>
        <span>{title}</span>
        <strong>{value}</strong>
        <p>{detail}</p>
        {health ? <div className={styles.healthBar}><span /></div> : null}
      </div>
      <div className={styles.metricVisual}>
        {icon}
        {trend ? <em>{trend}</em> : null}
        {badge ? <em>{badge}</em> : null}
      </div>
    </article>
  );
}

function TenantGrowthChart({ data }: { data: AdminDashboardData }) {
  const bars = dashboardTrendBars(data);
  const max = Math.max(...bars.map((item) => item.value), 1);

  return (
    <div className={styles.growthChart}>
      <div className={styles.chartScale}>
        <span>1000</span>
        <span>750</span>
        <span>500</span>
        <span>250</span>
        <span>0</span>
      </div>
      <div className={styles.chartBars}>
        {bars.map((bar, index) => (
          <div key={bar.label} className={styles.chartBarSlot}>
            <span
              className={styles.chartBar}
              style={{
                height: `${Math.max(22, Math.round((bar.value / max) * 100))}%`,
                opacity: 0.42 + index * 0.08
              }}
              title={`${bar.label}: ${formatInteger(bar.value)}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardAuditSummary({ items }: { items: AuditLogItem[] }) {
  if (items.length === 0) {
    return <div className={styles.stateBox}>최근 감사 로그가 없습니다.</div>;
  }

  return (
    <div className={styles.dashboardAuditList}>
      {items.slice(0, 4).map((item) => (
        <article key={item.auditId} className={styles.dashboardAuditItem}>
          <span className={auditIconClass(item.result)}>{auditIconLabel(item)}</span>
          <div>
            <strong>{auditActorLabel(item)} 님이 {auditActionLabel(item.action)}</strong>
            <p>{relativeAuditTime(item.occurredAt)} · {item.tenantId ? shortId(item.tenantId) : "전역 범위"}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function StatusSummary({ data }: { data: AdminDashboardData }) {
  const statuses = ["active", "provisioning", "suspended", "deleted"];

  return (
    <div className={styles.statusList}>
      {statuses.map((status) => (
        <div key={status} className={styles.statusRow}>
          <span>{statusLabel(status)}</span>
          <strong>{formatInteger(data.tenantSummary.statusCounts[status] ?? 0)}</strong>
        </div>
      ))}
    </div>
  );
}

function ModuleSummary({ modules }: { modules: Record<string, number> }) {
  const entries = Object.entries(modules);

  if (entries.length === 0) {
    return <div className={styles.stateBox}>활성 모듈 정보가 없습니다.</div>;
  }

  return (
    <div className={styles.actionGrid}>
      {entries.map(([moduleName, count]) => (
        <span key={moduleName} className={styles.actionOn}>{moduleName} {formatInteger(count)}</span>
      ))}
    </div>
  );
}

function AuditSummary({ items }: { items: AuditLogItem[] }) {
  if (items.length === 0) {
    return <div className={styles.stateBox}>최근 감사 로그가 없습니다.</div>;
  }

  return (
    <div className={styles.auditList}>
      {items.slice(0, 5).map((item) => (
        <div key={item.auditId} className={styles.auditItem}>
          <strong>{item.action}</strong>
          <span>{item.requestId}</span>
          <small>{formatDate(item.occurredAt)} · {resultLabel(item.result)}</small>
        </div>
      ))}
    </div>
  );
}

function RiskSignal({ label, value }: { label: string; value: number }) {
  return (
    <div className={value > 0 ? styles.riskSignalOn : styles.riskSignalOff}>
      <span>{label}</span>
      <strong>{formatInteger(value)}</strong>
    </div>
  );
}

function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.requestId ? `${error.code}: ${error.message} (${error.requestId})` : `${error.code}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "로그인 요청에 실패했습니다.";
}

function isRequiredCreateModule(moduleCode: string): boolean {
  return (tenantRequiredCreateModuleCodes as readonly string[]).includes(moduleCode);
}

function ensureRequiredCreateModules(moduleCodes: string[]): string[] {
  return Array.from(new Set([...tenantRequiredCreateModuleCodes, ...moduleCodes]));
}

function TenantsScreen() {
  const queryClient = useQueryClient();
  const [draftFilters, setDraftFilters] = useState<FilterValues>(() => createFilterValues(tenantSearchFields));
  const [filters, setFilters] = useState<FilterValues>(() => createFilterValues(tenantSearchFields));
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const tenantQuery = { ...toAdminListQuery(filters), page, size: pageSize };
  const tenants = useQuery({
    queryKey: ["admin-tenants", tenantQuery],
    queryFn: () => getTenants(tenantQuery)
  });
  const tenantSummary = useQuery({
    queryKey: ["admin-tenants-summary"],
    queryFn: () => getTenants({ page: 1, size: 100 })
  });
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDomain, setCreateDomain] = useState("");
  const [createContact, setCreateContact] = useState("");
  const [createModules, setCreateModules] = useState<string[]>(() => [...defaultTenantCreateModules]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [isDetailEditMode, setIsDetailEditMode] = useState(false);
  const [detailName, setDetailName] = useState("");
  const [detailDomain, setDetailDomain] = useState("");
  const [detailContact, setDetailContact] = useState("");
  const [detailStatus, setDetailStatus] = useState("");
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const tenantDetail = useQuery({
    queryKey: ["admin-tenant-detail", selectedTenantId],
    queryFn: () => getTenant(selectedTenantId ?? ""),
    enabled: selectedTenantId !== null
  });
  const summaryItems = tenantSummary.data?.data.items ?? tenants.data?.data.items ?? [];
  const totalTenants = tenantSummary.data?.data.total ?? tenants.data?.data.total ?? 0;
  const activeTenants = summaryItems.filter((item) => item.status === "active").length;
  const attentionTenants = summaryItems.filter((item) => item.status === "provisioning" || item.status === "suspended").length;
  const totalPages = Math.max(1, Math.ceil((tenants.data?.data.total ?? 0) / pageSize));
  const refreshTenantQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-tenants"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-tenants-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-tenant-detail"] })
    ]);
  };
  const resetCreateForm = () => {
    setCreateName("");
    setCreateDomain("");
    setCreateContact("");
    setCreateModules([...defaultTenantCreateModules]);
  };
  const closeCreateModal = () => {
    setIsCreateModalOpen(false);
    resetCreateForm();
  };
  const closeDetailModal = () => {
    setSelectedTenantId(null);
    setIsDetailEditMode(false);
    setDetailName("");
    setDetailDomain("");
    setDetailContact("");
    setDetailStatus("");
  };
  const resetDetailDraft = (detail: TenantDetail) => {
    setDetailName(detail.name);
    setDetailDomain(primaryTenantDomain(detail));
    setDetailContact(tenantContactPhone(detail));
    setDetailStatus(detail.status);
  };
  const enterDetailEditMode = () => {
    if (!tenantDetail.data?.data) {
      return;
    }

    resetDetailDraft(tenantDetail.data.data);
    setActionNotice(null);
    setIsDetailEditMode(true);
  };
  const cancelDetailEditMode = () => {
    if (tenantDetail.data?.data) {
      resetDetailDraft(tenantDetail.data.data);
    }

    setIsDetailEditMode(false);
  };
  const saveDetailChanges = () => {
    if (!tenantDetail.data?.data || !isDetailEditMode) {
      return;
    }

    const nextName = detailName.trim();
    const nextDomain = detailDomain.trim();

    if (!nextName || !nextDomain) {
      setActionNotice("고객사 이름과 도메인은 필수입니다.");
      return;
    }

    updateMutation.mutate({
      tenantId: tenantDetail.data.data.tenantId,
      name: nextName,
      domain: nextDomain,
      contactPhone: detailContact.trim() || undefined
    });
  };
  const createMutation = useMutation({
    mutationFn: async (input: { name: string; domain?: string; contactPhone?: string; enabledModules: string[] }) => {
      const tenant = await createTenant({
        name: input.name,
        domain: input.domain,
        contactPhone: input.contactPhone
      });
      await replaceTenantModules({
        tenantId: tenant.tenantId,
        enabledModules: ensureRequiredCreateModules(input.enabledModules)
      });
      return tenant;
    },
    onSuccess: async () => {
      resetCreateForm();
      setIsCreateModalOpen(false);
      setActionNotice("고객사 추가 요청이 완료되었습니다.");
      await refreshTenantQueries();
    },
    onError: (error) => setActionNotice(loginErrorMessage(error))
  });
  const updateMutation = useMutation({
    mutationFn: (input: { tenantId: string; name: string; domain?: string; contactPhone?: string }) => updateTenant(input),
    onSuccess: async () => {
      setIsDetailEditMode(false);
      setActionNotice("고객사 정보가 수정되었습니다.");
      await refreshTenantQueries();
    },
    onError: (error) => setActionNotice(loginErrorMessage(error))
  });
  const updateStatusMutation = useMutation({
    mutationFn: (input: { tenantId: string; status: string }) => updateTenantStatus(input),
    onSuccess: async (tenant) => {
      setDetailStatus(tenant.status);
      setActionNotice(
        isDetailEditMode
          ? "고객사 상태가 변경되었습니다. 기본 정보 변경은 저장하기를 눌러야 반영됩니다."
          : "고객사 상태가 변경되었습니다."
      );
      await refreshTenantQueries();
    },
    onError: (error) => setActionNotice(loginErrorMessage(error))
  });
  const canSubmitCreateTenant =
    createName.trim().length > 0
    && createDomain.trim().length > 0
    && createModules.length > 0
    && !createMutation.isPending;

  useEffect(() => {
    if (!tenantDetail.data?.data || isDetailEditMode) {
      return;
    }

    resetDetailDraft(tenantDetail.data.data);
  }, [isDetailEditMode, selectedTenantId, tenantDetail.data?.data?.tenantId, tenantDetail.data?.data?.updatedAt]);

  return (
    <section className={styles.customerPage}>
      <header className={styles.customerHero}>
        <div>
          <h2>고객사 관리</h2>
          <p>등록된 모든 고객사(테넌트)를 관리하고 모니터링합니다.</p>
        </div>
        <button
          type="button"
          className={styles.customerAddButton}
          onClick={() => {
            setIsCreateModalOpen(true);
            setActionNotice(null);
          }}
        >
          <Plus size={20} />
          고객사 추가
        </button>
      </header>

      <div className={styles.customerSummaryGrid}>
        <article className={styles.customerMetricCard}>
          <span className={styles.customerMetricIcon}><Users size={34} /></span>
          <div>
            <p>전체 고객사</p>
            <strong>{formatInteger(totalTenants)}</strong>
            <small>개소</small>
          </div>
        </article>
        <article className={styles.customerMetricCard}>
          <span className={styles.customerMetricIcon}><CheckCircle2 size={34} /></span>
          <div>
            <p>활성 고객사</p>
            <strong>{formatInteger(activeTenants)}</strong>
            <small>개소</small>
          </div>
        </article>
        <article className={styles.customerMetricCard}>
          <span className={`${styles.customerMetricIcon} ${styles.customerMetricDanger}`}>
            <CalendarX2 size={34} />
          </span>
          <div>
            <p>관리 필요</p>
            <strong>{formatInteger(attentionTenants)}</strong>
            <small>개소</small>
          </div>
        </article>
      </div>

      <form
        className={styles.customerFilterBar}
        onSubmit={(event) => {
          event.preventDefault();
          setFilters(sanitizeFilterValues(draftFilters));
          setPage(1);
        }}
      >
        <label className={styles.customerSearchInput}>
          <Search size={22} />
          <input
            value={draftFilters.keyword ?? ""}
            onChange={(event) => setDraftFilters((current) => ({ ...current, keyword: event.target.value }))}
            placeholder="고객사 이름 또는 도메인 검색"
          />
        </label>
        <label className={styles.customerSelectField}>
          상태:
          <select
            value={draftFilters.status ?? ""}
            onChange={(event) => setDraftFilters((current) => ({ ...current, status: event.target.value }))}
          >
            <option value="">전체</option>
            <option value="provisioning">준비중</option>
            <option value="active">활성</option>
            <option value="suspended">중지</option>
            <option value="deleted">삭제</option>
          </select>
        </label>
        <label className={styles.customerSelectField}>
          모듈:
          <select
            value={draftFilters.moduleCode ?? ""}
            onChange={(event) => setDraftFilters((current) => ({ ...current, moduleCode: event.target.value }))}
          >
            <option value="">전체</option>
            <option value="auth">Auth</option>
            <option value="tenant">Tenant</option>
            <option value="wms">WMS</option>
          </select>
        </label>
        <button type="submit" className={styles.customerSearchButton}>검색</button>
        <button
          type="button"
          className={styles.customerResetButton}
          onClick={() => {
            const next = createFilterValues(tenantSearchFields);
            setDraftFilters(next);
            setFilters(next);
            setPage(1);
          }}
        >
          <RefreshCw size={18} />
          필터 초기화
        </button>
      </form>

      <ResultState query={tenants}>
        {(result) => (
          <>
            <div className={styles.customerTableCard}>
              <table className={styles.customerTable}>
                <thead>
                  <tr>
                    <th>고객사 이름</th>
                    <th>도메인</th>
                    <th>모듈</th>
                    <th>상태</th>
                    <th>등록 일자</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.items.map((item) => (
                    <tr
                      key={item.tenantId}
                      className={styles.customerTableRow}
                      tabIndex={0}
                      onClick={() => {
                        setSelectedTenantId(item.tenantId);
                        setIsDetailEditMode(false);
                        setActionNotice(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedTenantId(item.tenantId);
                          setIsDetailEditMode(false);
                          setActionNotice(null);
                        }
                      }}
                    >
                      <td>
                        <div className={styles.customerNameCell}>
                          <span className={styles.customerAvatar}>{tenantInitials(item)}</span>
                          <span className={styles.customerNameText}>
                            <strong>{item.name}</strong>
                            <small>{item.code}</small>
                          </span>
                        </div>
                      </td>
                      <td className={styles.customerMono}>{item.domains[0] ?? "-"}</td>
                      <td>
                        <span className={styles.moduleChipList}>
                          {item.enabledModules.length > 0
                            ? item.enabledModules.map((moduleCode) => (
                                <em key={moduleCode} className={styles.moduleChip}>{moduleLabel(moduleCode)}</em>
                              ))
                            : <em className={styles.moduleChip}>-</em>}
                        </span>
                      </td>
                      <td>
                        <span className={`${styles.customerStatusPill} ${styles[customerStatusClass(item.status)]}`}>
                          {statusLabel(item.status)}
                        </span>
                      </td>
                      <td>{formatDate(item.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <footer className={styles.customerTableFooter}>
                <span>
                  총 {formatInteger(result.data.total)}개 중 {formatInteger(Math.min((page - 1) * pageSize + 1, result.data.total))}-
                  {formatInteger(Math.min(page * pageSize, result.data.total))}개 표시
                </span>
                <div className={styles.customerPagination}>
                  <button type="button" onClick={() => setPage(1)} disabled={page === 1}>처음</button>
                  <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>이전</button>
                  <strong>{page}</strong>
                  <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>다음</button>
                  <button type="button" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>끝</button>
                </div>
              </footer>
            </div>

            <div className={styles.customerFooterCards}>
              <article className={styles.customerGuideCard}>
                <div>
                  <h3>신규 고객사 온보딩 가이드</h3>
                  <p>새로운 테넌트를 설정하고 보안 정책을 적용하는 단계를 확인하세요.</p>
                </div>
                <button type="button">가이드 보기</button>
                <Sparkles size={76} />
              </article>
            </div>
            {actionNotice ? <p className={styles.actionNotice}>{actionNotice}</p> : null}
          </>
        )}
      </ResultState>
      {isCreateModalOpen ? (
        <div className={styles.customerModalBackdrop}>
          <form
            className={styles.customerCreateModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-create-title"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canSubmitCreateTenant) {
                return;
              }
              createMutation.mutate({
                name: createName.trim(),
                domain: createDomain.trim() || undefined,
                contactPhone: createContact.trim() || undefined,
                enabledModules: ensureRequiredCreateModules(createModules)
              });
            }}
          >
            <header className={styles.customerModalHeader}>
              <div>
                <h3 id="customer-create-title">새 테넌트 추가</h3>
                <p>새로운 테넌트를 등록하기 위해 아래 정보를 입력해 주세요.</p>
              </div>
              <button type="button" className={styles.customerModalClose} onClick={closeCreateModal} aria-label="닫기">
                <X size={24} />
              </button>
            </header>
            <div className={styles.customerModalBody}>
              <div className={styles.customerModalGrid}>
                <label className={styles.customerModalField}>
                  <span>업체명 <em>*</em></span>
                  <input
                    value={createName}
                    onChange={(event) => setCreateName(event.target.value)}
                    placeholder="예: (주)테크솔루션"
                    required
                  />
                </label>
                <label className={styles.customerModalField}>
                  <span>테넌트 ID</span>
                  <input value="자동 생성됨" disabled />
                </label>
              </div>
              <label className={styles.customerModalField}>
                <span>도메인 <em>*</em></span>
                <input
                  value={createDomain}
                  onChange={(event) => setCreateDomain(event.target.value)}
                  placeholder="도메인 주소를 입력하세요 (예: company.com)"
                  required
                />
                <small>테넌트 전용 접속 주소로 사용됩니다.</small>
              </label>
              <fieldset className={styles.customerModulePicker}>
                <legend>모듈 선택 <em>*</em></legend>
                <div>
                  {tenantCreateModuleOptions.map((moduleOption) => (
                    <label
                      key={moduleOption.code}
                      className={`${styles.customerModuleOption} ${
                        isRequiredCreateModule(moduleOption.code) ? styles.customerModuleOptionLocked : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={createModules.includes(moduleOption.code)}
                        disabled={isRequiredCreateModule(moduleOption.code)}
                        onChange={(event) => {
                          if (isRequiredCreateModule(moduleOption.code)) {
                            return;
                          }
                          setCreateModules((current) => {
                            if (event.target.checked) {
                              return ensureRequiredCreateModules([...current, moduleOption.code]);
                            }

                            return ensureRequiredCreateModules(current.filter((moduleCode) => moduleCode !== moduleOption.code));
                          });
                        }}
                      />
                      <span>{moduleOption.label}</span>
                    </label>
                  ))}
                </div>
                <small>Auth와 Tenant는 기본 필수 모듈이며, WMS는 선택할 수 있습니다.</small>
              </fieldset>
              <div className={styles.customerModalDivider} />
              <label className={styles.customerModalField}>
                <span>연락처</span>
                <span className={styles.customerPhoneField}>
                  <Phone size={18} />
                  <input
                    value={createContact}
                    onChange={(event) => setCreateContact(event.target.value)}
                    placeholder="010-0000-0000"
                  />
                </span>
              </label>
            </div>
            <footer className={styles.customerModalFooter}>
              <button type="button" className={styles.customerModalSecondary} onClick={closeCreateModal}>
                취소
              </button>
              <button type="submit" className={styles.customerModalPrimary} disabled={!canSubmitCreateTenant}>
                테넌트 등록
              </button>
            </footer>
          </form>
        </div>
      ) : null}
      {selectedTenantId ? (
        <div className={styles.customerModalBackdrop}>
          <div
            className={styles.customerDetailModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-detail-title"
          >
            <header className={styles.customerModalHeader}>
              <div className={styles.customerDetailTitle}>
                <Building2 size={24} />
                <h3 id="customer-detail-title">고객사 상세 정보</h3>
                <span>{isDetailEditMode ? "수정 모드" : "조회 모드"}</span>
              </div>
              <div className={styles.customerModalHeaderActions}>
                {!isDetailEditMode ? (
                  <button
                    type="button"
                    className={styles.customerHeaderPrimary}
                    disabled={!tenantDetail.data?.data}
                    onClick={enterDetailEditMode}
                  >
                    <Pencil size={18} />
                    수정하기
                  </button>
                ) : null}
                <button type="button" className={styles.customerModalClose} onClick={closeDetailModal} aria-label="닫기">
                  <X size={24} />
                </button>
              </div>
            </header>
            <div className={styles.customerDetailBody}>
              {tenantDetail.isLoading ? <p className={styles.stateBox}>고객사 상세 정보를 불러오고 있습니다.</p> : null}
              {tenantDetail.isError ? <p className={styles.stateBox}>{loginErrorMessage(tenantDetail.error)}</p> : null}
              {tenantDetail.data?.data ? (
                <>
                  <section className={styles.customerDetailHero}>
                    <span className={styles.customerDetailIcon}><Building2 size={42} /></span>
                    <div>
                      <strong>{tenantDetail.data.data.name}</strong>
                      <span className={`${styles.customerStatusPill} ${styles[customerStatusClass(tenantDetail.data.data.status)]}`}>
                        {statusLabel(tenantDetail.data.data.status)}
                      </span>
                      <p>{tenantModuleSummary(tenantDetail.data.data)}</p>
                      <div className={styles.customerStatusControl}>
                        <label>
                          <span>상태</span>
                          <select
                            value={detailStatus || tenantDetail.data.data.status}
                            onChange={(event) => setDetailStatus(event.target.value)}
                          >
                            {tenantStatusOptions.map((statusOption) => (
                              <option key={statusOption.value} value={statusOption.value}>
                                {statusOption.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className={styles.customerStatusChangeButton}
                          disabled={
                            updateStatusMutation.isPending
                            || !detailStatus
                            || detailStatus === tenantDetail.data.data.status
                          }
                          onClick={() => {
                            updateStatusMutation.mutate({
                              tenantId: tenantDetail.data.data.tenantId,
                              status: detailStatus
                            });
                          }}
                        >
                          {updateStatusMutation.isPending ? "변경 중" : "상태 변경"}
                        </button>
                      </div>
                    </div>
                  </section>
                  <div className={styles.customerDetailGrid}>
                    <label className={styles.customerDetailField}>
                      <span>고객사 이름</span>
                      {isDetailEditMode ? (
                        <input value={detailName} onChange={(event) => setDetailName(event.target.value)} required />
                      ) : (
                        <strong>{tenantDetail.data.data.name}</strong>
                      )}
                    </label>
                    <label className={styles.customerDetailField}>
                      <span>고객사 ID</span>
                      <strong className={styles.customerDetailMono}>{tenantDetail.data.data.tenantId}</strong>
                    </label>
                    <label className={styles.customerDetailField}>
                      <span>고객사 코드</span>
                      <strong className={styles.customerDetailMono}>{tenantDetail.data.data.code}</strong>
                    </label>
                    <label className={styles.customerDetailField}>
                      <span>도메인 (DOMAIN)</span>
                      {isDetailEditMode ? (
                        <input value={detailDomain} onChange={(event) => setDetailDomain(event.target.value)} required />
                      ) : (
                        <strong className={styles.customerDetailMono}>{primaryTenantDomain(tenantDetail.data.data) || "-"}</strong>
                      )}
                    </label>
                    <label className={styles.customerDetailField}>
                      <span>모듈 (MODULE)</span>
                      <strong>{tenantModuleSummary(tenantDetail.data.data)}</strong>
                    </label>
                    <label className={styles.customerDetailField}>
                      <span>등록 일자</span>
                      <strong>{formatDate(tenantDetail.data.data.createdAt)}</strong>
                    </label>
                    <label className={`${styles.customerDetailField} ${styles.customerDetailWideField}`}>
                      <span>연락처 (CONTACT)</span>
                      {isDetailEditMode ? (
                        <span className={styles.customerPhoneField}>
                          <Phone size={18} />
                          <input value={detailContact} onChange={(event) => setDetailContact(event.target.value)} placeholder="010-0000-0000" />
                        </span>
                      ) : (
                        <strong className={styles.customerDetailContact}>
                          <Phone size={18} />
                          {tenantContactPhone(tenantDetail.data.data) || "-"}
                        </strong>
                      )}
                    </label>
                  </div>
                  <div className={styles.customerDetailMemo}>
                    <span>관리자 메모</span>
                    <p>등록된 고객사의 기본 정보를 확인하고 필요한 항목을 수정할 수 있습니다.</p>
                  </div>
                </>
              ) : null}
              {actionNotice ? <p className={styles.actionNotice}>{actionNotice}</p> : null}
            </div>
            <footer className={`${styles.customerModalFooter} ${!isDetailEditMode ? styles.customerModalFooterSingle : ""}`}>
              <button type="button" className={styles.customerModalSecondary} onClick={isDetailEditMode ? cancelDetailEditMode : closeDetailModal}>
                {isDetailEditMode ? "취소" : "닫기"}
              </button>
              {isDetailEditMode ? (
                <button
                  type="button"
                  className={styles.customerModalPrimary}
                  disabled={updateMutation.isPending || !tenantDetail.data?.data || !detailName.trim() || !detailDomain.trim()}
                  onClick={saveDetailChanges}
                >
                  <Save size={18} />
                  {updateMutation.isPending ? "저장 중" : "저장하기"}
                </button>
              ) : null}
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function tenantInitials(tenant: TenantItem): string {
  const source = tenant.code || tenant.name;
  return source.slice(0, 2).toUpperCase();
}

function primaryTenantDomain(tenant: TenantDetail): string {
  return tenant.domains[0]?.domain ?? "";
}

function tenantContactPhone(tenant: TenantDetail): string {
  const contactPhone = tenant.settings.contactPhone;
  return typeof contactPhone === "string" ? contactPhone : "";
}

function tenantModuleSummary(tenant: Pick<TenantDetail, "enabledModules">): string {
  return tenant.enabledModules.length > 0 ? tenant.enabledModules.map((moduleCode) => moduleLabel(moduleCode)).join(", ") : "-";
}

function moduleLabel(moduleCode: string): string {
  const labels: Record<string, string> = {
    auth: "Auth",
    tenant: "Tenant",
    wms: "WMS"
  };

  return labels[moduleCode] ?? moduleCode;
}

function customerStatusClass(status: string): string {
  if (status === "active") {
    return "customerStatusActive";
  }
  if (status === "provisioning") {
    return "customerStatusPending";
  }
  if (status === "suspended") {
    return "customerStatusDanger";
  }

  return "customerStatusOff";
}

function AccessControlScreen({ admin }: { admin: AdminMe }) {
  const queryClient = useQueryClient();
  const [draftFilters, setDraftFilters] = useState<FilterValues>(() => createFilterValues(accessSearchFields));
  const [filters, setFilters] = useState<FilterValues>(() => createFilterValues(accessSearchFields));
  const [page, setPage] = useState(1);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createTarget, setCreateTarget] = useState<CreateUserTarget>("tenant_user");
  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createStatus, setCreateStatus] = useState("active");
  const [createRoleId, setCreateRoleId] = useState("");
  const [createTenantId, setCreateTenantId] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);
  const [isUserDetailEditMode, setIsUserDetailEditMode] = useState(false);
  const [detailUserName, setDetailUserName] = useState("");
  const [detailUserEmail, setDetailUserEmail] = useState("");
  const [detailUserStatus, setDetailUserStatus] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const pageSize = 5;
  const accessQuery = { ...toAdminListQuery(filters), page, size: pageSize };
  const access = useQuery({
    queryKey: ["admin-access-control", accessQuery],
    queryFn: () => getAccessControlData(accessQuery)
  });
  const userSummary = useQuery({
    queryKey: ["admin-user-summary"],
    queryFn: () => getAccessControlData({ page: 1, size: 100 })
  });
  const canReadTenantDirectory = admin.tenant.tenantId === null && admin.permissions.includes("tenant.tenants.read");
  const hasSystemAdminScope = admin.tenant.tenantId === null && admin.roles.some((role) => role.roleCode === "system_admin");
  const isBootstrapSuperAdmin = hasSystemAdminScope && admin.user.id === bootstrapSystemAdminUserId;
  const tenantDirectory = useQuery({
    queryKey: ["admin-user-tenant-options"],
    queryFn: () => getTenants({ page: 1, size: 100 }),
    enabled: canReadTenantDirectory
  });
  const createTargetOptions: Array<{ value: CreateUserTarget; label: string }> = isBootstrapSuperAdmin
    ? [
      { value: "system_admin", label: "시스템 관리자" },
      { value: "tenant_admin", label: "테넌트 관리자" },
      { value: "tenant_user", label: "테넌트 사용자" }
    ]
    : hasSystemAdminScope
      ? [
        { value: "tenant_admin", label: "테넌트 관리자" },
        { value: "tenant_user", label: "테넌트 사용자" }
      ]
      : [{ value: "tenant_user", label: "테넌트 사용자" }];
  const roleOptions = userSummary.data?.data.roles.items ?? access.data?.data.roles.items ?? [];
  const tenantOptions = tenantDirectory.data?.data.items ?? [];
  const tenantNames = new Map(tenantOptions.map((tenant) => [tenant.tenantId, tenant.name]));
  const selectedCreateTenantId = createTarget === "system_admin"
    ? undefined
    : canReadTenantDirectory
      ? createTenantId
      : admin.tenant.tenantId ?? undefined;
  const roleOptionsForSelectedTenant = roleOptions.filter((role) => {
    if (createTarget === "system_admin") {
      return false;
    }

    return !role.tenantId || !selectedCreateTenantId || role.tenantId === selectedCreateTenantId;
  });
  const tenantAdminRole = roleOptionsForSelectedTenant.find((role) => role.code === "tenant_admin");
  const tenantUserRoleOptions = roleOptionsForSelectedTenant.filter((role) => role.code !== "tenant_admin");
  const summaryUsers = userSummary.data?.data.users.items ?? access.data?.data.users.items ?? [];
  const totalUsers = userSummary.data?.data.users.total ?? access.data?.data.users.total ?? 0;
  const activeUsers = summaryUsers.filter((user) => user.status === "active").length;
  const newUsers = summaryUsers.filter((user) => isWithinDays(user.createdAt, 30)).length;
  const lockedUsers = summaryUsers.filter((user) => user.status === "locked").length;
  const totalPages = Math.max(1, Math.ceil((access.data?.data.users.total ?? 0) / pageSize));
  const pageItems = buildPaginationItems(page, totalPages);
  const resetUserDetailDraft = (user: UserItem) => {
    setDetailUserName(user.displayName);
    setDetailUserEmail(user.email);
    setDetailUserStatus(user.status);
  };
  const openUserDetailModal = (user: UserItem) => {
    setSelectedUser(user);
    setIsUserDetailEditMode(false);
    resetUserDetailDraft(user);
    setNotice(null);
  };
  const closeUserDetailModal = () => {
    setSelectedUser(null);
    setIsUserDetailEditMode(false);
    setDetailUserName("");
    setDetailUserEmail("");
    setDetailUserStatus("");
  };
  const enterUserDetailEditMode = () => {
    if (!selectedUser) {
      return;
    }
    if (!isTenantScopedUser(selectedUser) && !isOwnSystemAdminUser(selectedUser, admin.user.id)) {
      setNotice("시스템 관리자 계정은 테넌트 사용자 수정 API로 변경할 수 없습니다. 별도 시스템 관리자 관리 흐름에서 처리해야 합니다.");
      return;
    }

    resetUserDetailDraft(selectedUser);
    setIsUserDetailEditMode(true);
    setNotice(null);
  };
  const cancelUserDetailEditMode = () => {
    if (selectedUser) {
      resetUserDetailDraft(selectedUser);
    }
    setIsUserDetailEditMode(false);
  };
  const resetCreateUserForm = () => {
    setCreateTarget(createTargetOptions.at(-1)?.value ?? "tenant_user");
    setCreateName("");
    setCreateEmail("");
    setCreatePassword("");
    setCreateStatus("active");
    setCreateRoleId("");
    setCreateTenantId("");
  };
  const createUserMutation = useMutation({
    mutationFn: async (input: {
      displayName: string;
      email: string;
      password: string;
      status: string;
      target: CreateUserTarget;
      roleId?: string;
      tenantId?: string | null;
    }) => {
      const user = await createUser({
        displayName: input.displayName,
        email: input.email,
        password: input.password,
        status: input.status,
        tenantId: input.tenantId,
        userType: input.target === "system_admin" ? "system_admin" : "general_user"
      });
      const userId = getUserId(user);

      if (input.roleId && userId) {
        await assignUserRole({
          userId,
          roleId: input.roleId,
          tenantId: input.tenantId ?? undefined
        });
      }

      return user;
    },
    onSuccess: async () => {
      resetCreateUserForm();
      setIsCreateModalOpen(false);
      setNotice("사용자 추가 요청이 완료되었습니다.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-access-control"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-user-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-audit-logs"] })
      ]);
    },
    onError: (error) => setNotice(loginErrorMessage(error))
  });
  const updateUserMutation = useMutation({
    mutationFn: async (input: {
      user: UserItem;
      displayName: string;
      email: string;
      status: string;
    }) => {
      const userId = getUserId(input.user);
      const updatedUser = await updateUser({
        userId,
        displayName: input.displayName,
        email: input.email,
        tenantId: input.user.tenantId
      });
      const statusUser = isTenantScopedUser(input.user) && input.status !== input.user.status
        ? await updateUserStatus({ userId, status: input.status, tenantId: input.user.tenantId })
        : null;

      return {
        ...input.user,
        ...updatedUser,
        ...(statusUser ?? {}),
        displayName: input.displayName,
        email: input.email,
        status: input.status
      };
    },
    onSuccess: async (user) => {
      setSelectedUser(user);
      resetUserDetailDraft(user);
      setIsUserDetailEditMode(false);
      setNotice("사용자 정보가 수정되었습니다.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-access-control"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-user-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-audit-logs"] })
      ]);
    },
    onError: (error) => setNotice(loginErrorMessage(error))
  });
  useEffect(() => {
    if (!createTargetOptions.some((option) => option.value === createTarget)) {
      setCreateTarget(createTargetOptions.at(-1)?.value ?? "tenant_user");
    }
  }, [createTarget, createTargetOptions]);

  useEffect(() => {
    setCreateRoleId("");
  }, [createTarget, selectedCreateTenantId]);

  const effectiveCreateRoleId = createTarget === "tenant_admin" ? (tenantAdminRole ? getRoleId(tenantAdminRole) : "") : createRoleId;
  const needsCreateTenant = createTarget !== "system_admin";
  const canSubmitCreateUser =
    createName.trim().length > 0
    && createEmail.trim().length > 0
    && createPassword.length >= 8
    && (!needsCreateTenant || Boolean(selectedCreateTenantId))
    && (createTarget !== "tenant_admin" || Boolean(effectiveCreateRoleId))
    && !createUserMutation.isPending;
  const canSubmitUserDetail =
    Boolean(selectedUser)
    && Boolean(selectedUser && (isTenantScopedUser(selectedUser) || isOwnSystemAdminUser(selectedUser, admin.user.id)))
    && Boolean(selectedUser && getUserId(selectedUser))
    && detailUserName.trim().length > 0
    && detailUserEmail.trim().length > 0
    && detailUserStatus.trim().length > 0
    && !updateUserMutation.isPending;
  const canEditSelectedUser = selectedUser ? isTenantScopedUser(selectedUser) || isOwnSystemAdminUser(selectedUser, admin.user.id) : false;
  const canEditSelectedUserStatus = selectedUser ? isTenantScopedUser(selectedUser) : false;

  return (
    <section className={styles.userPage}>
      <header className={styles.userHero}>
        <div>
          <h2>사용자 관리</h2>
          <p>시스템 내 모든 테넌트의 사용자를 조회하고 권한 상태를 확인합니다.</p>
        </div>
        <button
          type="button"
          className={styles.customerAddButton}
          onClick={() => {
            setIsCreateModalOpen(true);
            setNotice(null);
          }}
        >
          <Plus size={20} />
          사용자 추가
        </button>
      </header>

      <div className={styles.userSummaryGrid}>
        <article className={styles.userMetricCard}>
          <p>전체 사용자</p>
          <strong>{formatInteger(totalUsers)}</strong>
          <small>조회 가능한 사용자 수</small>
        </article>
        <article className={styles.userMetricCard}>
          <p>활성 사용자</p>
          <strong>{formatInteger(activeUsers)}</strong>
          <small>조회 가능한 활성 상태</small>
        </article>
        <article className={styles.userMetricCard}>
          <p>신규 사용자 (최근 30일)</p>
          <strong>{formatInteger(newUsers)}</strong>
          <small>{lockedUsers > 0 ? `확인 필요: ${formatInteger(lockedUsers)}` : "확인 필요 없음"}</small>
        </article>
      </div>

      <form
        className={styles.userFilterBar}
        onSubmit={(event) => {
          event.preventDefault();
          setFilters(sanitizeFilterValues(draftFilters));
          setPage(1);
        }}
      >
        <label className={styles.userSearchInput}>
          <Search size={22} />
          <input
            value={draftFilters.keyword ?? ""}
            onChange={(event) => setDraftFilters((current) => ({ ...current, keyword: event.target.value }))}
            placeholder="이름 또는 이메일 검색"
          />
        </label>
        <label className={styles.userSelectField}>
          <span>테넌트 선택</span>
          <select
            value={draftFilters.tenantFilter ?? ""}
            disabled={!canReadTenantDirectory}
            onChange={(event) => setDraftFilters((current) => ({ ...current, tenantFilter: event.target.value }))}
          >
            <option value="">{canReadTenantDirectory ? "전체" : "현재 테넌트"}</option>
            {tenantOptions.map((tenant) => (
              <option key={tenant.tenantId} value={tenant.tenantId}>{tenant.name}</option>
            ))}
          </select>
        </label>
        <label className={styles.userSelectField}>
          <span>역할</span>
          <select
            value={draftFilters.roleCode ?? ""}
            onChange={(event) => setDraftFilters((current) => ({ ...current, roleCode: event.target.value }))}
          >
            <option value="">전체</option>
            {roleOptions.map((role) => (
              <option key={getRoleId(role) || role.code} value={role.code}>{role.name}</option>
            ))}
          </select>
        </label>
        <label className={styles.userSelectField}>
          <span>상태</span>
          <select
            value={draftFilters.userStatus ?? ""}
            onChange={(event) => setDraftFilters((current) => ({ ...current, userStatus: event.target.value }))}
          >
            <option value="">전체</option>
            <option value="active">활성</option>
            <option value="inactive">비활성</option>
            <option value="locked">잠금</option>
          </select>
        </label>
        <button type="submit" className={styles.userSearchButton}>검색</button>
        <button
          type="button"
          className={styles.userResetButton}
          onClick={() => {
            const next = createFilterValues(accessSearchFields);
            setDraftFilters(next);
            setFilters(next);
            setPage(1);
          }}
        >
          <RefreshCw size={18} />
          필터 초기화
        </button>
      </form>
      <ResultState query={access}>
        {(result) => (
          <>
            <div className={styles.userTableCard}>
              <table className={styles.userTable}>
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>이메일</th>
                    <th>소속 테넌트</th>
                    <th>역할</th>
                    <th>상태</th>
                    <th>마지막 로그인</th>
                  </tr>
                </thead>
                <tbody>
	                  {result.data.users.items.map((user) => (
	                    <tr
	                      key={getUserId(user)}
	                      className={styles.userTableRow}
	                      tabIndex={0}
	                      onClick={() => openUserDetailModal(user)}
	                      onKeyDown={(event) => {
	                        if (event.key === "Enter" || event.key === " ") {
	                          event.preventDefault();
	                          openUserDetailModal(user);
	                        }
	                      }}
	                    >
	                      <td>
	                        <div className={styles.userNameCell}>
	                          <span className={styles.userAvatar}><UserRound size={22} /></span>
                          <strong>{user.displayName}</strong>
                        </div>
                      </td>
                      <td>{user.email}</td>
                      <td>{userTenantLabel(user, tenantNames)}</td>
                      <td><span className={styles.userRolePill}>{userRoleSummary(user)}</span></td>
                      <td>
                        <span className={`${styles.customerStatusPill} ${styles[userStatusClass(user.status)]}`}>
                          {statusLabel(user.status)}
                        </span>
                      </td>
                      <td>{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className={styles.userTableFooter}>
              <span>
                전체 {formatInteger(result.data.users.total)}명 중 {formatInteger(result.data.users.total === 0 ? 0 : (page - 1) * pageSize + 1)}-
                {formatInteger(Math.min(page * pageSize, result.data.users.total))} 표시
              </span>
              <div className={styles.customerPagination}>
                <button type="button" aria-label="이전 페이지" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>‹</button>
                {pageItems.map((item, index) => (
                  item === "ellipsis"
                    ? <span key={`ellipsis-${index}`} className={styles.paginationEllipsis}>...</span>
                    : item === page
                      ? <strong key={item}>{formatInteger(item)}</strong>
                      : <button key={item} type="button" onClick={() => setPage(item)}>{formatInteger(item)}</button>
                ))}
                <button type="button" aria-label="다음 페이지" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>›</button>
              </div>
            </footer>
            {notice ? <p className={styles.actionNotice}>{notice}</p> : null}
          </>
        )}
      </ResultState>
	      {isCreateModalOpen ? (
	        <div className={styles.customerModalBackdrop}>
          <form
            className={styles.customerCreateModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-create-title"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canSubmitCreateUser) {
                return;
              }

              createUserMutation.mutate({
                displayName: createName.trim(),
                email: createEmail.trim(),
                password: createPassword,
                status: createStatus,
                target: createTarget,
                roleId: effectiveCreateRoleId || undefined,
                tenantId: createTarget === "system_admin" ? null : selectedCreateTenantId
              });
            }}
          >
            <div className={styles.customerModalHeader}>
              <div>
                <h3 id="user-create-title">새 사용자 추가</h3>
                <p>현재 관리자 범위에 새 사용자를 등록합니다.</p>
              </div>
              <button
                type="button"
                className={styles.customerModalClose}
                aria-label="닫기"
                onClick={() => {
                  setIsCreateModalOpen(false);
                  resetCreateUserForm();
                }}
              >
                <X size={24} />
              </button>
            </div>
            <div className={styles.customerModalBody}>
              <label className={styles.customerModalField}>
                등록 유형 <em>*</em>
                <select
                  value={createTarget}
                  onChange={(event) => {
                    const nextTarget = event.target.value as CreateUserTarget;
                    setCreateTarget(nextTarget);
                    setCreateRoleId("");
                    if (nextTarget === "system_admin") {
                      setCreateTenantId("");
                    }
                  }}
                >
                  {createTargetOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <small>
                  {createTarget === "system_admin"
                    ? "슈퍼 관리자만 테넌트 없는 시스템 관리자를 등록할 수 있습니다."
                    : createTarget === "tenant_admin"
                      ? "선택한 테넌트에 테넌트 관리자 역할을 자동 부여합니다."
                      : "테넌트 범위 일반 사용자를 등록합니다."}
                </small>
              </label>
              <div className={styles.customerModalGrid}>
                <label className={styles.customerModalField}>
                  이름 <em>*</em>
                  <input
                    value={createName}
                    onChange={(event) => setCreateName(event.target.value)}
                    placeholder="예: 홍길동"
                  />
                </label>
                <label className={styles.customerModalField}>
                  이메일 <em>*</em>
                  <input
                    type="email"
                    value={createEmail}
                    onChange={(event) => setCreateEmail(event.target.value)}
                    placeholder="user@example.com"
                  />
                </label>
              </div>
              <div className={styles.customerModalGrid}>
                {canReadTenantDirectory && createTarget !== "system_admin" ? (
                  <label className={styles.customerModalField}>
                    소속 테넌트 <em>*</em>
                    <select
                      value={createTenantId}
                      onChange={(event) => {
                        setCreateTenantId(event.target.value);
                        setCreateRoleId("");
                      }}
                    >
                      <option value="">테넌트를 선택하세요</option>
                      {tenantOptions.map((tenant) => (
                        <option key={tenant.tenantId} value={tenant.tenantId}>{tenant.name}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className={styles.customerModalField}>
                  임시 비밀번호 <em>*</em>
                  <input
                    type="password"
                    value={createPassword}
                    onChange={(event) => setCreatePassword(event.target.value)}
                    placeholder="8자 이상 입력"
                  />
                </label>
                <label className={styles.customerModalField}>
                  상태
                  <select value={createStatus} onChange={(event) => setCreateStatus(event.target.value)}>
                    <option value="active">활성</option>
                    <option value="inactive">비활성</option>
                    <option value="locked">잠금</option>
                  </select>
                </label>
              </div>
              {createTarget === "tenant_admin" ? (
                <label className={styles.customerModalField}>
                  부여 역할
                  <input value={tenantAdminRole?.name ?? "테넌트 관리자 역할을 찾을 수 없음"} readOnly />
                  <small>테넌트 관리자는 테넌트 전체 범위로 자동 부여되며 하위 관리자가 다시 부여할 수 없습니다.</small>
                </label>
              ) : null}
              {createTarget === "tenant_user" ? (
                <label className={styles.customerModalField}>
                  역할
                  <select value={createRoleId} onChange={(event) => setCreateRoleId(event.target.value)}>
                    <option value="">선택 안 함</option>
                    {tenantUserRoleOptions.map((role) => (
                      <option key={getRoleId(role) || `${role.tenantId ?? "tenant"}-${role.code}`} value={getRoleId(role)}>{role.name}</option>
                    ))}
                  </select>
                  <small>테넌트 관리자 역할은 상위 관리자만 등록 유형에서 선택할 수 있습니다.</small>
                </label>
              ) : null}
            </div>
            <div className={styles.customerModalFooter}>
              <button
                type="button"
                className={styles.customerModalSecondary}
                onClick={() => {
                  setIsCreateModalOpen(false);
                  resetCreateUserForm();
                }}
              >
                취소
              </button>
              <button type="submit" className={styles.customerModalPrimary} disabled={!canSubmitCreateUser}>
                사용자 등록
              </button>
            </div>
          </form>
	        </div>
	      ) : null}
	      {selectedUser ? (
	        <div className={styles.customerModalBackdrop}>
	          <div
	            className={styles.customerDetailModal}
	            role="dialog"
	            aria-modal="true"
	            aria-labelledby="user-detail-title"
	          >
	            <header className={styles.customerModalHeader}>
	              <div className={styles.customerDetailTitle}>
	                <UserRound size={24} />
	                <h3 id="user-detail-title">사용자 상세 정보</h3>
	                <span>{isUserDetailEditMode ? "수정 모드" : "조회 모드"}</span>
	              </div>
	              <div className={styles.customerModalHeaderActions}>
	                {!isUserDetailEditMode ? (
	                  <button
	                    type="button"
	                    className={styles.customerHeaderPrimary}
	                    disabled={!getUserId(selectedUser) || !canEditSelectedUser}
	                    onClick={enterUserDetailEditMode}
	                    title={canEditSelectedUser ? "사용자 정보 수정" : "다른 시스템 관리자 계정은 별도 관리 흐름에서 수정합니다."}
	                  >
	                    <Pencil size={18} />
	                    수정하기
	                  </button>
	                ) : null}
	                <button type="button" className={styles.customerModalClose} onClick={closeUserDetailModal} aria-label="닫기">
	                  <X size={24} />
	                </button>
	              </div>
	            </header>
	            <div className={styles.customerDetailBody}>
	              <section className={styles.customerDetailHero}>
	                <span className={styles.customerDetailIcon}><UserRound size={42} /></span>
	                <div>
	                  <strong>{isUserDetailEditMode ? detailUserName || selectedUser.displayName : selectedUser.displayName}</strong>
	                  <span className={`${styles.customerStatusPill} ${styles[userStatusClass(isUserDetailEditMode ? detailUserStatus : selectedUser.status)]}`}>
	                    {statusLabel(isUserDetailEditMode ? detailUserStatus : selectedUser.status)}
	                  </span>
	                  <p>{isUserDetailEditMode ? detailUserEmail || selectedUser.email : selectedUser.email}</p>
	                </div>
	              </section>
	              <div className={styles.customerDetailGrid}>
	                <label className={styles.customerDetailField}>
	                  <span>사용자 이름</span>
	                  {isUserDetailEditMode ? (
	                    <input value={detailUserName} onChange={(event) => setDetailUserName(event.target.value)} required />
	                  ) : (
	                    <strong>{selectedUser.displayName}</strong>
	                  )}
	                </label>
	                <label className={styles.customerDetailField}>
	                  <span>사용자 ID</span>
	                  <strong className={styles.customerDetailMono}>{getUserId(selectedUser) || "-"}</strong>
	                </label>
	                <label className={styles.customerDetailField}>
	                  <span>이메일</span>
	                  {isUserDetailEditMode ? (
	                    <input type="email" value={detailUserEmail} onChange={(event) => setDetailUserEmail(event.target.value)} required />
	                  ) : (
	                    <strong className={styles.customerDetailMono}>{selectedUser.email}</strong>
	                  )}
	                </label>
	                <label className={styles.customerDetailField}>
	                  <span>소속 테넌트</span>
	                  <strong>{userTenantLabel(selectedUser, tenantNames)}</strong>
	                </label>
	                <label className={styles.customerDetailField}>
	                  <span>상태</span>
	                  {isUserDetailEditMode && canEditSelectedUserStatus ? (
	                    <select value={detailUserStatus} onChange={(event) => setDetailUserStatus(event.target.value)} required>
	                      <option value="active">활성</option>
	                      <option value="inactive">비활성</option>
	                      <option value="locked">잠금</option>
	                    </select>
	                  ) : (
	                    <strong>{statusLabel(selectedUser.status)}</strong>
	                  )}
	                </label>
	                <label className={styles.customerDetailField}>
	                  <span>사용자 유형</span>
	                  <strong>{userTypeLabel(selectedUser.userType)}</strong>
	                </label>
	                <label className={styles.customerDetailField}>
	                  <span>역할</span>
	                  <strong>{userRoleSummary(selectedUser)}</strong>
	                </label>
	                <label className={styles.customerDetailField}>
	                  <span>등록 일자</span>
	                  <strong>{selectedUser.createdAt ? formatDateTime(selectedUser.createdAt) : "-"}</strong>
	                </label>
	                <label className={styles.customerDetailField}>
	                  <span>수정 일자</span>
	                  <strong>{selectedUser.updatedAt ? formatDateTime(selectedUser.updatedAt) : "-"}</strong>
	                </label>
	                <label className={`${styles.customerDetailField} ${styles.customerDetailWideField}`}>
	                  <span>마지막 로그인</span>
	                  <strong>{selectedUser.lastLoginAt ? formatDateTime(selectedUser.lastLoginAt) : "-"}</strong>
	                </label>
	              </div>
	              <div className={styles.customerDetailMemo}>
	                <span>권한 범위</span>
	                <p>
	                  {selectedUser && isTenantScopedUser(selectedUser)
	                    ? "사용자 이름, 이메일, 상태는 수정 모드에서 변경할 수 있습니다. 사용자 유형, 소속 테넌트, 역할은 권한 관리 흐름에서 별도로 관리합니다."
	                    : selectedUser && isOwnSystemAdminUser(selectedUser, admin.user.id)
	                      ? "현재 로그인한 슈퍼 관리자 본인의 이름과 이메일을 수정할 수 있습니다. 시스템 관리자 상태와 역할은 별도 관리 흐름에서 처리합니다."
	                      : "다른 시스템 관리자 계정은 테넌트가 없는 전역 관리자 계정이므로 이 화면의 테넌트 사용자 수정 API로 변경하지 않습니다. 별도 시스템 관리자 관리 흐름에서 처리해야 합니다."}
	                </p>
	              </div>
	              {notice ? <p className={styles.actionNotice}>{notice}</p> : null}
	            </div>
	            <footer className={`${styles.customerModalFooter} ${!isUserDetailEditMode ? styles.customerModalFooterSingle : ""}`}>
	              <button
	                type="button"
	                className={styles.customerModalSecondary}
	                onClick={isUserDetailEditMode ? cancelUserDetailEditMode : closeUserDetailModal}
	              >
	                {isUserDetailEditMode ? "취소" : "닫기"}
	              </button>
	              {isUserDetailEditMode ? (
	                <button
	                  type="button"
	                  className={styles.customerModalPrimary}
	                  disabled={!canSubmitUserDetail}
	                  onClick={() => {
	                    if (!selectedUser || !canSubmitUserDetail) {
	                      return;
	                    }

	                    updateUserMutation.mutate({
	                      user: selectedUser,
	                      displayName: detailUserName.trim(),
	                      email: detailUserEmail.trim(),
	                      status: detailUserStatus
	                    });
	                  }}
	                >
	                  <Save size={18} />
	                  {updateUserMutation.isPending ? "저장 중" : "저장하기"}
	                </button>
	              ) : null}
	            </footer>
	          </div>
	        </div>
	      ) : null}
	    </section>
	  );
	}

function RolesScreen() {
  const queryClient = useQueryClient();
  const access = useQuery({ queryKey: ["admin-access-control"], queryFn: () => getAccessControlData() });
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [selectedPermissionCodes, setSelectedPermissionCodes] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const roles = access.data?.data.roles.items ?? [];
  const permissions = access.data?.data.permissions.items ?? [];
  const selectedRole = roles.find((role) => getRoleId(role) === selectedRoleId);
  const replacePermissionsMutation = useMutation({
    mutationFn: (input: { roleId: string; permissionCodes: string[] }) => replaceRolePermissions(input),
    onSuccess: async (role) => {
      setNotice(`${role.code} 역할 권한을 ${role.permissions?.length ?? role.permissionCodes?.length ?? 0}개로 교체했습니다.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-access-control"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-audit-logs"] })
      ]);
    },
    onError: (error) => setNotice(loginErrorMessage(error))
  });

  useEffect(() => {
    if (selectedRoleId || roles.length === 0) {
      return;
    }

    const firstRole = roles[0];
    setSelectedRoleId(getRoleId(firstRole));
    setSelectedPermissionCodes(rolePermissionCodes(firstRole));
  }, [roles, selectedRoleId]);

  return (
    <Screen title="역할/권한" description="역할별 권한 구성을 비교하고 변경 전 영향을 확인합니다." result={access.data}>
      <ResultState query={access}>
        {(result) => (
          <>
            <div className={styles.roleManageGrid}>
              <form
                className={styles.formPanel}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!selectedRoleId) {
                    setNotice("권한을 교체할 역할을 선택하세요.");
                    return;
                  }

                  replacePermissionsMutation.mutate({
                    roleId: selectedRoleId,
                    permissionCodes: selectedPermissionCodes
                  });
                }}
              >
                <h3>역할 권한 교체</h3>
                <label>
                  역할
                  <select
                    value={selectedRoleId}
                    onChange={(event) => {
                      const nextRole = result.data.roles.items.find((role) => getRoleId(role) === event.target.value);
                      setSelectedRoleId(event.target.value);
                      setSelectedPermissionCodes(nextRole ? rolePermissionCodes(nextRole) : []);
                      setNotice(null);
                    }}
                  >
                    {result.data.roles.items.map((role) => (
                      <option key={getRoleId(role)} value={getRoleId(role)}>
                        {role.code} · {role.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={styles.checkboxGrid}>
                  {permissions.map((permission) => (
                    <label key={permission.code} className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={selectedPermissionCodes.includes(permission.code)}
                        onChange={(event) => {
                          setSelectedPermissionCodes((current) =>
                            event.target.checked
                              ? [...new Set([...current, permission.code])].sort()
                              : current.filter((code) => code !== permission.code)
                          );
                        }}
                      />
                      <span>{permission.code}</span>
                    </label>
                  ))}
                </div>
                <button type="submit" disabled={replacePermissionsMutation.isPending || !selectedRoleId}>
                  <Save size={16} />
                  {replacePermissionsMutation.isPending ? "저장 중" : "권한 교체"}
                </button>
              </form>
              <Panel title="변경 전 확인" icon={<ShieldCheck size={18} />}>
                <div className={styles.guidanceList}>
                  <p>선택 역할: <strong>{selectedRole ? `${selectedRole.code} · ${selectedRole.name}` : "선택 없음"}</strong></p>
                  <p>현재 선택 권한: <strong>{formatInteger(selectedPermissionCodes.length)}개</strong></p>
                  <p>저장하면 기존 role-permission mapping이 선택한 권한 목록으로 전체 교체됩니다.</p>
                </div>
              </Panel>
            </div>
            {notice ? <p className={styles.actionNotice}>{notice}</p> : null}
            <div className={styles.twoColumn}>
              <Panel title="역할별 권한" icon={<ShieldPlus size={18} />}>
                <CompactList
                  items={result.data.roles.items}
                  render={(role) => (
                    <>
                      <strong>{role.name}</strong>
                      <span>{role.code}</span>
                      <div className={styles.permissionChips}>
                        {rolePermissionCodes(role).map((permission) => <em key={permission}>{permission}</em>)}
                      </div>
                    </>
                  )}
                />
              </Panel>
              <Panel title="권한 카탈로그" icon={<LockKeyhole size={18} />}>
                <CompactList
                  items={result.data.permissions.items}
                  render={(permission) => (
                    <>
                      <strong>{permission.code}</strong>
                      <span>{permission.description ?? "설명 없음"}</span>
                    </>
                  )}
                />
              </Panel>
            </div>
          </>
        )}
      </ResultState>
    </Screen>
  );
}

function AuditLogsScreen() {
  const [draftFilters, setDraftFilters] = useState<FilterValues>(() => createFilterValues(auditSearchFields));
  const [filters, setFilters] = useState<FilterValues>(() => createFilterValues(auditSearchFields));
  const auditQuery = toAdminListQuery(filters);
  const auditLogs = useQuery({
    queryKey: ["admin-audit-logs", auditQuery],
    queryFn: () => getAuditLogs(auditQuery)
  });

  return (
    <Screen title="감사 로그" description="중요 변경 이력과 requestId evidence를 조회합니다." result={auditLogs.data}>
      <SearchBar
        fields={auditSearchFields}
        values={draftFilters}
        onChange={setDraftFilters}
        onSubmit={() => setFilters(sanitizeFilterValues(draftFilters))}
        onReset={() => {
          const next = createFilterValues(auditSearchFields);
          setDraftFilters(next);
          setFilters(next);
        }}
      />
      <ActiveFilters fields={auditSearchFields} values={filters} />
      <ResultState query={auditLogs}>
        {(result) => (
          <DataTable
            columns={["발생시각", "액션", "리소스", "결과", "요청 ID"]}
            rows={result.data.items.map((item) => [
              formatDate(item.occurredAt),
              item.action,
              `${item.resource.type}:${item.resource.id}`,
              resultLabel(item.result),
              item.requestId
            ])}
          />
        )}
      </ResultState>
    </Screen>
  );
}

function RiskActionsScreen() {
  return (
    <Screen title="위험 작업" description="상태 변경, 모듈 교체, 권한 변경처럼 감사 evidence가 필요한 작업을 관리합니다.">
      <div className={styles.riskGrid}>
        {[
          ["테넌트 상태 변경", "active, suspended, deleted 전환 전 사유와 영향 범위를 확인합니다."],
          ["활성 모듈 교체", "WMS, auth, tenant 모듈 변경 전 사용자 영향과 회귀 시나리오를 확인합니다."],
          ["역할 권한 교체", "권한 목록 전체 교체 전 현재 역할 사용자와 requestId evidence를 남깁니다."],
          ["도메인 비활성화", "관리자 접근 경로와 tenant domain 충돌 여부를 확인합니다."]
        ].map(([title, description]) => (
          <article key={title} className={styles.riskCard}>
            <AlertTriangle size={22} />
            <div>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
            <button type="button">확인 절차 보기</button>
          </article>
        ))}
      </div>
    </Screen>
  );
}

function Screen({
  title,
  description,
  result,
  children
}: {
  title: string;
  description: string;
  result?: DataResult<unknown>;
  children: ReactNode;
}) {
  return (
    <section className={styles.screen}>
      <div className={styles.screenHeader}>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {result?.source === "sample" ? <SourceBadge result={result} /> : null}
      </div>
      {children}
    </section>
  );
}

function ResultState<T>({
  query,
  children
}: {
  query: { isLoading: boolean; data?: DataResult<T>; error: Error | null };
  children: (result: DataResult<T>) => ReactNode;
}) {
  if (query.isLoading) {
    return <div className={styles.stateBox}>데이터를 불러오는 중입니다.</div>;
  }

  if (query.error) {
    return <div className={styles.stateBox}>요청 실패: {query.error.message}</div>;
  }

  if (!query.data) {
    return <div className={styles.stateBox}>표시할 데이터가 없습니다.</div>;
  }

  return <>{children(query.data)}</>;
}

function SourceBadge({ result }: { result: DataResult<unknown> }) {
  return (
    <span className={result.source === "api" ? styles.apiBadge : styles.sampleBadge}>
      {result.source === "api" ? "API 데이터" : "샘플 데이터"}
    </span>
  );
}

function Metric({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className={styles.metric}>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.panel}>
      <header>
        <span>{icon}</span>
        <h3>{title}</h3>
      </header>
      {children}
    </section>
  );
}

function CatalogPanel({ title, total, icon, children }: { title: string; total: number; icon: ReactNode; children: ReactNode }) {
  return (
    <Panel title={`${title} ${formatInteger(total)}건`} icon={icon}>
      {children}
    </Panel>
  );
}

function SearchBar({
  fields,
  values,
  onChange,
  onSubmit,
  onReset
}: {
  fields: SearchField[];
  values: FilterValues;
  onChange: (values: FilterValues) => void;
  onSubmit: () => void;
  onReset: () => void;
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form className={styles.searchBar} onSubmit={handleSubmit}>
      <Search className={styles.searchIcon} size={18} aria-hidden="true" />
      {fields.map((field) => (
        <label key={field.name}>
          {field.label}
          {field.options ? (
            <select
              value={values[field.name] ?? ""}
              onChange={(event) => onChange({ ...values, [field.name]: event.target.value })}
            >
              {field.options.map((option) => (
                <option key={option.value || "all"} value={option.value}>{option.label}</option>
              ))}
            </select>
          ) : (
            <input
              value={values[field.name] ?? ""}
              placeholder={field.placeholder ?? `${field.label} 검색`}
              onChange={(event) => onChange({ ...values, [field.name]: event.target.value })}
            />
          )}
        </label>
      ))}
      <button type="submit"><Search size={16} />검색</button>
      <button type="button" className={styles.secondaryButton} onClick={onReset}>초기화</button>
    </form>
  );
}

function ActiveFilters({ fields, values }: { fields: SearchField[]; values: FilterValues }) {
  const active = fields
    .map((field) => {
      const value = values[field.name]?.trim();
      if (!value) {
        return null;
      }

      const label = field.options?.find((option) => option.value === value)?.label ?? value;
      return `${field.label}: ${label}`;
    })
    .filter(Boolean);

  if (active.length === 0) {
    return <p className={styles.filterSummary}>적용 조건: 전체</p>;
  }

  return <p className={styles.filterSummary}>적용 조건: {active.join(" / ")}</p>;
}

function DataTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div className={styles.tableWrap}>
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join("-")}>
              {row.map((cell, index) => <td key={`${cell}-${index}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompactList<T>({ items, render }: { items: T[]; render: (item: T) => ReactNode }) {
  return (
    <div className={styles.compactList}>
      {items.map((item, index) => (
        <div key={index} className={styles.compactItem}>
          {render(item)}
        </div>
      ))}
    </div>
  );
}

function KeyValue({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className={styles.keyValue}>
      {rows.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <em className={styles.statusBadge}>{statusLabel(status)}</em>;
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    active: "활성",
    inactive: "비활성",
    provisioning: "준비 중",
    suspended: "중지",
    deleted: "삭제",
    locked: "잠금",
    system_admin: "슈퍼 관리자"
  };

  return map[status] ?? status;
}

function resultLabel(result: string): string {
  const map: Record<string, string> = {
    success: "성공",
    failure: "실패",
    denied: "거부"
  };

  return map[result] ?? result;
}

function riskAlertCount(data: AdminDashboardData): number {
  return (
    data.riskSummary.provisioningTenants
    + data.riskSummary.suspendedTenants
    + data.riskSummary.lockedUsers
    + data.riskSummary.failedAuditLogs
  );
}

function healthPercent(data: AdminDashboardData): string {
  const total = Math.max(data.tenantSummary.total, 1);
  const active = data.tenantSummary.statusCounts.active ?? 0;
  const activeRatio = (active / total) * 100;
  const riskPenalty = Math.min(18, riskAlertCount(data) * 3);
  return Math.max(0, Math.min(99.9, activeRatio - riskPenalty)).toFixed(1);
}

function trendLabel(value: number): string {
  const trend = Math.max(1, Math.min(12, Math.round(value / 10)));
  return `↗ +${trend}%`;
}

function dashboardTrendBars(data: AdminDashboardData): Array<{ label: string; value: number }> {
  const totalTenants = Math.max(data.tenantSummary.total, 1);
  const activeTenants = data.tenantSummary.statusCounts.active ?? 0;
  const activityWeight = Math.max(1, Math.round(data.auditSummary.total / 8));

  return Array.from({ length: 7 }, (_, index) => ({
    label: `D-${6 - index}`,
    value: Math.round(totalTenants * (0.45 + index * 0.09) + activeTenants * (index + 1) + activityWeight)
  }));
}

function auditIconClass(result: string): string {
  if (result === "failure" || result === "denied") {
    return styles.auditIconDanger;
  }

  return styles.auditIconInfo;
}

function auditIconLabel(item: AuditLogItem): string {
  if (item.result === "failure" || item.result === "denied") {
    return "!";
  }

  if (item.action.includes("tenant")) {
    return "고";
  }

  if (item.action.includes("role") || item.action.includes("permission")) {
    return "권";
  }

  if (item.action.includes("user")) {
    return "사";
  }

  return "시";
}

function auditActorLabel(item: AuditLogItem): string {
  if (item.actor.userId) {
    return shortId(item.actor.userId);
  }

  return item.actor.type === "system" ? "시스템" : "관리자";
}

function auditActionLabel(action: string): string {
  const map: Record<string, string> = {
    "admin.tenant.created": "고객사를 생성함",
    "admin.tenant.updated": "고객사 정보를 수정함",
    "admin.tenant.statusChanged": "고객사 상태를 변경함",
    "admin.tenant.modulesReplaced": "고객사 모듈을 교체함",
    "admin.tenantDomain.created": "고객사 도메인을 추가함",
    "admin.tenantDomain.disabled": "고객사 도메인을 비활성화함",
    "admin.user.created": "사용자를 추가함",
    "admin.user.statusChanged": "사용자 상태를 변경함",
    "admin.userRole.assigned": "사용자 역할을 부여함",
    "admin.userRole.removed": "사용자 역할을 해제함",
    "admin.rolePermissions.replaced": "역할 권한을 교체함"
  };

  return map[action] ?? action;
}

function relativeAuditTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) {
    return "방금 전";
  }
  if (minutes < 60) {
    return `${minutes}분 전`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}시간 전`;
  }

  return formatDate(value);
}

function formatInteger(value: number): string {
  return value.toLocaleString("ko-KR");
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function isWithinDays(value: string | undefined, days: number): boolean {
  if (!value) {
    return false;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return Date.now() - date.getTime() <= days * 24 * 60 * 60 * 1000;
}

function joinOrDash(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "-";
}

function createFilterValues(fields: SearchField[]): FilterValues {
  return fields.reduce<FilterValues>((values, field) => {
    values[field.name] = "";
    return values;
  }, {});
}

function sanitizeFilterValues(values: FilterValues): FilterValues {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]));
}

function toAdminListQuery(values: FilterValues): AdminListQuery {
  return Object.fromEntries(
    Object.entries(values)
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => value)
  ) as AdminListQuery;
}

type PaginationItem = number | "ellipsis";

function buildPaginationItems(currentPage: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 3) {
    return [1, 2, 3, "ellipsis", totalPages];
  }

  if (currentPage >= totalPages - 2) {
    return [1, "ellipsis", totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages];
}

function getUserId(user: UserItem): string {
  return user.userId ?? user.id ?? "";
}

function getRoleId(role: RoleItem): string {
  return role.roleId ?? role.id ?? "";
}

function rolePermissionCodes(role: RoleItem): string[] {
  return [...(role.permissionCodes ?? role.permissions ?? [])].sort();
}

function userRoleSummary(user: UserItem): string {
  const roleCodes = user.roleCodes ?? [];
  if (roleCodes.length > 0) {
    return roleCodes.map((roleCode) => roleCode.toUpperCase()).join(", ");
  }

  return user.userType === "system_admin" ? "SYSTEM_ADMIN" : "-";
}

function userTypeLabel(userType: string | undefined): string {
  if (userType === "system_admin") {
    return "시스템 관리자";
  }

  return "일반 사용자";
}

function isTenantScopedUser(user: UserItem): boolean {
  return Boolean(user.tenantId) && user.userType !== "system_admin";
}

function isOwnSystemAdminUser(user: UserItem, currentUserId: string): boolean {
  return user.userType === "system_admin" && !user.tenantId && getUserId(user) === currentUserId;
}

function userTenantLabel(user: UserItem, tenantNames: Map<string, string>): string {
  if (!user.tenantId) {
    return "전체 테넌트";
  }

  return tenantNames.get(user.tenantId) ?? shortId(user.tenantId);
}

function userStatusClass(status: string): string {
  if (status === "active") {
    return "customerStatusActive";
  }

  if (status === "locked") {
    return "customerStatusDanger";
  }

  return "customerStatusOff";
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}...${value.slice(-4)}`;
}
