import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Building2,
  ClipboardCheck,
  ClipboardList,
  Database,
  KeyRound,
  LockKeyhole,
  LogOut,
  PackagePlus,
  PackageCheck,
  Save,
  Search,
  Send,
  ShieldAlert,
  Truck,
  Warehouse
} from "lucide-react";
import { FormEvent, ReactNode, useMemo, useState } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import {
  ApiError,
  addOutboundPackage,
  adjustInventory,
  allocateOutbound,
  clearSession,
  confirmInbound,
  confirmOutboundPacking,
  createOutboundPacking,
  getAppMe,
  getDashboard,
  getDefaultSnapshotDate,
  getInventorySnapshots,
  getInventorySummary,
  getLocations,
  getMaterials,
  getNavigation,
  getOutboundAllocations,
  getOutboundPackings,
  getWarehouses,
  loadSession,
  login,
  shipOutbound,
  type WmsListQuery
} from "./api-client";
import type {
  AppMe,
  AppNavigation,
  AuthSession,
  DataResult,
  InventoryItem,
  InventorySnapshots,
  InventorySummary,
  LocationItem,
  MaterialItem,
  OutboundAllocationItem,
  OutboundPackingItem,
  PageData,
  WarehouseItem,
  WmsDashboard
} from "./api-types";
import styles from "./app.module.css";

const menuItems = [
  { key: "dashboard", to: "/dashboard", label: "대시보드", icon: BarChart3 },
  { key: "inventory", to: "/inventory", label: "재고 현황", icon: Boxes },
  { key: "snapshots", to: "/snapshots", label: "재고 스냅샷", icon: Database },
  { key: "master-data", to: "/master-data", label: "기준정보", icon: Warehouse },
  { key: "outbound", to: "/outbound", label: "출고 작업", icon: Truck },
  { key: "permission", to: "/permission", label: "권한 제한", icon: ShieldAlert }
] as const;

type MenuItem = (typeof menuItems)[number];
type NavigationMenuItem = {
  key: string;
  to: string;
  label: string;
  icon: MenuItem["icon"];
};
type FilterValues = Record<string, string>;
type SearchField = {
  name: string;
  label: string;
  placeholder?: string;
  type?: "text" | "date";
  options?: Array<{ value: string; label: string }>;
};
type InventoryAdjustmentForm = {
  warehouseId: string;
  locationId: string;
  itemId: string;
  quantityChange: string;
  reason: string;
  referenceNo: string;
  memo: string;
  effectiveDate: string;
};
type InboundConfirmationForm = {
  warehouseId: string;
  locationId: string;
  itemId: string;
  quantity: string;
  referenceNo: string;
};
type OutboundAllocationForm = {
  orderNo: string;
  warehouseId: string;
  locationId: string;
  itemId: string;
  quantity: string;
};
type OutboundPackingForm = {
  outboundOrderId: string;
  allocationIds: string;
  memo: string;
};
type OutboundPackageForm = {
  packingId: string;
  packageNo: string;
  boxType: string;
  allocationId: string;
  itemId: string;
  quantity: string;
};
type OutboundShipmentForm = {
  allocationId: string;
  packingId: string;
  carrierCode: string;
  trackingNo: string;
};

const inventorySearchFields: SearchField[] = [
  { name: "warehouseId", label: "창고 ID", placeholder: "warehouseId" },
  { name: "locationId", label: "로케이션 ID", placeholder: "locationId" },
  { name: "itemId", label: "품목 ID", placeholder: "materialId" }
];
const snapshotSearchFields: SearchField[] = [
  { name: "snapshotDate", label: "스냅샷 일자", type: "date" },
  { name: "warehouseId", label: "창고 ID", placeholder: "warehouseId" },
  { name: "locationId", label: "로케이션 ID", placeholder: "locationId" },
  { name: "itemId", label: "품목 ID", placeholder: "materialId" }
];
const masterSearchFields: SearchField[] = [
  { name: "warehouseCode", label: "창고 코드", placeholder: "WH-" },
  { name: "locationWarehouseId", label: "로케이션 창고 ID", placeholder: "warehouseId" },
  { name: "locationCode", label: "로케이션 코드", placeholder: "LOC-" },
  { name: "materialSku", label: "품목 SKU", placeholder: "SKU" }
];
const outboundSearchFields: SearchField[] = [
  { name: "warehouseId", label: "창고 ID", placeholder: "warehouseId" },
  { name: "outboundOrderId", label: "출고 주문 ID", placeholder: "outboundOrderId" },
  {
    name: "allocationStatus",
    label: "할당 상태",
    options: [
      { value: "", label: "전체" },
      { value: "allocated", label: "할당" },
      { value: "shipped", label: "출하" }
    ]
  },
  {
    name: "packingStatus",
    label: "포장 상태",
    options: [
      { value: "", label: "전체" },
      { value: "packing", label: "포장중" },
      { value: "confirmed", label: "확정" },
      { value: "shipped", label: "출하" },
      { value: "cancelled", label: "취소" }
    ]
  }
];

const emptyInventoryAdjustmentForm: InventoryAdjustmentForm = {
  warehouseId: "",
  locationId: "",
  itemId: "",
  quantityChange: "1",
  reason: "cycle_count",
  referenceNo: "",
  memo: "",
  effectiveDate: getDefaultSnapshotDate()
};
const emptyInboundConfirmationForm: InboundConfirmationForm = {
  warehouseId: "",
  locationId: "",
  itemId: "",
  quantity: "1",
  referenceNo: ""
};
const emptyOutboundAllocationForm: OutboundAllocationForm = {
  orderNo: `ORD-${getDefaultSnapshotDate().replaceAll("-", "")}`,
  warehouseId: "",
  locationId: "",
  itemId: "",
  quantity: "1"
};
const emptyOutboundPackingForm: OutboundPackingForm = {
  outboundOrderId: "",
  allocationIds: "",
  memo: ""
};
const emptyOutboundPackageForm: OutboundPackageForm = {
  packingId: "",
  packageNo: `PKG-${getDefaultSnapshotDate().replaceAll("-", "")}`,
  boxType: "",
  allocationId: "",
  itemId: "",
  quantity: "1"
};
const emptyOutboundShipmentForm: OutboundShipmentForm = {
  allocationId: "",
  packingId: "",
  carrierCode: "",
  trackingNo: ""
};

export function App() {
  const [session, setSession] = useState<AuthSession | null>(() => loadSession());

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
      <Route path="/*" element={<AppShell session={session} onLogout={() => {
        clearSession();
        setSession(null);
      }} />} />
    </Routes>
  );
}

function LoginScreen({ onLogin }: { onLogin: (session: AuthSession) => void }) {
  const navigate = useNavigate();
  const [tenantId, setTenantId] = useState("11111111-1111-4111-8111-111111111111");
  const [email, setEmail] = useState("admin@demo.local");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setNotice(null);

    try {
      const result = await login({ tenantId, email, password });
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
        <div>
          <p className={styles.eyebrow}>WMS 운영</p>
          <h1 id="login-title">로그인</h1>
          <p className={styles.loginCopy}>테넌트와 계정 정보를 기준으로 WMS 운영 화면에 접속합니다.</p>
        </div>
        <form className={styles.loginForm} onSubmit={handleSubmit}>
          <label>
            테넌트 ID
            <input autoComplete="organization" value={tenantId} onChange={(event) => setTenantId(event.target.value)} required />
          </label>
          <label>
            이메일
            <input autoComplete="username" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            비밀번호
            <input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          <button type="submit" disabled={isSubmitting}>
            <KeyRound size={18} />
            {isSubmitting ? "확인 중" : "로그인"}
          </button>
          {notice ? <p className={styles.formNotice}>{notice}</p> : null}
        </form>
      </section>
    </main>
  );
}

function AppShell({ session, onLogout }: { session: AuthSession; onLogout: () => void }) {
  const appContext = useQuery({
    queryKey: ["wms-app-context", session.accessToken],
    queryFn: async () => {
      const [me, navigation] = await Promise.all([getAppMe(), getNavigation()]);
      return { me, navigation };
    },
    retry: false
  });

  if (appContext.isLoading) {
    return <SessionState title="세션 초기화" description="사용자 정보, 테넌트 상태, WMS 메뉴 권한을 확인하고 있습니다." onLogout={onLogout} />;
  }

  if (appContext.error || !appContext.data) {
    return (
      <SessionState
        title="세션 확인 실패"
        description={loginErrorMessage(appContext.error)}
        onLogout={onLogout}
      />
    );
  }

  const appMe = appContext.data.me.data;
  const navigation = buildMenu(appContext.data.navigation.data, appMe);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brandBlock}>
          <div className={styles.brandIcon}><PackageCheck size={24} /></div>
          <div>
            <strong>WMS 운영</strong>
            <span>멀티테넌트 창고</span>
          </div>
        </div>
        <nav className={styles.nav} aria-label="WMS 메뉴">
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
        <div className={styles.tenantBox}>
          <span>테넌트</span>
          <strong>{appMe.tenant.name}</strong>
          <span>{appMe.tenant.code} · {shortId(appMe.tenant.tenantId)}</span>
        </div>
      </aside>
      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <div>
            <p className={styles.eyebrow}>Desktop 1차 범위</p>
            <h1>WMS 운영 콘솔</h1>
          </div>
          <div className={styles.userBox}>
            <div>
              <strong>{session.user.displayName}</strong>
              <span>{session.user.email} · {shortId(appMe.user.userId)}</span>
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
            <Route path="/inventory" element={<RequireNavigation navigation={navigation} path="/inventory"><InventoryScreen /></RequireNavigation>} />
            <Route path="/snapshots" element={<RequireNavigation navigation={navigation} path="/snapshots"><SnapshotScreen /></RequireNavigation>} />
            <Route path="/master-data" element={<RequireNavigation navigation={navigation} path="/master-data"><MasterDataScreen /></RequireNavigation>} />
            <Route path="/outbound" element={<RequireNavigation navigation={navigation} path="/outbound"><OutboundScreen /></RequireNavigation>} />
            <Route path="/permission" element={<PermissionScreen />} />
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
          <p className={styles.eyebrow}>WMS 운영</p>
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
      <Screen title="접근 제한" description="현재 권한으로 접근할 수 없는 WMS 메뉴입니다.">
        <div className={styles.stateBox}>필요 권한이 있는 계정으로 다시 로그인하거나 관리자에게 권한 부여를 요청하세요.</div>
      </Screen>
    );
  }

  return <>{children}</>;
}

function buildMenu(navigation: AppNavigation, appMe: AppMe): NavigationMenuItem[] {
  const permissions = new Set(appMe.permissions.permissions);
  const apiPaths = new Set(navigation.items.map((item) => item.path));
  const allowedKeys = new Set<string>();

  if (apiPaths.has("/wms") || permissions.has("wms.inventory.read")) {
    allowedKeys.add("dashboard");
  }
  if (apiPaths.has("/wms/inventory") || permissions.has("wms.inventory.read")) {
    allowedKeys.add("inventory");
    allowedKeys.add("snapshots");
  }
  if (
    apiPaths.has("/wms/warehouses") ||
    apiPaths.has("/wms/materials") ||
    permissions.has("wms.warehouses.manage") ||
    permissions.has("wms.items.manage")
  ) {
    allowedKeys.add("master-data");
  }
  if (permissions.has("wms.outbound.allocate") || permissions.has("wms.outbound.pack")) {
    allowedKeys.add("outbound");
  }

  allowedKeys.add("permission");

  return menuItems.filter((item) => allowedKeys.has(item.key));
}

function DashboardScreen() {
  const dashboard = useQuery({ queryKey: ["wms-dashboard"], queryFn: getDashboard });

  return (
    <Screen title="대시보드" description="재고와 출고 작업 상태를 한 화면에서 확인합니다." result={dashboard.data}>
      <ResultState query={dashboard}>
        {(result) => (
          <>
            <div className={styles.metricGrid}>
              <Metric title="재고 레코드" value={formatInteger(result.data.inventory.totalBalances)} detail={`표본 ${result.data.inventory.sampledBalanceCount}건`} />
              <Metric title="총 수량" value={formatQuantity(result.data.inventory.pageTotals.quantity)} detail="현재 페이지 합계" />
              <Metric title="가용 수량" value={formatQuantity(result.data.inventory.pageTotals.availableQuantity)} detail="할당 제외" />
              <Metric title="할당 수량" value={formatQuantity(result.data.inventory.pageTotals.allocatedQuantity)} detail="출고 작업 대기" />
            </div>
            <div className={styles.twoColumn}>
              <Panel title="출고 진행" icon={<Truck size={18} />}>
                <ProgressRows
                  rows={[
                    {
                      label: "출고 할당",
                      value: result.data.operations.outboundAllocations.total,
                      sampledCount: result.data.operations.outboundAllocations.sampledCount,
                      canView: result.data.operations.outboundAllocations.canView
                    },
                    {
                      label: "포장 작업",
                      value: result.data.operations.outboundPackings.total,
                      sampledCount: result.data.operations.outboundPackings.sampledCount,
                      canView: result.data.operations.outboundPackings.canView
                    }
                  ]}
                />
              </Panel>
              <Panel title="사용 가능 작업" icon={<ClipboardList size={18} />}>
                <div className={styles.actionGrid}>
                  {[
                    ["재고 조회", result.data.visibleActions.inventory],
                    ["창고 관리", result.data.visibleActions.warehouses],
                    ["품목 관리", result.data.visibleActions.materials],
                    ["스냅샷 생성", result.data.visibleActions.snapshots],
                    ["포장 처리", result.data.visibleActions.packing],
                    ["출하 처리", result.data.visibleActions.shipping]
                  ].map(([label, enabled]) => (
                    <span key={String(label)} className={enabled ? styles.actionOn : styles.actionOff}>
                      {label}
                    </span>
                  ))}
                </div>
              </Panel>
            </div>
          </>
        )}
      </ResultState>
    </Screen>
  );
}

function InventoryScreen() {
  const queryClient = useQueryClient();
  const [draftFilters, setDraftFilters] = useState<FilterValues>(() => createFilterValues(inventorySearchFields));
  const [filters, setFilters] = useState<FilterValues>(() => createFilterValues(inventorySearchFields));
  const [adjustmentForm, setAdjustmentForm] = useState<InventoryAdjustmentForm>(emptyInventoryAdjustmentForm);
  const [inboundForm, setInboundForm] = useState<InboundConfirmationForm>(emptyInboundConfirmationForm);
  const [mutationNotice, setMutationNotice] = useState<string | null>(null);
  const inventoryQuery = toWmsListQuery(filters);
  const inventory = useQuery({
    queryKey: ["wms-inventory", inventoryQuery],
    queryFn: () => getInventorySummary(inventoryQuery)
  });
  const firstInventoryItem = inventory.data?.data.inventory.items[0];
  const adjustmentMutation = useMutation({
    mutationFn: adjustInventory,
    onSuccess: async (result) => {
      setMutationNotice(`재고 조정 완료: ${result.data.adjustmentId}${result.requestId ? ` / requestId ${result.requestId}` : ""}`);
      await invalidateWmsMutationQueries(queryClient);
    }
  });
  const inboundMutation = useMutation({
    mutationFn: confirmInbound,
    onSuccess: async (result) => {
      setMutationNotice(`입고 확정 완료: ${result.data.receiptId}${result.requestId ? ` / requestId ${result.requestId}` : ""}`);
      await invalidateWmsMutationQueries(queryClient);
    }
  });

  function applyInventoryItem(item: InventoryItem | undefined) {
    if (!item) {
      return;
    }

    setAdjustmentForm((current) => ({
      ...current,
      warehouseId: item.warehouseId,
      locationId: item.locationId,
      itemId: item.materialId
    }));
    setInboundForm((current) => ({
      ...current,
      warehouseId: item.warehouseId,
      locationId: item.locationId,
      itemId: item.materialId
    }));
  }

  return (
    <Screen title="재고 현황" description="창고, 로케이션, 품목 기준 현재 재고를 조회합니다." result={inventory.data}>
      <SearchBar
        fields={inventorySearchFields}
        values={draftFilters}
        onChange={setDraftFilters}
        onSubmit={() => setFilters(sanitizeFilterValues(draftFilters))}
        onReset={() => {
          const next = createFilterValues(inventorySearchFields);
          setDraftFilters(next);
          setFilters(next);
        }}
      />
      <ActiveFilters fields={inventorySearchFields} values={filters} />
      <div className={styles.mutationGrid}>
        <form
          className={styles.mutationPanel}
          onSubmit={(event) => {
            event.preventDefault();
            setMutationNotice(null);
            adjustmentMutation.mutate(adjustmentForm);
          }}
        >
          <header>
            <span><Save size={18} /></span>
            <h3>재고 조정</h3>
            <button type="button" className={styles.secondaryButton} onClick={() => applyInventoryItem(firstInventoryItem)} disabled={!firstInventoryItem}>
              첫 행 적용
            </button>
          </header>
          <div className={styles.compactFields}>
            <MutationField label="창고 ID" value={adjustmentForm.warehouseId} onChange={(value) => setAdjustmentForm({ ...adjustmentForm, warehouseId: value })} required />
            <MutationField label="로케이션 ID" value={adjustmentForm.locationId} onChange={(value) => setAdjustmentForm({ ...adjustmentForm, locationId: value })} required />
            <MutationField label="품목 ID" value={adjustmentForm.itemId} onChange={(value) => setAdjustmentForm({ ...adjustmentForm, itemId: value })} required />
            <MutationField label="조정 수량" value={adjustmentForm.quantityChange} onChange={(value) => setAdjustmentForm({ ...adjustmentForm, quantityChange: value })} required />
            <MutationField label="사유" value={adjustmentForm.reason} onChange={(value) => setAdjustmentForm({ ...adjustmentForm, reason: value })} required />
            <MutationField label="기준 일자" type="date" value={adjustmentForm.effectiveDate} onChange={(value) => setAdjustmentForm({ ...adjustmentForm, effectiveDate: value })} />
            <MutationField label="참조 번호" value={adjustmentForm.referenceNo} onChange={(value) => setAdjustmentForm({ ...adjustmentForm, referenceNo: value })} />
            <MutationField label="메모" value={adjustmentForm.memo} onChange={(value) => setAdjustmentForm({ ...adjustmentForm, memo: value })} />
          </div>
          <MutationError error={adjustmentMutation.error} />
          <div className={styles.formActions}>
            <button type="submit" disabled={adjustmentMutation.isPending}>
              <Save size={16} />
              {adjustmentMutation.isPending ? "처리 중" : "조정 저장"}
            </button>
          </div>
        </form>
        <form
          className={styles.mutationPanel}
          onSubmit={(event) => {
            event.preventDefault();
            setMutationNotice(null);
            inboundMutation.mutate(inboundForm);
          }}
        >
          <header>
            <span><ClipboardCheck size={18} /></span>
            <h3>입고 확정</h3>
            <button type="button" className={styles.secondaryButton} onClick={() => applyInventoryItem(firstInventoryItem)} disabled={!firstInventoryItem}>
              첫 행 적용
            </button>
          </header>
          <div className={styles.compactFields}>
            <MutationField label="창고 ID" value={inboundForm.warehouseId} onChange={(value) => setInboundForm({ ...inboundForm, warehouseId: value })} required />
            <MutationField label="로케이션 ID" value={inboundForm.locationId} onChange={(value) => setInboundForm({ ...inboundForm, locationId: value })} required />
            <MutationField label="품목 ID" value={inboundForm.itemId} onChange={(value) => setInboundForm({ ...inboundForm, itemId: value })} required />
            <MutationField label="입고 수량" value={inboundForm.quantity} onChange={(value) => setInboundForm({ ...inboundForm, quantity: value })} required />
            <MutationField label="참조 번호" value={inboundForm.referenceNo} onChange={(value) => setInboundForm({ ...inboundForm, referenceNo: value })} />
          </div>
          <MutationError error={inboundMutation.error} />
          <div className={styles.formActions}>
            <button type="submit" disabled={inboundMutation.isPending}>
              <ClipboardCheck size={16} />
              {inboundMutation.isPending ? "처리 중" : "입고 확정"}
            </button>
          </div>
        </form>
      </div>
      {mutationNotice ? <p className={styles.actionNotice}>{mutationNotice}</p> : null}
      <ResultState query={inventory}>
        {(result) => (
          <>
            <div className={styles.metricGrid}>
              <Metric title="조회 수량" value={formatQuantity(result.data.pageTotals.quantity)} detail={`${result.data.inventory.total}건`} />
              <Metric title="가용 수량" value={formatQuantity(result.data.pageTotals.availableQuantity)} detail="출고 가능" />
              <Metric title="할당 수량" value={formatQuantity(result.data.pageTotals.allocatedQuantity)} detail="작업 예약" />
            </div>
            <DataTable
              columns={["창고", "로케이션", "품목", "총 수량", "가용", "할당", "수정일"]}
              rows={result.data.inventory.items.map((item) => [
                item.warehouseId,
                item.locationId,
                item.materialId,
                formatQuantity(item.quantity),
                formatQuantity(item.availableQuantity),
                formatQuantity(item.allocatedQuantity),
                formatDate(item.updatedAt)
              ])}
            />
          </>
        )}
      </ResultState>
    </Screen>
  );
}

function SnapshotScreen() {
  const [draftFilters, setDraftFilters] = useState<FilterValues>(() => createSnapshotFilterValues());
  const [filters, setFilters] = useState<FilterValues>(() => createSnapshotFilterValues());
  const snapshotQuery = toWmsListQuery(filters);
  const snapshots = useQuery({
    queryKey: ["wms-inventory-snapshots", snapshotQuery],
    queryFn: () => getInventorySnapshots(snapshotQuery)
  });

  return (
    <Screen title="재고 스냅샷" description="일자별 재고 스냅샷과 생성 이력을 확인합니다." result={snapshots.data}>
      <SearchBar
        fields={snapshotSearchFields}
        values={draftFilters}
        onChange={setDraftFilters}
        onSubmit={() => setFilters(sanitizeFilterValues(draftFilters))}
        onReset={() => {
          const next = createSnapshotFilterValues();
          setDraftFilters(next);
          setFilters(next);
        }}
      />
      <ActiveFilters fields={snapshotSearchFields} values={filters} />
      <ResultState query={snapshots}>
        {(result) => (
          <>
            <div className={styles.metricGrid}>
              <Metric title="스냅샷 수량" value={formatQuantity(result.data.pageTotals.quantity)} detail={`${result.data.snapshots.total}건`} />
              <Metric title="가용 수량" value={formatQuantity(result.data.pageTotals.availableQuantity)} detail="스냅샷 기준" />
              <Metric title="할당 수량" value={formatQuantity(result.data.pageTotals.allocatedQuantity)} detail="스냅샷 기준" />
            </div>
            <DataTable
              columns={["일자", "창고", "로케이션", "품목", "총 수량", "가용", "생성시각"]}
              rows={result.data.snapshots.items.map((item) => [
                item.snapshotDate,
                item.warehouseId,
                item.locationId,
                item.materialId,
                formatQuantity(item.quantity),
                formatQuantity(item.availableQuantity),
                formatDate(item.generatedAt)
              ])}
            />
          </>
        )}
      </ResultState>
    </Screen>
  );
}

function MasterDataScreen() {
  const [draftFilters, setDraftFilters] = useState<FilterValues>(() => createFilterValues(masterSearchFields));
  const [filters, setFilters] = useState<FilterValues>(() => createFilterValues(masterSearchFields));
  const warehouseQuery = toWmsListQuery({ code: filters.warehouseCode });
  const locationQuery = toWmsListQuery({ warehouseId: filters.locationWarehouseId, code: filters.locationCode });
  const materialQuery = toWmsListQuery({ sku: filters.materialSku });
  const warehouses = useQuery({
    queryKey: ["wms-warehouses", warehouseQuery],
    queryFn: () => getWarehouses(warehouseQuery)
  });
  const locations = useQuery({
    queryKey: ["wms-locations", locationQuery],
    queryFn: () => getLocations(locationQuery)
  });
  const materials = useQuery({
    queryKey: ["wms-materials", materialQuery],
    queryFn: () => getMaterials(materialQuery)
  });

  return (
    <Screen title="기준정보" description="창고, 로케이션, 품목 기준정보를 한 화면에서 확인합니다.">
      <SearchBar
        fields={masterSearchFields}
        values={draftFilters}
        onChange={setDraftFilters}
        onSubmit={() => setFilters(sanitizeFilterValues(draftFilters))}
        onReset={() => {
          const next = createFilterValues(masterSearchFields);
          setDraftFilters(next);
          setFilters(next);
        }}
      />
      <ActiveFilters fields={masterSearchFields} values={filters} />
      <div className={styles.threeColumn}>
        <MasterDataPanel title="창고" icon={<Building2 size={18} />} query={warehouses} render={(item: WarehouseItem) => (
          <>
            <strong>{item.name}</strong>
            <span>{item.code}</span>
            <StatusBadge status={item.status} />
          </>
        )} />
        <MasterDataPanel title="로케이션" icon={<Warehouse size={18} />} query={locations} render={(item: LocationItem) => (
          <>
            <strong>{item.name ?? item.code}</strong>
            <span>{item.warehouseId} · {item.type}</span>
            <StatusBadge status={item.status} />
          </>
        )} />
        <MasterDataPanel title="품목" icon={<Boxes size={18} />} query={materials} render={(item: MaterialItem) => (
          <>
            <strong>{item.name}</strong>
            <span>{item.code} · {item.uom}</span>
            <StatusBadge status={item.status} />
          </>
        )} />
      </div>
    </Screen>
  );
}

function OutboundScreen() {
  const queryClient = useQueryClient();
  const [draftFilters, setDraftFilters] = useState<FilterValues>(() => createFilterValues(outboundSearchFields));
  const [filters, setFilters] = useState<FilterValues>(() => createFilterValues(outboundSearchFields));
  const [allocationForm, setAllocationForm] = useState<OutboundAllocationForm>(emptyOutboundAllocationForm);
  const [packingForm, setPackingForm] = useState<OutboundPackingForm>(emptyOutboundPackingForm);
  const [packageForm, setPackageForm] = useState<OutboundPackageForm>(emptyOutboundPackageForm);
  const [confirmPackingId, setConfirmPackingId] = useState("");
  const [shipmentForm, setShipmentForm] = useState<OutboundShipmentForm>(emptyOutboundShipmentForm);
  const [mutationNotice, setMutationNotice] = useState<string | null>(null);
  const outboundBaseQuery = {
    warehouseId: filters.warehouseId,
    outboundOrderId: filters.outboundOrderId
  };
  const allocationQuery = toWmsListQuery({ ...outboundBaseQuery, status: filters.allocationStatus });
  const packingQuery = toWmsListQuery({ ...outboundBaseQuery, status: filters.packingStatus });
  const allocations = useQuery({
    queryKey: ["wms-outbound-allocations", allocationQuery],
    queryFn: () => getOutboundAllocations(allocationQuery)
  });
  const packings = useQuery({
    queryKey: ["wms-outbound-packings", packingQuery],
    queryFn: () => getOutboundPackings(packingQuery)
  });
  const firstAllocation = allocations.data?.data.items[0];
  const firstPacking = packings.data?.data.items[0];
  const allocationMutation = useMutation({
    mutationFn: allocateOutbound,
    onSuccess: async (result) => {
      setMutationNotice(`출고 할당 완료: ${result.data.allocationId}${result.requestId ? ` / requestId ${result.requestId}` : ""}`);
      setPackingForm((current) => ({
        ...current,
        outboundOrderId: result.data.outboundOrderId,
        allocationIds: result.data.allocationId
      }));
      setPackageForm((current) => ({
        ...current,
        allocationId: result.data.allocationId,
        itemId: result.data.materialId,
        quantity: result.data.quantity
      }));
      setShipmentForm((current) => ({ ...current, allocationId: result.data.allocationId, packingId: "" }));
      await invalidateWmsMutationQueries(queryClient);
    }
  });
  const packingMutation = useMutation({
    mutationFn: createOutboundPacking,
    onSuccess: async (result) => {
      setMutationNotice(`포장 생성 완료: ${result.data.packingId}${result.requestId ? ` / requestId ${result.requestId}` : ""}`);
      setPackageForm((current) => ({ ...current, packingId: result.data.packingId }));
      setConfirmPackingId(result.data.packingId);
      setShipmentForm((current) => ({ ...current, packingId: result.data.packingId, allocationId: "" }));
      await invalidateWmsMutationQueries(queryClient);
    }
  });
  const packageMutation = useMutation({
    mutationFn: addOutboundPackage,
    onSuccess: async (result) => {
      setMutationNotice(`패키지 등록 완료: ${result.data.packageId}${result.requestId ? ` / requestId ${result.requestId}` : ""}`);
      await invalidateWmsMutationQueries(queryClient);
    }
  });
  const confirmPackingMutation = useMutation({
    mutationFn: confirmOutboundPacking,
    onSuccess: async (result) => {
      setMutationNotice(`포장 확정 완료: ${result.data.packingId}${result.requestId ? ` / requestId ${result.requestId}` : ""}`);
      setShipmentForm((current) => ({ ...current, packingId: result.data.packingId, allocationId: "" }));
      await invalidateWmsMutationQueries(queryClient);
    }
  });
  const shipmentMutation = useMutation({
    mutationFn: shipOutbound,
    onSuccess: async (result) => {
      const shipmentId = result.data.shipmentId ?? result.data.allocationId ?? result.data.packingId ?? "출하";
      setMutationNotice(`출하 처리 완료: ${shipmentId}${result.requestId ? ` / requestId ${result.requestId}` : ""}`);
      await invalidateWmsMutationQueries(queryClient);
    }
  });

  function applyFirstAllocation(allocation: OutboundAllocationItem | undefined) {
    if (!allocation) {
      return;
    }

    setPackingForm((current) => ({
      ...current,
      outboundOrderId: allocation.outboundOrderId,
      allocationIds: allocation.allocationId
    }));
    setPackageForm((current) => ({
      ...current,
      allocationId: allocation.allocationId,
      itemId: allocation.materialId,
      quantity: allocation.quantity
    }));
    setShipmentForm((current) => ({ ...current, allocationId: allocation.allocationId, packingId: "" }));
  }

  function applyFirstPacking(packing: OutboundPackingItem | undefined) {
    if (!packing) {
      return;
    }

    setPackageForm((current) => ({ ...current, packingId: packing.packingId }));
    setConfirmPackingId(packing.packingId);
    setShipmentForm((current) => ({ ...current, packingId: packing.packingId, allocationId: "" }));
  }

  return (
    <Screen title="출고 작업" description="출고 할당과 포장 상태를 작업 단위로 확인합니다.">
      <SearchBar
        fields={outboundSearchFields}
        values={draftFilters}
        onChange={setDraftFilters}
        onSubmit={() => setFilters(sanitizeFilterValues(draftFilters))}
        onReset={() => {
          const next = createFilterValues(outboundSearchFields);
          setDraftFilters(next);
          setFilters(next);
        }}
      />
      <ActiveFilters fields={outboundSearchFields} values={filters} />
      <div className={styles.mutationGrid}>
        <form
          className={styles.mutationPanel}
          onSubmit={(event) => {
            event.preventDefault();
            setMutationNotice(null);
            allocationMutation.mutate(allocationForm);
          }}
        >
          <header>
            <span><Truck size={18} /></span>
            <h3>출고 할당</h3>
          </header>
          <div className={styles.compactFields}>
            <MutationField label="주문 번호" value={allocationForm.orderNo} onChange={(value) => setAllocationForm({ ...allocationForm, orderNo: value })} required />
            <MutationField label="창고 ID" value={allocationForm.warehouseId} onChange={(value) => setAllocationForm({ ...allocationForm, warehouseId: value })} required />
            <MutationField label="로케이션 ID" value={allocationForm.locationId} onChange={(value) => setAllocationForm({ ...allocationForm, locationId: value })} required />
            <MutationField label="품목 ID" value={allocationForm.itemId} onChange={(value) => setAllocationForm({ ...allocationForm, itemId: value })} required />
            <MutationField label="수량" value={allocationForm.quantity} onChange={(value) => setAllocationForm({ ...allocationForm, quantity: value })} required />
          </div>
          <MutationError error={allocationMutation.error} />
          <div className={styles.formActions}>
            <button type="submit" disabled={allocationMutation.isPending}>
              <Truck size={16} />
              {allocationMutation.isPending ? "처리 중" : "할당 생성"}
            </button>
          </div>
        </form>
        <form
          className={styles.mutationPanel}
          onSubmit={(event) => {
            event.preventDefault();
            setMutationNotice(null);
            packingMutation.mutate({
              outboundOrderId: packingForm.outboundOrderId,
              allocationIds: splitIds(packingForm.allocationIds),
              memo: packingForm.memo
            });
          }}
        >
          <header>
            <span><PackagePlus size={18} /></span>
            <h3>포장 생성</h3>
            <button type="button" className={styles.secondaryButton} onClick={() => applyFirstAllocation(firstAllocation)} disabled={!firstAllocation}>
              첫 할당 적용
            </button>
          </header>
          <div className={styles.compactFields}>
            <MutationField label="출고 주문 ID" value={packingForm.outboundOrderId} onChange={(value) => setPackingForm({ ...packingForm, outboundOrderId: value })} />
            <MutationField label="할당 ID 목록" value={packingForm.allocationIds} onChange={(value) => setPackingForm({ ...packingForm, allocationIds: value })} required />
            <MutationField label="메모" value={packingForm.memo} onChange={(value) => setPackingForm({ ...packingForm, memo: value })} />
          </div>
          <MutationError error={packingMutation.error} />
          <div className={styles.formActions}>
            <button type="submit" disabled={packingMutation.isPending}>
              <PackagePlus size={16} />
              {packingMutation.isPending ? "처리 중" : "포장 생성"}
            </button>
          </div>
        </form>
        <form
          className={styles.mutationPanel}
          onSubmit={(event) => {
            event.preventDefault();
            setMutationNotice(null);
            packageMutation.mutate(packageForm);
          }}
        >
          <header>
            <span><PackageCheck size={18} /></span>
            <h3>패키지 등록</h3>
            <button type="button" className={styles.secondaryButton} onClick={() => applyFirstPacking(firstPacking)} disabled={!firstPacking}>
              첫 포장 적용
            </button>
          </header>
          <div className={styles.compactFields}>
            <MutationField label="포장 ID" value={packageForm.packingId} onChange={(value) => setPackageForm({ ...packageForm, packingId: value })} required />
            <MutationField label="패키지 번호" value={packageForm.packageNo} onChange={(value) => setPackageForm({ ...packageForm, packageNo: value })} required />
            <MutationField label="박스 유형" value={packageForm.boxType} onChange={(value) => setPackageForm({ ...packageForm, boxType: value })} />
            <MutationField label="할당 ID" value={packageForm.allocationId} onChange={(value) => setPackageForm({ ...packageForm, allocationId: value })} required />
            <MutationField label="품목 ID" value={packageForm.itemId} onChange={(value) => setPackageForm({ ...packageForm, itemId: value })} required />
            <MutationField label="수량" value={packageForm.quantity} onChange={(value) => setPackageForm({ ...packageForm, quantity: value })} required />
          </div>
          <MutationError error={packageMutation.error} />
          <div className={styles.formActions}>
            <button type="submit" disabled={packageMutation.isPending}>
              <PackageCheck size={16} />
              {packageMutation.isPending ? "처리 중" : "패키지 등록"}
            </button>
          </div>
        </form>
        <form
          className={styles.mutationPanel}
          onSubmit={(event) => {
            event.preventDefault();
            setMutationNotice(null);
            confirmPackingMutation.mutate({ packingId: confirmPackingId });
          }}
        >
          <header>
            <span><ClipboardCheck size={18} /></span>
            <h3>포장 확정</h3>
            <button type="button" className={styles.secondaryButton} onClick={() => applyFirstPacking(firstPacking)} disabled={!firstPacking}>
              첫 포장 적용
            </button>
          </header>
          <div className={styles.compactFields}>
            <MutationField label="포장 ID" value={confirmPackingId} onChange={setConfirmPackingId} required />
          </div>
          <MutationError error={confirmPackingMutation.error} />
          <div className={styles.formActions}>
            <button type="submit" disabled={confirmPackingMutation.isPending}>
              <ClipboardCheck size={16} />
              {confirmPackingMutation.isPending ? "처리 중" : "포장 확정"}
            </button>
          </div>
        </form>
        <form
          className={styles.mutationPanel}
          onSubmit={(event) => {
            event.preventDefault();
            setMutationNotice(null);
            shipmentMutation.mutate(shipmentForm);
          }}
        >
          <header>
            <span><Send size={18} /></span>
            <h3>출하 처리</h3>
          </header>
          <div className={styles.compactFields}>
            <MutationField label="할당 ID" value={shipmentForm.allocationId} onChange={(value) => setShipmentForm({ ...shipmentForm, allocationId: value, packingId: "" })} />
            <MutationField label="포장 ID" value={shipmentForm.packingId} onChange={(value) => setShipmentForm({ ...shipmentForm, packingId: value, allocationId: "" })} />
            <MutationField label="운송사 코드" value={shipmentForm.carrierCode} onChange={(value) => setShipmentForm({ ...shipmentForm, carrierCode: value })} />
            <MutationField label="송장 번호" value={shipmentForm.trackingNo} onChange={(value) => setShipmentForm({ ...shipmentForm, trackingNo: value })} />
          </div>
          <MutationError error={shipmentMutation.error} />
          <div className={styles.formActions}>
            <button type="submit" disabled={shipmentMutation.isPending}>
              <Send size={16} />
              {shipmentMutation.isPending ? "처리 중" : "출하 처리"}
            </button>
          </div>
        </form>
      </div>
      {mutationNotice ? <p className={styles.actionNotice}>{mutationNotice}</p> : null}
      <div className={styles.twoColumn}>
              <Panel
                title="출고 할당"
                icon={<Truck size={18} />}
                meta={allocations.data ? <SourceBadge result={allocations.data} /> : null}
              >
          <ResultState query={allocations}>
            {(result) => (
              <CompactList
                items={result.data.items}
                render={(item: OutboundAllocationItem) => (
                  <>
                    <strong>{item.orderNo}</strong>
                    <span>{item.locationId} · {item.materialId} · {formatQuantity(item.quantity)}</span>
                    <StatusBadge status={item.status} />
                  </>
                )}
              />
            )}
          </ResultState>
        </Panel>
              <Panel
                title="포장 상태"
                icon={<PackageCheck size={18} />}
                meta={packings.data ? <SourceBadge result={packings.data} /> : null}
              >
          <ResultState query={packings}>
            {(result) => (
              <CompactList
                items={result.data.items}
                render={(item: OutboundPackingItem) => (
                  <>
                    <strong>{item.orderNo}</strong>
                    <span>{item.packageCount}개 포장 · {item.packageIds.join(", ")}</span>
                    <StatusBadge status={item.status} />
                  </>
                )}
              />
            )}
          </ResultState>
        </Panel>
      </div>
    </Screen>
  );
}

function PermissionScreen() {
  return (
    <Screen title="권한 제한" description="사용자 권한에 따라 메뉴와 작업 버튼 노출을 제한합니다.">
      <div className={styles.permissionBox}>
        <LockKeyhole size={42} />
        <div>
          <h2>접근 가능한 업무만 표시됩니다.</h2>
          <p>기준정보, 스냅샷 생성, 포장, 출하 권한이 없으면 관련 화면은 읽기 제한 또는 차단 상태로 표시됩니다.</p>
        </div>
      </div>
      <div className={styles.twoColumn}>
        <Panel title="권한 예시" icon={<ShieldAlert size={18} />}>
          <div className={styles.actionGrid}>
            <span className={styles.actionOn}>wms.inventory.read</span>
            <span className={styles.actionOff}>wms.inventory.snapshot.generate</span>
            <span className={styles.actionOn}>wms.outbound.pack</span>
            <span className={styles.actionOff}>wms.outbound.ship</span>
          </div>
        </Panel>
        <Panel title="화면 처리" icon={<AlertTriangle size={18} />}>
          <p className={styles.panelText}>API가 <code>FORBIDDEN</code> 또는 tenant 오류를 반환하면 오류 code와 requestId를 화면에 남기고 업무 데이터는 표시하지 않습니다.</p>
        </Panel>
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
        {result ? <SourceBadge result={result} /> : null}
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

function Panel({
  title,
  icon,
  meta,
  children
}: {
  title: string;
  icon: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.panel}>
      <header>
        <span>{icon}</span>
        <h3>{title}</h3>
        {meta ? <div className={styles.panelHeaderMeta}>{meta}</div> : null}
      </header>
      {children}
    </section>
  );
}

function ProgressRows({
  rows
}: {
  rows: Array<{ label: string; value: number | null; sampledCount: number; canView: boolean }>;
}) {
  return (
    <div className={styles.progressRows}>
      {rows.map((row) => (
        <div key={row.label} className={styles.progressRow}>
          <div>
            <strong>{row.label}</strong>
            <span>{row.canView ? `표본 ${row.sampledCount}건` : "권한 제한"}</span>
          </div>
          <b>{row.value === null ? "-" : formatInteger(row.value)}</b>
        </div>
      ))}
    </div>
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
              type={field.type ?? "text"}
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

function MutationField({
  label,
  value,
  onChange,
  type = "text",
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "date";
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
    </label>
  );
}

function MutationError({ error }: { error: Error | null }) {
  if (!error) {
    return null;
  }

  return <p className={styles.formNotice}>{loginErrorMessage(error)}</p>;
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

function MasterDataPanel<T>({
  title,
  icon,
  query,
  render
}: {
  title: string;
  icon: ReactNode;
  query: { isLoading: boolean; data?: DataResult<PageData<T>>; error: Error | null };
  render: (item: T) => ReactNode;
}) {
  const total = query.data?.data.total ?? 0;

  return (
    <Panel title={`${title} ${formatInteger(total)}건`} icon={icon} meta={query.data ? <SourceBadge result={query.data} /> : null}>
      <ResultState query={query}>
        {(result) => <CompactList items={result.data.items} render={render} />}
      </ResultState>
    </Panel>
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

function StatusBadge({ status }: { status: string }) {
  const label = useMemo(() => {
    const map: Record<string, string> = {
      active: "사용",
      inactive: "중지",
      allocated: "할당",
      packing: "포장중",
      confirmed: "확정",
      packed: "포장",
      shipped: "출하"
    };
    return map[status] ?? status;
  }, [status]);

  return <em className={styles.statusBadge}>{label}</em>;
}

function formatQuantity(value: string | number): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }

  return numeric.toLocaleString("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  });
}

function formatInteger(value: number): string {
  return value.toLocaleString("ko-KR");
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

function createFilterValues(fields: SearchField[]): FilterValues {
  return fields.reduce<FilterValues>((values, field) => {
    values[field.name] = "";
    return values;
  }, {});
}

function createSnapshotFilterValues(): FilterValues {
  return {
    ...createFilterValues(snapshotSearchFields),
    snapshotDate: getDefaultSnapshotDate()
  };
}

function sanitizeFilterValues(values: FilterValues): FilterValues {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]));
}

function toWmsListQuery(values: FilterValues): WmsListQuery {
  return Object.fromEntries(
    Object.entries(values)
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => value)
  ) as WmsListQuery;
}

async function invalidateWmsMutationQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["wms-dashboard"] }),
    queryClient.invalidateQueries({ queryKey: ["wms-inventory"] }),
    queryClient.invalidateQueries({ queryKey: ["wms-inventory-snapshots"] }),
    queryClient.invalidateQueries({ queryKey: ["wms-outbound-allocations"] }),
    queryClient.invalidateQueries({ queryKey: ["wms-outbound-packings"] })
  ]);
}

function splitIds(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.code}: ${error.message}${error.requestId ? ` (requestId: ${error.requestId})` : ""}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "로그인 또는 세션 확인에 실패했습니다.";
}
