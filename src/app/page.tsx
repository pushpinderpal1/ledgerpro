'use client'
import { useState, useEffect, useCallback, createContext, useContext, Fragment } from 'react'

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Entity { id: string; name: string; slug: string; currency: string; userAccess?: { role: string }[] }
interface User   { id: string; name: string; email: string; isSuperAdmin: boolean }
interface Account{ id: string; code: string; name: string; type: string; subType?: string; isBankAccount?: boolean; parentId?: string | null; description?: string | null; usageCount?: number; isActive?: boolean }
interface JournalEntry { id: string; ref: string; date: string; description: string; status: string; lines: JournalLine[] }
interface JournalLine  { id: string; accountId: string; account: { code: string; name: string }; debit: number; credit: number }
interface ApInvoice { id: string; vendor: string; invoiceNo: string; dueDate: string; amount: number; balance: number; status: string; agingBucket: string; daysOverdue: number }
interface Employee  { id: string; employeeNo: string; firstName: string; lastName: string; payType: string; salary?: number; hourlyRate?: number; department?: string; jobTitle?: string }
interface PayrollRun{ id: string; grossPay: number; fedTax: number; ssTax: number; medicareTax: number; netPay: number; periodEnd: string }
interface EntityUser{ userId: string; role: string; user: { id: string; name: string; email: string; lastLoginAt?: string } }

// ─── App Context ──────────────────────────────────────────────────────────────
const AppCtx = createContext<{
  user: User | null; entities: Entity[]; currentEntity: Entity | null
  setCurrentEntity: (e: Entity) => void; role: string
}>({ user: null, entities: [], currentEntity: null, setCurrentEntity: () => {}, role: '' })

const useApp = () => useContext(AppCtx)

// ─── Utility ──────────────────────────────────────────────────────────────────
const fmt = (n: number | string, dec = 2) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(Number(n))
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const ROLES = ['OWNER','ADMIN','ACCOUNTANT','AUDITOR','AP_CLERK','PAYROLL_CLERK','CLIENT_VIEW']
const ROLE_COLORS: Record<string, string> = {
  OWNER: '#7c3aed', ADMIN: '#2563eb', ACCOUNTANT: '#0891b2',
  AUDITOR: '#059669', AP_CLERK: '#d97706', PAYROLL_CLERK: '#dc2626', CLIENT_VIEW: '#6b7280'
}
const MODULE_ACCESS: Record<string, string[]> = {
  dashboard:  ['OWNER','ADMIN','ACCOUNTANT','AUDITOR','AP_CLERK','PAYROLL_CLERK','CLIENT_VIEW'],
  accounts:   ['OWNER','ADMIN','ACCOUNTANT','AUDITOR'],
  journals:   ['OWNER','ADMIN','ACCOUNTANT','AUDITOR'],
  iif:        ['OWNER','ADMIN','ACCOUNTANT'],
  budget:     ['OWNER','ADMIN','ACCOUNTANT','AUDITOR','CLIENT_VIEW'],
  ap:         ['OWNER','ADMIN','ACCOUNTANT','AP_CLERK'],
  'ap-requests': ['OWNER','ADMIN','ACCOUNTANT','AP_CLERK','AUDITOR'],
  payments:   ['OWNER','ADMIN','ACCOUNTANT','AP_CLERK'],
  recon:      ['OWNER','ADMIN','ACCOUNTANT','AUDITOR'],
  'vendor-recon': ['OWNER','ADMIN','ACCOUNTANT','AUDITOR','AP_CLERK'],
  reports:    ['OWNER','ADMIN','ACCOUNTANT','AUDITOR','CLIENT_VIEW'],
  assets:     ['OWNER','ADMIN','ACCOUNTANT','AUDITOR'],
  audit:      ['OWNER','ADMIN','AUDITOR'],
  group:      ['OWNER','ADMIN'],
  fx:         ['OWNER','ADMIN','ACCOUNTANT'],
  mis:        ['OWNER','ADMIN','ACCOUNTANT'],
  periods:    ['OWNER','ADMIN'],
  payroll:    ['OWNER','ADMIN','PAYROLL_CLERK'],
  w2:         ['OWNER','ADMIN','PAYROLL_CLERK'],
  users:      ['OWNER','ADMIN'],
  settings:   ['OWNER'],
}
const canAccess = (role: string, mod: string) => MODULE_ACCESS[mod]?.includes(role) ?? false

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function LedgerProApp() {
  const [authPage, setAuthPage] = useState<'login'|'register'>('login')
  const [user, setUser] = useState<User | null>(null)
  const [entities, setEntities] = useState<Entity[]>([])
  const [currentEntity, setCurrentEntityState] = useState<Entity | null>(null)
  const [page, setPage] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [entitySwitcherOpen, setEntitySwitcherOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'ok'|'err' } | null>(null)

  const role = currentEntity?.userAccess?.[0]?.role ?? ''

  const showToast = (msg: string, type: 'ok'|'err' = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const setCurrentEntity = useCallback((e: Entity) => {
    setCurrentEntityState(e)
    setEntitySwitcherOpen(false)
    setPage('dashboard')
  }, [])

  const handleLogout = () => { setUser(null); setEntities([]); setCurrentEntityState(null) }

  if (!user) return (
    <AuthScreen authPage={authPage} setAuthPage={setAuthPage}
      onAuth={(u, ents) => { setUser(u); setEntities(ents); setCurrentEntityState(ents[0] ?? null) }} />
  )

  const navItems = [
    { id: 'dashboard', label: 'Dashboard',         icon: '▤' },
    { id: 'accounts',  label: 'Chart of Accounts', icon: '≡' },
    { id: 'journals',  label: 'Journal Entries',   icon: '✎' },
    { id: 'iif',       label: 'QB IIF',            icon: '⇄' },
    { id: 'budget',    label: 'Budget & MIS',       icon: '◈' },
    { id: 'ap',        label: 'AP Tracker',         icon: '◎' },
    { id: 'ap-requests', label: 'Expense Requests', icon: '📥' },
    { id: 'payments',  label: 'Payments',           icon: '✓' },
    { id: 'recon',     label: 'Bank Recon',         icon: '↔' },
    { id: 'vendor-recon', label: 'Vendor Recon',    icon: '◐' },
    { id: 'assets',    label: 'Fixed Assets',       icon: '⬚' },
    { id: 'reports',   label: 'Reports',            icon: '▤' },
    { id: 'audit',     label: 'Audit Trail',        icon: '⊙' },
    { id: 'group',     label: 'Group Structure',    icon: '◇' },
    { id: 'fx',        label: 'FX Rates',           icon: '⇄' },
    { id: 'mis',       label: 'MIS / Departments',  icon: '⊞' },
    { id: 'periods',   label: 'Period Locks',       icon: '🔒' },
    { id: 'payroll',   label: 'Payroll',            icon: '◷' },
    { id: 'w2',        label: 'W-2 / 1040-K',       icon: '◻' },
    { id: 'users',     label: 'User Management',    icon: '◉' },
    { id: 'settings',  label: 'Settings',            icon: '⚙' },
  ].filter(n => canAccess(role, n.id) || user.isSuperAdmin)

  return (
    <AppCtx.Provider value={{ user, entities, currentEntity, setCurrentEntity, role }}>
      <div style={S.app}>
        {/* Sidebar */}
        <aside style={{ ...S.sidebar, width: sidebarOpen ? 220 : 56, transition: 'width .2s' }}>
          <div style={S.sidebarTop}>
            <div style={S.logoRow} onClick={() => setSidebarOpen(o => !o)}>
              <span style={S.logoMark}>L</span>
              {sidebarOpen && <span style={S.logoText}>LedgerPro</span>}
            </div>
            {sidebarOpen && (
              <div style={S.entityBtn} onClick={() => setEntitySwitcherOpen(o => !o)}>
                <span style={S.entityName} title={currentEntity?.name ?? 'No entity'}>
                  {currentEntity?.name?.slice(0, 22) ?? 'Select entity'}
                </span>
                <span style={{ fontSize: 10, color: '#94a3b8' }}>▼</span>
              </div>
            )}
          </div>

          <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {navItems.map(n => (
              <div key={n.id} style={{
                ...S.navItem,
                ...(page === n.id ? S.navActive : {}),
                justifyContent: sidebarOpen ? 'flex-start' : 'center',
              }} onClick={() => setPage(n.id)} title={!sidebarOpen ? n.label : ''}>
                <span style={{ fontSize: 14, minWidth: 18, textAlign: 'center' }}>{n.icon}</span>
                {sidebarOpen && <span style={{ fontSize: 13 }}>{n.label}</span>}
              </div>
            ))}
          </nav>

          <div style={S.sidebarBottom}>
            {sidebarOpen && (
              <div style={S.userRow}>
                <div style={S.avatar}>{user.name[0]}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={S.userName}>{user.name}</div>
                  <div style={S.userRole}>{role || (user.isSuperAdmin ? 'SUPER ADMIN' : '')}</div>
                </div>
                <button style={S.logoutBtn} onClick={handleLogout} title="Logout">✕</button>
              </div>
            )}
          </div>
        </aside>

        {/* Entity Switcher Overlay */}
        {entitySwitcherOpen && (
          <div style={S.overlay} onClick={() => setEntitySwitcherOpen(false)}>
            <div style={S.switcher} onClick={e => e.stopPropagation()}>
              <div style={S.switcherHeader}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>Switch legal entity</span>
                <button style={S.closeBtn} onClick={() => setEntitySwitcherOpen(false)}>✕</button>
              </div>
              {entities.map(e => (
                <div key={e.id} style={{
                  ...S.switcherItem,
                  ...(e.id === currentEntity?.id ? S.switcherActive : {}),
                }} onClick={() => setCurrentEntity(e)}>
                  <div style={S.entityIcon}>{e.name[0]}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{e.name}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>
                      {e.userAccess?.[0]?.role ?? ''} · {e.currency}
                    </div>
                  </div>
                  {e.id === currentEntity?.id && <span style={{ color: '#7c3aed', fontSize: 14 }}>✓</span>}
                </div>
              ))}
              <div style={{ borderTop: '1px solid #f1f5f9', marginTop: 8, paddingTop: 8 }}>
                <NewEntityForm onCreated={e => { setEntities(prev => [...prev, e]); setCurrentEntity(e) }} showToast={showToast} />
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <main style={S.main}>
          <div style={S.topbar}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>
                {navItems.find(n => n.id === page)?.label ?? page}
              </span>
              {currentEntity && (
                <span style={S.entityBadge}>{currentEntity.name}</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {role && <span style={{ ...S.rolePill, background: ROLE_COLORS[role] + '20', color: ROLE_COLORS[role] }}>{role}</span>}
              {user.isSuperAdmin && <span style={{ ...S.rolePill, background: '#7c3aed20', color: '#7c3aed' }}>SUPER ADMIN</span>}
            </div>
          </div>

          <div style={S.content}>
            {!currentEntity && page !== 'settings' ? (
              <EmptyState onOpen={() => setEntitySwitcherOpen(true)} />
            ) : (
              <>
                {page === 'dashboard' && <DashboardPage showToast={showToast} />}
                {page === 'accounts'  && <AccountsPage  showToast={showToast} />}
                {page === 'journals'  && <JournalsPage  showToast={showToast} />}
                {page === 'iif'       && <IifPage        showToast={showToast} />}
                {page === 'budget'    && <BudgetPage     showToast={showToast} />}
                {page === 'ap'        && <ApPage         showToast={showToast} />}
                {page === 'ap-requests' && <ApRequestsPage showToast={showToast} />}
                {page === 'payments'  && <PaymentsPage   showToast={showToast} />}
                {page === 'recon'     && <ReconPage      showToast={showToast} />}
                {page === 'vendor-recon' && <VendorReconPage showToast={showToast} />}
                {page === 'assets'    && <AssetsPage     showToast={showToast} />}
                {page === 'reports'   && <ReportsPage    showToast={showToast} />}
                {page === 'audit'     && <AuditPage      showToast={showToast} />}
                {page === 'group'     && <GroupPage      showToast={showToast} />}
                {page === 'fx'        && <FxRatesPage    showToast={showToast} />}
                {page === 'mis'       && <MisPage         showToast={showToast} />}
                {page === 'periods'   && <PeriodsPage    showToast={showToast} />}
                {page === 'payroll'   && <PayrollPage    showToast={showToast} />}
                {page === 'w2'        && <W2Page         showToast={showToast} />}
                {page === 'users'     && <UsersPage      showToast={showToast} />}
                {page === 'settings'  && <SettingsPage   showToast={showToast} />}
              </>
            )}
          </div>
        </main>

        {toast && (
          <div style={{ ...S.toast, background: toast.type === 'ok' ? '#0f172a' : '#b91c1c' }}>
            {toast.type === 'ok' ? '✓' : '✕'} {toast.msg}
          </div>
        )}
      </div>
    </AppCtx.Provider>
  )
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────
function AuthScreen({ authPage, setAuthPage, onAuth }: {
  authPage: 'login'|'register'
  setAuthPage: (p: 'login'|'register') => void
  onAuth: (u: User, e: Entity[]) => void
}) {
  const [form, setForm] = useState({ email: '', password: '', name: '', firmName: '' })
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  // 2FA challenge state — after password succeeds for a 2FA user, we get a
  // short-lived challenge token and ask for the code without re-prompting for
  // password.
  const [challengeToken, setChallengeToken] = useState<string | null>(null)
  const [twoFactorCode, setTwoFactorCode] = useState('')

  const finishAuth = async (user: User) => {
    const entsRes = await fetch('/api/entities')
    const ents = entsRes.ok ? await entsRes.json() : []
    onAuth(user, ents)
  }

  const handle = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setLoading(true)
    try {
      const endpoint = authPage === 'login' ? '/api/auth/login' : '/api/auth/register'
      const res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error ?? 'Authentication failed'); return }
      // Branch 1: server says 2FA required → show code prompt.
      if (data.requires2fa && data.challengeToken) {
        setChallengeToken(data.challengeToken)
        return
      }
      // Branch 2: normal login/register success.
      await finishAuth(data.user)
    } catch { setErr('Network error') } finally { setLoading(false) }
  }

  const submitChallenge = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setLoading(true)
    try {
      const res = await fetch('/api/auth/2fa/challenge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken, code: twoFactorCode }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error ?? 'Invalid code'); return }
      await finishAuth(data.user)
    } catch { setErr('Network error') } finally { setLoading(false) }
  }

  const fillDemo = (email: string, pw: string) => setForm(f => ({ ...f, email, password: pw }))

  return (
    <div style={S.authWrap}>
      <div style={S.authCard}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={S.authLogo}>L</div>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.5 }}>LedgerPro</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
            {challengeToken ? 'Two-factor authentication' : 'Multi-entity accounting platform'}
          </div>
        </div>

        {challengeToken ? (
          <form onSubmit={submitChallenge}>
            <div style={{ fontSize: 13, color: '#475569', marginBottom: 14, lineHeight: 1.5 }}>
              Open your authenticator app and enter the 6-digit code. Or use one of your one-time backup codes.
            </div>
            <label style={S.label}>Authentication code</label>
            <input
              style={{ ...S.input, fontSize: 18, fontFamily: 'monospace', letterSpacing: 4, textAlign: 'center' }}
              value={twoFactorCode}
              onChange={e => setTwoFactorCode(e.target.value)}
              placeholder="123456"
              autoFocus
              required
            />
            {err && <div style={S.errMsg}>{err}</div>}
            <button style={{ ...S.btn, ...S.btnPrimary, width: '100%', marginTop: 8, justifyContent: 'center', opacity: loading ? 0.7 : 1 }} disabled={loading}>
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <div style={{ textAlign: 'center', marginTop: 14, fontSize: 13, color: '#64748b' }}>
              <button type="button" style={S.textBtn} onClick={() => { setChallengeToken(null); setTwoFactorCode(''); setErr('') }}>Cancel and sign in as another user</button>
            </div>
          </form>
        ) : (
          <form onSubmit={handle}>
            {authPage === 'register' && (
              <>
                <label style={S.label}>Full name</label>
                <input style={S.input} value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="Jane Smith" required />
                <label style={S.label}>Company / Firm name</label>
                <input style={S.input} value={form.firmName} onChange={e => setForm(f => ({...f, firmName: e.target.value}))} placeholder="Apex Accounting LLC" required />
              </>
            )}
            <label style={S.label}>Email</label>
            <input style={S.input} type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} placeholder="you@firm.com" required />
            <label style={S.label}>Password</label>
            <input style={S.input} type="password" value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))} placeholder="••••••••" required />
            {err && <div style={S.errMsg}>{err}</div>}
            <button style={{ ...S.btn, ...S.btnPrimary, width: '100%', marginTop: 8, justifyContent: 'center', opacity: loading ? 0.7 : 1 }} disabled={loading}>
              {loading ? 'Please wait…' : authPage === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
        )}

        {!challengeToken && (
          <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: '#64748b' }}>
            {authPage === 'login' ? (
              <>No account? <button style={S.textBtn} onClick={() => setAuthPage('register')}>Register</button></>
            ) : (
              <>Have an account? <button style={S.textBtn} onClick={() => setAuthPage('login')}>Sign in</button></>
            )}
          </div>
        )}

        {authPage === 'login' && !challengeToken && (
          <div style={{ marginTop: 20, padding: '14px 16px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: .06 }}>Demo accounts</div>
            {[
              ['owner@apexaccounting.com','Owner123!','Owner'],
              ['accountant@apexaccounting.com','Acct123!','Accountant'],
              ['apclerk@apexaccounting.com','Clerk123!','AP Clerk'],
              ['client@techstartup.com','Client123!','Client View'],
            ].map(([email, pw, label]) => (
              <button key={email} style={S.demoBtn} onClick={() => fillDemo(email, pw)}>
                <span style={{ fontWeight: 500 }}>{label}</span>
                <span style={{ color: '#94a3b8', fontSize: 11 }}>{email}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
// ─── Dashboard with KPIs ──────────────────────────────────────────────────────
interface DashboardKpis {
  cashBalance: number
  cashAccountCount: number
  thisMonth: { revenue: number; expense: number; cogs: number; netIncome: number; from: string; to: string }
  ytd:       { revenue: number; expense: number; cogs: number; netIncome: number; from: string; to: string }
  apOpen: number
  apOverdue: number
  apOverdueCount: number
  topExpenses: { accountId: string; code: string; name: string; amount: number }[]
  trend: { month: string; label: string; revenue: number; expense: number; netIncome: number }[]
  asOf: string
}

function DashboardPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { currentEntity } = useApp()
  const [kpis, setKpis] = useState<DashboardKpis | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentEntity) return
    setLoading(true)
    fetch(`/api/dashboard?entityId=${currentEntity.id}`)
      .then(r => r.json())
      .then(d => { if (d.error) showToast(d.error, 'err'); else setKpis(d) })
      .finally(() => setLoading(false))
  }, [currentEntity, showToast])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading dashboard…</div>
  if (!kpis) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No data yet — post some journal entries to populate</div>

  const niPositive = kpis.thisMonth.netIncome >= 0
  const ytdPositive = kpis.ytd.netIncome >= 0

  // KPI cards (4 wide)
  const cards = [
    {
      label: 'Cash on hand',
      value: `$${fmt(kpis.cashBalance)}`,
      sub: `${kpis.cashAccountCount} bank account${kpis.cashAccountCount === 1 ? '' : 's'}`,
      color: kpis.cashBalance >= 0 ? '#0891b2' : '#dc2626',
    },
    {
      label: 'Net income — this month',
      value: `$${fmt(kpis.thisMonth.netIncome)}`,
      sub: `Revenue $${fmt(kpis.thisMonth.revenue)} − Exp $${fmt(kpis.thisMonth.expense + kpis.thisMonth.cogs)}`,
      color: niPositive ? '#16a34a' : '#dc2626',
    },
    {
      label: 'Net income — YTD',
      value: `$${fmt(kpis.ytd.netIncome)}`,
      sub: `Revenue $${fmt(kpis.ytd.revenue)} − Exp $${fmt(kpis.ytd.expense + kpis.ytd.cogs)}`,
      color: ytdPositive ? '#16a34a' : '#dc2626',
    },
    {
      label: 'AP outstanding',
      value: `$${fmt(kpis.apOpen)}`,
      sub: kpis.apOverdueCount > 0 ? `${kpis.apOverdueCount} overdue ($${fmt(kpis.apOverdue)})` : 'No overdue',
      color: kpis.apOverdueCount > 0 ? '#dc2626' : '#7c3aed',
    },
  ]

  // Trend chart sizing
  const trendMax = Math.max(...kpis.trend.flatMap(t => [t.revenue, t.expense]), 1)
  const chartW = 600, chartH = 160, padL = 40, padR = 10, padT = 20, padB = 30
  const barAreaW = chartW - padL - padR
  const barGroupW = barAreaW / kpis.trend.length
  const barW = (barGroupW - 8) / 2

  return (
    <div>
      {/* KPI cards */}
      <div style={S.kpiGrid}>
        {cards.map(k => (
          <div key={k.label} style={S.kpiCard}>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: k.color, fontFamily: 'monospace' }}>{k.value}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Trend chart + Top expenses */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginTop: 16 }}>
        <div style={S.card}>
          <div style={S.cardHeader}>Revenue vs Expense — last 6 months</div>
          <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{ width: '100%', height: 'auto' }}>
            {/* Y axis grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
              const y = padT + (chartH - padT - padB) * (1 - p)
              return (
                <g key={i}>
                  <line x1={padL} y1={y} x2={chartW - padR} y2={y} stroke="#e2e8f0" strokeWidth={0.5} />
                  <text x={padL - 4} y={y + 3} fontSize={9} fill="#94a3b8" textAnchor="end">
                    {p === 0 ? '0' : `$${fmtCompact(trendMax * p)}`}
                  </text>
                </g>
              )
            })}
            {/* Bars */}
            {kpis.trend.map((t, i) => {
              const x0 = padL + i * barGroupW + 4
              const revH = (t.revenue / trendMax) * (chartH - padT - padB)
              const expH = (t.expense / trendMax) * (chartH - padT - padB)
              return (
                <g key={t.month}>
                  <rect x={x0} y={chartH - padB - revH} width={barW} height={revH} fill="#16a34a" rx={2} />
                  <rect x={x0 + barW + 2} y={chartH - padB - expH} width={barW} height={expH} fill="#dc2626" rx={2} />
                  <text x={x0 + barW + 1} y={chartH - padB + 14} fontSize={10} fill="#475569" textAnchor="middle">{t.label}</text>
                </g>
              )
            })}
            {/* Legend */}
            <g transform={`translate(${chartW - padR - 130}, 5)`}>
              <rect width={10} height={10} fill="#16a34a" rx={2} />
              <text x={14} y={9} fontSize={10} fill="#475569">Revenue</text>
              <rect x={70} width={10} height={10} fill="#dc2626" rx={2} />
              <text x={84} y={9} fontSize={10} fill="#475569">Expense</text>
            </g>
          </svg>
        </div>
        <div style={S.card}>
          <div style={S.cardHeader}>Top expenses — this month</div>
          {kpis.topExpenses.length === 0 ? (
            <div style={{ padding: 20, color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>No expenses yet this month</div>
          ) : (
            <table style={S.table}>
              <tbody>
                {kpis.topExpenses.map(e => {
                  const max = kpis.topExpenses[0].amount
                  const pct = (e.amount / max) * 100
                  return (
                    <tr key={e.accountId}>
                      <td style={{ ...S.td, padding: '8px 6px' }}>
                        <div style={{ fontSize: 12, fontWeight: 500 }}>{e.code} — {e.name}</div>
                        <div style={{ background: '#fee2e2', borderRadius: 2, height: 4, marginTop: 4, position: 'relative' }}>
                          <div style={{ background: '#dc2626', borderRadius: 2, height: 4, width: `${pct}%` }} />
                        </div>
                      </td>
                      <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>${fmt(e.amount)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Bottom row: account summary + recent AP */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <AccountsWidget />
        <ApWidget />
      </div>

      <div style={{ marginTop: 16, fontSize: 11, color: '#94a3b8', textAlign: 'right' }}>
        As of {new Date(kpis.asOf).toLocaleString()}
      </div>
    </div>
  )
}

// Compact formatter for chart axis labels ($1.2K, $3.5M, etc.)
function fmtCompact(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (abs >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(0)
}

function AccountsWidget() {
  const { currentEntity } = useApp()
  const [accounts, setAccounts] = useState<Account[]>([])
  useEffect(() => {
    if (!currentEntity) return
    fetch(`/api/accounts?entityId=${currentEntity.id}`).then(r => r.json()).then(setAccounts)
  }, [currentEntity])
  const byType = ['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'].map(t => ({
    type: t, count: accounts.filter(a => a.type === t).length
  }))
  return (
    <div style={S.card}>
      <div style={S.cardHeader}>Account summary</div>
      <table style={S.table}>
        <thead><tr>{['Type','Count'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
        <tbody>{byType.map(r => (
          <tr key={r.type}>
            <td style={S.td}><span style={{ ...S.typeBadge, background: TYPE_COLORS[r.type] + '18', color: TYPE_COLORS[r.type] }}>{r.type}</span></td>
            <td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>{r.count}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

function ApWidget() {
  const { currentEntity } = useApp()
  const [invoices, setInvoices] = useState<ApInvoice[]>([])
  useEffect(() => {
    if (!currentEntity) return
    fetch(`/api/ap?entityId=${currentEntity.id}`).then(r => r.json()).then(d => setInvoices(d.invoices?.slice(0,5) ?? []))
  }, [currentEntity])
  return (
    <div style={S.card}>
      <div style={S.cardHeader}>AP — recent invoices</div>
      <table style={S.table}>
        <thead><tr>{['Vendor','Amount','Due','Status'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
        <tbody>{invoices.map(inv => (
          <tr key={inv.id}>
            <td style={S.td}>{inv.vendor}</td>
            <td style={{ ...S.td, textAlign: 'right' }}>${fmt(inv.amount)}</td>
            <td style={S.td}>{fmtDate(inv.dueDate)}</td>
            <td style={S.td}><StatusBadge status={inv.status} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

// ─── Chart of Accounts ────────────────────────────────────────────────────────
function AccountsPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { currentEntity, role } = useApp()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [filter, setFilter] = useState('ALL')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const blankForm = { code: '', name: '', type: 'EXPENSE', subType: '', description: '', parentId: '', isBankAccount: false }
  const [form, setForm] = useState(blankForm)

  const load = useCallback(() => {
    if (!currentEntity) return
    fetch(`/api/accounts?entityId=${currentEntity.id}`).then(r => r.json()).then(setAccounts)
  }, [currentEntity])

  useEffect(() => { load() }, [load])

  const startEdit = (a: Account) => {
    setEditingId(a.id)
    setForm({
      code: a.code, name: a.name, type: a.type,
      subType: a.subType ?? '', description: a.description ?? '',
      parentId: a.parentId ?? '', isBankAccount: !!a.isBankAccount,
    })
    setShowForm(true)
  }

  const cancel = () => { setShowForm(false); setEditingId(null); setForm(blankForm) }

  const save = async () => {
    if (!currentEntity) return
    if (!form.code || !form.name) return showToast('Code and name are required', 'err')
    const isEdit = !!editingId
    const url = '/api/accounts'
    const method = isEdit ? 'PATCH' : 'POST'
    const body = isEdit
      ? { entityId: currentEntity.id, id: editingId, ...form, parentId: form.parentId || null, subType: form.subType || null, description: form.description || null }
      : { entityId: currentEntity.id, ...form, parentId: form.parentId || undefined }
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (res.ok) {
      showToast(isEdit ? 'Account updated' : 'Account created')
      cancel()
      load()
    } else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  const del = async (a: Account) => {
    if (!currentEntity) return
    const used = a.usageCount ?? 0
    const msg = used > 0
      ? `"${a.code} ${a.name}" is used in ${used} journal line(s). Deleting will mark it inactive (historical data preserved). Continue?`
      : `Delete "${a.code} ${a.name}"? This is permanent (account is unused).`
    if (!confirm(msg)) return
    const res = await fetch(`/api/accounts?entityId=${currentEntity.id}&id=${a.id}`, { method: 'DELETE' })
    if (res.ok) { showToast('Done'); load() }
    else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  // Build the indented hierarchy view. Parents first; their children indented underneath.
  // We work on `filtered` so the type filter still applies, but if a parent doesn't match
  // the filter, its children are promoted to top-level so they're still visible.
  const filtered = filter === 'ALL' ? accounts : accounts.filter(a => a.type === filter)
  const filteredIds = new Set(filtered.map(a => a.id))
  type Node = Account & { depth: number }
  const buildTree = (): Node[] => {
    const childrenOf = new Map<string | null, Account[]>()
    for (const a of filtered) {
      const key = a.parentId && filteredIds.has(a.parentId) ? a.parentId : null
      const arr = childrenOf.get(key) ?? []
      arr.push(a)
      childrenOf.set(key, arr)
    }
    // Sort each bucket by code.
    for (const list of childrenOf.values()) list.sort((a, b) => a.code.localeCompare(b.code))
    const out: Node[] = []
    const visit = (parentId: string | null, depth: number) => {
      const kids = childrenOf.get(parentId) ?? []
      for (const k of kids) {
        out.push({ ...k, depth })
        visit(k.id, depth + 1)
      }
    }
    visit(null, 0)
    return out
  }
  const tree = buildTree()

  const canWrite = ['OWNER','ADMIN','ACCOUNTANT'].includes(role)
  // Valid parent options: same-type accounts, excluding self and own descendants.
  const descendantIdsOf = (id: string): Set<string> => {
    const out = new Set<string>()
    const queue: string[] = [id]
    while (queue.length) {
      const cur = queue.shift()!
      for (const a of accounts) {
        if (a.parentId === cur && !out.has(a.id)) {
          out.add(a.id); queue.push(a.id)
        }
      }
    }
    return out
  }
  const parentOptions = accounts.filter(a => {
    if (a.type !== form.type) return false             // parent must be same type
    if (editingId && a.id === editingId) return false
    if (editingId) {
      const desc = descendantIdsOf(editingId)
      if (desc.has(a.id)) return false
    }
    return true
  })

  // For edit lock messages.
  const editing = editingId ? accounts.find(a => a.id === editingId) : null
  const editingInUse = (editing?.usageCount ?? 0) > 0

  return (
    <div>
      <div style={S.pageActions}>
        <div style={{ display: 'flex', gap: 6 }}>
          {['ALL','ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','COGS'].map(t => (
            <button key={t} style={{ ...S.filterBtn, ...(filter === t ? S.filterBtnActive : {}) }} onClick={() => setFilter(t)}>{t}</button>
          ))}
        </div>
        {canWrite && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={S.btn} onClick={() => setShowImport(true)}>↥ Import COA</button>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => { cancel(); setShowForm(true) }}>+ Add account</button>
          </div>
        )}
      </div>

      {showForm && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={S.cardHeader}>
            {editingId ? `Edit account: ${editing?.code} — ${editing?.name}` : 'New account'}
            {editingInUse && <span style={{ marginLeft: 12, fontSize: 11, fontWeight: 600, color: '#92400e', background: '#fef3c7', padding: '2px 8px', borderRadius: 4 }}>In use — code & type locked</span>}
          </div>
          <div style={S.formGrid}>
            <div>
              <label style={S.label}>Account code</label>
              <input
                style={{ ...S.input, ...(editingInUse ? { background: '#f8fafc', color: '#64748b' } : {}) }}
                value={form.code} disabled={editingInUse}
                onChange={e => setForm(f => ({...f,code:e.target.value}))}
                placeholder="1000"
              />
            </div>
            <div>
              <label style={S.label}>Account name</label>
              <input style={S.input} value={form.name} onChange={e => setForm(f => ({...f,name:e.target.value}))} placeholder="Cash & Equivalents" />
            </div>
            <div>
              <label style={S.label}>Type</label>
              <select
                style={{ ...S.select, ...(editingInUse ? { background: '#f8fafc', color: '#64748b' } : {}) }}
                value={form.type} disabled={editingInUse}
                onChange={e => setForm(f => ({...f, type: e.target.value, parentId: ''}))}
              >
                {['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','COGS'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>Sub-type</label>
              <input style={S.input} value={form.subType} onChange={e => setForm(f => ({...f,subType:e.target.value}))} placeholder="e.g. Current Asset, Bank, Long-Term Debt" />
            </div>
            <div>
              <label style={S.label}>Parent account (for ledger / subledger hierarchy)</label>
              <select style={S.select} value={form.parentId} onChange={e => setForm(f => ({...f,parentId:e.target.value}))}>
                <option value="">— (top-level)</option>
                {parentOptions.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569', paddingBottom: 8 }}>
                <input type="checkbox" checked={form.isBankAccount} onChange={e => setForm(f => ({...f, isBankAccount: e.target.checked}))} />
                <span><strong>Is bank account</strong> — makes this account selectable in Bank Reconciliation</span>
              </label>
            </div>
          </div>
          <input style={{ ...S.input, marginBottom: 12 }} value={form.description} onChange={e => setForm(f => ({...f,description:e.target.value}))} placeholder="Description (optional)" />
          <div style={{ display:'flex',gap:8 }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={save}>{editingId ? 'Save changes' : 'Save account'}</button>
            <button style={S.btn} onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}

      <div style={S.card}>
        <table style={S.table}>
          <thead><tr>{['Code','Account name','Type','Sub-type','Bank?','Usage',''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>{tree.map(a => (
            <tr key={a.id}>
              <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12, paddingLeft: 8 + a.depth * 24 }}>
                {a.depth > 0 && <span style={{ color: '#cbd5e1', marginRight: 6 }}>↳</span>}
                {a.code}
              </td>
              <td style={{ ...S.td, fontWeight: a.depth === 0 ? 600 : 400 }}>{a.name}</td>
              <td style={S.td}><span style={{ ...S.typeBadge, background: TYPE_COLORS[a.type] + '18', color: TYPE_COLORS[a.type] }}>{a.type}</span></td>
              <td style={{ ...S.td, fontSize: 12, color: '#64748b' }}>{a.subType ?? '—'}</td>
              <td style={S.td}>{a.isBankAccount ? <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>BANK</span> : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
              <td style={{ ...S.td, fontSize: 12, color: '#64748b', textAlign: 'right' }}>{a.usageCount ?? 0}</td>
              <td style={{ ...S.td, textAlign: 'right' }}>
                {canWrite && <>
                  <button style={S.textBtn} onClick={() => startEdit(a)}>Edit</button>
                  <span style={{ color: '#cbd5e1', margin: '0 8px' }}>·</span>
                  <button style={{ ...S.textBtn, color: '#dc2626' }} onClick={() => del(a)}>Delete</button>
                </>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      {showImport && (
        <ImportCoaModal
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); load() }}
          showToast={showToast}
        />
      )}
    </div>
  )
}

// ─── COA Import Modal ─────────────────────────────────────────────────────────
interface PreviewRow {
  row: {
    code: string; name: string; type: string; subType?: string
    description?: string; parentCode?: string; parentName?: string
    isBankAccount?: boolean; warnings: string[]
  }
  action: 'create' | 'update' | 'conflict' | 'skip'
  reason?: string
}
interface Preview {
  format: 'csv' | 'iif'
  rows: PreviewRow[]
  parseErrors: { line?: number; message: string }[]
  summary: { total: number; create: number; update: number; conflict: number; skip: number }
}

function ImportCoaModal({ onClose, onImported, showToast }: {
  onClose: () => void; onImported: () => void; showToast: (m: string, t?: 'ok'|'err') => void
}) {
  const { currentEntity } = useApp()
  const [content, setContent] = useState('')
  const [filename, setFilename] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [overwriteOnConflict, setOverwriteOnConflict] = useState(false)
  const [commitResult, setCommitResult] = useState<{ created: number; updated: number; skipped: number; parentLinks: number; errors: { code: string; message: string }[] } | null>(null)

  const handleFile = (file: File) => {
    setFilename(file.name)
    const reader = new FileReader()
    reader.onload = (e) => setContent((e.target?.result as string) ?? '')
    reader.readAsText(file)
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }

  const runPreview = async () => {
    if (!currentEntity || !content) return showToast('Paste or upload a file first', 'err')
    setBusy(true)
    try {
      const res = await fetch('/api/accounts/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'preview', entityId: currentEntity.id, filename: filename || 'import.csv', content }),
      })
      const data = await res.json()
      if (!res.ok) return showToast(data.error ?? 'Preview failed', 'err')
      setPreview(data)
    } finally { setBusy(false) }
  }

  const runCommit = async () => {
    if (!currentEntity || !preview) return
    setBusy(true)
    try {
      const res = await fetch('/api/accounts/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'commit', entityId: currentEntity.id, filename, content, overwriteOnConflict }),
      })
      const data = await res.json()
      if (!res.ok) return showToast(data.error ?? 'Import failed', 'err')
      setCommitResult(data)
      showToast(`Imported ${data.created} new, ${data.updated} updated`)
    } finally { setBusy(false) }
  }

  // Template content as a CSV string — embedded directly in the anchor's
  // data URI so the browser handles the download natively. No JS function
  // call, no auth, no pop-up blocker, no Blob API.
  const csvTemplate = [
    'Code,Name,Type,SubType,Description,Parent Code',
    '1000,Cash - Operating,ASSET,Bank,Primary checking account,',
    '1010,Cash - Petty,ASSET,Bank,Petty cash on hand,',
    '1100,Accounts Receivable,ASSET,Accounts Receivable,Customer balances,',
    '1500,Fixed Assets,ASSET,Fixed Asset,Equipment and machinery,',
    '1510,Accumulated Depreciation,ASSET,Fixed Asset,Contra-asset; credit-balance,1500',
    '2000,Accounts Payable,LIABILITY,Accounts Payable,Vendor balances,',
    "3000,Owner's Equity,EQUITY,,Equity capital,",
    '4000,Sales Revenue,REVENUE,Income,Revenue from sales,',
    '5000,Cost of Goods Sold,COGS,,Direct cost of products sold,',
    '6000,Operating Expenses,EXPENSE,,General operating expenses,',
    '6100,Rent Expense,EXPENSE,,Office rent,6000',
    '6200,Depreciation Expense,EXPENSE,,Depreciation for the period,6000',
    '',
  ].join('\n')
  const csvDataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvTemplate)

  return (
    <ModalOverlay onClose={onClose}>
      <div style={S.cardHeader}>Import Chart of Accounts</div>

      {/* Stage 1: file input */}
      {!preview && !commitResult && (
        <div>
          <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, marginBottom: 14 }}>
            Two formats accepted:
            <ul style={{ marginTop: 6, marginBottom: 0, paddingLeft: 20 }}>
              <li><strong>LedgerPro CSV template</strong> — columns: Code, Name, Type, SubType, Description, Parent Code. <a href={csvDataUri} download="ledgerpro-coa-template.csv" style={{ color: '#2563eb', textDecoration: 'underline', cursor: 'pointer' }}>Download template</a></li>
              <li><strong>QuickBooks IIF</strong> — exported from QuickBooks Desktop ("File → Utilities → Export → Lists to IIF Files → Chart of Accounts"). QB account types (BANK, AR, AP, INC, etc.) are mapped automatically.</li>
            </ul>
          </div>

          <div
            onDragOver={e => e.preventDefault()}
            onDrop={onDrop}
            style={{ border: '2px dashed #cbd5e1', borderRadius: 8, padding: 28, textAlign: 'center', background: '#f8fafc', marginBottom: 14 }}
          >
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 10 }}>Drag & drop a .csv or .iif file here, or</div>
            <label style={{ ...S.btn, display: 'inline-block', cursor: 'pointer' }}>
              Choose file
              <input
                type="file"
                accept=".csv,.iif,.txt"
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
              />
            </label>
            {filename && <div style={{ fontSize: 12, color: '#0891b2', marginTop: 10 }}>Selected: <strong>{filename}</strong> ({content.length.toLocaleString()} chars)</div>}
          </div>

          <details style={{ marginBottom: 14 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, color: '#64748b' }}>Or paste the file content here</summary>
            <textarea
              value={content}
              onChange={e => { setContent(e.target.value); if (!filename) setFilename('paste.csv') }}
              placeholder="Paste CSV or IIF content..."
              style={{ width: '100%', minHeight: 140, fontFamily: 'monospace', fontSize: 11, padding: 10, border: '1px solid #e2e8f0', borderRadius: 6, marginTop: 8 }}
            />
          </details>

          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} disabled={!content || busy} onClick={runPreview}>{busy ? 'Analyzing…' : 'Preview import'}</button>
            <button style={S.btn} onClick={onClose}>Cancel</button>
          </div>
        </div>
      )}

      {/* Stage 2: preview */}
      {preview && !commitResult && (
        <div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 13 }}>
            <span style={{ color: '#64748b' }}>Format: <strong>{preview.format.toUpperCase()}</strong></span>
            <span style={{ color: '#16a34a' }}><strong>{preview.summary.create}</strong> new</span>
            <span style={{ color: '#1d4ed8' }}><strong>{preview.summary.update}</strong> update</span>
            <span style={{ color: '#dc2626' }}><strong>{preview.summary.conflict}</strong> conflict</span>
            {preview.summary.skip > 0 && <span style={{ color: '#94a3b8' }}><strong>{preview.summary.skip}</strong> skip</span>}
          </div>

          {preview.parseErrors.length > 0 && (
            <div style={{ marginBottom: 12, padding: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12 }}>
              <strong style={{ color: '#991b1b' }}>{preview.parseErrors.length} parse warning{preview.parseErrors.length === 1 ? '' : 's'}:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 20, color: '#991b1b' }}>
                {preview.parseErrors.slice(0, 5).map((e, i) => <li key={i}>{e.line ? `Line ${e.line}: ` : ''}{e.message}</li>)}
                {preview.parseErrors.length > 5 && <li>…and {preview.parseErrors.length - 5} more</li>}
              </ul>
            </div>
          )}

          <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: 14 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {['', 'Code', 'Name', 'Type', 'Sub-type', 'Parent', 'Notes'].map(h => (
                    <th key={h} style={{ background: '#f8fafc', padding: '6px 8px', textAlign: 'left', fontWeight: 600, fontSize: 11, color: '#475569', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => {
                  const tone =
                    r.action === 'create' ? { bg: '#f0fdf4', fg: '#166534' } :
                    r.action === 'update' ? { bg: '#eff6ff', fg: '#1d4ed8' } :
                    r.action === 'conflict' ? { bg: '#fef2f2', fg: '#991b1b' } :
                    { bg: '#f1f5f9', fg: '#64748b' }
                  return (
                    <tr key={i}>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9' }}>
                        <span style={{ background: tone.bg, color: tone.fg, padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600 }}>{r.action}</span>
                      </td>
                      <td style={{ padding: '4px 8px', fontFamily: 'monospace', borderBottom: '1px solid #f1f5f9' }}>{r.row.code}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9' }}>{r.row.name}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9' }}>{r.row.type}</td>
                      <td style={{ padding: '4px 8px', color: '#64748b', borderBottom: '1px solid #f1f5f9' }}>{r.row.subType ?? '—'}</td>
                      <td style={{ padding: '4px 8px', color: '#64748b', borderBottom: '1px solid #f1f5f9' }}>{r.row.parentCode ?? r.row.parentName ?? '—'}</td>
                      <td style={{ padding: '4px 8px', color: tone.fg, borderBottom: '1px solid #f1f5f9', fontSize: 11 }}>
                        {r.reason ?? r.row.warnings.join('; ')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {preview.summary.conflict > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13, color: '#475569' }}>
              <input type="checkbox" checked={overwriteOnConflict} onChange={e => setOverwriteOnConflict(e.target.checked)} />
              <span>Overwrite name-conflict rows (reassigns the existing account to the import's code). <strong>Use carefully</strong> — type conflicts are never overwritten.</span>
            </label>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              style={{ ...S.btn, ...S.btnPrimary, opacity: (preview.summary.create + preview.summary.update + (overwriteOnConflict ? preview.summary.conflict : 0)) === 0 ? 0.5 : 1 }}
              disabled={busy || (preview.summary.create + preview.summary.update + (overwriteOnConflict ? preview.summary.conflict : 0)) === 0}
              onClick={runCommit}
            >
              {busy ? 'Importing…' : `Import ${preview.summary.create + preview.summary.update + (overwriteOnConflict ? preview.summary.conflict : 0)} account${preview.summary.create + preview.summary.update === 1 ? '' : 's'}`}
            </button>
            <button style={S.btn} onClick={() => setPreview(null)}>Back</button>
          </div>
        </div>
      )}

      {/* Stage 3: result */}
      {commitResult && (
        <div>
          <div style={{ padding: 14, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, marginBottom: 14 }}>
            <div style={{ fontWeight: 600, color: '#166534', marginBottom: 6 }}>✓ Import complete</div>
            <div style={{ fontSize: 13, color: '#166534', lineHeight: 1.6 }}>
              Created: <strong>{commitResult.created}</strong> • Updated: <strong>{commitResult.updated}</strong>
              {commitResult.skipped > 0 && <> • Skipped: <strong>{commitResult.skipped}</strong></>}
              {commitResult.parentLinks > 0 && <> • Parent links resolved: <strong>{commitResult.parentLinks}</strong></>}
            </div>
          </div>
          {commitResult.errors.length > 0 && (
            <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, marginBottom: 14 }}>
              <strong style={{ color: '#991b1b' }}>{commitResult.errors.length} error{commitResult.errors.length === 1 ? '' : 's'}:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 20, color: '#991b1b' }}>
                {commitResult.errors.slice(0, 10).map((e, i) => <li key={i}>{e.code}: {e.message}</li>)}
                {commitResult.errors.length > 10 && <li>…and {commitResult.errors.length - 10} more</li>}
              </ul>
            </div>
          )}
          <button style={{ ...S.btn, ...S.btnPrimary }} onClick={onImported}>Done</button>
        </div>
      )}
    </ModalOverlay>
  )
}

// ─── Journal Entries ──────────────────────────────────────────────────────────
function JournalsPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { currentEntity, role } = useApp()
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [misConfig, setMisConfig] = useState<MisConfig | null>(null)
  const [misCodes, setMisCodes] = useState<MisCodeRow[]>([])
  const [showForm, setShowForm] = useState(false)
  const [lines, setLines] = useState([
    { accountId: '', debit: '', credit: '', description: '', misCodeId: '' },
    { accountId: '', debit: '', credit: '', description: '', misCodeId: '' },
  ])
  const [hdr, setHdr] = useState({ date: new Date().toISOString().split('T')[0], description: '', memo: '' })
  const canWrite = ['OWNER','ADMIN','ACCOUNTANT'].includes(role)

  const load = useCallback(() => {
    if (!currentEntity) return
    fetch(`/api/journals?entityId=${currentEntity.id}&limit=20`).then(r => r.json()).then(d => setEntries(d.entries ?? []))
    fetch(`/api/accounts?entityId=${currentEntity.id}`).then(r => r.json()).then(setAccounts)
    fetch(`/api/mis-config?entityId=${currentEntity.id}`).then(r => r.json()).then(setMisConfig)
    fetch(`/api/mis-codes?entityId=${currentEntity.id}`).then(r => r.json()).then(d => setMisCodes(d.codes ?? []))
  }, [currentEntity])

  useEffect(() => { load() }, [load])

  const totalDebit  = lines.reduce((s,l) => s + (parseFloat(l.debit)  || 0), 0)
  const totalCredit = lines.reduce((s,l) => s + (parseFloat(l.credit) || 0), 0)
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005

  // MIS validation preview — mirrors src/lib/mis/policy.ts validateLines.
  const misIssues = (() => {
    if (!misConfig?.enabled) return [] as { lineIdx: number; type: 'error'|'warning'; msg: string }[]
    const required = new Set(misConfig.requiredForTypes)
    if (required.size === 0) return []
    const out: { lineIdx: number; type: 'error'|'warning'; msg: string }[] = []
    lines.forEach((l, i) => {
      if (!l.accountId) return
      const acct = accounts.find(a => a.id === l.accountId)
      if (!acct || !required.has(acct.type as AccountTypeT)) return
      if (l.misCodeId && l.misCodeId.trim()) return
      out.push({
        lineIdx: i,
        type: misConfig.allowOverride ? 'warning' : 'error',
        msg: `Line ${i + 1} (${acct.type}) ${misConfig.allowOverride ? 'recommended' : 'requires'} an MIS code`,
      })
    })
    return out
  })()
  const misBlocks = misIssues.some(x => x.type === 'error')

  const save = async (status: 'DRAFT'|'POST') => {
    if (!currentEntity) return
    if (status === 'POST' && misBlocks) return showToast('MIS code required on flagged lines', 'err')
    const res = await fetch('/api/journals', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityId: currentEntity.id, ...hdr,
        lines: lines.filter(l => l.accountId).map((l,i) => ({
          accountId: l.accountId, description: l.description,
          debit: parseFloat(l.debit)||0, credit: parseFloat(l.credit)||0, lineOrder: i,
          misCodeId: l.misCodeId || undefined,
        })),
      }),
    })
    if (res.ok) {
      showToast('Journal entry saved')
      setShowForm(false)
      setLines([
        { accountId:'',debit:'',credit:'',description:'',misCodeId:'' },
        { accountId:'',debit:'',credit:'',description:'',misCodeId:'' },
      ])
      setHdr({ date: new Date().toISOString().split('T')[0], description:'', memo:'' })
      load()
    } else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  const showMisCol = misConfig?.enabled === true
  const activeCodes = misCodes.filter(c => c.isActive)

  return (
    <div>
      <div style={S.pageActions}>
        <span style={{ fontSize: 13, color: '#64748b' }}>{entries.length} entries shown
          {showMisCol && <span style={{ marginLeft: 12, padding: '2px 8px', background: '#eff6ff', color: '#1d4ed8', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>MIS active{misConfig?.allowOverride ? ' · lenient' : ' · strict'}</span>}
        </span>
        {canWrite && <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setShowForm(o => !o)}>+ New entry</button>}
      </div>

      {showForm && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={S.cardHeader}>New journal entry</div>
          <div style={S.formGrid}>
            <div><label style={S.label}>Date</label><input style={S.input} type="date" value={hdr.date} onChange={e => setHdr(h => ({...h,date:e.target.value}))} /></div>
            <div><label style={S.label}>Description</label><input style={S.input} value={hdr.description} onChange={e => setHdr(h => ({...h,description:e.target.value}))} placeholder="e.g. Monthly payroll" /></div>
          </div>
          <div style={{ overflowX: 'auto', marginBottom: 12 }}>
            <table style={{ ...S.table, minWidth: showMisCol ? 720 : 600 }}>
              <thead><tr>{(showMisCol ? ['Account','Description','Debit','Credit','MIS code',''] : ['Account','Description','Debit','Credit','']).map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {lines.map((l, i) => {
                  const issue = misIssues.find(x => x.lineIdx === i)
                  return (
                  <tr key={i}>
                    <td style={S.td}>
                      <select style={{ ...S.select, width: 180 }} value={l.accountId} onChange={e => setLines(ls => ls.map((x,j) => j===i?{...x,accountId:e.target.value}:x))}>
                        <option value="">Select account…</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                      </select>
                    </td>
                    <td style={S.td}><input style={{ ...S.input, marginBottom: 0, width: 120 }} value={l.description} placeholder="Memo" onChange={e => setLines(ls => ls.map((x,j) => j===i?{...x,description:e.target.value}:x))} /></td>
                    <td style={S.td}><input style={{ ...S.input, marginBottom: 0, width: 90, color: '#dc2626' }} value={l.debit} placeholder="0.00" onChange={e => setLines(ls => ls.map((x,j) => j===i?{...x,debit:e.target.value}:x))} /></td>
                    <td style={S.td}><input style={{ ...S.input, marginBottom: 0, width: 90, color: '#16a34a' }} value={l.credit} placeholder="0.00" onChange={e => setLines(ls => ls.map((x,j) => j===i?{...x,credit:e.target.value}:x))} /></td>
                    {showMisCol && (
                      <td style={S.td}>
                        <select
                          style={{
                            ...S.select, width: 160,
                            ...(issue ? { borderColor: issue.type === 'error' ? '#dc2626' : '#d97706' } : {}),
                          }}
                          value={l.misCodeId}
                          onChange={e => setLines(ls => ls.map((x,j) => j===i?{...x,misCodeId:e.target.value}:x))}
                        >
                          <option value="">— (none)</option>
                          {activeCodes.map(c => <option key={c.id} value={c.id}>{c.code} — {c.department}</option>)}
                        </select>
                      </td>
                    )}
                    <td style={S.td}><button style={{ ...S.btn, padding: '3px 8px', fontSize: 11 }} onClick={() => setLines(ls => ls.filter((_,j) => j!==i))}>✕</button></td>
                  </tr>
                )})}
                <tr>
                  <td style={{ ...S.td, fontWeight: 600 }}>Totals</td>
                  <td style={S.td}></td>
                  <td style={{ ...S.td, fontWeight: 700, color: '#dc2626' }}>${fmt(totalDebit)}</td>
                  <td style={{ ...S.td, fontWeight: 700, color: '#16a34a' }}>${fmt(totalCredit)}</td>
                  {showMisCol && <td style={S.td}></td>}
                  <td style={S.td}></td>
                </tr>
              </tbody>
            </table>
          </div>
          {!balanced && <div style={S.errMsg}>Entry is unbalanced — debits ${fmt(totalDebit)} ≠ credits ${fmt(totalCredit)}</div>}
          {misIssues.length > 0 && (
            <div style={{ padding: 10, marginBottom: 12, borderRadius: 6, background: misBlocks ? '#fef2f2' : '#fffbeb', border: `1px solid ${misBlocks ? '#fecaca' : '#fde68a'}`, fontSize: 12, color: misBlocks ? '#991b1b' : '#92400e' }}>
              {misBlocks ? '⚠ MIS required:' : 'ℹ MIS recommended:'}
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {misIssues.map((x, k) => <li key={k}>{x.msg}</li>)}
              </ul>
            </div>
          )}
          <div style={{ display:'flex', gap:8 }}>
            <button style={S.btn} onClick={() => setLines(ls => [...ls, { accountId:'',debit:'',credit:'',description:'',misCodeId:'' }])}>+ Add line</button>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => save('POST')} disabled={!balanced || lines.filter(l=>l.accountId).length < 2 || misBlocks}>Post entry</button>
            <button style={S.btn} onClick={() => save('DRAFT')}>Save draft</button>
            <button style={S.btn} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={S.card}>
        <table style={S.table}>
          <thead><tr>{['Ref','Date','Description','Status','Dr Total','Cr Total','Lines'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>{entries.map(e => {
            const dr = e.lines.reduce((s,l) => s + Number(l.debit),  0)
            const cr = e.lines.reduce((s,l) => s + Number(l.credit), 0)
            return (
              <tr key={e.id}>
                <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{e.ref}</td>
                <td style={S.td}>{fmtDate(e.date)}</td>
                <td style={{ ...S.td, maxWidth: 200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.description}</td>
                <td style={S.td}><StatusBadge status={e.status} /></td>
                <td style={{ ...S.td, textAlign:'right', color:'#dc2626', fontFamily:'monospace' }}>${fmt(dr)}</td>
                <td style={{ ...S.td, textAlign:'right', color:'#16a34a', fontFamily:'monospace' }}>${fmt(cr)}</td>
                <td style={{ ...S.td, textAlign:'center', color:'#64748b' }}>{e.lines.length}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
    </div>
  )
}

// ─── IIF Import/Export ────────────────────────────────────────────────────────
function IifPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { currentEntity } = useApp()
  const [exportType, setExportType] = useState('trns')
  const [preview, setPreview] = useState('')
  const [importText, setImportText] = useState('')
  const [importResult, setImportResult] = useState<Record<string,unknown>|null>(null)

  const IIF_SAMPLES: Record<string,string> = {
    trns: `!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO\n!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\n!ENDTRNS\nTRNS\t1\tINVOICE\t03/28/2024\tAccounts Receivable\tClient A\t31500.00\tQ1 Invoice\nSPL\t1\tINVOICE\t03/28/2024\tSales Revenue\tClient A\t-31500.00\nENDTRNS\nTRNS\t2\tCHECK\t03/31/2024\tSalaries & Wages\tPayroll March\t-18400.00\nSPL\t2\tCHECK\t03/31/2024\tCash & Equivalents\tPayroll March\t18400.00\nENDTRNS`,
    accnt: `!ACCNT\tNAME\tACCNTTYPE\tDESC\tACCNUM\n!ENDACCNT\nACCNT\tCash & Equivalents\tBank\tPrimary checking account\t1000\nENDACCNT\nACCNT\tAccounts Receivable\tAR\tCustomer receivables\t1100\nENDACCNT\nACCNT\tAccounts Payable\tAP\tVendor payables\t2000\nENDACCNT\nACCNT\tSales Revenue\tInc\tProduct & service revenue\t4000\nENDACCNT`,
    payroll: `!PAYROLL\tEMPLID\tLASTNAME\tFIRSTNAME\tWAGES\tFEDTAX\tSSTAX\tMEDTAX\tSTATETAX\n!ENDPAYROLL\nPAYROLL\tEMP001\tSmith\tJohn\t5000.00\t750.00\t310.00\t72.50\t280.00\nENDPAYROLL\nPAYROLL\tEMP002\tJones\tAmy\t4200.00\t630.00\t260.40\t60.90\t235.00\nENDPAYROLL`,
  }

  useEffect(() => { setPreview(IIF_SAMPLES[exportType]) }, [exportType])

  const handleImport = async () => {
    if (!currentEntity || !importText) return
    const res = await fetch('/api/iif', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId: currentEntity.id, content: importText, dryRun: true }),
    })
    const d = await res.json()
    if (res.ok) setImportResult(d)
    else showToast(d.error ?? 'Import failed', 'err')
  }

  const handleExport = async () => {
    if (!currentEntity) return
    const url = `/api/iif?entityId=${currentEntity.id}&type=${exportType}`
    const res = await fetch(url)
    const text = await res.text()
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `export-${exportType}-${Date.now()}.iif`
    a.click()
    showToast('IIF file downloaded')
  }

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
      <div style={S.card}>
        <div style={S.cardHeader}>Import QB IIF file</div>
        <label style={S.label}>Paste IIF content</label>
        <textarea style={{ ...S.input, fontFamily:'monospace', fontSize:11, height:160, resize:'vertical', marginBottom:12 }}
          value={importText} onChange={e => setImportText(e.target.value)} placeholder="Paste .IIF file content here…" />
        <div style={{ display:'flex', gap:8, marginBottom:16 }}>
          <button style={{ ...S.btn, ...S.btnPrimary }} onClick={handleImport}>Preview import</button>
          <button style={S.btn} onClick={() => setImportText(IIF_SAMPLES.trns)}>Load sample</button>
        </div>
        {importResult && (
          <div style={{ padding:12, background:'#f0fdf4', borderRadius:8, border:'1px solid #bbf7d0', fontSize:12 }}>
            <div style={{ fontWeight:600, color:'#166534', marginBottom:6 }}>Import preview</div>
            <div>Transactions: <b>{(importResult.parsed as {transactions?:unknown[]})?.transactions?.length ?? 0}</b></div>
            <div>Accounts: <b>{(importResult.parsed as {accounts?:unknown[]})?.accounts?.length ?? 0}</b></div>
            <div>Payroll rows: <b>{(importResult.parsed as {payroll?:unknown[]})?.payroll?.length ?? 0}</b></div>
            <div>Errors: <b style={{color:'#dc2626'}}>{(importResult.parsed as {errors?:unknown[]})?.errors?.length ?? 0}</b></div>
            <button style={{ ...S.btn, ...S.btnPrimary, marginTop:10 }} onClick={async () => {
              if (!currentEntity) return
              const res = await fetch('/api/iif', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entityId: currentEntity.id, content: importText, dryRun: false }),
              })
              if (res.ok) { showToast('IIF imported successfully'); setImportResult(null); setImportText('') }
              else showToast('Import failed', 'err')
            }}>Confirm import</button>
          </div>
        )}
      </div>

      <div style={S.card}>
        <div style={S.cardHeader}>Export to QB IIF</div>
        <label style={S.label}>Export type</label>
        <select style={S.select} value={exportType} onChange={e => setExportType(e.target.value)}>
          <option value="trns">Transactions (TRNS)</option>
          <option value="accnt">Chart of Accounts (ACCNT)</option>
          <option value="payroll">Payroll (PAYROLL)</option>
        </select>
        <label style={{ ...S.label, marginTop:12 }}>IIF preview</label>
        <pre style={{ background:'#0f172a', color:'#a5f3fc', borderRadius:8, padding:14, fontSize:11, overflowX:'auto', maxHeight:200, margin:'0 0 12px' }}>{preview}</pre>
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={handleExport}>Download .IIF file</button>
      </div>
    </div>
  )
}

// ─── Budget & MIS ─────────────────────────────────────────────────────────────
function BudgetPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { currentEntity } = useApp()
  const [data, setData] = useState<{
    mis?: { totalRevenueActual:number; totalRevenueBudget:number; totalExpenseActual:number; totalExpenseBudget:number }
    report?: Array<{ account:{code:string;name:string;type:string}; budgetTotal:number; actualAmount:number; variance:number; pctUsed:number|null; status:string }>
  }>({})
  const [tab, setTab] = useState<'mis'|'budget'|'pl'>('mis')
  const [year, setYear] = useState(2024)

  useEffect(() => {
    if (!currentEntity) return
    fetch(`/api/budget?entityId=${currentEntity.id}&fiscalYear=${year}`).then(r => r.json()).then(setData)
  }, [currentEntity, year])

  const r = data.report ?? []
  const revenues = r.filter(x => x.account.type === 'REVENUE')
  const expenses = r.filter(x => ['EXPENSE','COGS'].includes(x.account.type))
  const mis = data.mis

  return (
    <div>
      <div style={S.pageActions}>
        <div style={{ display:'flex', gap:6 }}>
          {(['mis','budget','pl'] as const).map(t => (
            <button key={t} style={{ ...S.filterBtn, ...(tab===t ? S.filterBtnActive : {}) }} onClick={() => setTab(t)}>
              {t === 'mis' ? 'MIS Dashboard' : t === 'budget' ? 'Budget vs Actual' : 'P&L Statement'}
            </button>
          ))}
        </div>
        <select style={{ ...S.select, width:100 }} value={year} onChange={e => setYear(+e.target.value)}>
          {[2022,2023,2024,2025].map(y => <option key={y}>{y}</option>)}
        </select>
      </div>

      {tab === 'mis' && mis && (
        <>
          <div style={S.kpiGrid}>
            {[
              { label:'Revenue (actual)', value:`$${fmt(mis.totalRevenueActual)}`, sub:`Budget: $${fmt(mis.totalRevenueBudget)}`, color:'#16a34a' },
              { label:'Expenses (actual)', value:`$${fmt(mis.totalExpenseActual)}`, sub:`Budget: $${fmt(mis.totalExpenseBudget)}`, color:'#dc2626' },
              { label:'Net income',  value:`$${fmt(mis.totalRevenueActual - mis.totalExpenseActual)}`, sub:'Revenue minus expenses', color:'#7c3aed' },
              { label:'Net margin',  value:`${mis.totalRevenueActual > 0 ? fmt((mis.totalRevenueActual-mis.totalExpenseActual)/mis.totalRevenueActual*100,1) : '0.0'}%`, sub:'of revenue', color:'#0891b2' },
            ].map(k => <div key={k.label} style={S.kpiCard}><div style={{fontSize:11,color:'#94a3b8',marginBottom:4}}>{k.label}</div><div style={{fontSize:22,fontWeight:700,color:k.color}}>{k.value}</div><div style={{fontSize:11,color:'#64748b',marginTop:3}}>{k.sub}</div></div>)}
          </div>
          <div style={S.card}>
            <table style={S.table}>
              <thead><tr>{['Account','Actual','Budget','Variance','% Used','Status'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>{r.filter(x => x.budgetTotal !== 0 || x.actualAmount !== 0).map(x => (
                <tr key={x.account.code}>
                  <td style={S.td}><span style={{color:'#64748b',fontSize:11,marginRight:6}}>{x.account.code}</span>{x.account.name}</td>
                  <td style={{...S.td,textAlign:'right',fontFamily:'monospace'}}>${fmt(x.actualAmount)}</td>
                  <td style={{...S.td,textAlign:'right',fontFamily:'monospace'}}>${fmt(x.budgetTotal)}</td>
                  <td style={{...S.td,textAlign:'right',fontFamily:'monospace',color:x.variance>=0?'#16a34a':'#dc2626'}}>{x.variance>=0?'+':''}${fmt(x.variance)}</td>
                  <td style={{...S.td,textAlign:'right'}}>{x.pctUsed != null ? `${fmt(x.pctUsed,0)}%` : '—'}</td>
                  <td style={S.td}><StatusBadge status={x.status}/></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'pl' && (
        <div style={{ maxWidth:520 }}>
          <div style={S.card}>
            <table style={S.table}>
              <thead><tr><th style={S.th}>Account</th><th style={{...S.th,textAlign:'right'}}>Amount</th></tr></thead>
              <tbody>
                <tr><td colSpan={2} style={{...S.td,fontWeight:700,background:'#f8fafc',color:'#475569'}}>REVENUE</td></tr>
                {revenues.map(x => <tr key={x.account.code}><td style={{...S.td,paddingLeft:24}}>{x.account.name}</td><td style={{...S.td,textAlign:'right',color:'#16a34a',fontFamily:'monospace'}}>${fmt(x.actualAmount)}</td></tr>)}
                <tr style={{borderTop:'2px solid #e2e8f0'}}><td style={{...S.td,fontWeight:700}}>Total revenue</td><td style={{...S.td,textAlign:'right',fontWeight:700,color:'#16a34a',fontFamily:'monospace'}}>${fmt(revenues.reduce((s,x)=>s+x.actualAmount,0))}</td></tr>
                <tr><td colSpan={2} style={{...S.td,fontWeight:700,background:'#f8fafc',color:'#475569',paddingTop:16}}>EXPENSES</td></tr>
                {expenses.map(x => <tr key={x.account.code}><td style={{...S.td,paddingLeft:24}}>{x.account.name}</td><td style={{...S.td,textAlign:'right',color:'#dc2626',fontFamily:'monospace'}}>${fmt(x.actualAmount)}</td></tr>)}
                <tr style={{borderTop:'2px solid #e2e8f0'}}><td style={{...S.td,fontWeight:700}}>Total expenses</td><td style={{...S.td,textAlign:'right',fontWeight:700,color:'#dc2626',fontFamily:'monospace'}}>${fmt(expenses.reduce((s,x)=>s+x.actualAmount,0))}</td></tr>
                <tr style={{borderTop:'3px double #334155'}}><td style={{...S.td,fontWeight:800,fontSize:14}}>Net income</td><td style={{...S.td,textAlign:'right',fontWeight:800,fontSize:15,fontFamily:'monospace',color:'#7c3aed'}}>${fmt(revenues.reduce((s,x)=>s+x.actualAmount,0) - expenses.reduce((s,x)=>s+x.actualAmount,0))}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'budget' && (
        <div style={S.card}>
          <table style={S.table}>
            <thead><tr>{['Account','Budget','Actual','Variance','% Used','Status'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>{r.map(x=>(
              <tr key={x.account.code}>
                <td style={S.td}><span style={{color:'#64748b',fontSize:11,marginRight:6}}>{x.account.code}</span>{x.account.name}</td>
                <td style={{...S.td,textAlign:'right',fontFamily:'monospace'}}>${fmt(x.budgetTotal)}</td>
                <td style={{...S.td,textAlign:'right',fontFamily:'monospace'}}>${fmt(x.actualAmount)}</td>
                <td style={{...S.td,textAlign:'right',fontFamily:'monospace',color:x.variance>=0?'#16a34a':'#dc2626'}}>{x.variance>=0?'+':''}${fmt(x.variance)}</td>
                <td style={{...S.td,textAlign:'right'}}>{x.pctUsed!=null?`${fmt(x.pctUsed,0)}%`:'—'}</td>
                <td style={S.td}><StatusBadge status={x.status}/></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── AP Tracker ───────────────────────────────────────────────────────────────
function ApPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { currentEntity, role } = useApp()
  const [invoices, setInvoices] = useState<ApInvoice[]>([])
  const [summary, setSummary] = useState({ total:0, overdueCount:0, overdue30:0, overdue90plus:0 })
  const [accounts, setAccounts] = useState<Account[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ vendor:'', invoiceNo:'', invoiceDate:'', dueDate:'', amount:'', accountId:'', notes:'' })
  const canWrite = ['OWNER','ADMIN','ACCOUNTANT','AP_CLERK'].includes(role)

  const load = useCallback(() => {
    if (!currentEntity) return
    fetch(`/api/ap?entityId=${currentEntity.id}`).then(r => r.json()).then(d => {
      setInvoices(d.invoices ?? [])
      setSummary(d.summary ?? { total:0, overdueCount:0, overdue30:0, overdue90plus:0 })
    })
    fetch(`/api/accounts?entityId=${currentEntity.id}`).then(r => r.json()).then(setAccounts)
  }, [currentEntity])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!currentEntity) return
    const res = await fetch('/api/ap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId: currentEntity.id, ...form, amount: parseFloat(form.amount) }),
    })
    if (res.ok) { showToast('Invoice added'); setShowForm(false); setForm({ vendor:'',invoiceNo:'',invoiceDate:'',dueDate:'',amount:'',accountId:'',notes:'' }); load() }
    else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  const AGING_COLORS: Record<string,string> = {
    'Current': '#16a34a', '1-30 days': '#d97706', '31-60 days': '#ea580c', '61-90 days': '#dc2626', '90+ days': '#7f1d1d'
  }

  return (
    <div>
      <div style={S.kpiGrid}>
        {[
          { label:'Total outstanding', value:`$${fmt(summary.total)}`, color:'#0891b2' },
          { label:'Overdue invoices', value:summary.overdueCount, color:'#dc2626' },
          { label:'1-30 days overdue', value:`$${fmt(summary.overdue30)}`, color:'#d97706' },
          { label:'90+ days overdue', value:`$${fmt(summary.overdue90plus)}`, color:'#7f1d1d' },
        ].map(k => <div key={k.label} style={S.kpiCard}><div style={{fontSize:11,color:'#94a3b8',marginBottom:4}}>{k.label}</div><div style={{fontSize:22,fontWeight:700,color:k.color}}>{k.value}</div></div>)}
      </div>

      <div style={S.pageActions}>
        <span />
        {canWrite && <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setShowForm(o => !o)}>+ Add invoice</button>}
      </div>

      {showForm && (
        <div style={{ ...S.card, marginBottom:16 }}>
          <div style={S.cardHeader}>New AP invoice</div>
          <div style={S.formGrid}>
            <div><label style={S.label}>Vendor</label><input style={S.input} value={form.vendor} onChange={e => setForm(f=>({...f,vendor:e.target.value}))} placeholder="Vendor name" /></div>
            <div><label style={S.label}>Invoice #</label><input style={S.input} value={form.invoiceNo} onChange={e => setForm(f=>({...f,invoiceNo:e.target.value}))} placeholder="INV-001" /></div>
            <div><label style={S.label}>Invoice date</label><input style={S.input} type="date" value={form.invoiceDate} onChange={e => setForm(f=>({...f,invoiceDate:e.target.value}))} /></div>
            <div><label style={S.label}>Due date</label><input style={S.input} type="date" value={form.dueDate} onChange={e => setForm(f=>({...f,dueDate:e.target.value}))} /></div>
            <div><label style={S.label}>Amount</label><input style={S.input} value={form.amount} onChange={e => setForm(f=>({...f,amount:e.target.value}))} placeholder="0.00" /></div>
            <div><label style={S.label}>GL account</label>
              <select style={S.select} value={form.accountId} onChange={e => setForm(f=>({...f,accountId:e.target.value}))}>
                <option value="">Select account…</option>
                {accounts.filter(a => a.type==='EXPENSE'||a.type==='COGS').map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button style={{...S.btn,...S.btnPrimary}} onClick={save}>Add invoice</button>
            <button style={S.btn} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={S.card}>
        <table style={S.table}>
          <thead><tr>{['Vendor','Invoice #','Invoice date','Due date','Amount','Balance','Aging','Status',''].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>{invoices.map(inv => (
            <tr key={inv.id}>
              <td style={{...S.td,fontWeight:500}}>{inv.vendor}</td>
              <td style={{...S.td,fontFamily:'monospace',fontSize:11}}>{inv.invoiceNo}</td>
              <td style={S.td}>{fmtDate(inv.dueDate)}</td>
              <td style={S.td}>{fmtDate(inv.dueDate)}</td>
              <td style={{...S.td,textAlign:'right',fontFamily:'monospace'}}>${fmt(inv.amount)}</td>
              <td style={{...S.td,textAlign:'right',fontFamily:'monospace',fontWeight:600}}>${fmt(inv.balance)}</td>
              <td style={S.td}><span style={{color: AGING_COLORS[inv.agingBucket]??'#64748b',fontWeight:600,fontSize:11}}>{inv.agingBucket}</span></td>
              <td style={S.td}><StatusBadge status={inv.status} /></td>
              <td style={S.td}>{canWrite && <button style={{...S.btn,padding:'3px 10px',fontSize:11}}>Pay</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Payroll ──────────────────────────────────────────────────────────────────
function PayrollPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { currentEntity, role } = useApp()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ employeeNo:'', firstName:'', lastName:'', payType:'SALARY', salary:'', hourlyRate:'', filingStatus:'SINGLE', allowances:'1', state:'NY', retirement401k:'0', healthDeduction:'0', department:'', jobTitle:'' })
  const canWrite = ['OWNER','ADMIN','PAYROLL_CLERK'].includes(role)

  const load = useCallback(() => {
    if (!currentEntity) return
    fetch(`/api/payroll?entityId=${currentEntity.id}`).then(r => r.json()).then(setEmployees)
  }, [currentEntity])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!currentEntity) return
    const res = await fetch('/api/payroll', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityId: currentEntity.id, action: 'create_employee',
        employee: { ...form, salary: parseFloat(form.salary)||undefined, hourlyRate: parseFloat(form.hourlyRate)||undefined,
          allowances: parseInt(form.allowances), retirement401k: parseFloat(form.retirement401k),
          healthDeduction: parseFloat(form.healthDeduction), startDate: new Date().toISOString().split('T')[0] },
      }),
    })
    if (res.ok) { showToast('Employee saved'); setShowForm(false); load() }
    else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  return (
    <div>
      <div style={S.pageActions}>
        <span style={{fontSize:13,color:'#64748b'}}>{employees.length} active employees</span>
        {canWrite && <button style={{...S.btn,...S.btnPrimary}} onClick={() => setShowForm(o=>!o)}>+ Add employee</button>}
      </div>

      {showForm && (
        <div style={{...S.card,marginBottom:16}}>
          <div style={S.cardHeader}>New employee</div>
          <div style={S.formGrid}>
            <div><label style={S.label}>Employee #</label><input style={S.input} value={form.employeeNo} onChange={e=>setForm(f=>({...f,employeeNo:e.target.value}))} placeholder="EMP001" /></div>
            <div><label style={S.label}>First name</label><input style={S.input} value={form.firstName} onChange={e=>setForm(f=>({...f,firstName:e.target.value}))} /></div>
            <div><label style={S.label}>Last name</label><input style={S.input} value={form.lastName} onChange={e=>setForm(f=>({...f,lastName:e.target.value}))} /></div>
            <div><label style={S.label}>Pay type</label>
              <select style={S.select} value={form.payType} onChange={e=>setForm(f=>({...f,payType:e.target.value}))}>
                <option>SALARY</option><option>HOURLY</option><option>COMMISSION</option>
              </select>
            </div>
            <div><label style={S.label}>Annual salary / Hourly rate</label><input style={S.input} value={form.payType==='SALARY'?form.salary:form.hourlyRate} onChange={e=>setForm(f=>form.payType==='SALARY'?{...f,salary:e.target.value}:{...f,hourlyRate:e.target.value})} placeholder="60000" /></div>
            <div><label style={S.label}>Filing status</label>
              <select style={S.select} value={form.filingStatus} onChange={e=>setForm(f=>({...f,filingStatus:e.target.value}))}>
                <option>SINGLE</option><option>MARRIED</option><option>MFS</option><option>HH</option>
              </select>
            </div>
            <div><label style={S.label}>State</label>
              <select style={S.select} value={form.state} onChange={e=>setForm(f=>({...f,state:e.target.value}))}>
                {['NY','CA','TX','FL','IL','PA','OH','WA','NV'].map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <div><label style={S.label}>401(k) %</label><input style={S.input} value={form.retirement401k} onChange={e=>setForm(f=>({...f,retirement401k:e.target.value}))} placeholder="0.03" /></div>
            <div><label style={S.label}>Health deduction</label><input style={S.input} value={form.healthDeduction} onChange={e=>setForm(f=>({...f,healthDeduction:e.target.value}))} placeholder="150" /></div>
            <div><label style={S.label}>Department</label><input style={S.input} value={form.department} onChange={e=>setForm(f=>({...f,department:e.target.value}))} /></div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button style={{...S.btn,...S.btnPrimary}} onClick={save}>Save employee</button>
            <button style={S.btn} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={S.card}>
        <table style={S.table}>
          <thead><tr>{['Emp #','Name','Title','Dept','Pay type','Rate','State','Status'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>{employees.map(e => (
            <tr key={e.id}>
              <td style={{...S.td,fontFamily:'monospace',fontSize:11}}>{e.employeeNo}</td>
              <td style={{...S.td,fontWeight:500}}>{e.firstName} {e.lastName}</td>
              <td style={S.td}>{e.jobTitle ?? '—'}</td>
              <td style={S.td}>{e.department ?? '—'}</td>
              <td style={S.td}>{e.payType}</td>
              <td style={{...S.td,textAlign:'right',fontFamily:'monospace'}}>{e.payType==='SALARY'?`$${fmt(e.salary??0,0)}/yr`:`$${fmt(e.hourlyRate??0)}/hr`}</td>
              <td style={S.td}>{(e as unknown as {state:string}).state}</td>
              <td style={S.td}><span style={S.greenBadge}>Active</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}

// ─── W-2 / 1040-K ─────────────────────────────────────────────────────────────
function W2Page({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { currentEntity, role } = useApp()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [year, setYear] = useState(2023)
  const [w2s, setW2s] = useState<Record<string, unknown>[]>([])
  const [tab, setTab] = useState<'w2'|'k1'>('w2')

  useEffect(() => {
    if (!currentEntity) return
    fetch(`/api/payroll?entityId=${currentEntity.id}`).then(r=>r.json()).then(setEmployees)
  }, [currentEntity])

  const generateAll = async () => {
    if (!currentEntity) return
    const results = []
    for (const emp of employees) {
      const res = await fetch('/api/payroll', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ entityId: currentEntity.id, action:'generate_w2', employeeId:emp.id, taxYear:year }),
      })
      if (res.ok) results.push(await res.json())
    }
    setW2s(results)
    showToast(`Generated ${results.length} W-2 forms`)
  }

  return (
    <div>
      <div style={S.pageActions}>
        <div style={{display:'flex',gap:6}}>
          {(['w2','k1'] as const).map(t => <button key={t} style={{...S.filterBtn,...(tab===t?S.filterBtnActive:{})}} onClick={()=>setTab(t)}>{t==='w2'?'W-2 Forms':'Schedule K-1 / 1040'}</button>)}
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <select style={{...S.select,width:90}} value={year} onChange={e=>setYear(+e.target.value)}>
            {[2021,2022,2023,2024].map(y=><option key={y}>{y}</option>)}
          </select>
          <button style={{...S.btn,...S.btnPrimary}} onClick={generateAll}>Generate W-2s</button>
        </div>
      </div>

      {tab === 'w2' && (
        <>
          <div style={S.card}>
            <table style={S.table}>
              <thead><tr>{['Employee','Box 1 Wages','Box 2 Fed Tax','Box 3 SS Wages','Box 4 SS Tax','Box 5 Med Wages','Box 6 Med Tax','Status'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>{employees.map(emp => {
                const w2 = w2s.find((w: Record<string,unknown>) => w.employeeId === emp.id) as Record<string,number|string>|undefined
                return (
                  <tr key={emp.id}>
                    <td style={{...S.td,fontWeight:500}}>{emp.firstName} {emp.lastName}</td>
                    {['box1Wages','box2FedTax','box3SsWages','box4SsTax','box5MedWages','box6MedTax'].map(b => (
                      <td key={b} style={{...S.td,textAlign:'right',fontFamily:'monospace'}}>{w2?`$${fmt(w2[b] as number)}`:'—'}</td>
                    ))}
                    <td style={S.td}><StatusBadge status={w2?(w2.status as string):'PENDING'}/></td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
          {w2s.length > 0 && (
            <div style={{...S.card,marginTop:16,maxWidth:460}}>
              <div style={S.cardHeader}>W-2 preview — {employees[0]?.firstName} {employees[0]?.lastName}</div>
              {(() => {
                const w = w2s[0] as Record<string,number|string>|undefined
                if (!w) return null
                return (
                  <div style={{fontSize:12,lineHeight:1.8}}>
                    {[['Box 1','Wages','box1Wages'],['Box 2','Federal tax withheld','box2FedTax'],['Box 3','Social security wages','box3SsWages'],['Box 4','SS tax withheld','box4SsTax'],['Box 5','Medicare wages','box5MedWages'],['Box 6','Medicare tax withheld','box6MedTax']].map(([code,label,key]) => (
                      <div key={code} style={{display:'flex',justifyContent:'space-between',borderBottom:'1px solid #f1f5f9',padding:'4px 0'}}>
                        <span style={{color:'#64748b'}}><b>{code}</b> — {label}</span>
                        <span style={{fontFamily:'monospace',fontWeight:600}}>${fmt(w[key] as number)}</span>
                      </div>
                    ))}
                  </div>
                )
              })()}
              <div style={{display:'flex',gap:8,marginTop:12}}>
                <button style={{...S.btn,...S.btnPrimary}}>Export SSA format</button>
                <button style={S.btn}>Print copies A/B/C</button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'k1' && (
        <div style={S.card}>
          <div style={{color:'#64748b',fontSize:13,marginBottom:16}}>Schedule K-1 / 1040 partner income allocation for tax year {year}</div>
          <table style={S.table}>
            <thead><tr>{['Line','Item','Amount','Notes'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>{[
              ['1','Ordinary business income','—','From P&L net income'],
              ['5','Interest income','—','From bank accounts'],
              ['6','Dividend income','—','Investment accounts'],
              ['12','Section 179 deductions','—','Capital equipment'],
              ['13','Other deductions','—','Charitable contributions'],
            ].map(([line,item,amt,note]) => (
              <tr key={line}><td style={{...S.td,fontFamily:'monospace',fontWeight:600}}>{line}</td><td style={S.td}>{item}</td><td style={{...S.td,fontFamily:'monospace'}}>{amt}</td><td style={{...S.td,color:'#94a3b8',fontSize:11}}>{note}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── User Management ──────────────────────────────────────────────────────────
function UsersPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { currentEntity, role } = useApp()
  const [users, setUsers] = useState<EntityUser[]>([])
  const [showInvite, setShowInvite] = useState(false)
  const [form, setForm] = useState({ email:'', name:'', role:'ACCOUNTANT' })
  const canAdmin = ['OWNER','ADMIN'].includes(role)

  const load = useCallback(() => {
    if (!currentEntity) return
    fetch(`/api/users?entityId=${currentEntity.id}`).then(r=>r.json()).then(setUsers)
  }, [currentEntity])

  useEffect(() => { load() }, [load])

  const invite = async () => {
    if (!currentEntity) return
    const res = await fetch('/api/users', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ entityId: currentEntity.id, ...form }),
    })
    const d = await res.json()
    if (res.ok) {
      showToast(`User invited${d.isNew ? ` · temp password: ${d.tempPassword}` : ''}`)
      setShowInvite(false); setForm({ email:'', name:'', role:'ACCOUNTANT' }); load()
    } else showToast(d.error ?? 'Error', 'err')
  }

  const changeRole = async (userId: string, newRole: string) => {
    if (!currentEntity) return
    const res = await fetch('/api/users', {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ entityId: currentEntity.id, userId, role: newRole }),
    })
    if (res.ok) { showToast('Role updated'); load() }
    else showToast('Error updating role', 'err')
  }

  const removeUser = async (userId: string) => {
    if (!currentEntity || !confirm('Remove this user from the entity?')) return
    const res = await fetch(`/api/users?entityId=${currentEntity.id}&userId=${userId}`, { method: 'DELETE' })
    if (res.ok) { showToast('User removed'); load() }
    else showToast('Error removing user', 'err')
  }

  return (
    <div>
      <div style={S.pageActions}>
        <div>
          <div style={{fontSize:13,color:'#64748b'}}>{users.length} users with access to <b>{currentEntity?.name}</b></div>
          <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>Users can have different roles in different legal entities</div>
        </div>
        {canAdmin && <button style={{...S.btn,...S.btnPrimary}} onClick={() => setShowInvite(o=>!o)}>+ Invite user</button>}
      </div>

      {showInvite && (
        <div style={{...S.card,marginBottom:16}}>
          <div style={S.cardHeader}>Invite user to {currentEntity?.name}</div>
          <div style={S.formGrid}>
            <div><label style={S.label}>Full name</label><input style={S.input} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Jane Smith" /></div>
            <div><label style={S.label}>Email</label><input style={S.input} type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="jane@firm.com" /></div>
            <div>
              <label style={S.label}>Role</label>
              <select style={S.select} value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div style={{padding:'10px 14px',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:8,fontSize:12,marginBottom:12,color:'#92400e'}}>
            If this is a new user, a temporary password will be generated and shown after submission.
          </div>
          <div style={{display:'flex',gap:8}}>
            <button style={{...S.btn,...S.btnPrimary}} onClick={invite}>Send invitation</button>
            <button style={S.btn} onClick={() => setShowInvite(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{...S.card,marginBottom:16}}>
        <div style={{fontSize:12,color:'#64748b',marginBottom:12,fontWeight:500}}>Role permissions reference</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:8}}>
          {[
            { role:'OWNER', perms:'Full control, entity settings, delete' },
            { role:'ADMIN', perms:'All ops except delete entity' },
            { role:'ACCOUNTANT', perms:'Journals, accounts, AP, budget' },
            { role:'AUDITOR', perms:'Read-only all modules' },
            { role:'AP_CLERK', perms:'AP tracker only' },
            { role:'PAYROLL_CLERK', perms:'Payroll module only' },
            { role:'CLIENT_VIEW', perms:'Dashboard & reports only' },
          ].map(({ role: r, perms }) => (
            <div key={r} style={{padding:'8px 10px',borderRadius:8,border:`1px solid ${ROLE_COLORS[r]}40`,background:`${ROLE_COLORS[r]}10`}}>
              <div style={{fontSize:11,fontWeight:700,color:ROLE_COLORS[r]}}>{r}</div>
              <div style={{fontSize:11,color:'#64748b',marginTop:3,lineHeight:1.4}}>{perms}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={S.card}>
        <table style={S.table}>
          <thead><tr>{['User','Email','Role','Last login','Status','Actions'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>{users.map(u => (
            <tr key={u.userId}>
              <td style={{...S.td,fontWeight:500}}>{u.user.name}</td>
              <td style={{...S.td,color:'#64748b',fontSize:12}}>{u.user.email}</td>
              <td style={S.td}>
                {canAdmin ? (
                  <select style={{...S.select,width:140,fontSize:11,padding:'4px 8px'}} value={u.role} onChange={e=>changeRole(u.userId,e.target.value)}>
                    {ROLES.map(r=><option key={r}>{r}</option>)}
                  </select>
                ) : (
                  <span style={{...S.rolePill,background:ROLE_COLORS[u.role]+'20',color:ROLE_COLORS[u.role]}}>{u.role}</span>
                )}
              </td>
              <td style={{...S.td,color:'#94a3b8',fontSize:11}}>{u.user.lastLoginAt ? fmtDate(u.user.lastLoginAt) : 'Never'}</td>
              <td style={S.td}><span style={S.greenBadge}>Active</span></td>
              <td style={S.td}>
                {canAdmin && (
                  <button style={{...S.btn,padding:'3px 10px',fontSize:11,color:'#dc2626',borderColor:'#fca5a5'}} onClick={() => removeUser(u.userId)}>Remove</button>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function SettingsPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { currentEntity } = useApp()
  const [form, setForm] = useState({ name: currentEntity?.name??'', email:'', taxId:'', address:'', currency:'USD', fiscalMonth:1 })

  useEffect(() => {
    if (currentEntity) setForm(f => ({ ...f, name: currentEntity.name, currency: currentEntity.currency }))
  }, [currentEntity])

  return (
    <div style={{ maxWidth: 700 }}>
      <div style={{ ...S.card, marginBottom: 16 }}>
        <div style={S.cardHeader}>Entity settings — {currentEntity?.name}</div>
        <div style={S.formGrid}>
          <div><label style={S.label}>Legal entity name</label><input style={S.input} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} /></div>
          <div><label style={S.label}>Tax ID / EIN</label><input style={S.input} value={form.taxId} onChange={e=>setForm(f=>({...f,taxId:e.target.value}))} placeholder="12-3456789" /></div>
          <div><label style={S.label}>Email</label><input style={S.input} type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} /></div>
          <div><label style={S.label}>Currency</label>
            <select style={S.select} value={form.currency} onChange={e=>setForm(f=>({...f,currency:e.target.value}))}>
              {['USD','EUR','GBP','CAD','AUD','INR'].map(c=><option key={c}>{c}</option>)}
            </select>
          </div>
          <div><label style={S.label}>Fiscal year start</label>
            <select style={S.select} value={form.fiscalMonth} onChange={e=>setForm(f=>({...f,fiscalMonth:+e.target.value}))}>
              {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m,i)=><option key={i+1} value={i+1}>{m}</option>)}
            </select>
          </div>
        </div>
        <div><label style={S.label}>Address</label><input style={S.input} value={form.address} onChange={e=>setForm(f=>({...f,address:e.target.value}))} placeholder="123 Main St, New York, NY 10001" /></div>
        <button style={{...S.btn,...S.btnPrimary,marginTop:8}} onClick={() => showToast('Settings saved')}>Save settings</button>
      </div>

      <TwoFactorPanel showToast={showToast} />
    </div>
  )
}

// ─── Two-Factor Authentication panel ─────────────────────────────────────────
function TwoFactorPanel({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  type Phase = 'idle' | 'setup' | 'showing-codes' | 'disable' | 'regenerate'
  const [phase, setPhase] = useState<Phase>('idle')
  const [status, setStatus] = useState<{ enabled: boolean; backupCodesRemaining: number } | null>(null)
  const [setupData, setSetupData] = useState<{ secret: string; otpauthUri: string; accountName: string; issuer: string } | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [disablePassword, setDisablePassword] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [regenCode, setRegenCode] = useState('')
  const [shownCodes, setShownCodes] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  // QR modal state — opens a popup that renders the otpauth URI as a scannable QR.
  const [qrOpen, setQrOpen] = useState(false)
  const [qrSvg, setQrSvg] = useState<string | null>(null)
  const [qrLoading, setQrLoading] = useState(false)

  const openQr = async () => {
    if (!setupData) return
    setQrOpen(true)
    if (qrSvg) return                                   // already generated this session
    setQrLoading(true)
    try {
      // Lazy-load qrcode so it isn't shipped on every page load.
      const QRCode = (await import('qrcode')).default
      const svg = await QRCode.toString(setupData.otpauthUri, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 280,
        color: { dark: '#0f172a', light: '#ffffff' },
      })
      setQrSvg(svg)
    } catch {
      showToast('Could not generate QR code', 'err')
      setQrOpen(false)
    } finally {
      setQrLoading(false)
    }
  }

  const refreshStatus = useCallback(async () => {
    const res = await fetch('/api/auth/2fa/manage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' }),
    })
    if (res.ok) setStatus(await res.json())
  }, [])

  useEffect(() => { refreshStatus() }, [refreshStatus])

  const startSetup = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/auth/2fa/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      const data = await res.json()
      if (!res.ok) return showToast(data.error ?? 'Setup failed', 'err')
      setSetupData(data); setPhase('setup'); setVerifyCode('')
    } finally { setBusy(false) }
  }

  const confirmSetup = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: verifyCode }),
      })
      const data = await res.json()
      if (!res.ok) return showToast(data.error ?? 'Verification failed', 'err')
      setShownCodes(data.backupCodes); setPhase('showing-codes'); setSetupData(null)
      setQrSvg(null); setQrOpen(false)                    // discard QR — secret is now committed
      await refreshStatus()
      showToast('2FA enabled')
    } finally { setBusy(false) }
  }

  const confirmDisable = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/auth/2fa/manage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disable', password: disablePassword, code: disableCode }),
      })
      const data = await res.json()
      if (!res.ok) return showToast(data.error ?? 'Disable failed', 'err')
      setPhase('idle'); setDisablePassword(''); setDisableCode('')
      await refreshStatus()
      showToast('2FA disabled')
    } finally { setBusy(false) }
  }

  const confirmRegenerate = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/auth/2fa/manage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'regenerate-codes', code: regenCode }),
      })
      const data = await res.json()
      if (!res.ok) return showToast(data.error ?? 'Regenerate failed', 'err')
      setShownCodes(data.backupCodes); setRegenCode(''); setPhase('showing-codes')
      await refreshStatus()
      showToast('Backup codes regenerated')
    } finally { setBusy(false) }
  }

  const copy = (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard'))
    }
  }

  const downloadCodes = () => {
    if (!shownCodes) return
    const blob = new Blob(
      [`LedgerPro — 2FA Backup Codes\nGenerated: ${new Date().toISOString()}\n\nEach code can be used ONCE.\nKeep this file somewhere safe.\n\n${shownCodes.join('\n')}\n`],
      { type: 'text/plain' }
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'ledgerpro-backup-codes.txt'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={S.card}>
      <div style={S.cardHeader}>
        Two-factor authentication
        {status?.enabled && <span style={{ ...S.greenBadge, marginLeft: 10 }}>ENABLED</span>}
      </div>

      {/* ── IDLE: not in any flow ── */}
      {phase === 'idle' && (
        <>
          <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, marginBottom: 14 }}>
            {status?.enabled
              ? `2FA is active. You'll be asked for a 6-digit code at sign-in. ${status.backupCodesRemaining} backup code${status.backupCodesRemaining === 1 ? '' : 's'} remaining.`
              : 'Protect your account with an authenticator app like Google Authenticator, Authy, or 1Password. Strongly recommended for any account with access to financial data.'}
          </div>
          {!status?.enabled ? (
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={startSetup} disabled={busy}>Enable 2FA</button>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={S.btn} onClick={() => setPhase('regenerate')}>Regenerate backup codes</button>
              <button style={{ ...S.btn, color: '#dc2626', borderColor: '#fecaca' }} onClick={() => setPhase('disable')}>Disable 2FA</button>
            </div>
          )}
        </>
      )}

      {/* ── SETUP: show secret + ask for verification code ── */}
      {phase === 'setup' && setupData && (
        <div>
          <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, marginBottom: 12 }}>
            <strong>Step 1:</strong> Open Google Authenticator (or Authy, 1Password, etc.) and add a new account.
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={openQr}>
              📱 Scan QR code
            </button>
            <a href={setupData.otpauthUri} style={{ ...S.btn, textDecoration: 'none' }}>
              Open on this device
            </a>
            <details style={{ flex: '1 1 100%', marginTop: 4 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: '#64748b', padding: '6px 0' }}>
                Can't scan? Show secret to enter manually
              </summary>
              <div style={{ background: '#f8fafc', padding: 14, borderRadius: 8, border: '1px solid #e2e8f0', marginTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: .06 }}>Account name</div>
                <div style={{ fontFamily: 'monospace', fontSize: 13, marginBottom: 10 }}>{setupData.issuer}: {setupData.accountName}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: .06 }}>Secret key (time-based, 6 digits, 30 sec)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ flex: 1, fontFamily: 'monospace', fontSize: 14, fontWeight: 600, letterSpacing: 1, wordBreak: 'break-all' }}>{setupData.secret}</code>
                  <button style={S.btn} onClick={() => copy(setupData.secret)}>Copy</button>
                </div>
              </div>
            </details>
          </div>

          <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, marginBottom: 8 }}>
            <strong>Step 2:</strong> Enter the 6-digit code your authenticator shows.
          </div>
          <input
            style={{ ...S.input, fontSize: 18, fontFamily: 'monospace', letterSpacing: 4, textAlign: 'center', maxWidth: 240 }}
            value={verifyCode}
            onChange={e => setVerifyCode(e.target.value)}
            placeholder="123456"
            autoFocus
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} disabled={busy || verifyCode.length < 6} onClick={confirmSetup}>Verify & enable</button>
            <button style={S.btn} onClick={() => { setPhase('idle'); setSetupData(null); setVerifyCode(''); setQrSvg(null); setQrOpen(false) }}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── QR modal: dim backdrop, click outside to close ── */}
      {qrOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 20,
          }}
          onClick={() => setQrOpen(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 14, padding: 28, maxWidth: 360,
              width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Scan with your authenticator</div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 18 }}>
              In Google Authenticator: tap <strong>+</strong> → <strong>Scan a QR code</strong> → point your camera here.
            </div>
            <div
              style={{
                background: '#fff', padding: 12, borderRadius: 10, border: '1px solid #e2e8f0',
                display: 'inline-block', marginBottom: 18,
              }}
            >
              {qrLoading || !qrSvg ? (
                <div style={{ width: 280, height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                  Generating QR…
                </div>
              ) : (
                <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
              )}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14, lineHeight: 1.5 }}>
              After scanning, the app will show a 6-digit code. Close this and enter it below.
            </div>
            <button style={{ ...S.btn, ...S.btnPrimary, width: '100%', justifyContent: 'center' }} onClick={() => setQrOpen(false)}>
              I've scanned it
            </button>
          </div>
        </div>
      )}

      {/* ── SHOWING BACKUP CODES: shown exactly once ── */}
      {phase === 'showing-codes' && shownCodes && (
        <div>
          <div style={{ padding: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, marginBottom: 14 }}>
            <div style={{ fontWeight: 600, color: '#92400e', marginBottom: 4 }}>⚠ Save these backup codes now</div>
            <div style={{ fontSize: 13, color: '#92400e', lineHeight: 1.5 }}>
              Each code works once if you lose access to your authenticator. You won't see them again — save them in a password manager or print them.
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontFamily: 'monospace', fontSize: 15, padding: 14, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 14 }}>
            {shownCodes.map((c, i) => <div key={i} style={{ padding: '6px 10px', background: '#fff', borderRadius: 4 }}>{c}</div>)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={downloadCodes}>Download as text file</button>
            <button style={S.btn} onClick={() => copy(shownCodes.join('\n'))}>Copy all</button>
            <button style={S.btn} onClick={() => { setPhase('idle'); setShownCodes(null) }}>I've saved them</button>
          </div>
        </div>
      )}

      {/* ── DISABLE: requires password + code ── */}
      {phase === 'disable' && (
        <div>
          <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, marginBottom: 12 }}>
            To turn off 2FA, confirm your password and enter a current 6-digit code (or one backup code).
          </div>
          <label style={S.label}>Password</label>
          <input style={S.input} type="password" value={disablePassword} onChange={e => setDisablePassword(e.target.value)} placeholder="••••••••" />
          <label style={S.label}>Authentication code</label>
          <input style={{ ...S.input, fontFamily: 'monospace', letterSpacing: 4, textAlign: 'center', maxWidth: 240 }} value={disableCode} onChange={e => setDisableCode(e.target.value)} placeholder="123456" />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={{ ...S.btn, color: '#dc2626', borderColor: '#fecaca' }} disabled={busy || !disablePassword || disableCode.length < 6} onClick={confirmDisable}>Disable 2FA</button>
            <button style={S.btn} onClick={() => { setPhase('idle'); setDisablePassword(''); setDisableCode('') }}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── REGENERATE: requires current code ── */}
      {phase === 'regenerate' && (
        <div>
          <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, marginBottom: 12 }}>
            Generating new backup codes will invalidate all existing ones. Enter a current 6-digit code (or one unused backup code) to confirm.
          </div>
          <label style={S.label}>Authentication code</label>
          <input style={{ ...S.input, fontFamily: 'monospace', letterSpacing: 4, textAlign: 'center', maxWidth: 240 }} value={regenCode} onChange={e => setRegenCode(e.target.value)} placeholder="123456" autoFocus />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} disabled={busy || regenCode.length < 6} onClick={confirmRegenerate}>Regenerate</button>
            <button style={S.btn} onClick={() => { setPhase('idle'); setRegenCode('') }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Supporting components ────────────────────────────────────────────────────
function NewEntityForm({ onCreated, showToast }: { onCreated: (e: Entity) => void; showToast: (m: string, t?: 'ok'|'err') => void }) {
  const [form, setForm] = useState({ name:'', taxId:'', currency:'USD' })
  const [loading, setLoading] = useState(false)
  const save = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/entities', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) })
      const d = await res.json()
      if (res.ok) { onCreated(d); showToast('Entity created') }
      else showToast(d.error ?? 'Error', 'err')
    } finally { setLoading(false) }
  }
  return (
    <div>
      <div style={{fontSize:12,fontWeight:600,color:'#64748b',marginBottom:8}}>Create new legal entity</div>
      <input style={{...S.input,marginBottom:8}} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Entity name" />
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
        <input style={{...S.input,marginBottom:0}} value={form.taxId} onChange={e=>setForm(f=>({...f,taxId:e.target.value}))} placeholder="Tax ID / EIN" />
        <select style={S.select} value={form.currency} onChange={e=>setForm(f=>({...f,currency:e.target.value}))}>
          {['USD','EUR','GBP','CAD','INR'].map(c=><option key={c}>{c}</option>)}
        </select>
      </div>
      <button style={{...S.btn,...S.btnPrimary,width:'100%',justifyContent:'center',opacity:loading?0.7:1}} disabled={loading||!form.name} onClick={save}>Create entity</button>
    </div>
  )
}

function EmptyState({ onOpen }: { onOpen: () => void }) {
  return (
    <div style={{textAlign:'center',padding:'80px 20px'}}>
      <div style={{fontSize:48,marginBottom:16}}>⬡</div>
      <div style={{fontSize:20,fontWeight:600,marginBottom:8}}>No entity selected</div>
      <div style={{fontSize:14,color:'#64748b',marginBottom:24}}>Select a legal entity or create a new one to get started</div>
      <button style={{...S.btn,...S.btnPrimary}} onClick={onOpen}>Select or create entity</button>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    POSTED:    { bg:'#f0fdf4', color:'#166534', label:'Posted' },
    DRAFT:     { bg:'#f8fafc', color:'#475569', label:'Draft' },
    VOID:      { bg:'#fef2f2', color:'#991b1b', label:'Void' },
    PAID:      { bg:'#f0fdf4', color:'#166534', label:'Paid' },
    PENDING:   { bg:'#fffbeb', color:'#92400e', label:'Pending' },
    OVERDUE:   { bg:'#fef2f2', color:'#991b1b', label:'Overdue' },
    PARTIALLY_PAID: { bg:'#eff6ff', color:'#1d4ed8', label:'Partial' },
    OVER:      { bg:'#fef2f2', color:'#991b1b', label:'Over' },
    ON_TRACK:  { bg:'#f0fdf4', color:'#166534', label:'On track' },
    UNDER:     { bg:'#eff6ff', color:'#1d4ed8', label:'Under' },
    NO_BUDGET: { bg:'#f8fafc', color:'#475569', label:'No budget' },
    APPROVED:  { bg:'#f0fdf4', color:'#166534', label:'Approved' },
    ACTIVE:    { bg:'#f0fdf4', color:'#166534', label:'Active' },
    CLIENT_VIEW: { bg:'#f8fafc', color:'#475569', label:'Client' },
    ACCOUNTANT: { bg:'#eff6ff', color:'#1d4ed8', label:'Accountant' },
  }
  const m = map[status] ?? { bg:'#f8fafc', color:'#475569', label: status }
  return <span style={{ padding:'2px 8px', borderRadius:20, fontSize:11, fontWeight:600, background:m.bg, color:m.color }}>{m.label}</span>
}

// ─── Payments (Write Cheque & ACH) ────────────────────────────────────────────
interface Payment {
  id: string
  method: 'CHEQUE' | 'ACH'
  status: 'DRAFT' | 'ISSUED' | 'CLEARED' | 'VOID'
  payeeName: string
  amount: number
  paymentDate: string
  memo?: string
  chequeNo?: string
  achTraceNo?: string
  achBatchId?: string
  bankAccount?: { code: string; name: string }
}

function PaymentsPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { currentEntity, role } = useApp()
  const [payments, setPayments] = useState<Payment[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [tab, setTab] = useState<'ALL'|'CHEQUE'|'ACH'>('ALL')
  const [showForm, setShowForm] = useState(false)
  const [method, setMethod] = useState<'CHEQUE'|'ACH'>('CHEQUE')
  const [nextCheque, setNextCheque] = useState('')
  const today = new Date().toISOString().slice(0,10)
  const [form, setForm] = useState({
    bankAccountId:'', payeeName:'', amount:'', paymentDate: today, memo:'',
    expenseAccountId:'', chequeNo:'',
    achRoutingNo:'', achAccountNo:'', achAccountType:'CHECKING' as 'CHECKING'|'SAVINGS', achEffectiveDate: today,
  })
  const canWrite = ['OWNER','ADMIN','ACCOUNTANT'].includes(role)

  const load = useCallback(() => {
    if (!currentEntity) return
    const q = tab === 'ALL' ? '' : `&method=${tab}`
    fetch(`/api/payments?entityId=${currentEntity.id}${q}`).then(r => r.json()).then(d => setPayments(d.payments ?? []))
    fetch(`/api/accounts?entityId=${currentEntity.id}`).then(r => r.json()).then(setAccounts)
  }, [currentEntity, tab])

  useEffect(() => { load() }, [load])

  // Pre-fetch next cheque number when bank account selected for cheque method
  useEffect(() => {
    if (!currentEntity || method !== 'CHEQUE' || !form.bankAccountId) { setNextCheque(''); return }
    fetch(`/api/payments?entityId=${currentEntity.id}&nextCheque=${form.bankAccountId}`)
      .then(r => r.json()).then(d => setNextCheque(d.nextChequeNo ?? ''))
  }, [currentEntity, method, form.bankAccountId])

  const bankAccounts = accounts.filter(a => a.isBankAccount)
  const expenseAccounts = accounts.filter(a => a.type === 'EXPENSE' || a.type === 'COGS')

  const resetForm = () => setForm({
    bankAccountId:'', payeeName:'', amount:'', paymentDate: today, memo:'',
    expenseAccountId:'', chequeNo:'',
    achRoutingNo:'', achAccountNo:'', achAccountType:'CHECKING', achEffectiveDate: today,
  })

  const save = async (postNow: boolean) => {
    if (!currentEntity) return
    if (!form.bankAccountId)    return showToast('Pick a bank account', 'err')
    if (!form.payeeName)        return showToast('Payee name required', 'err')
    if (!parseFloat(form.amount)) return showToast('Amount required', 'err')
    if (postNow && !form.expenseAccountId) return showToast('Expense account required to post', 'err')
    if (method === 'ACH' && (!form.achRoutingNo || !form.achAccountNo))
      return showToast('Routing & account number required for ACH', 'err')

    const body: Record<string, unknown> = {
      entityId: currentEntity.id, bankAccountId: form.bankAccountId, method,
      payeeName: form.payeeName, amount: parseFloat(form.amount),
      paymentDate: form.paymentDate, memo: form.memo || undefined,
      expenseAccountId: form.expenseAccountId || undefined, postNow,
    }
    if (method === 'CHEQUE' && form.chequeNo) body.chequeNo = form.chequeNo
    if (method === 'ACH') {
      body.achRoutingNo = form.achRoutingNo
      body.achAccountNo = form.achAccountNo
      body.achAccountType = form.achAccountType
      body.achEffectiveDate = form.achEffectiveDate
    }
    const res = await fetch('/api/payments', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
    if (res.ok) {
      showToast(postNow ? `${method === 'CHEQUE' ? 'Cheque' : 'ACH'} posted` : 'Saved as draft')
      setShowForm(false); resetForm(); load()
    } else {
      const d = await res.json(); showToast(d.error ?? 'Error', 'err')
    }
  }

  const postDraft = async (id: string) => {
    if (!currentEntity) return
    const res = await fetch('/api/payments', { method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ entityId: currentEntity.id, paymentId: id, action: 'post' }) })
    if (res.ok) { showToast('Posted to GL'); load() }
    else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  const voidPayment = async (id: string) => {
    if (!currentEntity) return
    const reason = prompt('Reason for voiding?')
    if (!reason) return
    const res = await fetch('/api/payments', { method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ entityId: currentEntity.id, paymentId: id, action: 'void', reason }) })
    if (res.ok) { showToast('Payment voided'); load() }
    else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  const STATUS_COLORS: Record<string, string> = { DRAFT:'#94a3b8', ISSUED:'#0891b2', CLEARED:'#16a34a', VOID:'#dc2626' }
  const tabBtn = (id: 'ALL'|'CHEQUE'|'ACH', label: string) => (
    <button onClick={() => setTab(id)} style={{ ...S.btn, ...(tab===id ? { background:'#0f172a', color:'#fff', borderColor:'#0f172a' } : {}) }}>{label}</button>
  )

  return (
    <div>
      <div style={S.pageActions}>
        <div style={{ display:'flex', gap:8 }}>{tabBtn('ALL','All')}{tabBtn('CHEQUE','Cheques')}{tabBtn('ACH','ACH')}</div>
        {canWrite && <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setShowForm(o => !o)}>+ New payment</button>}
      </div>

      {showForm && (
        <div style={{ ...S.card, marginBottom:16 }}>
          <div style={S.cardHeader}>
            New payment
            <div style={{ display:'inline-flex', gap:8, marginLeft:16 }}>
              <button onClick={() => setMethod('CHEQUE')} style={{ ...S.btn, ...(method==='CHEQUE' ? S.btnPrimary : {}) }}>Write cheque</button>
              <button onClick={() => setMethod('ACH')} style={{ ...S.btn, ...(method==='ACH' ? S.btnPrimary : {}) }}>ACH</button>
            </div>
          </div>
          <div style={S.formGrid}>
            <div>
              <label style={S.label}>Pay from (bank account)</label>
              <select style={S.select} value={form.bankAccountId} onChange={e => setForm(f=>({...f, bankAccountId:e.target.value}))}>
                <option value="">Select bank account…</option>
                {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
              {bankAccounts.length === 0 && <div style={{ fontSize:11, color:'#dc2626', marginTop:4 }}>No bank accounts. Mark an account as bank account in Chart of Accounts.</div>}
            </div>
            <div><label style={S.label}>Pay to</label><input style={S.input} value={form.payeeName} onChange={e => setForm(f=>({...f, payeeName:e.target.value}))} placeholder="Payee name" /></div>
            <div><label style={S.label}>Amount</label><input style={S.input} value={form.amount} onChange={e => setForm(f=>({...f, amount:e.target.value}))} placeholder="0.00" /></div>
            <div><label style={S.label}>Payment date</label><input style={S.input} type="date" value={form.paymentDate} onChange={e => setForm(f=>({...f, paymentDate:e.target.value}))} /></div>
            <div>
              <label style={S.label}>Expense / offset account</label>
              <select style={S.select} value={form.expenseAccountId} onChange={e => setForm(f=>({...f, expenseAccountId:e.target.value}))}>
                <option value="">Select account…</option>
                {expenseAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div><label style={S.label}>Memo</label><input style={S.input} value={form.memo} onChange={e => setForm(f=>({...f, memo:e.target.value}))} placeholder="Optional memo" /></div>

            {method === 'CHEQUE' && (
              <div>
                <label style={S.label}>Cheque # {nextCheque && <span style={{ color:'#94a3b8', fontWeight:400 }}>(next: {nextCheque})</span>}</label>
                <input style={S.input} value={form.chequeNo} onChange={e => setForm(f=>({...f, chequeNo:e.target.value}))} placeholder={nextCheque || 'Auto'} />
              </div>
            )}

            {method === 'ACH' && (<>
              <div><label style={S.label}>Routing # (9 digits)</label><input style={S.input} value={form.achRoutingNo} onChange={e => setForm(f=>({...f, achRoutingNo:e.target.value.replace(/\D/g,'').slice(0,9)}))} placeholder="123456789" /></div>
              <div><label style={S.label}>Account #</label><input style={S.input} value={form.achAccountNo} onChange={e => setForm(f=>({...f, achAccountNo:e.target.value}))} placeholder="Will be masked to last 4" /></div>
              <div>
                <label style={S.label}>Account type</label>
                <select style={S.select} value={form.achAccountType} onChange={e => setForm(f=>({...f, achAccountType: e.target.value as 'CHECKING'|'SAVINGS'}))}>
                  <option value="CHECKING">Checking</option><option value="SAVINGS">Savings</option>
                </select>
              </div>
              <div><label style={S.label}>Effective date</label><input style={S.input} type="date" value={form.achEffectiveDate} onChange={e => setForm(f=>({...f, achEffectiveDate:e.target.value}))} /></div>
            </>)}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => save(true)}>{method === 'CHEQUE' ? 'Save & post cheque' : 'Save & submit ACH'}</button>
            <button style={S.btn} onClick={() => save(false)}>Save as draft</button>
            <button style={S.btn} onClick={() => { setShowForm(false); resetForm() }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={S.card}>
        <table style={S.table}>
          <thead><tr>{['Date','Method','#/Trace','Bank','Payee','Memo','Amount','Status',''].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {payments.length === 0 && <tr><td style={{ ...S.td, textAlign:'center', color:'#94a3b8' }} colSpan={9}>No payments yet</td></tr>}
            {payments.map(p => (
              <tr key={p.id}>
                <td style={S.td}>{fmtDate(p.paymentDate)}</td>
                <td style={S.td}><span style={{ ...S.greenBadge, background: p.method==='CHEQUE' ? '#eff6ff' : '#fef3c7', color: p.method==='CHEQUE' ? '#1e40af' : '#92400e' }}>{p.method}</span></td>
                <td style={{ ...S.td, fontFamily:'monospace', fontSize:11 }}>{p.method === 'CHEQUE' ? `#${p.chequeNo ?? ''}` : (p.achTraceNo ?? p.achBatchId ?? '')}</td>
                <td style={{ ...S.td, fontSize:12, color:'#64748b' }}>{p.bankAccount ? `${p.bankAccount.code} ${p.bankAccount.name}` : ''}</td>
                <td style={{ ...S.td, fontWeight:500 }}>{p.payeeName}</td>
                <td style={{ ...S.td, fontSize:12, color:'#64748b' }}>{p.memo}</td>
                <td style={{ ...S.td, textAlign:'right', fontWeight:600 }}>${fmt(p.amount)}</td>
                <td style={S.td}><span style={{ ...S.greenBadge, background:'#f1f5f9', color: STATUS_COLORS[p.status] ?? '#475569' }}>{p.status}</span></td>
                <td style={{ ...S.td, textAlign:'right' }}>
                  {canWrite && p.status === 'DRAFT' && <button style={S.textBtn} onClick={() => postDraft(p.id)}>Post</button>}
                  {canWrite && (p.status === 'DRAFT' || p.status === 'ISSUED') && <button style={{ ...S.textBtn, color:'#dc2626', marginLeft:8 }} onClick={() => voidPayment(p.id)}>Void</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Bank Reconciliation ──────────────────────────────────────────────────────
interface ReconSummary {
  beginningBalance: number; endingBalance: number; clearedBalance: number
  clearedCount: number; unclearedCount: number; difference: number; isBalanced: boolean
}
interface ReconLine {
  id: string; date: string; ref: string; description: string
  debit: number; credit: number; movement: number
  clearedStatus: 'UNCLEARED'|'CLEARED'|'RECONCILED'; clearedDate: string | null; inThisRecon: boolean
}
interface StatementLine { id: string; date: string; description: string; amount: number; reference?: string; isMatched: boolean }
interface ReconRecord { id: string; statementDate: string; beginningBalance: number; endingBalance: number; status: 'IN_PROGRESS'|'COMPLETED'; bankAccount?: { code: string; name: string } }
interface ReconState { reconciliation: { id: string; statementDate: string; bankAccountId: string; status: string }; cleared: ReconLine[]; uncleared: ReconLine[]; statementLines: StatementLine[]; summary: ReconSummary }

function ReconPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { currentEntity, role } = useApp()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [recons, setRecons] = useState<ReconRecord[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [state, setState] = useState<ReconState | null>(null)
  const [showStart, setShowStart] = useState(false)
  const today = new Date().toISOString().slice(0,10)
  const [startForm, setStartForm] = useState({
    bankAccountId:'', statementDate: today, beginningBalance:'', endingBalance:'',
    statementFile:'', statementContent:''
  })
  const canWrite = ['OWNER','ADMIN','ACCOUNTANT'].includes(role)

  const loadList = useCallback(() => {
    if (!currentEntity) return
    fetch(`/api/recon?entityId=${currentEntity.id}`).then(r => r.json()).then(d => setRecons(d.reconciliations ?? []))
    fetch(`/api/accounts?entityId=${currentEntity.id}`).then(r => r.json()).then(setAccounts)
  }, [currentEntity])

  const loadOne = useCallback((id: string) => {
    if (!currentEntity) return
    fetch(`/api/recon?entityId=${currentEntity.id}&id=${id}`).then(r => r.json()).then(setState)
  }, [currentEntity])

  useEffect(() => { loadList() }, [loadList])
  useEffect(() => { if (activeId) loadOne(activeId) }, [activeId, loadOne])

  const bankAccounts = accounts.filter(a => a.isBankAccount)

  const onFileChosen = async (file: File | null) => {
    if (!file) { setStartForm(f => ({ ...f, statementFile:'', statementContent:'' })); return }
    const text = await file.text()
    setStartForm(f => ({ ...f, statementFile: file.name, statementContent: text }))
  }

  const startRecon = async () => {
    if (!currentEntity) return
    if (!startForm.bankAccountId) return showToast('Pick a bank account', 'err')
    const begin = parseFloat(startForm.beginningBalance), end = parseFloat(startForm.endingBalance)
    if (isNaN(begin) || isNaN(end)) return showToast('Beginning and ending balances required', 'err')
    const res = await fetch('/api/recon', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        entityId: currentEntity.id,
        bankAccountId: startForm.bankAccountId,
        statementDate: startForm.statementDate,
        beginningBalance: begin, endingBalance: end,
        statementFile: startForm.statementFile || undefined,
        statementContent: startForm.statementContent || undefined,
      })
    })
    if (res.ok) {
      const data = await res.json()
      showToast(startForm.statementContent ? `Started — parsed ${data.statementLines?.length ?? 0} statement lines` : 'Reconciliation started')
      setShowStart(false); setStartForm({ bankAccountId:'', statementDate: today, beginningBalance:'', endingBalance:'', statementFile:'', statementContent:'' })
      loadList(); setActiveId(data.reconciliation.id)
    } else {
      const d = await res.json(); showToast(d.error ?? 'Error', 'err')
    }
  }

  const toggleClear = async (lineId: string, cleared: boolean, clearedDate?: string) => {
    if (!currentEntity || !activeId) return
    const res = await fetch('/api/recon', { method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ entityId: currentEntity.id, action: 'clear', reconciliationId: activeId, journalLineId: lineId, cleared, clearedDate }) })
    if (res.ok) setState(await res.json())
    else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  const autoMatch = async () => {
    if (!currentEntity || !activeId) return
    const res = await fetch('/api/recon', { method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ entityId: currentEntity.id, action: 'autoMatch', reconciliationId: activeId }) })
    if (res.ok) {
      const data = await res.json()
      showToast(`Auto-matched ${data.autoMatch?.matched ?? 0} of ${data.autoMatch?.totalStatementLines ?? 0} statement lines`)
      setState(data)
    } else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  const finalize = async () => {
    if (!currentEntity || !activeId) return
    if (!state?.summary.isBalanced) return showToast(`Out of balance by ${fmt(state?.summary.difference ?? 0)}`, 'err')
    if (!confirm('Finalize this reconciliation? Cleared lines will be locked.')) return
    const res = await fetch('/api/recon', { method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ entityId: currentEntity.id, action: 'finalize', reconciliationId: activeId }) })
    if (res.ok) { showToast('Reconciliation completed'); loadList(); loadOne(activeId) }
    else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  // Detail view of one reconciliation
  if (activeId && state) {
    const isLocked = state.reconciliation.status === 'COMPLETED'
    const { summary } = state
    const allLines = [...state.cleared, ...state.uncleared].sort((a,b) => +new Date(a.date) - +new Date(b.date))

    return (
      <div>
        <div style={S.pageActions}>
          <button style={S.btn} onClick={() => { setActiveId(null); setState(null) }}>← Back to list</button>
          <div style={{ display:'flex', gap:8 }}>
            {!isLocked && canWrite && state.statementLines.length > 0 && <button style={S.btn} onClick={autoMatch}>Auto-match statement</button>}
            {!isLocked && canWrite && <button style={{ ...S.btn, ...S.btnPrimary, opacity: summary.isBalanced ? 1 : 0.5 }} onClick={finalize} disabled={!summary.isBalanced}>Finalize reconciliation</button>}
            {isLocked && <span style={{ ...S.greenBadge }}>COMPLETED</span>}
          </div>
        </div>

        <div style={S.kpiGrid}>
          {[
            { label:'Beginning balance', value:`$${fmt(summary.beginningBalance)}`, color:'#475569' },
            { label:'Cleared balance', value:`$${fmt(summary.clearedBalance)}`, color:'#0891b2' },
            { label:'Statement ending', value:`$${fmt(summary.endingBalance)}`, color:'#475569' },
            { label:'Difference', value:`$${fmt(summary.difference)}`, color: summary.isBalanced ? '#16a34a' : '#dc2626' },
          ].map(k => <div key={k.label} style={S.kpiCard}><div style={{fontSize:11,color:'#94a3b8',marginBottom:4}}>{k.label}</div><div style={{fontSize:22,fontWeight:700,color:k.color}}>{k.value}</div></div>)}
        </div>

        {state.statementLines.length > 0 && (
          <div style={{ ...S.card, marginBottom:16 }}>
            <div style={S.cardHeader}>Statement lines ({state.statementLines.filter(s => s.isMatched).length} of {state.statementLines.length} matched)</div>
            <table style={S.table}>
              <thead><tr>{['Date','Description','Reference','Amount','Matched'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>{state.statementLines.map(sl => (
                <tr key={sl.id}>
                  <td style={S.td}>{fmtDate(sl.date)}</td>
                  <td style={{ ...S.td, fontSize:12 }}>{sl.description}</td>
                  <td style={{ ...S.td, fontFamily:'monospace', fontSize:11, color:'#64748b' }}>{sl.reference ?? ''}</td>
                  <td style={{ ...S.td, textAlign:'right', color: sl.amount < 0 ? '#dc2626' : '#16a34a', fontWeight:600 }}>${fmt(sl.amount)}</td>
                  <td style={S.td}>{sl.isMatched ? <span style={S.greenBadge}>matched</span> : <span style={{ color:'#94a3b8', fontSize:12 }}>—</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}

        <div style={S.card}>
          <div style={S.cardHeader}>Book transactions — tick to clear, set the date money cleared the bank</div>
          <table style={S.table}>
            <thead><tr>{['','Date','Ref','Description','Withdrawal','Deposit','Clearing date'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {allLines.length === 0 && <tr><td style={{ ...S.td, textAlign:'center', color:'#94a3b8' }} colSpan={7}>No book transactions in this period</td></tr>}
              {allLines.map(l => {
                const isCleared = l.inThisRecon && l.clearedStatus !== 'UNCLEARED'
                return (
                  <tr key={l.id} style={{ background: isCleared ? '#f0fdf4' : 'transparent' }}>
                    <td style={S.td}>
                      <input type="checkbox" checked={isCleared} disabled={isLocked || !canWrite}
                        onChange={e => toggleClear(l.id, e.target.checked, e.target.checked ? (l.clearedDate ?? today) : undefined)} />
                    </td>
                    <td style={S.td}>{fmtDate(l.date)}</td>
                    <td style={{ ...S.td, fontFamily:'monospace', fontSize:11 }}>{l.ref}</td>
                    <td style={{ ...S.td, fontSize:12 }}>{l.description}</td>
                    <td style={{ ...S.td, textAlign:'right', color:'#dc2626' }}>{l.credit > 0 ? `$${fmt(l.credit)}` : ''}</td>
                    <td style={{ ...S.td, textAlign:'right', color:'#16a34a' }}>{l.debit > 0 ? `$${fmt(l.debit)}` : ''}</td>
                    <td style={S.td}>
                      {isCleared ? (
                        <input type="date" style={{ ...S.input, padding:'4px 6px', fontSize:12 }}
                          value={l.clearedDate ? l.clearedDate.slice(0,10) : today}
                          disabled={isLocked || !canWrite}
                          onChange={e => toggleClear(l.id, true, e.target.value)} />
                      ) : <span style={{ color:'#94a3b8', fontSize:12 }}>—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // List view
  return (
    <div>
      <div style={S.pageActions}>
        <span />
        {canWrite && <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setShowStart(o => !o)}>+ Start reconciliation</button>}
      </div>

      {showStart && (
        <div style={{ ...S.card, marginBottom:16 }}>
          <div style={S.cardHeader}>Start a new reconciliation</div>
          <div style={S.formGrid}>
            <div>
              <label style={S.label}>Bank account</label>
              <select style={S.select} value={startForm.bankAccountId} onChange={e => setStartForm(f=>({...f, bankAccountId:e.target.value}))}>
                <option value="">Select bank account…</option>
                {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div><label style={S.label}>Statement date</label><input style={S.input} type="date" value={startForm.statementDate} onChange={e => setStartForm(f=>({...f, statementDate:e.target.value}))} /></div>
            <div><label style={S.label}>Beginning balance</label><input style={S.input} value={startForm.beginningBalance} onChange={e => setStartForm(f=>({...f, beginningBalance:e.target.value}))} placeholder="0.00" /></div>
            <div><label style={S.label}>Ending balance (from statement)</label><input style={S.input} value={startForm.endingBalance} onChange={e => setStartForm(f=>({...f, endingBalance:e.target.value}))} placeholder="0.00" /></div>
            <div style={{ gridColumn:'1 / -1' }}>
              <label style={S.label}>Upload statement (optional — CSV or OFX/QFX)</label>
              <input type="file" accept=".csv,.ofx,.qfx,text/csv" onChange={e => onFileChosen(e.target.files?.[0] ?? null)} style={{ display:'block', marginTop:4 }} />
              {startForm.statementFile && <div style={{ fontSize:11, color:'#16a34a', marginTop:4 }}>✓ {startForm.statementFile} — will auto-match on start</div>}
              <div style={{ fontSize:11, color:'#94a3b8', marginTop:4 }}>If no file, you can still reconcile manually by ticking entries below.</div>
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={startRecon}>Start</button>
            <button style={S.btn} onClick={() => setShowStart(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={S.card}>
        <table style={S.table}>
          <thead><tr>{['Statement date','Bank account','Beginning','Ending','Status',''].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {recons.length === 0 && <tr><td style={{ ...S.td, textAlign:'center', color:'#94a3b8' }} colSpan={6}>No reconciliations yet</td></tr>}
            {recons.map(r => (
              <tr key={r.id}>
                <td style={S.td}>{fmtDate(r.statementDate)}</td>
                <td style={S.td}>{r.bankAccount ? `${r.bankAccount.code} — ${r.bankAccount.name}` : ''}</td>
                <td style={{ ...S.td, textAlign:'right' }}>${fmt(r.beginningBalance)}</td>
                <td style={{ ...S.td, textAlign:'right' }}>${fmt(r.endingBalance)}</td>
                <td style={S.td}><span style={{ ...S.greenBadge, background: r.status==='COMPLETED' ? '#f0fdf4' : '#fef3c7', color: r.status==='COMPLETED' ? '#166534' : '#92400e' }}>{r.status}</span></td>
                <td style={{ ...S.td, textAlign:'right' }}><button style={S.textBtn} onClick={() => setActiveId(r.id)}>Open →</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Period Locks ─────────────────────────────────────────────────────────────
interface PeriodLock {
  id: string
  periodEnd: string
  lockedAt: string
  lockedBy: string | null
  reason: string | null
  releasedAt: string | null
  releasedBy: string | null
}

function PeriodsPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { currentEntity, role } = useApp()
  const [locks, setLocks] = useState<PeriodLock[]>([])
  const [showForm, setShowForm] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  // Default lock-through: end of last month.
  const defaultPeriodEnd = (() => {
    const d = new Date()
    d.setDate(0) // last day of previous month
    return d.toISOString().slice(0, 10)
  })()
  const [form, setForm] = useState({ periodEnd: defaultPeriodEnd, reason: '' })
  const canWrite = ['OWNER','ADMIN'].includes(role)

  const load = useCallback(() => {
    if (!currentEntity) return
    fetch(`/api/periods?entityId=${currentEntity.id}`).then(r => r.json()).then(d => setLocks(d.locks ?? []))
  }, [currentEntity])

  useEffect(() => { load() }, [load])

  const activeLock = locks.find(l => !l.releasedAt)
  // Active cutoff is the latest unreleased lock's periodEnd.
  const activeCutoff = locks
    .filter(l => !l.releasedAt)
    .map(l => l.periodEnd)
    .sort()
    .pop() ?? null

  const createLock = async () => {
    if (!currentEntity) return
    if (!form.periodEnd) return showToast('Pick a period-end date', 'err')
    if (activeCutoff && form.periodEnd <= activeCutoff) {
      return showToast(`A lock already covers ${activeCutoff}. Pick a later date.`, 'err')
    }
    const res = await fetch('/api/periods', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId: currentEntity.id, periodEnd: form.periodEnd, reason: form.reason || undefined }),
    })
    if (res.ok) {
      showToast(`Period locked through ${form.periodEnd}`)
      setShowForm(false); setForm({ periodEnd: defaultPeriodEnd, reason: '' }); load()
    } else {
      const d = await res.json(); showToast(d.error ?? 'Error', 'err')
    }
  }

  const releaseLock = async (id: string) => {
    if (!currentEntity) return
    if (!confirm('Release this lock? Entries within the period will become editable again.')) return
    const res = await fetch('/api/periods', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId: currentEntity.id, id }),
    })
    if (res.ok) { showToast('Lock released'); load() }
    else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  return (
    <div>
      <div style={S.pageActions}>
        <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
          {activeCutoff ? (
            <>Books locked through <strong>{fmtDate(activeCutoff)}</strong>. Journal entries and payments dated on or before this date cannot be created or modified.</>
          ) : (
            <>No active lock. All historical periods are open for edits.</>
          )}
        </div>
        {canWrite && <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setShowForm(o => !o)}>+ Lock period</button>}
      </div>

      {showForm && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={S.cardHeader}>Lock a period</div>
          <div style={{ fontSize: 13, color: '#475569', marginBottom: 14, lineHeight: 1.5 }}>
            Close the books up to and including this date. After locking, no entries dated on or before <strong>{form.periodEnd}</strong> can be created or modified — including payment posts and voids. OWNER or ADMIN can release the lock later if you need to make corrections.
          </div>
          <div style={S.formGrid}>
            <div>
              <label style={S.label}>Lock through (inclusive)</label>
              <input style={S.input} type="date" value={form.periodEnd} max={today} onChange={e => setForm(f => ({ ...f, periodEnd: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={S.label}>Reason (optional)</label>
              <input style={S.input} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="e.g. April 2026 close" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={createLock}>Lock period</button>
            <button style={S.btn} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={S.card}>
        <div style={S.cardHeader}>Lock history</div>
        <table style={S.table}>
          <thead><tr>{['Period end','Locked at','Reason','Released at','Status',''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {locks.length === 0 && <tr><td style={{ ...S.td, textAlign: 'center', color: '#94a3b8' }} colSpan={6}>No locks created yet</td></tr>}
            {locks.map(l => {
              const active = !l.releasedAt
              return (
                <tr key={l.id} style={{ background: active ? '#fffbeb' : 'transparent' }}>
                  <td style={{ ...S.td, fontWeight: 600 }}>{fmtDate(l.periodEnd)}</td>
                  <td style={{ ...S.td, fontSize: 12, color: '#64748b' }}>{fmtDate(l.lockedAt)}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{l.reason ?? <span style={{ color: '#94a3b8' }}>—</span>}</td>
                  <td style={{ ...S.td, fontSize: 12, color: '#64748b' }}>{l.releasedAt ? fmtDate(l.releasedAt) : <span style={{ color: '#94a3b8' }}>—</span>}</td>
                  <td style={S.td}>
                    <span style={{ ...S.greenBadge, background: active ? '#fef3c7' : '#f0fdf4', color: active ? '#92400e' : '#166534' }}>
                      {active ? 'ACTIVE' : 'RELEASED'}
                    </span>
                  </td>
                  <td style={{ ...S.td, textAlign: 'right' }}>
                    {active && canWrite && <button style={{ ...S.textBtn, color: '#dc2626' }} onClick={() => releaseLock(l.id)}>Release</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Reports (QuickBooks-style) ───────────────────────────────────────────────

interface ReportDef {
  id: string                          // backend type param
  name: string                        // shown in UI
  description: string
  category: 'overview' | 'expenses' | 'accountant' | 'banking'
  needsRange: boolean                 // does it take a from/to date range?
  needsAsOf: boolean                  // or a single "as of" date?
}

const REPORT_CATALOG: ReportDef[] = [
  { id: 'pnl',                  name: 'Profit & Loss',              description: 'Revenue, expenses, and net income for the period.',                category: 'overview',   needsRange: true,  needsAsOf: false },
  { id: 'pnl-comparison',       name: 'Profit & Loss Comparison',   description: 'Current period vs prior period and prior year.',                   category: 'overview',   needsRange: true,  needsAsOf: false },
  { id: 'balance-sheet',        name: 'Balance Sheet',              description: 'Assets, liabilities, and equity as of a date.',                    category: 'overview',   needsRange: false, needsAsOf: true  },
  { id: 'cash-flows',           name: 'Statement of Cash Flows',    description: 'Cash movement broken into operating, investing, and financing.',   category: 'overview',   needsRange: true,  needsAsOf: false },
  { id: 'ap-aging',             name: 'A/P Aging Summary',          description: 'Open bills grouped by how far overdue they are.',                  category: 'expenses',   needsRange: false, needsAsOf: true  },
  { id: 'ap-aging-detail',      name: 'A/P Aging Detail',           description: 'Every open bill listed, grouped by vendor.',                       category: 'expenses',   needsRange: false, needsAsOf: true  },
  { id: 'expenses-by-vendor',   name: 'Expenses by Vendor',         description: 'Total billed by each vendor over the period.',                     category: 'expenses',   needsRange: true,  needsAsOf: false },
  { id: 'trial-balance',        name: 'Trial Balance',              description: 'Every account with its debit or credit balance — proves the books balance.', category: 'accountant', needsRange: true,  needsAsOf: false },
  { id: 'general-ledger',       name: 'General Ledger',             description: 'Every posted transaction by account with running balance.',         category: 'accountant', needsRange: true,  needsAsOf: false },
  { id: 'journal',              name: 'Journal Report',             description: 'Chronological list of every posted journal entry.',                category: 'accountant', needsRange: true,  needsAsOf: false },
]

const REPORT_CATEGORIES = [
  { id: 'overview',   name: 'Business overview',     description: 'How your business is performing overall' },
  { id: 'expenses',   name: 'What you owe',          description: 'Bills, vendor balances, and aging' },
  { id: 'accountant', name: 'For my accountant',     description: 'Trial balance, general ledger, and the journal' },
] as const

// ─── Date-range presets, QB-style ──────────────────────────────────────────────
type RangePresetId = 'today' | 'this-month' | 'last-month' | 'this-quarter' | 'last-quarter' | 'this-year' | 'last-year' | 'ytd' | 'custom'

function presetRange(preset: RangePresetId, today: Date = new Date()): { from: string; to: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const y = today.getFullYear(), m = today.getMonth()
  const startOfMonth = new Date(y, m, 1)
  const endOfMonth   = new Date(y, m + 1, 0)
  const q = Math.floor(m / 3)
  const startOfQuarter = new Date(y, q * 3, 1)
  const endOfQuarter   = new Date(y, q * 3 + 3, 0)
  const startOfYear = new Date(y, 0, 1)
  const endOfYear   = new Date(y, 11, 31)
  switch (preset) {
    case 'today':         return { from: iso(today), to: iso(today) }
    case 'this-month':    return { from: iso(startOfMonth), to: iso(endOfMonth) }
    case 'last-month': {
      const f = new Date(y, m - 1, 1), t = new Date(y, m, 0)
      return { from: iso(f), to: iso(t) }
    }
    case 'this-quarter':  return { from: iso(startOfQuarter), to: iso(endOfQuarter) }
    case 'last-quarter': {
      const f = new Date(y, (q - 1) * 3, 1), t = new Date(y, q * 3, 0)
      return { from: iso(f), to: iso(t) }
    }
    case 'this-year':     return { from: iso(startOfYear), to: iso(endOfYear) }
    case 'last-year':     return { from: iso(new Date(y - 1, 0, 1)), to: iso(new Date(y - 1, 11, 31)) }
    case 'ytd':           return { from: iso(startOfYear), to: iso(today) }
    default:              return { from: iso(startOfYear), to: iso(today) }
  }
}

function ReportsPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const [activeReport, setActiveReport] = useState<string | null>(null)
  const def = activeReport ? REPORT_CATALOG.find(r => r.id === activeReport) ?? null : null

  if (def) {
    return <ReportViewer def={def} showToast={showToast} onBack={() => setActiveReport(null)} />
  }
  return <ReportsLanding onPick={setActiveReport} />
}

// ─── Landing: catalog of reports grouped by category ──────────────────────────
function ReportsLanding({ onPick }: { onPick: (id: string) => void }) {
  const [search, setSearch] = useState('')
  const filtered = (cat: string) =>
    REPORT_CATALOG.filter(r => r.category === cat)
      .filter(r => !search || (r.name + ' ' + r.description).toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <div style={S.pageActions}>
        <input
          style={{ ...S.input, maxWidth: 380, marginBottom: 0 }}
          placeholder="Find a report by name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div style={{ fontSize: 12, color: '#64748b' }}>{REPORT_CATALOG.length} reports available</div>
      </div>

      {REPORT_CATEGORIES.map(cat => {
        const reports = filtered(cat.id)
        if (reports.length === 0 && search) return null
        return (
          <div key={cat.id} style={{ marginBottom: 24 }}>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{cat.name}</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>{cat.description}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
              {reports.map(r => (
                <button
                  key={r.id}
                  onClick={() => onPick(r.id)}
                  style={{
                    textAlign: 'left', background: '#fff', border: '1px solid #e2e8f0',
                    borderRadius: 10, padding: 16, cursor: 'pointer', display: 'flex',
                    flexDirection: 'column', gap: 6, transition: 'all .12s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#0891b2'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(8,145,178,0.08)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none' }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>{r.description}</div>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Viewer: customization bar + the report itself ────────────────────────────
function ReportViewer({ def, showToast, onBack }: { def: ReportDef; showToast: (m: string, t?: 'ok'|'err') => void; onBack: () => void }) {
  const { currentEntity } = useApp()
  const initial = presetRange('this-year')
  const [preset, setPreset] = useState<RangePresetId>('this-year')
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10))
  const [data, setData] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [drill, setDrill] = useState<{ accountId: string; range?: { from: string; to: string }; asOf?: string } | null>(null)

  const handleDrill = (accountId: string, range: { from?: string; to?: string }) => {
    if (def.needsAsOf) setDrill({ accountId, asOf })
    else if (range.from && range.to) setDrill({ accountId, range: { from: range.from, to: range.to } })
  }

  const setPresetAndDates = (p: RangePresetId) => {
    setPreset(p)
    if (p !== 'custom') {
      const r = presetRange(p)
      setFrom(r.from); setTo(r.to); setAsOf(r.to)
    }
  }

  const load = useCallback(async () => {
    if (!currentEntity) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ entityId: currentEntity.id, type: def.id })
      if (def.needsRange) { params.set('from', from); params.set('to', to) }
      if (def.needsAsOf)  { params.set('asOf', asOf) }
      const res = await fetch(`/api/reports?${params}`)
      if (!res.ok) {
        const e = await res.json(); showToast(e.error ?? 'Failed to load report', 'err'); return
      }
      setData(await res.json())
    } finally { setLoading(false) }
  }, [currentEntity, def, from, to, asOf, showToast])

  useEffect(() => { load() }, [load])

  const exportCsv = () => {
    if (!data) return
    const rows = reportToCsvRows(def, data)
    if (!rows.length) { showToast('Nothing to export yet', 'err'); return }
    const csv = rows.map(r => r.map(cell => {
      const s = String(cell ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${def.id}-${(def.needsAsOf ? asOf : `${from}_to_${to}`)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div style={S.pageActions}>
        <button style={S.btn} onClick={onBack}>← All reports</button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={S.btn} onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
          <button style={{ ...S.btn, ...S.btnPrimary }} onClick={exportCsv} disabled={!data}>Export CSV</button>
          <button style={S.btn} onClick={() => window.print()}>Print</button>
        </div>
      </div>

      {/* Customization bar */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {def.needsRange && (
            <>
              <div>
                <label style={S.label}>Period</label>
                <select style={{ ...S.select, minWidth: 160 }} value={preset} onChange={e => setPresetAndDates(e.target.value as RangePresetId)}>
                  <option value="today">Today</option>
                  <option value="this-month">This month</option>
                  <option value="last-month">Last month</option>
                  <option value="this-quarter">This quarter</option>
                  <option value="last-quarter">Last quarter</option>
                  <option value="ytd">Year to date</option>
                  <option value="this-year">This year</option>
                  <option value="last-year">Last year</option>
                  <option value="custom">Custom…</option>
                </select>
              </div>
              <div>
                <label style={S.label}>From</label>
                <input style={S.input} type="date" value={from} onChange={e => { setFrom(e.target.value); setPreset('custom') }} />
              </div>
              <div>
                <label style={S.label}>To</label>
                <input style={S.input} type="date" value={to} onChange={e => { setTo(e.target.value); setPreset('custom') }} />
              </div>
            </>
          )}
          {def.needsAsOf && (
            <div>
              <label style={S.label}>As of</label>
              <input style={S.input} type="date" value={asOf} onChange={e => setAsOf(e.target.value)} />
            </div>
          )}
        </div>
      </div>

      {/* Report body */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 28 }}>
        <div style={{ textAlign: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>{currentEntity?.name}</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{def.name}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
            {def.needsRange && `${fmtDate(from)} — ${fmtDate(to)}`}
            {def.needsAsOf && `As of ${fmtDate(asOf)}`}
          </div>
        </div>

        {loading && <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>Generating report…</div>}
        {!loading && data && <ReportBody def={def} data={data} onDrill={handleDrill} dateContext={{ from, to, asOf }} />}
        {!loading && !data && <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>No data</div>}
      </div>
      {drill && (
        <DrillDownModal
          accountId={drill.accountId}
          range={drill.range}
          asOf={drill.asOf}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  )
}

// ─── Renderers per report type ────────────────────────────────────────────────
function ReportBody({ def, data, onDrill, dateContext }: {
  def: ReportDef
  data: unknown
  onDrill?: (accountId: string, range: { from?: string; to?: string }) => void
  dateContext?: { from: string; to: string; asOf: string }
}) {
  const range = dateContext ? { from: dateContext.from, to: dateContext.to } : undefined
  switch (def.id) {
    case 'pnl':                return <PnlReport data={data as PnlData} />
    case 'pnl-comparison':     return <PnlComparisonReport data={data as PnlComparisonData} />
    case 'balance-sheet':      return <BalanceSheetReport data={data as BsData} />
    case 'cash-flows':         return <CashFlowsReport data={data as CashFlowsData} />
    case 'trial-balance':      return <TrialBalanceReport data={data as TrialBalanceData} onDrill={onDrill} range={range} />
    case 'general-ledger':     return <GeneralLedgerReport data={data as GlData} />
    case 'journal':            return <JournalReportView data={data as JournalData} />
    case 'ap-aging':           return <ApAgingReport data={data as ApAgingData} />
    case 'ap-aging-detail':    return <ApAgingDetailReport data={data as ApAgingDetailData} />
    case 'expenses-by-vendor': return <ExpensesByVendorReport data={data as ExpensesByVendorData} />
    default:                   return <pre style={{ fontSize: 11 }}>{JSON.stringify(data, null, 2)}</pre>
  }
}

// ─── Data shapes ──────────────────────────────────────────────────────────────
interface AmtRow { code: string; name: string; amount: number }
interface PnlData {
  revenue: AmtRow[]; cogs: AmtRow[]; expenses: AmtRow[]
  totalRevenue: number; totalCogs: number; grossProfit: number; grossMargin: number
  totalExpenses: number; netIncome: number; netMargin: number
}
interface PnlComparisonData { current: PnlData; prior: PnlData; priorYear: PnlData }
interface BsData {
  assets: AmtRow[]; liabilities: AmtRow[]; equity: AmtRow[]
  totalAssets: number; totalLiabilities: number; totalEquity: number
  totalLiabilitiesAndEquity: number; balanced: boolean
}
interface CashFlowsData {
  operating: { netIncome: number; adjustments: { code: string; name: string; amount: number; direction?: string }[]; total: number }
  investing: { items: { code: string; name: string; amount: number }[]; total: number }
  financing: { items: { code: string; name: string; amount: number }[]; total: number }
  netCashChange: number; cashAtStart: number; cashAtEnd: number
}
interface TrialBalanceData {
  rows: { accountId: string; code: string; name: string; type: string; debit: number; credit: number }[]
  totalDebit: number; totalCredit: number; balanced: boolean
  range: { from?: string | Date; to?: string | Date }
}
interface GlData {
  accounts: {
    account: { code: string; name: string; type: string }
    opening: number; closing: number
    entries: { date: string; ref: string; description: string | null; debit: number; credit: number; balance: number }[]
  }[]
}
interface JournalData {
  entries: {
    date: string; ref: string; description: string | null; source: string | null
    lines: { accountCode: string; accountName: string; description: string | null; debit: number; credit: number }[]
    totalDebit: number; totalCredit: number
  }[]
  totalEntries: number; totalDebit: number; totalCredit: number
}
interface ApAgingData {
  rows: { vendor: string; invoiceNo: string; dueDate: string; daysOverdue: number; balance: number; bucket: string }[]
  buckets: { current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number }
  total: number
}
interface ApAgingDetailData {
  vendors: {
    vendor: string
    invoices: { invoiceNo: string; invoiceDate: string; dueDate: string; daysOverdue: number; amount: number; amountPaid: number; balance: number; bucket: string; status: string }[]
    total: number
  }[]
  grandTotal: number
}
interface ExpensesByVendorData {
  rows: { vendor: string; totalAmount: number; invoiceCount: number }[]
  grandTotal: number; totalInvoices: number
}

// ─── Report renderers ─────────────────────────────────────────────────────────
const reportTableHeader = { background: '#f8fafc', fontWeight: 600, fontSize: 11, color: '#475569', textTransform: 'uppercase' as const, letterSpacing: 0.06, padding: '8px 12px', borderBottom: '1px solid #e2e8f0', textAlign: 'left' as const }
const reportTableCell   = { padding: '6px 12px', fontSize: 13, borderBottom: '1px solid #f1f5f9' }
const reportSectionRow  = { padding: '12px 12px 6px', fontSize: 12, fontWeight: 600, color: '#0f172a', textTransform: 'uppercase' as const, letterSpacing: 0.06 }
const reportSubtotalRow = { padding: '8px 12px', fontSize: 13, fontWeight: 600, borderTop: '1px solid #e2e8f0', background: '#f8fafc' }
const reportGrandTotal  = { padding: '12px', fontSize: 14, fontWeight: 700, borderTop: '2px solid #0f172a', background: '#f8fafc' }

function moneyCell(n: number, opts: { bold?: boolean; negative?: boolean } = {}) {
  const negative = opts.negative ?? n < 0
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', color: negative ? '#dc2626' : 'inherit', fontWeight: opts.bold ? 600 : 'inherit' }}>
      {n < 0 ? '(' : ''}${fmt(Math.abs(n))}{n < 0 ? ')' : ''}
    </span>
  )
}

function PnlReport({ data }: { data: PnlData }) {
  const Row = ({ row }: { row: AmtRow }) => (
    <tr><td style={{ ...reportTableCell, paddingLeft: 28 }}>{row.code} — {row.name}</td><td style={{ ...reportTableCell, textAlign: 'right' }}>{moneyCell(row.amount)}</td></tr>
  )
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <tbody>
        <tr><td style={reportSectionRow} colSpan={2}>Income</td></tr>
        {data.revenue.length === 0 && <tr><td colSpan={2} style={{ ...reportTableCell, paddingLeft: 28, color: '#94a3b8' }}>No revenue in period</td></tr>}
        {data.revenue.map(r => <Row key={r.code} row={r} />)}
        <tr><td style={reportSubtotalRow}>Total Income</td><td style={{ ...reportSubtotalRow, textAlign: 'right' }}>{moneyCell(data.totalRevenue, { bold: true })}</td></tr>

        {data.cogs.length > 0 && <>
          <tr><td style={reportSectionRow} colSpan={2}>Cost of Goods Sold</td></tr>
          {data.cogs.map(r => <Row key={r.code} row={r} />)}
          <tr><td style={reportSubtotalRow}>Total COGS</td><td style={{ ...reportSubtotalRow, textAlign: 'right' }}>{moneyCell(data.totalCogs, { bold: true })}</td></tr>
          <tr><td style={{ ...reportSubtotalRow, background: '#f0fdf4' }}>Gross Profit</td><td style={{ ...reportSubtotalRow, background: '#f0fdf4', textAlign: 'right' }}>{moneyCell(data.grossProfit, { bold: true })}</td></tr>
        </>}

        <tr><td style={reportSectionRow} colSpan={2}>Expenses</td></tr>
        {data.expenses.length === 0 && <tr><td colSpan={2} style={{ ...reportTableCell, paddingLeft: 28, color: '#94a3b8' }}>No expenses in period</td></tr>}
        {data.expenses.map(r => <Row key={r.code} row={r} />)}
        <tr><td style={reportSubtotalRow}>Total Expenses</td><td style={{ ...reportSubtotalRow, textAlign: 'right' }}>{moneyCell(data.totalExpenses, { bold: true })}</td></tr>

        <tr><td style={{ ...reportGrandTotal, background: data.netIncome >= 0 ? '#f0fdf4' : '#fef2f2' }}>Net Income</td><td style={{ ...reportGrandTotal, background: data.netIncome >= 0 ? '#f0fdf4' : '#fef2f2', textAlign: 'right' }}>{moneyCell(data.netIncome, { bold: true })}</td></tr>
        {data.totalRevenue > 0 && <tr><td style={{ ...reportTableCell, color: '#64748b', fontSize: 11 }}>Net margin</td><td style={{ ...reportTableCell, color: '#64748b', fontSize: 11, textAlign: 'right' }}>{(data.netMargin * 100).toFixed(1)}%</td></tr>}
      </tbody>
    </table>
  )
}

function PnlComparisonReport({ data }: { data: PnlComparisonData }) {
  const renderRow = (label: string, c: number, p: number, py: number, opts: { bold?: boolean; emphasize?: boolean } = {}) => {
    const change = c - p
    const pctChange = p !== 0 ? (change / Math.abs(p)) * 100 : null
    const style = opts.emphasize ? reportGrandTotal : opts.bold ? reportSubtotalRow : { ...reportTableCell, paddingLeft: 28 }
    const right = { ...style, textAlign: 'right' as const }
    return (
      <tr>
        <td style={style}>{label}</td>
        <td style={right}>{moneyCell(c, { bold: opts.bold })}</td>
        <td style={right}>{moneyCell(p, { bold: opts.bold })}</td>
        <td style={right}><span style={{ color: change >= 0 ? '#16a34a' : '#dc2626', fontVariantNumeric: 'tabular-nums', fontWeight: opts.bold ? 600 : 'inherit' }}>{change >= 0 ? '+' : ''}{fmt(change)}{pctChange !== null && ` (${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(1)}%)`}</span></td>
        <td style={right}>{moneyCell(py, { bold: opts.bold })}</td>
      </tr>
    )
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={reportTableHeader}></th>
          <th style={{ ...reportTableHeader, textAlign: 'right' }}>Current</th>
          <th style={{ ...reportTableHeader, textAlign: 'right' }}>Prior Period</th>
          <th style={{ ...reportTableHeader, textAlign: 'right' }}>Change</th>
          <th style={{ ...reportTableHeader, textAlign: 'right' }}>Prior Year</th>
        </tr>
      </thead>
      <tbody>
        {renderRow('Total Income', data.current.totalRevenue, data.prior.totalRevenue, data.priorYear.totalRevenue, { bold: true })}
        {data.current.totalCogs > 0 && renderRow('Total COGS', data.current.totalCogs, data.prior.totalCogs, data.priorYear.totalCogs, { bold: true })}
        {data.current.totalCogs > 0 && renderRow('Gross Profit', data.current.grossProfit, data.prior.grossProfit, data.priorYear.grossProfit, { bold: true })}
        {renderRow('Total Expenses', data.current.totalExpenses, data.prior.totalExpenses, data.priorYear.totalExpenses, { bold: true })}
        {renderRow('Net Income', data.current.netIncome, data.prior.netIncome, data.priorYear.netIncome, { emphasize: true })}
      </tbody>
    </table>
  )
}

function BalanceSheetReport({ data }: { data: BsData }) {
  const section = (title: string, rows: AmtRow[], total: number, totalLabel: string) => (
    <>
      <tr><td style={reportSectionRow} colSpan={2}>{title}</td></tr>
      {rows.length === 0 && <tr><td colSpan={2} style={{ ...reportTableCell, paddingLeft: 28, color: '#94a3b8' }}>None</td></tr>}
      {rows.map(r => <tr key={r.code}><td style={{ ...reportTableCell, paddingLeft: 28 }}>{r.code} — {r.name}</td><td style={{ ...reportTableCell, textAlign: 'right' }}>{moneyCell(r.amount)}</td></tr>)}
      <tr><td style={reportSubtotalRow}>{totalLabel}</td><td style={{ ...reportSubtotalRow, textAlign: 'right' }}>{moneyCell(total, { bold: true })}</td></tr>
    </>
  )
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <tbody>
        {section('Assets',      data.assets,      data.totalAssets,      'Total Assets')}
        {section('Liabilities', data.liabilities, data.totalLiabilities, 'Total Liabilities')}
        {section('Equity',      data.equity,      data.totalEquity,      'Total Equity')}
        <tr><td style={reportGrandTotal}>Total Liabilities and Equity</td><td style={{ ...reportGrandTotal, textAlign: 'right' }}>{moneyCell(data.totalLiabilitiesAndEquity, { bold: true })}</td></tr>
        {!data.balanced && <tr><td colSpan={2} style={{ padding: 12, color: '#dc2626', fontSize: 12, textAlign: 'center', background: '#fef2f2' }}>⚠ Out of balance by ${fmt(Math.abs(data.totalAssets - data.totalLiabilitiesAndEquity))}</td></tr>}
      </tbody>
    </table>
  )
}

function CashFlowsReport({ data }: { data: CashFlowsData }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <tbody>
        <tr><td style={reportSectionRow} colSpan={2}>Cash from Operating Activities</td></tr>
        <tr><td style={{ ...reportTableCell, paddingLeft: 28 }}>Net Income</td><td style={{ ...reportTableCell, textAlign: 'right' }}>{moneyCell(data.operating.netIncome)}</td></tr>
        {data.operating.adjustments.length > 0 && <tr><td colSpan={2} style={{ ...reportTableCell, paddingLeft: 28, color: '#64748b', fontSize: 11 }}>Adjustments for changes in working capital:</td></tr>}
        {data.operating.adjustments.map(a => <tr key={a.code}><td style={{ ...reportTableCell, paddingLeft: 44 }}>{a.code} — {a.name}</td><td style={{ ...reportTableCell, textAlign: 'right' }}>{moneyCell(a.amount)}</td></tr>)}
        <tr><td style={reportSubtotalRow}>Net Cash from Operating Activities</td><td style={{ ...reportSubtotalRow, textAlign: 'right' }}>{moneyCell(data.operating.total, { bold: true })}</td></tr>

        <tr><td style={reportSectionRow} colSpan={2}>Cash from Investing Activities</td></tr>
        {data.investing.items.length === 0 && <tr><td colSpan={2} style={{ ...reportTableCell, paddingLeft: 28, color: '#94a3b8' }}>No investing activity</td></tr>}
        {data.investing.items.map(a => <tr key={a.code}><td style={{ ...reportTableCell, paddingLeft: 28 }}>{a.code} — {a.name}</td><td style={{ ...reportTableCell, textAlign: 'right' }}>{moneyCell(a.amount)}</td></tr>)}
        <tr><td style={reportSubtotalRow}>Net Cash from Investing</td><td style={{ ...reportSubtotalRow, textAlign: 'right' }}>{moneyCell(data.investing.total, { bold: true })}</td></tr>

        <tr><td style={reportSectionRow} colSpan={2}>Cash from Financing Activities</td></tr>
        {data.financing.items.length === 0 && <tr><td colSpan={2} style={{ ...reportTableCell, paddingLeft: 28, color: '#94a3b8' }}>No financing activity</td></tr>}
        {data.financing.items.map(a => <tr key={a.code}><td style={{ ...reportTableCell, paddingLeft: 28 }}>{a.code} — {a.name}</td><td style={{ ...reportTableCell, textAlign: 'right' }}>{moneyCell(a.amount)}</td></tr>)}
        <tr><td style={reportSubtotalRow}>Net Cash from Financing</td><td style={{ ...reportSubtotalRow, textAlign: 'right' }}>{moneyCell(data.financing.total, { bold: true })}</td></tr>

        <tr><td style={reportGrandTotal}>Net Change in Cash</td><td style={{ ...reportGrandTotal, textAlign: 'right' }}>{moneyCell(data.netCashChange, { bold: true })}</td></tr>
        <tr><td style={reportTableCell}>Cash at beginning of period</td><td style={{ ...reportTableCell, textAlign: 'right' }}>{moneyCell(data.cashAtStart)}</td></tr>
        <tr><td style={{ ...reportTableCell, fontWeight: 600 }}>Cash at end of period</td><td style={{ ...reportTableCell, textAlign: 'right', fontWeight: 600 }}>{moneyCell(data.cashAtEnd, { bold: true })}</td></tr>
      </tbody>
    </table>
  )
}

function TrialBalanceReport({ data, onDrill, range }: { data: TrialBalanceData; onDrill?: (accountId: string, range: { from?: string; to?: string }) => void; range?: { from: string; to: string } }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr>
        <th style={reportTableHeader}>Account</th>
        <th style={{ ...reportTableHeader, textAlign: 'right' }}>Debit</th>
        <th style={{ ...reportTableHeader, textAlign: 'right' }}>Credit</th>
      </tr></thead>
      <tbody>
        {data.rows.map(r => {
          const drillable = !!onDrill && (r.debit > 0 || r.credit > 0)
          return (
            <tr
              key={r.accountId ?? r.code}
              style={drillable ? { cursor: 'pointer' } : undefined}
              onMouseEnter={drillable ? (e) => (e.currentTarget.style.background = '#f8fafc') : undefined}
              onMouseLeave={drillable ? (e) => (e.currentTarget.style.background = '') : undefined}
              onClick={drillable && onDrill && range ? () => onDrill(r.accountId, range) : undefined}
            >
              <td style={reportTableCell}>
                {r.code} — {r.name}
                {drillable && <span style={{ marginLeft: 6, fontSize: 10, color: '#0ea5e9' }}>›</span>}
              </td>
              <td style={{ ...reportTableCell, textAlign: 'right' }}>{r.debit > 0 ? `$${fmt(r.debit)}` : ''}</td>
              <td style={{ ...reportTableCell, textAlign: 'right' }}>{r.credit > 0 ? `$${fmt(r.credit)}` : ''}</td>
            </tr>
          )
        })}
        <tr>
          <td style={reportGrandTotal}>Total</td>
          <td style={{ ...reportGrandTotal, textAlign: 'right' }}>${fmt(data.totalDebit)}</td>
          <td style={{ ...reportGrandTotal, textAlign: 'right' }}>${fmt(data.totalCredit)}</td>
        </tr>
        {!data.balanced && <tr><td colSpan={3} style={{ padding: 12, color: '#dc2626', fontSize: 12, textAlign: 'center', background: '#fef2f2' }}>⚠ Trial balance does not tie — investigate before relying on this report</td></tr>}
      </tbody>
    </table>
  )
}

// ─── Drill-down modal ─────────────────────────────────────────────────────────
interface DrillLine {
  id: string
  date: string
  ref: string
  entryId: string
  entryDescription: string | null
  entryStatus: string
  lineDescription: string | null
  debit: number
  credit: number
  runningBalance: number
}
interface DrillResp {
  account: { id: string; code: string; name: string; type: string; subType: string | null }
  openingBalance: number
  closingBalance: number
  totalDebit: number
  totalCredit: number
  lineCount: number
  lines: DrillLine[]
}

function DrillDownModal({
  accountId, range, asOf, onClose,
}: {
  accountId: string
  range?: { from: string; to: string }
  asOf?: string
  onClose: () => void
}) {
  const { currentEntity } = useApp()
  const [data, setData] = useState<DrillResp | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentEntity) return
    setLoading(true)
    const sp = new URLSearchParams({ entityId: currentEntity.id, accountId })
    if (asOf) sp.set('asOf', asOf)
    else if (range) { sp.set('from', range.from); sp.set('to', range.to) }
    fetch(`/api/reports/drilldown?${sp}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setData(d) })
      .finally(() => setLoading(false))
  }, [currentEntity, accountId, range, asOf])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        zIndex: 1000, padding: '40px 20px', overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff', borderRadius: 8, width: '100%', maxWidth: 900,
          padding: 24, boxShadow: '0 20px 50px rgba(15,23,42,0.3)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.06 }}>Drill-down</div>
            {data && <div style={{ fontSize: 18, fontWeight: 700 }}>{data.account.code} — {data.account.name}</div>}
          </div>
          <button onClick={onClose} style={{ ...S.btn, padding: '4px 12px' }}>✕</button>
        </div>

        {loading && <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>}
        {!loading && data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
              <div style={{ padding: 10, background: '#f8fafc', borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase' }}>Opening</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14 }}>${fmt(data.openingBalance)}</div>
              </div>
              <div style={{ padding: 10, background: '#fef2f2', borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase' }}>Total debits</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14, color: '#dc2626' }}>${fmt(data.totalDebit)}</div>
              </div>
              <div style={{ padding: 10, background: '#f0fdf4', borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase' }}>Total credits</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14, color: '#16a34a' }}>${fmt(data.totalCredit)}</div>
              </div>
              <div style={{ padding: 10, background: '#eff6ff', borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase' }}>Closing</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14, color: '#1d4ed8' }}>${fmt(data.closingBalance)}</div>
              </div>
            </div>

            <div style={{ maxHeight: 480, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
              <table style={S.table}>
                <thead style={{ position: 'sticky', top: 0, background: '#fff' }}>
                  <tr>{['Date','Ref','Description','Memo','Debit','Credit','Balance'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {data.lines.length === 0 && <tr><td colSpan={7} style={{ ...S.td, textAlign: 'center', color: '#94a3b8' }}>No journal lines in this period</td></tr>}
                  {data.lines.map(l => (
                    <tr key={l.id}>
                      <td style={{ ...S.td, fontSize: 11 }}>{fmtDate(l.date)}</td>
                      <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>{l.ref}</td>
                      <td style={{ ...S.td, fontSize: 12 }}>{l.entryDescription ?? '—'}</td>
                      <td style={{ ...S.td, fontSize: 11, color: '#64748b' }}>{l.lineDescription ?? '—'}</td>
                      <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', color: '#dc2626' }}>{l.debit > 0 ? `$${fmt(l.debit)}` : ''}</td>
                      <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', color: '#16a34a' }}>{l.credit > 0 ? `$${fmt(l.credit)}` : ''}</td>
                      <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>${fmt(l.runningBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: '#64748b' }}>
              Showing {data.lineCount} line{data.lineCount === 1 ? '' : 's'}. Click outside or ✕ to close.
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function GeneralLedgerReport({ data }: { data: GlData }) {
  if (data.accounts.length === 0) return <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No activity in this period</div>
  return (
    <div>
      {data.accounts.map(a => (
        <div key={a.account.code} style={{ marginBottom: 24 }}>
          <div style={{ padding: '8px 12px', background: '#f1f5f9', borderRadius: 6, marginBottom: 6, fontWeight: 600, fontSize: 13 }}>
            {a.account.code} — {a.account.name}
            <span style={{ float: 'right', fontWeight: 400, color: '#64748b', fontSize: 12 }}>Opening: ${fmt(a.opening)} • Closing: ${fmt(a.closing)}</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={reportTableHeader}>Date</th>
              <th style={reportTableHeader}>Ref</th>
              <th style={reportTableHeader}>Description</th>
              <th style={{ ...reportTableHeader, textAlign: 'right' }}>Debit</th>
              <th style={{ ...reportTableHeader, textAlign: 'right' }}>Credit</th>
              <th style={{ ...reportTableHeader, textAlign: 'right' }}>Balance</th>
            </tr></thead>
            <tbody>
              {a.entries.map((e, i) => (
                <tr key={i}>
                  <td style={reportTableCell}>{fmtDate(e.date)}</td>
                  <td style={{ ...reportTableCell, fontFamily: 'monospace', fontSize: 11 }}>{e.ref}</td>
                  <td style={{ ...reportTableCell, color: '#64748b' }}>{e.description}</td>
                  <td style={{ ...reportTableCell, textAlign: 'right' }}>{e.debit > 0 ? `$${fmt(e.debit)}` : ''}</td>
                  <td style={{ ...reportTableCell, textAlign: 'right' }}>{e.credit > 0 ? `$${fmt(e.credit)}` : ''}</td>
                  <td style={{ ...reportTableCell, textAlign: 'right', fontWeight: 500 }}>${fmt(e.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

function JournalReportView({ data }: { data: JournalData }) {
  if (data.entries.length === 0) return <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No posted entries in this period</div>
  return (
    <div>
      <div style={{ display: 'flex', gap: 24, marginBottom: 16, fontSize: 13, color: '#475569' }}>
        <div><strong>{data.totalEntries}</strong> entries</div>
        <div>Total debits: <strong>${fmt(data.totalDebit)}</strong></div>
        <div>Total credits: <strong>${fmt(data.totalCredit)}</strong></div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={reportTableHeader}>Date / Ref</th>
          <th style={reportTableHeader}>Account</th>
          <th style={reportTableHeader}>Description</th>
          <th style={{ ...reportTableHeader, textAlign: 'right' }}>Debit</th>
          <th style={{ ...reportTableHeader, textAlign: 'right' }}>Credit</th>
        </tr></thead>
        <tbody>
          {data.entries.map((entry, i) => (
            <Fragment key={i}>
              <tr>
                <td style={{ ...reportTableCell, fontWeight: 600, verticalAlign: 'top' }} rowSpan={entry.lines.length + 1}>
                  <div>{fmtDate(entry.date)}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#64748b', fontWeight: 400 }}>{entry.ref}</div>
                  {entry.description && <div style={{ fontSize: 11, color: '#64748b', fontWeight: 400, marginTop: 4 }}>{entry.description}</div>}
                </td>
              </tr>
              {entry.lines.map((l, j) => (
                <tr key={j}>
                  <td style={reportTableCell}>{l.accountCode} — {l.accountName}</td>
                  <td style={{ ...reportTableCell, color: '#64748b', fontSize: 12 }}>{l.description ?? ''}</td>
                  <td style={{ ...reportTableCell, textAlign: 'right' }}>{l.debit > 0 ? `$${fmt(l.debit)}` : ''}</td>
                  <td style={{ ...reportTableCell, textAlign: 'right' }}>{l.credit > 0 ? `$${fmt(l.credit)}` : ''}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ApAgingReport({ data }: { data: ApAgingData }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginBottom: 20 }}>
        {[
          { label: 'Current', value: data.buckets.current, color: '#16a34a' },
          { label: '1-30 days', value: data.buckets.d1_30, color: '#eab308' },
          { label: '31-60 days', value: data.buckets.d31_60, color: '#f97316' },
          { label: '61-90 days', value: data.buckets.d61_90, color: '#dc2626' },
          { label: '>90 days', value: data.buckets.d90plus, color: '#991b1b' },
          { label: 'Total', value: data.total, color: '#0f172a' },
        ].map(b => (
          <div key={b.label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.06, marginBottom: 4 }}>{b.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: b.color }}>${fmt(b.value)}</div>
          </div>
        ))}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={reportTableHeader}>Vendor</th>
          <th style={reportTableHeader}>Invoice</th>
          <th style={reportTableHeader}>Due Date</th>
          <th style={{ ...reportTableHeader, textAlign: 'right' }}>Days Overdue</th>
          <th style={{ ...reportTableHeader, textAlign: 'right' }}>Balance</th>
        </tr></thead>
        <tbody>
          {data.rows.length === 0 && <tr><td colSpan={5} style={{ ...reportTableCell, textAlign: 'center', color: '#94a3b8', padding: 24 }}>No open bills</td></tr>}
          {data.rows.map((r, i) => (
            <tr key={i}>
              <td style={reportTableCell}>{r.vendor}</td>
              <td style={{ ...reportTableCell, fontFamily: 'monospace', fontSize: 11 }}>{r.invoiceNo}</td>
              <td style={reportTableCell}>{fmtDate(r.dueDate)}</td>
              <td style={{ ...reportTableCell, textAlign: 'right', color: r.daysOverdue > 0 ? '#dc2626' : '#16a34a' }}>{r.daysOverdue > 0 ? r.daysOverdue : 'Current'}</td>
              <td style={{ ...reportTableCell, textAlign: 'right', fontWeight: 500 }}>${fmt(r.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ApAgingDetailReport({ data }: { data: ApAgingDetailData }) {
  if (data.vendors.length === 0) return <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No open bills</div>
  return (
    <div>
      {data.vendors.map(v => (
        <div key={v.vendor} style={{ marginBottom: 20 }}>
          <div style={{ padding: '8px 12px', background: '#f1f5f9', borderRadius: 6, marginBottom: 6, fontWeight: 600, fontSize: 13 }}>
            {v.vendor}
            <span style={{ float: 'right', fontWeight: 600 }}>${fmt(v.total)}</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={reportTableHeader}>Invoice</th>
              <th style={reportTableHeader}>Invoice Date</th>
              <th style={reportTableHeader}>Due Date</th>
              <th style={{ ...reportTableHeader, textAlign: 'right' }}>Original</th>
              <th style={{ ...reportTableHeader, textAlign: 'right' }}>Paid</th>
              <th style={{ ...reportTableHeader, textAlign: 'right' }}>Days OD</th>
              <th style={{ ...reportTableHeader, textAlign: 'right' }}>Balance</th>
            </tr></thead>
            <tbody>
              {v.invoices.map(inv => (
                <tr key={inv.invoiceNo}>
                  <td style={{ ...reportTableCell, fontFamily: 'monospace', fontSize: 11 }}>{inv.invoiceNo}</td>
                  <td style={reportTableCell}>{fmtDate(inv.invoiceDate)}</td>
                  <td style={reportTableCell}>{fmtDate(inv.dueDate)}</td>
                  <td style={{ ...reportTableCell, textAlign: 'right' }}>${fmt(inv.amount)}</td>
                  <td style={{ ...reportTableCell, textAlign: 'right', color: '#16a34a' }}>${fmt(inv.amountPaid)}</td>
                  <td style={{ ...reportTableCell, textAlign: 'right', color: inv.daysOverdue > 0 ? '#dc2626' : '#16a34a' }}>{inv.daysOverdue > 0 ? inv.daysOverdue : '—'}</td>
                  <td style={{ ...reportTableCell, textAlign: 'right', fontWeight: 500 }}>${fmt(inv.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div style={{ ...reportGrandTotal, display: 'flex', justifyContent: 'space-between' }}>
        <span>Grand Total</span>
        <span>${fmt(data.grandTotal)}</span>
      </div>
    </div>
  )
}

function ExpensesByVendorReport({ data }: { data: ExpensesByVendorData }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr>
        <th style={reportTableHeader}>Vendor</th>
        <th style={{ ...reportTableHeader, textAlign: 'right' }}>Invoices</th>
        <th style={{ ...reportTableHeader, textAlign: 'right' }}>Total</th>
        <th style={{ ...reportTableHeader, textAlign: 'right' }}>% of Total</th>
      </tr></thead>
      <tbody>
        {data.rows.length === 0 && <tr><td colSpan={4} style={{ ...reportTableCell, textAlign: 'center', color: '#94a3b8', padding: 24 }}>No expenses in this period</td></tr>}
        {data.rows.map(r => (
          <tr key={r.vendor}>
            <td style={reportTableCell}>{r.vendor}</td>
            <td style={{ ...reportTableCell, textAlign: 'right' }}>{r.invoiceCount}</td>
            <td style={{ ...reportTableCell, textAlign: 'right' }}>${fmt(r.totalAmount)}</td>
            <td style={{ ...reportTableCell, textAlign: 'right', color: '#64748b' }}>{data.grandTotal > 0 ? `${(r.totalAmount / data.grandTotal * 100).toFixed(1)}%` : '—'}</td>
          </tr>
        ))}
        <tr>
          <td style={reportGrandTotal}>Total</td>
          <td style={{ ...reportGrandTotal, textAlign: 'right' }}>{data.totalInvoices}</td>
          <td style={{ ...reportGrandTotal, textAlign: 'right' }}>${fmt(data.grandTotal)}</td>
          <td style={{ ...reportGrandTotal, textAlign: 'right' }}>100%</td>
        </tr>
      </tbody>
    </table>
  )
}

// ─── CSV export per report ────────────────────────────────────────────────────
function reportToCsvRows(def: ReportDef, data: unknown): (string | number)[][] {
  if (!data || typeof data !== 'object') return []
  const d = data as Record<string, unknown>
  switch (def.id) {
    case 'pnl': {
      const p = d as unknown as PnlData
      const out: (string | number)[][] = [['Section','Code','Name','Amount']]
      p.revenue.forEach(r => out.push(['Revenue', r.code, r.name, r.amount]))
      out.push(['','','Total Revenue', p.totalRevenue])
      p.cogs.forEach(r => out.push(['COGS', r.code, r.name, r.amount]))
      if (p.cogs.length) out.push(['','','Gross Profit', p.grossProfit])
      p.expenses.forEach(r => out.push(['Expense', r.code, r.name, r.amount]))
      out.push(['','','Total Expenses', p.totalExpenses])
      out.push(['','','Net Income', p.netIncome])
      return out
    }
    case 'balance-sheet': {
      const b = d as unknown as BsData
      const out: (string | number)[][] = [['Section','Code','Name','Amount']]
      b.assets.forEach(r => out.push(['Assets', r.code, r.name, r.amount]))
      out.push(['','','Total Assets', b.totalAssets])
      b.liabilities.forEach(r => out.push(['Liabilities', r.code, r.name, r.amount]))
      b.equity.forEach(r => out.push(['Equity', r.code, r.name, r.amount]))
      out.push(['','','Total Liabilities + Equity', b.totalLiabilitiesAndEquity])
      return out
    }
    case 'trial-balance': {
      const t = d as unknown as TrialBalanceData
      const out: (string | number)[][] = [['Code','Name','Type','Debit','Credit']]
      t.rows.forEach(r => out.push([r.code, r.name, r.type, r.debit, r.credit]))
      out.push(['','','Total', t.totalDebit, t.totalCredit])
      return out
    }
    case 'journal': {
      const j = d as unknown as JournalData
      const out: (string | number)[][] = [['Date','Ref','Description','Account','Line Description','Debit','Credit']]
      j.entries.forEach(e => e.lines.forEach(l =>
        out.push([new Date(e.date).toISOString().slice(0,10), e.ref, e.description ?? '', `${l.accountCode} ${l.accountName}`, l.description ?? '', l.debit, l.credit])
      ))
      return out
    }
    case 'ap-aging': {
      const a = d as unknown as ApAgingData
      const out: (string | number)[][] = [['Vendor','Invoice','Due Date','Days Overdue','Bucket','Balance']]
      a.rows.forEach(r => out.push([r.vendor, r.invoiceNo, new Date(r.dueDate).toISOString().slice(0,10), r.daysOverdue, r.bucket, r.balance]))
      return out
    }
    case 'ap-aging-detail': {
      const a = d as unknown as ApAgingDetailData
      const out: (string | number)[][] = [['Vendor','Invoice','Invoice Date','Due Date','Days Overdue','Original','Paid','Balance']]
      a.vendors.forEach(v => v.invoices.forEach(i =>
        out.push([v.vendor, i.invoiceNo, new Date(i.invoiceDate).toISOString().slice(0,10), new Date(i.dueDate).toISOString().slice(0,10), i.daysOverdue, i.amount, i.amountPaid, i.balance])
      ))
      return out
    }
    case 'expenses-by-vendor': {
      const e = d as unknown as ExpensesByVendorData
      const out: (string | number)[][] = [['Vendor','Invoices','Total']]
      e.rows.forEach(r => out.push([r.vendor, r.invoiceCount, r.totalAmount]))
      out.push(['','Total', e.grandTotal])
      return out
    }
    default:
      // Generic fallback: dump the JSON shape one key per row.
      return [['key','value'], ...Object.entries(d).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])]
  }
}

// ─── Audit Trail ──────────────────────────────────────────────────────────────
interface AuditEntry {
  id: string
  action: string
  resource: string
  resourceId: string | null
  oldValue: string | null
  newValue: string | null
  ipAddress: string | null
  createdAt: string
  userId: string | null
  user: { id: string; email: string; name: string } | null
}
interface AuditFacets {
  actions: { value: string; count: number }[]
  resources: { value: string; count: number }[]
}

// Color the action badge based on a coarse classification of the verb.
const actionTone = (action: string): { bg: string; fg: string } => {
  const a = action.toUpperCase()
  if (/(VOID|DELET|RELEASE|REVOK|DISABL)/.test(a)) return { bg: '#fef2f2', fg: '#991b1b' }
  if (/(POST|CREAT|ISSU|ADD|GRANT|ENABL|LOCK|FINAL)/.test(a)) return { bg: '#f0fdf4', fg: '#166534' }
  if (/(UPDAT|EDIT|CHANG)/.test(a)) return { bg: '#eff6ff', fg: '#1d4ed8' }
  return { bg: '#f1f5f9', fg: '#475569' }
}

function AuditPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { currentEntity } = useApp()
  const today = new Date()
  const monthAgo = new Date(); monthAgo.setMonth(monthAgo.getMonth() - 1)
  const [filters, setFilters] = useState({
    from: monthAgo.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
    action: '',
    resource: '',
    search: '',
  })
  const [rows, setRows] = useState<AuditEntry[]>([])
  const [facets, setFacets] = useState<AuditFacets>({ actions: [], resources: [] })
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const limit = 50

  const load = useCallback(async () => {
    if (!currentEntity) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        entityId: currentEntity.id,
        page: String(page),
        limit: String(limit),
      })
      if (filters.from)     params.set('from', filters.from)
      if (filters.to)       params.set('to', filters.to)
      if (filters.action)   params.set('action', filters.action)
      if (filters.resource) params.set('resource', filters.resource)
      if (filters.search)   params.set('search', filters.search)
      const res = await fetch(`/api/audit?${params}`)
      if (!res.ok) {
        const e = await res.json(); showToast(e.error ?? 'Failed to load', 'err'); return
      }
      const data = await res.json()
      setRows(data.rows)
      setFacets(data.facets)
      setTotal(data.total)
      setTotalPages(data.totalPages)
    } finally { setLoading(false) }
  }, [currentEntity, filters, page, showToast])

  useEffect(() => { load() }, [load])

  const resetFilters = () => {
    setFilters({
      from: monthAgo.toISOString().slice(0, 10),
      to: today.toISOString().slice(0, 10),
      action: '', resource: '', search: '',
    })
    setPage(1)
  }

  const exportCsv = () => {
    if (rows.length === 0) { showToast('Nothing to export', 'err'); return }
    const header = ['Timestamp', 'User', 'Action', 'Resource', 'Resource ID', 'IP', 'Old Value', 'New Value']
    const csvRows = rows.map(r => [
      new Date(r.createdAt).toISOString(),
      r.user?.email ?? r.userId ?? 'system',
      r.action,
      r.resource,
      r.resourceId ?? '',
      r.ipAddress ?? '',
      r.oldValue ?? '',
      r.newValue ?? '',
    ])
    const csv = [header, ...csvRows].map(row =>
      row.map(cell => {
        const s = String(cell ?? '')
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }).join(',')
    ).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `audit-trail-${filters.from}_to_${filters.to}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div style={S.pageActions}>
        <div style={{ fontSize: 13, color: '#475569' }}>
          {loading ? 'Loading…' : `${total.toLocaleString()} ${total === 1 ? 'entry' : 'entries'}`}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.btn} onClick={load} disabled={loading}>Refresh</button>
          <button style={{ ...S.btn, ...S.btnPrimary }} onClick={exportCsv} disabled={rows.length === 0}>Export CSV</button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={S.label}>From</label>
            <input style={S.input} type="date" value={filters.from} onChange={e => { setFilters(f => ({ ...f, from: e.target.value })); setPage(1) }} />
          </div>
          <div>
            <label style={S.label}>To</label>
            <input style={S.input} type="date" value={filters.to} onChange={e => { setFilters(f => ({ ...f, to: e.target.value })); setPage(1) }} />
          </div>
          <div>
            <label style={S.label}>Action</label>
            <select style={S.select} value={filters.action} onChange={e => { setFilters(f => ({ ...f, action: e.target.value })); setPage(1) }}>
              <option value="">All actions</option>
              {facets.actions.map(a => <option key={a.value} value={a.value}>{a.value} ({a.count})</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>Resource</label>
            <select style={S.select} value={filters.resource} onChange={e => { setFilters(f => ({ ...f, resource: e.target.value })); setPage(1) }}>
              <option value="">All resources</option>
              {facets.resources.map(r => <option key={r.value} value={r.value}>{r.value} ({r.count})</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>Search ID</label>
            <input style={S.input} value={filters.search} onChange={e => { setFilters(f => ({ ...f, search: e.target.value })); setPage(1) }} placeholder="resource ID…" />
          </div>
          <div>
            <button style={{ ...S.btn, width: '100%', justifyContent: 'center' }} onClick={resetFilters}>Reset</button>
          </div>
        </div>
      </div>

      {/* Audit table */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['When','User','Action','Resource','Resource ID','IP','Details'].map(h => (
                <th key={h} style={{ background: '#f8fafc', fontWeight: 600, fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.06, padding: '10px 12px', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No audit entries matching these filters</td></tr>
            )}
            {rows.map(r => {
              const tone = actionTone(r.action)
              const isOpen = expandedId === r.id
              const hasValues = r.oldValue || r.newValue
              return (
                <Fragment key={r.id}>
                  <tr>
                    <td style={{ padding: '8px 12px', fontSize: 12, borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>
                      <div>{new Date(r.createdAt).toLocaleDateString()}</div>
                      <div style={{ color: '#94a3b8', fontSize: 11 }}>{new Date(r.createdAt).toLocaleTimeString()}</div>
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 12, borderBottom: '1px solid #f1f5f9' }}>
                      {r.user ? (
                        <div>
                          <div style={{ fontWeight: 500 }}>{r.user.name}</div>
                          <div style={{ color: '#94a3b8', fontSize: 11 }}>{r.user.email}</div>
                        </div>
                      ) : <span style={{ color: '#94a3b8' }}>system</span>}
                    </td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9' }}>
                      <span style={{ background: tone.bg, color: tone.fg, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, letterSpacing: 0.04 }}>{r.action}</span>
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 12, borderBottom: '1px solid #f1f5f9' }}>{r.resource}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11, fontFamily: 'monospace', color: '#64748b', borderBottom: '1px solid #f1f5f9' }}>{r.resourceId ?? '—'}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11, fontFamily: 'monospace', color: '#64748b', borderBottom: '1px solid #f1f5f9' }}>{r.ipAddress ?? '—'}</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>
                      {hasValues ? (
                        <button style={S.textBtn} onClick={() => setExpandedId(isOpen ? null : r.id)}>
                          {isOpen ? 'Hide' : 'Show'}
                        </button>
                      ) : <span style={{ color: '#cbd5e1', fontSize: 11 }}>—</span>}
                    </td>
                  </tr>
                  {isOpen && hasValues && (
                    <tr>
                      <td colSpan={7} style={{ padding: '0 12px 14px', background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: r.oldValue && r.newValue ? '1fr 1fr' : '1fr', gap: 12, marginTop: 8 }}>
                          {r.oldValue && <div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: '#dc2626', textTransform: 'uppercase', letterSpacing: 0.06, marginBottom: 4 }}>Before</div>
                            <pre style={{ background: '#fff', padding: 10, borderRadius: 6, border: '1px solid #fecaca', fontSize: 11, overflow: 'auto', maxHeight: 240, margin: 0 }}>{prettyJson(r.oldValue)}</pre>
                          </div>}
                          {r.newValue && <div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: '#16a34a', textTransform: 'uppercase', letterSpacing: 0.06, marginBottom: 4 }}>After</div>
                            <pre style={{ background: '#fff', padding: 10, borderRadius: 6, border: '1px solid #bbf7d0', fontSize: 11, overflow: 'auto', maxHeight: 240, margin: 0 }}>{prettyJson(r.newValue)}</pre>
                          </div>}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 16 }}>
          <button style={S.btn} disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Previous</button>
          <div style={{ fontSize: 13, color: '#64748b' }}>Page {page} of {totalPages}</div>
          <button style={S.btn} disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}
    </div>
  )
}

// Render a JSON string with indentation; gracefully fall back to raw text if not JSON.
function prettyJson(raw: string): string {
  try { return JSON.stringify(JSON.parse(raw), null, 2) }
  catch { return raw }
}

// ─── Fixed Assets ─────────────────────────────────────────────────────────────
type DepMethod = 'STRAIGHT_LINE' | 'DECLINING_BALANCE'

interface AssetCategory {
  id: string
  name: string
  description?: string | null
  depreciationMethod: DepMethod
  usefulLifeMonths: number
  depreciationRatePercent: number
  assetAccountId: string
  accumDepAccountId: string
  depExpenseAccountId: string
  assetAccount?:      { code: string; name: string }
  accumDepAccount?:   { code: string; name: string }
  depExpenseAccount?: { code: string; name: string }
  _count?: { assets: number }
}

interface FixedAsset {
  id: string
  categoryId: string
  assetNo: string
  description: string
  acquisitionDate: string
  cost: number
  salvageValue: number
  usefulLifeMonths: number
  depreciationMethod: DepMethod
  depreciationRatePercent: number
  status: 'ACTIVE' | 'DISPOSED' | 'FULLY_DEPRECIATED'
  disposalDate?: string | null
  disposalProceeds?: number | null
  location?: string | null
  serialNumber?: string | null
  category?: { id: string; name: string }
  accumulated: number
  bookValue: number
}

function AssetsPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { currentEntity, role } = useApp()
  const [tab, setTab] = useState<'register'|'categories'>('register')
  const canWrite = ['OWNER','ADMIN','ACCOUNTANT'].includes(role)
  const [showDepModal, setShowDepModal] = useState(false)

  return (
    <div>
      <div style={S.pageActions}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => setTab('register')} style={{ ...S.btn, ...(tab==='register' ? { background:'#0f172a', color:'#fff', borderColor:'#0f172a' } : {}) }}>Asset register</button>
          <button onClick={() => setTab('categories')} style={{ ...S.btn, ...(tab==='categories' ? { background:'#0f172a', color:'#fff', borderColor:'#0f172a' } : {}) }}>Categories</button>
        </div>
        {canWrite && tab === 'register' && (
          <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setShowDepModal(true)}>Run depreciation</button>
        )}
      </div>

      {tab === 'register'   && <AssetRegister showToast={showToast} canWrite={canWrite} />}
      {tab === 'categories' && <AssetCategories showToast={showToast} canWrite={canWrite} />}

      {showDepModal && <DepreciationRunModal onClose={() => setShowDepModal(false)} showToast={showToast} />}
    </div>
  )
}

// ─── Categories tab ────────────────────────────────────────────────────────────
function AssetCategories({ showToast, canWrite }: { showToast: (m: string, t?: 'ok'|'err') => void; canWrite: boolean }) {
  const { currentEntity } = useApp()
  const [categories, setCategories] = useState<AssetCategory[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    name: '', description: '', depreciationMethod: 'STRAIGHT_LINE' as DepMethod,
    usefulLifeMonths: '60', depreciationRatePercent: '20',
    assetAccountId: '', accumDepAccountId: '', depExpenseAccountId: '',
  })

  const load = useCallback(() => {
    if (!currentEntity) return
    fetch(`/api/asset-categories?entityId=${currentEntity.id}`).then(r => r.json()).then(d => setCategories(d.categories ?? []))
    fetch(`/api/accounts?entityId=${currentEntity.id}`).then(r => r.json()).then(setAccounts)
  }, [currentEntity])

  useEffect(() => { load() }, [load])

  // Bucket accounts so the dropdowns are pre-filtered to plausible choices.
  const assetAccounts   = accounts.filter(a => a.type === 'ASSET')
  const expenseAccounts = accounts.filter(a => a.type === 'EXPENSE')

  const save = async () => {
    if (!currentEntity) return
    const errs: string[] = []
    if (!form.name) errs.push('Name')
    if (!form.assetAccountId) errs.push('Asset account')
    if (!form.accumDepAccountId) errs.push('Accumulated depreciation account')
    if (!form.depExpenseAccountId) errs.push('Depreciation expense account')
    if (errs.length) return showToast(`Required: ${errs.join(', ')}`, 'err')

    const res = await fetch('/api/asset-categories', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityId: currentEntity.id,
        name: form.name,
        description: form.description || undefined,
        depreciationMethod: form.depreciationMethod,
        usefulLifeMonths: parseInt(form.usefulLifeMonths, 10) || 60,
        depreciationRatePercent: parseFloat(form.depreciationRatePercent) || 0,
        assetAccountId: form.assetAccountId,
        accumDepAccountId: form.accumDepAccountId,
        depExpenseAccountId: form.depExpenseAccountId,
      }),
    })
    if (res.ok) {
      showToast('Category created')
      setShowForm(false)
      setForm({ name: '', description: '', depreciationMethod: 'STRAIGHT_LINE', usefulLifeMonths: '60', depreciationRatePercent: '20', assetAccountId: '', accumDepAccountId: '', depExpenseAccountId: '' })
      load()
    } else {
      const d = await res.json(); showToast(d.error ?? 'Error', 'err')
    }
  }

  const del = async (id: string, name: string) => {
    if (!currentEntity) return
    if (!confirm(`Delete category "${name}"?`)) return
    const res = await fetch(`/api/asset-categories?entityId=${currentEntity.id}&id=${id}`, { method: 'DELETE' })
    if (res.ok) { showToast('Deleted'); load() }
    else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  return (
    <div>
      {canWrite && (
        <div style={{ marginBottom: 16 }}>
          <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setShowForm(o => !o)}>+ New category</button>
        </div>
      )}

      {showForm && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={S.cardHeader}>New asset category</div>
          <div style={S.formGrid}>
            <div><label style={S.label}>Name</label><input style={S.input} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Computer Equipment" /></div>
            <div><label style={S.label}>Description</label><input style={S.input} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div>
              <label style={S.label}>Depreciation method</label>
              <select style={S.select} value={form.depreciationMethod} onChange={e => setForm(f => ({ ...f, depreciationMethod: e.target.value as DepMethod }))}>
                <option value="STRAIGHT_LINE">Straight Line</option>
                <option value="DECLINING_BALANCE">Declining Balance</option>
              </select>
            </div>
            <div><label style={S.label}>Useful life (months)</label><input style={S.input} value={form.usefulLifeMonths} onChange={e => setForm(f => ({ ...f, usefulLifeMonths: e.target.value }))} placeholder="60" /></div>
            <div><label style={S.label}>Annual depreciation rate (%)</label><input style={S.input} value={form.depreciationRatePercent} onChange={e => setForm(f => ({ ...f, depreciationRatePercent: e.target.value }))} placeholder="20" /></div>
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', margin: '12px 0 4px', textTransform: 'uppercase', letterSpacing: 0.06 }}>GL accounts for postings</div>
          <div style={S.formGrid}>
            <div>
              <label style={S.label}>Fixed asset (cost)</label>
              <select style={S.select} value={form.assetAccountId} onChange={e => setForm(f => ({ ...f, assetAccountId: e.target.value }))}>
                <option value="">Select ASSET account…</option>
                {assetAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>Accumulated depreciation (contra-asset)</label>
              <select style={S.select} value={form.accumDepAccountId} onChange={e => setForm(f => ({ ...f, accumDepAccountId: e.target.value }))}>
                <option value="">Select ASSET account…</option>
                {assetAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>Depreciation expense</label>
              <select style={S.select} value={form.depExpenseAccountId} onChange={e => setForm(f => ({ ...f, depExpenseAccountId: e.target.value }))}>
                <option value="">Select EXPENSE account…</option>
                {expenseAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={save}>Save</button>
            <button style={S.btn} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={S.card}>
        <table style={S.table}>
          <thead><tr>{['Category','Method','Life','Rate','Asset acct','Accum dep acct','Expense acct','# assets',''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {categories.length === 0 && <tr><td colSpan={9} style={{ ...S.td, textAlign: 'center', color: '#94a3b8' }}>No categories yet — create one to start tracking assets</td></tr>}
            {categories.map(c => (
              <tr key={c.id}>
                <td style={{ ...S.td, fontWeight: 500 }}>{c.name}</td>
                <td style={{ ...S.td, fontSize: 12 }}>{c.depreciationMethod === 'STRAIGHT_LINE' ? 'Straight line' : 'Declining bal.'}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{c.usefulLifeMonths} mo</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{Number(c.depreciationRatePercent).toFixed(2)}%</td>
                <td style={{ ...S.td, fontSize: 11, fontFamily: 'monospace', color: '#64748b' }}>{c.assetAccount ? `${c.assetAccount.code} ${c.assetAccount.name}` : '—'}</td>
                <td style={{ ...S.td, fontSize: 11, fontFamily: 'monospace', color: '#64748b' }}>{c.accumDepAccount ? `${c.accumDepAccount.code} ${c.accumDepAccount.name}` : '—'}</td>
                <td style={{ ...S.td, fontSize: 11, fontFamily: 'monospace', color: '#64748b' }}>{c.depExpenseAccount ? `${c.depExpenseAccount.code} ${c.depExpenseAccount.name}` : '—'}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{c._count?.assets ?? 0}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>
                  {canWrite && (c._count?.assets ?? 0) === 0 && <button style={{ ...S.textBtn, color: '#dc2626' }} onClick={() => del(c.id, c.name)}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Register tab ──────────────────────────────────────────────────────────────
function AssetRegister({ showToast, canWrite }: { showToast: (m: string, t?: 'ok'|'err') => void; canWrite: boolean }) {
  const { currentEntity } = useApp()
  const [assets, setAssets] = useState<FixedAsset[]>([])
  const [categories, setCategories] = useState<AssetCategory[]>([])
  const [statusFilter, setStatusFilter] = useState<'all'|'ACTIVE'|'DISPOSED'|'FULLY_DEPRECIATED'>('all')
  const [showForm, setShowForm] = useState(false)
  const [selected, setSelected] = useState<FixedAsset | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    categoryId: '', assetNo: '', description: '', acquisitionDate: today,
    cost: '', salvageValue: '0', usefulLifeMonths: '', depreciationRatePercent: '',
    depreciationMethod: 'STRAIGHT_LINE' as DepMethod, location: '', serialNumber: '',
  })

  const load = useCallback(() => {
    if (!currentEntity) return
    fetch(`/api/fixed-assets?entityId=${currentEntity.id}`).then(r => r.json()).then(d => setAssets(d.assets ?? []))
    fetch(`/api/asset-categories?entityId=${currentEntity.id}`).then(r => r.json()).then(d => setCategories(d.categories ?? []))
  }, [currentEntity])

  useEffect(() => { load() }, [load])

  // When a category is picked, auto-fill life and rate.
  useEffect(() => {
    if (!form.categoryId) return
    const c = categories.find(c => c.id === form.categoryId)
    if (!c) return
    setForm(f => ({
      ...f,
      depreciationMethod: c.depreciationMethod,
      usefulLifeMonths: f.usefulLifeMonths || String(c.usefulLifeMonths),
      depreciationRatePercent: f.depreciationRatePercent || String(Number(c.depreciationRatePercent)),
    }))
  }, [form.categoryId, categories])

  const filtered = assets.filter(a => statusFilter === 'all' || a.status === statusFilter)
  const totals = filtered.reduce((s, a) => ({
    cost: s.cost + Number(a.cost),
    accum: s.accum + Number(a.accumulated),
    book: s.book + Number(a.bookValue),
  }), { cost: 0, accum: 0, book: 0 })

  const save = async () => {
    if (!currentEntity) return
    if (!form.categoryId) return showToast('Category required', 'err')
    if (!form.assetNo) return showToast('Asset # required', 'err')
    if (!form.description) return showToast('Description required', 'err')
    if (!parseFloat(form.cost)) return showToast('Cost required', 'err')
    const res = await fetch('/api/fixed-assets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityId: currentEntity.id,
        categoryId: form.categoryId,
        assetNo: form.assetNo,
        description: form.description,
        acquisitionDate: form.acquisitionDate,
        cost: parseFloat(form.cost),
        salvageValue: parseFloat(form.salvageValue) || 0,
        usefulLifeMonths: parseInt(form.usefulLifeMonths, 10) || undefined,
        depreciationRatePercent: parseFloat(form.depreciationRatePercent) || undefined,
        depreciationMethod: form.depreciationMethod,
        location: form.location || undefined,
        serialNumber: form.serialNumber || undefined,
      }),
    })
    if (res.ok) {
      showToast('Asset added')
      setShowForm(false)
      setForm({ categoryId: '', assetNo: '', description: '', acquisitionDate: today, cost: '', salvageValue: '0', usefulLifeMonths: '', depreciationRatePercent: '', depreciationMethod: 'STRAIGHT_LINE', location: '', serialNumber: '' })
      load()
    } else {
      const d = await res.json(); showToast(d.error ?? 'Error', 'err')
    }
  }

  if (selected) {
    return <AssetDetail asset={selected} onClose={() => { setSelected(null); load() }} showToast={showToast} canWrite={canWrite} />
  }

  return (
    <div>
      {/* KPI strip */}
      <div style={S.kpiGrid}>
        {[
          { label: 'Total cost', value: `$${fmt(totals.cost)}`, color: '#475569' },
          { label: 'Accumulated depreciation', value: `$${fmt(totals.accum)}`, color: '#d97706' },
          { label: 'Net book value', value: `$${fmt(totals.book)}`, color: '#0891b2' },
          { label: '# of assets', value: String(filtered.length), color: '#0f172a' },
        ].map(k => <div key={k.label} style={S.kpiCard}><div style={{fontSize:11,color:'#94a3b8',marginBottom:4}}>{k.label}</div><div style={{fontSize:22,fontWeight:700,color:k.color}}>{k.value}</div></div>)}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['all','ACTIVE','FULLY_DEPRECIATED','DISPOSED'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} style={{ ...S.btn, fontSize: 12, padding: '6px 10px', ...(statusFilter === s ? { background:'#0f172a', color:'#fff', borderColor:'#0f172a' } : {}) }}>
              {s === 'all' ? 'All' : s === 'ACTIVE' ? 'Active' : s === 'FULLY_DEPRECIATED' ? 'Fully depreciated' : 'Disposed'}
            </button>
          ))}
        </div>
        {canWrite && categories.length > 0 && <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setShowForm(o => !o)}>+ Add asset</button>}
      </div>

      {categories.length === 0 && canWrite && (
        <div style={{ padding: 16, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, marginBottom: 16, fontSize: 13, color: '#92400e' }}>
          Create an asset category first — categories define depreciation method and which GL accounts get posted.
        </div>
      )}

      {showForm && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={S.cardHeader}>New fixed asset</div>
          <div style={S.formGrid}>
            <div>
              <label style={S.label}>Category</label>
              <select style={S.select} value={form.categoryId} onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))}>
                <option value="">Select…</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label style={S.label}>Asset #</label><input style={S.input} value={form.assetNo} onChange={e => setForm(f => ({ ...f, assetNo: e.target.value }))} placeholder="FA-001" /></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={S.label}>Description</label><input style={S.input} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="MacBook Pro 16-inch" /></div>
            <div><label style={S.label}>Acquisition date</label><input style={S.input} type="date" value={form.acquisitionDate} onChange={e => setForm(f => ({ ...f, acquisitionDate: e.target.value }))} /></div>
            <div><label style={S.label}>Cost</label><input style={S.input} value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} placeholder="3000.00" /></div>
            <div><label style={S.label}>Salvage value</label><input style={S.input} value={form.salvageValue} onChange={e => setForm(f => ({ ...f, salvageValue: e.target.value }))} placeholder="0" /></div>
            <div>
              <label style={S.label}>Method</label>
              <select style={S.select} value={form.depreciationMethod} onChange={e => setForm(f => ({ ...f, depreciationMethod: e.target.value as DepMethod }))}>
                <option value="STRAIGHT_LINE">Straight Line</option>
                <option value="DECLINING_BALANCE">Declining Balance</option>
              </select>
            </div>
            <div><label style={S.label}>Useful life (months)</label><input style={S.input} value={form.usefulLifeMonths} onChange={e => setForm(f => ({ ...f, usefulLifeMonths: e.target.value }))} placeholder="60" /></div>
            <div><label style={S.label}>Annual rate (%)</label><input style={S.input} value={form.depreciationRatePercent} onChange={e => setForm(f => ({ ...f, depreciationRatePercent: e.target.value }))} placeholder="20" /></div>
            <div><label style={S.label}>Location</label><input style={S.input} value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Optional" /></div>
            <div><label style={S.label}>Serial number</label><input style={S.input} value={form.serialNumber} onChange={e => setForm(f => ({ ...f, serialNumber: e.target.value }))} placeholder="Optional" /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={save}>Save</button>
            <button style={S.btn} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={S.card}>
        <table style={S.table}>
          <thead><tr>{['Asset #','Description','Category','Acq date','Cost','Accum dep','Book value','Status'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={8} style={{ ...S.td, textAlign: 'center', color: '#94a3b8' }}>No assets {statusFilter !== 'all' ? `with status ${statusFilter}` : 'yet'}</td></tr>}
            {filtered.map(a => (
              <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(a)}>
                <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, fontWeight: 500 }}>{a.assetNo}</td>
                <td style={S.td}>{a.description}</td>
                <td style={{ ...S.td, fontSize: 12, color: '#64748b' }}>{a.category?.name ?? ''}</td>
                <td style={S.td}>{fmtDate(a.acquisitionDate)}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>${fmt(Number(a.cost))}</td>
                <td style={{ ...S.td, textAlign: 'right', color: '#d97706' }}>${fmt(Number(a.accumulated))}</td>
                <td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>${fmt(Number(a.bookValue))}</td>
                <td style={S.td}><AssetStatusBadge status={a.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AssetStatusBadge({ status }: { status: FixedAsset['status'] }) {
  const map = {
    ACTIVE:             { bg: '#f0fdf4', fg: '#166534', label: 'Active' },
    DISPOSED:           { bg: '#fef2f2', fg: '#991b1b', label: 'Disposed' },
    FULLY_DEPRECIATED:  { bg: '#f1f5f9', fg: '#475569', label: 'Fully depreciated' },
  }
  const t = map[status]
  return <span style={{ background: t.bg, color: t.fg, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{t.label}</span>
}

// ─── Asset detail (with depreciation schedule + dispose) ──────────────────────
interface DepEntry { id: string; periodEnd: string; amount: number; bookValueAfter: number; journalEntryId: string | null }

function AssetDetail({ asset: summary, onClose, showToast, canWrite }: {
  asset: FixedAsset; onClose: () => void; showToast: (m: string, t?: 'ok'|'err') => void; canWrite: boolean
}) {
  const { currentEntity } = useApp()
  const [detail, setDetail] = useState<{ asset: FixedAsset & { depreciationEntries: DepEntry[]; category: AssetCategory }; accumulated: number; bookValue: number } | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [showDispose, setShowDispose] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const [dispForm, setDispForm] = useState({ disposalDate: today, proceeds: '', proceedsAccountId: '', gainLossAccountId: '' })

  useEffect(() => {
    if (!currentEntity) return
    fetch(`/api/fixed-assets?entityId=${currentEntity.id}&id=${summary.id}`).then(r => r.json()).then(setDetail)
    fetch(`/api/accounts?entityId=${currentEntity.id}`).then(r => r.json()).then(setAccounts)
  }, [currentEntity, summary.id])

  const submitDispose = async () => {
    if (!currentEntity) return
    if (!dispForm.gainLossAccountId) return showToast('Pick a gain/loss account', 'err')
    const res = await fetch('/api/fixed-assets', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'dispose', entityId: currentEntity.id, assetId: summary.id,
        disposalDate: dispForm.disposalDate,
        proceeds: parseFloat(dispForm.proceeds) || 0,
        proceedsAccountId: dispForm.proceedsAccountId || dispForm.gainLossAccountId,
        gainLossAccountId: dispForm.gainLossAccountId,
      }),
    })
    if (res.ok) { showToast('Asset disposed'); onClose() }
    else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  const a = detail?.asset
  return (
    <div>
      <div style={S.pageActions}>
        <button style={S.btn} onClick={onClose}>← Back to register</button>
        {canWrite && a && a.status === 'ACTIVE' && (
          <button style={{ ...S.btn, color: '#dc2626', borderColor: '#fecaca' }} onClick={() => setShowDispose(true)}>Dispose asset</button>
        )}
      </div>

      {!a && <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>Loading…</div>}
      {a && (
        <>
          <div style={S.card}>
            <div style={S.cardHeader}>
              {a.assetNo} — {a.description}
              <span style={{ marginLeft: 12 }}><AssetStatusBadge status={a.status} /></span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, padding: '4px 4px 14px' }}>
              {[
                ['Category', a.category?.name ?? '—'],
                ['Acquisition date', fmtDate(a.acquisitionDate)],
                ['Cost', `$${fmt(Number(a.cost))}`],
                ['Salvage value', `$${fmt(Number(a.salvageValue))}`],
                ['Useful life', `${a.usefulLifeMonths} months`],
                ['Method', a.depreciationMethod === 'STRAIGHT_LINE' ? 'Straight Line' : 'Declining Balance'],
                ['Rate', `${Number(a.depreciationRatePercent).toFixed(2)}%`],
                ['Accum. depreciation', `$${fmt(detail!.accumulated)}`],
                ['Net book value', `$${fmt(detail!.bookValue)}`],
                ...(a.location ? [['Location', a.location]] : []),
                ...(a.serialNumber ? [['Serial number', a.serialNumber]] : []),
                ...(a.status === 'DISPOSED' ? [
                  ['Disposal date', fmtDate(a.disposalDate ?? '')],
                  ['Disposal proceeds', `$${fmt(Number(a.disposalProceeds ?? 0))}`],
                ] : []),
              ].map(([label, value]) => (
                <div key={label as string}>
                  <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.06, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{value as string}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...S.card, marginTop: 16 }}>
            <div style={S.cardHeader}>Depreciation schedule ({a.depreciationEntries.length} entries)</div>
            <table style={S.table}>
              <thead><tr>{['Period','Depreciation','Accumulated','Book value','JE'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {a.depreciationEntries.length === 0 && <tr><td colSpan={5} style={{ ...S.td, textAlign: 'center', color: '#94a3b8' }}>No depreciation yet — run depreciation from the register</td></tr>}
                {a.depreciationEntries.map((e, i) => {
                  const accumThroughHere = a.depreciationEntries.slice(0, i + 1).reduce((s, x) => s + Number(x.amount), 0)
                  return (
                    <tr key={e.id}>
                      <td style={S.td}>{fmtDate(e.periodEnd)}</td>
                      <td style={{ ...S.td, textAlign: 'right' }}>${fmt(Number(e.amount))}</td>
                      <td style={{ ...S.td, textAlign: 'right', color: '#d97706' }}>${fmt(accumThroughHere)}</td>
                      <td style={{ ...S.td, textAlign: 'right', fontWeight: 500 }}>${fmt(Number(e.bookValueAfter))}</td>
                      <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, color: '#64748b' }}>{e.journalEntryId ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showDispose && a && (
        <ModalOverlay onClose={() => setShowDispose(false)}>
          <div style={S.cardHeader}>Dispose {a.assetNo}</div>
          <div style={{ fontSize: 13, color: '#475569', marginBottom: 14, lineHeight: 1.5 }}>
            Books the disposal JE: removes cost, removes accumulated depreciation, records any proceeds, and books the gain/loss as the balancing figure.
          </div>
          <div style={S.formGrid}>
            <div><label style={S.label}>Disposal date</label><input style={S.input} type="date" value={dispForm.disposalDate} onChange={e => setDispForm(f => ({ ...f, disposalDate: e.target.value }))} /></div>
            <div><label style={S.label}>Proceeds</label><input style={S.input} value={dispForm.proceeds} onChange={e => setDispForm(f => ({ ...f, proceeds: e.target.value }))} placeholder="0.00" /></div>
            <div>
              <label style={S.label}>Proceeds account</label>
              <select style={S.select} value={dispForm.proceedsAccountId} onChange={e => setDispForm(f => ({ ...f, proceedsAccountId: e.target.value }))}>
                <option value="">— (no proceeds)</option>
                {accounts.filter(x => x.type === 'ASSET').map(x => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>Gain / loss account</label>
              <select style={S.select} value={dispForm.gainLossAccountId} onChange={e => setDispForm(f => ({ ...f, gainLossAccountId: e.target.value }))}>
                <option value="">Select…</option>
                {accounts.filter(x => x.type === 'REVENUE' || x.type === 'EXPENSE').map(x => <option key={x.id} value={x.id}>{x.code} — {x.name} ({x.type})</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={submitDispose}>Post disposal</button>
            <button style={S.btn} onClick={() => setShowDispose(false)}>Cancel</button>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}

// ─── Depreciation run modal ────────────────────────────────────────────────────
function DepreciationRunModal({ onClose, showToast }: { onClose: () => void; showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { currentEntity } = useApp()
  const [periodEnd, setPeriodEnd] = useState(() => {
    // Default to last day of last completed month.
    const d = new Date()
    d.setDate(0)
    return d.toISOString().slice(0, 10)
  })
  const [catchUp, setCatchUp] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ assetsProcessed: number; totalDepreciation: number; ref: string | null } | null>(null)

  const run = async () => {
    if (!currentEntity) return
    setRunning(true)
    try {
      const res = await fetch('/api/fixed-assets', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'depreciate', entityId: currentEntity.id, periodEnd, catchUp }),
      })
      const data = await res.json()
      if (!res.ok) return showToast(data.error ?? 'Run failed', 'err')
      setResult(data)
      if (data.assetsProcessed === 0) showToast('Nothing to depreciate — either no eligible assets or already booked', 'ok')
      else showToast(`Posted ${data.ref} — depreciated ${data.assetsProcessed} asset${data.assetsProcessed === 1 ? '' : 's'} for $${fmt(data.totalDepreciation)}`)
    } finally { setRunning(false) }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div style={S.cardHeader}>Run depreciation</div>
      {!result && <>
        <div style={{ fontSize: 13, color: '#475569', marginBottom: 14, lineHeight: 1.6 }}>
          Calculates one month of depreciation for every <strong>ACTIVE</strong> asset acquired on or before the period-end date, and posts the JE:<br/>
          <span style={{ fontFamily: 'monospace', fontSize: 12 }}>DR Depreciation Expense  /  CR Accumulated Depreciation</span><br/>
          Idempotent — running twice for the same period skips already-booked assets.
        </div>
        <div style={S.formGrid}>
          <div><label style={S.label}>Period end</label><input style={S.input} type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} /></div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569' }}>
              <input type="checkbox" checked={catchUp} onChange={e => setCatchUp(e.target.checked)} />
              Catch-up — book full cumulative dep for assets that have never been depreciated
            </label>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button style={{ ...S.btn, ...S.btnPrimary }} onClick={run} disabled={running}>{running ? 'Running…' : 'Run depreciation'}</button>
          <button style={S.btn} onClick={onClose}>Cancel</button>
        </div>
      </>}
      {result && <>
        <div style={{ padding: 16, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, marginBottom: 14 }}>
          <div style={{ fontWeight: 600, color: '#166534', marginBottom: 4 }}>✓ Depreciation posted</div>
          <div style={{ fontSize: 13, color: '#166534' }}>
            {result.assetsProcessed} asset{result.assetsProcessed === 1 ? '' : 's'} • Total: ${fmt(result.totalDepreciation)}<br/>
            {result.ref && <>Journal entry: <strong>{result.ref}</strong></>}
          </div>
        </div>
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={onClose}>Done</button>
      </>}
    </ModalOverlay>
  )
}

// Reusable modal overlay
function ModalOverlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
      onClick={onClose}
    >
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 24, maxWidth: 540, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', maxHeight: '90vh', overflow: 'auto' }}>
        {children}
      </div>
    </div>
  )
}

// ─── Group Structure ──────────────────────────────────────────────────────────
interface GroupNode {
  id: string
  name: string
  slug: string
  currency: string
  entityType: 'STANDALONE'|'HOLDING'|'SUBSIDIARY'|'BRANCH'
  parentEntityId: string | null
  ownershipPercent: number
  acquisitionDate: string | null
  children: GroupNode[]
}

function GroupPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { entities, role } = useApp()
  const [tree, setTree] = useState<GroupNode[]>([])
  const [editing, setEditing] = useState<GroupNode | null>(null)
  const canWrite = role === 'OWNER' || role === 'ADMIN'

  const load = useCallback(() => {
    fetch('/api/group').then(r => r.json()).then(d => setTree(d.tree ?? []))
  }, [])
  useEffect(() => { load() }, [load])

  // Flatten for the parent-picker dropdown (excluding the entity being edited
  // and any of its descendants — those would create cycles).
  const flatten = (nodes: GroupNode[], acc: GroupNode[] = []): GroupNode[] => {
    for (const n of nodes) { acc.push(n); flatten(n.children, acc) }
    return acc
  }
  const descendantIds = (node: GroupNode | null): Set<string> => {
    const out = new Set<string>()
    if (!node) return out
    const visit = (n: GroupNode) => { out.add(n.id); n.children.forEach(visit) }
    visit(node)
    return out
  }

  return (
    <div>
      <div style={S.pageActions}>
        <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
          Defines parent-subsidiary relationships across legal entities. Set a parent to mark an entity as a subsidiary, optionally tracking the ownership % and acquisition date.
        </div>
      </div>

      <div style={S.card}>
        <div style={S.cardHeader}>Corporate tree</div>
        {tree.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}>No entities visible</div>}
        {tree.map(node => <TreeBranch key={node.id} node={node} depth={0} onEdit={canWrite ? setEditing : null} />)}
      </div>

      {editing && (
        <GroupEditModal
          entity={editing}
          parentChoices={flatten(tree).filter(n => !descendantIds(editing).has(n.id))}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
          showToast={showToast}
        />
      )}
    </div>
  )
}

function TreeBranch({ node, depth, onEdit }: { node: GroupNode; depth: number; onEdit: ((n: GroupNode) => void) | null }) {
  const typeColor: Record<string, { bg: string; fg: string }> = {
    HOLDING:    { bg: '#eff6ff', fg: '#1d4ed8' },
    SUBSIDIARY: { bg: '#f0fdf4', fg: '#166534' },
    BRANCH:     { bg: '#fffbeb', fg: '#92400e' },
    STANDALONE: { bg: '#f1f5f9', fg: '#475569' },
  }
  const t = typeColor[node.entityType]
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
        borderBottom: '1px solid #f1f5f9', paddingLeft: 12 + depth * 28,
      }}>
        {depth > 0 && <span style={{ color: '#cbd5e1' }}>↳</span>}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{node.name}</div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
            {node.currency} {node.acquisitionDate && `• Acquired ${fmtDate(node.acquisitionDate)}`}
          </div>
        </div>
        <span style={{ background: t.bg, color: t.fg, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{node.entityType}</span>
        {node.parentEntityId && (
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>
            {Number(node.ownershipPercent).toFixed(2)}%
          </div>
        )}
        {onEdit && <button style={S.textBtn} onClick={() => onEdit(node)}>Edit</button>}
      </div>
      {node.children.map(c => <TreeBranch key={c.id} node={c} depth={depth + 1} onEdit={onEdit} />)}
    </div>
  )
}

function GroupEditModal({ entity, parentChoices, onClose, onSaved, showToast }: {
  entity: GroupNode; parentChoices: GroupNode[]; onClose: () => void; onSaved: () => void
  showToast: (m: string, t?: 'ok'|'err') => void
}) {
  const [parentId, setParentId] = useState(entity.parentEntityId ?? '')
  const [pct, setPct] = useState(String(entity.ownershipPercent))
  const [acqDate, setAcqDate] = useState(entity.acquisitionDate ? entity.acquisitionDate.slice(0, 10) : '')
  const [entityType, setEntityType] = useState(entity.entityType)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const isSettingParent = parentId && parentId !== entity.parentEntityId
      const isDetaching = !parentId && entity.parentEntityId
      let body: Record<string, unknown>
      if (isDetaching) {
        body = { action: 'detach', entityId: entity.id }
      } else if (isSettingParent) {
        body = {
          action: 'set-parent', entityId: entity.id, parentEntityId: parentId,
          ownershipPercent: parseFloat(pct) || 100,
          acquisitionDate: acqDate || undefined,
          entityType,
        }
      } else {
        body = {
          action: 'update-meta', entityId: entity.id,
          ownershipPercent: parseFloat(pct) || 100,
          acquisitionDate: acqDate || null,
          entityType,
        }
      }
      const res = await fetch('/api/group', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) { showToast('Saved'); onSaved() }
      else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
    } finally { setBusy(false) }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div style={S.cardHeader}>Group settings — {entity.name}</div>
      <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.5, marginBottom: 14 }}>
        Configure parent entity and ownership. Currency is set on entity creation and can't be changed here.
      </div>
      <div style={S.formGrid}>
        <div>
          <label style={S.label}>Parent entity</label>
          <select style={S.select} value={parentId} onChange={e => setParentId(e.target.value)}>
            <option value="">— (top-level / no parent)</option>
            {parentChoices.filter(p => p.id !== entity.id).map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.currency})</option>
            ))}
          </select>
        </div>
        <div>
          <label style={S.label}>Entity type</label>
          <select style={S.select} value={entityType} onChange={e => setEntityType(e.target.value as GroupNode['entityType'])}>
            <option value="STANDALONE">Standalone</option>
            <option value="HOLDING">Holding company</option>
            <option value="SUBSIDIARY">Subsidiary</option>
            <option value="BRANCH">Branch</option>
          </select>
        </div>
        <div>
          <label style={S.label}>Ownership %</label>
          <input style={S.input} value={pct} onChange={e => setPct(e.target.value)} placeholder="100" />
        </div>
        <div>
          <label style={S.label}>Acquisition date</label>
          <input style={S.input} type="date" value={acqDate} onChange={e => setAcqDate(e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={save} disabled={busy}>Save</button>
        <button style={S.btn} onClick={onClose}>Cancel</button>
      </div>
    </ModalOverlay>
  )
}

// ─── FX Rates ─────────────────────────────────────────────────────────────────
interface FxRate {
  id: string
  fromCurrency: string
  toCurrency: string
  rate: number | string
  effectiveDate: string
  source: string | null
  notes: string | null
  createdAt: string
}

const COMMON_CURRENCIES = ['USD','EUR','GBP','CAD','AUD','INR','JPY','CNY','SGD','CHF','HKD','AED']

function FxRatesPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { role } = useApp()
  const [rates, setRates] = useState<FxRate[]>([])
  const [filter, setFilter] = useState<{ from: string; to: string }>({ from: '', to: '' })
  const [showForm, setShowForm] = useState(false)
  const [showFetch, setShowFetch] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ fromCurrency: 'USD', toCurrency: 'EUR', rate: '', effectiveDate: today, source: 'manual', notes: '' })
  const [preview, setPreview] = useState({ amount: '1000', from: 'USD', to: 'EUR', date: today })
  const [previewResult, setPreviewResult] = useState<{ converted: number; rate: number; effectiveDate: string; source: string } | null>(null)
  const canWrite = role === 'OWNER'

  const load = useCallback(() => {
    const sp = new URLSearchParams()
    if (filter.from) sp.set('from', filter.from)
    if (filter.to)   sp.set('to',   filter.to)
    fetch(`/api/fx?${sp}`).then(r => r.json()).then(d => setRates(d.rates ?? []))
  }, [filter])
  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!form.fromCurrency || !form.toCurrency || !form.rate) return showToast('From, To, Rate are required', 'err')
    if (form.fromCurrency === form.toCurrency) return showToast('From and To must differ', 'err')
    const res = await fetch('/api/fx', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromCurrency: form.fromCurrency,
        toCurrency: form.toCurrency,
        rate: parseFloat(form.rate),
        effectiveDate: form.effectiveDate,
        source: form.source,
        notes: form.notes || undefined,
      }),
    })
    if (res.ok) {
      showToast('Rate saved')
      setShowForm(false)
      setForm({ ...form, rate: '', notes: '' })
      load()
    } else {
      const d = await res.json(); showToast(d.error ?? 'Error', 'err')
    }
  }

  const del = async (id: string) => {
    if (!confirm('Delete this rate? Existing transactions are unaffected.')) return
    const res = await fetch(`/api/fx?id=${id}`, { method: 'DELETE' })
    if (res.ok) { showToast('Deleted'); load() }
  }

  const runPreview = async () => {
    const amt = parseFloat(preview.amount) || 0
    const sp = new URLSearchParams({ convert: '1', amount: String(amt), from: preview.from, to: preview.to, date: preview.date })
    const res = await fetch(`/api/fx?${sp}`)
    if (res.ok) setPreviewResult(await res.json())
    else { setPreviewResult(null); const d = await res.json(); showToast(d.error ?? 'No rate', 'err') }
  }

  return (
    <div>
      <div style={S.pageActions}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div>
            <label style={S.label}>From</label>
            <select style={{ ...S.select, minWidth: 100 }} value={filter.from} onChange={e => setFilter(f => ({ ...f, from: e.target.value }))}>
              <option value="">Any</option>
              {COMMON_CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>To</label>
            <select style={{ ...S.select, minWidth: 100 }} value={filter.to} onChange={e => setFilter(f => ({ ...f, to: e.target.value }))}>
              <option value="">Any</option>
              {COMMON_CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        {canWrite && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={S.btn} onClick={() => setShowFetch(true)}>↓ Fetch latest</button>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setShowForm(o => !o)}>+ Add rate</button>
          </div>
        )}
      </div>

      {showForm && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={S.cardHeader}>Add / override FX rate</div>
          <div style={S.formGrid}>
            <div>
              <label style={S.label}>From currency</label>
              <select style={S.select} value={form.fromCurrency} onChange={e => setForm(f => ({ ...f, fromCurrency: e.target.value }))}>
                {COMMON_CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>To currency</label>
              <select style={S.select} value={form.toCurrency} onChange={e => setForm(f => ({ ...f, toCurrency: e.target.value }))}>
                {COMMON_CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>Rate (1 {form.fromCurrency} = ? {form.toCurrency})</label>
              <input style={S.input} value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} placeholder="0.92000000" />
            </div>
            <div>
              <label style={S.label}>Effective date</label>
              <input style={S.input} type="date" value={form.effectiveDate} onChange={e => setForm(f => ({ ...f, effectiveDate: e.target.value }))} />
            </div>
            <div>
              <label style={S.label}>Source</label>
              <input style={S.input} value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} placeholder="manual, RBI, ECB…" />
            </div>
            <div>
              <label style={S.label}>Notes</label>
              <input style={S.input} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={save}>Save</button>
            <button style={S.btn} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Conversion preview */}
      <div style={{ ...S.card, marginBottom: 16 }}>
        <div style={S.cardHeader}>Convert</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label style={S.label}>Amount</label><input style={{ ...S.input, maxWidth: 140 }} value={preview.amount} onChange={e => setPreview(p => ({ ...p, amount: e.target.value }))} /></div>
          <div><label style={S.label}>From</label><select style={S.select} value={preview.from} onChange={e => setPreview(p => ({ ...p, from: e.target.value }))}>{COMMON_CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label style={S.label}>To</label><select style={S.select} value={preview.to} onChange={e => setPreview(p => ({ ...p, to: e.target.value }))}>{COMMON_CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label style={S.label}>As of</label><input style={S.input} type="date" value={preview.date} onChange={e => setPreview(p => ({ ...p, date: e.target.value }))} /></div>
          <button style={{ ...S.btn, ...S.btnPrimary }} onClick={runPreview}>Convert</button>
        </div>
        {previewResult && (
          <div style={{ marginTop: 14, padding: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 13 }}>
            <strong>{previewResult.converted.toLocaleString()} {preview.to}</strong> at rate {previewResult.rate} <span style={{ color: '#64748b' }}>({previewResult.source === 'inverse' ? 'inverse of stored rate' : 'direct'}, effective {fmtDate(previewResult.effectiveDate)})</span>
          </div>
        )}
      </div>

      {/* Rate table */}
      <div style={S.card}>
        <div style={S.cardHeader}>Rate history ({rates.length})</div>
        <table style={S.table}>
          <thead><tr>{['From','To','Rate','Effective','Source','Notes',''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {rates.length === 0 && <tr><td colSpan={7} style={{ ...S.td, textAlign: 'center', color: '#94a3b8' }}>No rates {filter.from || filter.to ? 'matching filter' : 'yet'}</td></tr>}
            {rates.map(r => (
              <tr key={r.id}>
                <td style={{ ...S.td, fontFamily: 'monospace', fontWeight: 600 }}>{r.fromCurrency}</td>
                <td style={{ ...S.td, fontFamily: 'monospace', fontWeight: 600 }}>{r.toCurrency}</td>
                <td style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(r.rate).toFixed(8)}</td>
                <td style={S.td}>{fmtDate(r.effectiveDate)}</td>
                <td style={{ ...S.td, fontSize: 12, color: '#64748b' }}>{r.source ?? '—'}</td>
                <td style={{ ...S.td, fontSize: 12, color: '#64748b' }}>{r.notes ?? ''}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{canWrite && <button style={{ ...S.textBtn, color: '#dc2626' }} onClick={() => del(r.id)}>Delete</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showFetch && <FetchLatestModal onClose={() => setShowFetch(false)} onFetched={() => { setShowFetch(false); load() }} showToast={showToast} />}
    </div>
  )
}

// Fetches rates from frankfurter.app (free, ECB-backed). Manual rates are
// never overwritten — same (from, to, date) with source='manual' is skipped.
function FetchLatestModal({ onClose, onFetched, showToast }: {
  onClose: () => void; onFetched: () => void; showToast: (m: string, t?: 'ok'|'err') => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [base, setBase] = useState('USD')
  const [date, setDate] = useState<'latest' | string>('latest')
  const [customDate, setCustomDate] = useState(today)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{
    base: string; effectiveDate: string; inserted: number;
    skipped: { fromCurrency: string; toCurrency: string; reason: string }[];
    unsupported: string[]
  } | null>(null)

  const fetchNow = async () => {
    setBusy(true); setResult(null)
    try {
      const res = await fetch('/api/fx/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base, date: date === 'latest' ? 'latest' : customDate }),
      })
      const data = await res.json()
      if (!res.ok) return showToast(data.error ?? 'Fetch failed', 'err')
      setResult(data)
      showToast(`Fetched ${data.inserted} rate${data.inserted === 1 ? '' : 's'} from frankfurter.app`)
    } finally { setBusy(false) }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div style={S.cardHeader}>Fetch FX rates from frankfurter.app</div>
      {!result && (
        <>
          <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, marginBottom: 14 }}>
            Free service backed by the European Central Bank. About 30 major currencies (USD, EUR, GBP, INR, JPY, CNY, SGD, etc.). ECB publishes rates each business day around 16:00 CET — weekend requests return Friday's rate.
            <br/><br/>
            <strong>Manual rates are never overwritten.</strong> If you've manually entered a rate for the same currency pair and date, it stays.
          </div>
          <div style={S.formGrid}>
            <div>
              <label style={S.label}>Base currency</label>
              <select style={S.select} value={base} onChange={e => setBase(e.target.value)}>
                {COMMON_CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>Date</label>
              <select style={S.select} value={date} onChange={e => setDate(e.target.value)}>
                <option value="latest">Latest (today's ECB publication)</option>
                <option value="custom">Specific date…</option>
              </select>
            </div>
            {date !== 'latest' && (
              <div>
                <label style={S.label}>Effective date</label>
                <input style={S.input} type="date" value={customDate} max={today} onChange={e => setCustomDate(e.target.value)} />
              </div>
            )}
          </div>
          <div style={{ marginTop: 14, padding: 10, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 12, color: '#1e3a8a' }}>
            Rates are fetched for {base} against all available currencies. Will overwrite any non-manual (auto-fetched) rates for the same date, preserving any manually-entered overrides.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={fetchNow} disabled={busy}>{busy ? 'Fetching…' : 'Fetch now'}</button>
            <button style={S.btn} onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
      {result && (
        <>
          <div style={{ padding: 14, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, marginBottom: 14 }}>
            <div style={{ fontWeight: 600, color: '#166534', marginBottom: 6 }}>✓ Fetched from frankfurter.app</div>
            <div style={{ fontSize: 13, color: '#166534', lineHeight: 1.6 }}>
              <strong>{result.inserted}</strong> rates for base <strong>{result.base}</strong> as of <strong>{fmtDate(result.effectiveDate)}</strong>
              {result.skipped.length > 0 && <><br/>{result.skipped.length} skipped — manual override exists for: {result.skipped.map(s => `${s.fromCurrency}/${s.toCurrency}`).join(', ')}</>}
              {result.unsupported.length > 0 && <><br/><span style={{ color: '#92400e' }}>{result.unsupported.length} not published by ECB: {result.unsupported.join(', ')} — use manual entry</span></>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={onFetched}>Done</button>
            <button style={S.btn} onClick={() => setResult(null)}>Fetch another</button>
          </div>
        </>
      )}
    </ModalOverlay>
  )
}

// ─── MIS / Departments ────────────────────────────────────────────────────────
const ACCOUNT_TYPES_FOR_MIS = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'COGS'] as const
type AccountTypeT = typeof ACCOUNT_TYPES_FOR_MIS[number]

interface MisCodeRow {
  id: string
  code: string
  department: string
  description: string | null
  isActive: boolean
  displayOrder: number
  _count?: { journalLines: number }
}
interface MisConfig {
  enabled: boolean
  requiredForTypes: AccountTypeT[]
  allowOverride: boolean
}

function MisPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { currentEntity, role } = useApp()
  const [tab, setTab] = useState<'codes'|'config'>('codes')
  const canWrite = ['OWNER','ADMIN','ACCOUNTANT'].includes(role)
  const canConfig = ['OWNER','ADMIN'].includes(role)

  return (
    <div>
      <div style={S.pageActions}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => setTab('codes')} style={{ ...S.btn, ...(tab==='codes' ? { background:'#0f172a', color:'#fff', borderColor:'#0f172a' } : {}) }}>Codes</button>
          <button onClick={() => setTab('config')} style={{ ...S.btn, ...(tab==='config' ? { background:'#0f172a', color:'#fff', borderColor:'#0f172a' } : {}) }}>Configuration</button>
        </div>
      </div>
      {tab === 'codes'  && <MisCodes  showToast={showToast} canWrite={canWrite} />}
      {tab === 'config' && <MisConfigPanel showToast={showToast} canEdit={canConfig} />}
    </div>
  )
}

// ─── Codes master list ───────────────────────────────────────────────────────
function MisCodes({ showToast, canWrite }: { showToast: (m: string, t?: 'ok'|'err') => void; canWrite: boolean }) {
  const { currentEntity } = useApp()
  const [codes, setCodes] = useState<MisCodeRow[]>([])
  const [softCap, setSoftCap] = useState(10)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ code: '', department: '', description: '' })

  const load = useCallback(() => {
    if (!currentEntity) return
    const sp = new URLSearchParams({ entityId: currentEntity.id })
    if (includeInactive) sp.set('includeInactive', '1')
    fetch(`/api/mis-codes?${sp}`).then(r => r.json()).then(d => {
      setCodes(d.codes ?? [])
      if (d.softCap) setSoftCap(d.softCap)
    })
  }, [currentEntity, includeInactive])
  useEffect(() => { load() }, [load])

  const activeCount = codes.filter(c => c.isActive).length

  const save = async () => {
    if (!currentEntity) return
    if (!form.code || !form.department) return showToast('Code and Department are required', 'err')
    const res = await fetch('/api/mis-codes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId: currentEntity.id, ...form, code: form.code.toUpperCase() }),
    })
    const data = await res.json()
    if (res.ok) {
      showToast('MIS code added' + (data.softCapWarning ? ` — note: you have more than ${softCap} active codes` : ''))
      setShowForm(false)
      setForm({ code: '', department: '', description: '' })
      load()
    } else {
      showToast(data.error ?? 'Error', 'err')
    }
  }

  const toggleActive = async (row: MisCodeRow) => {
    if (!currentEntity) return
    const res = await fetch('/api/mis-codes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId: currentEntity.id, id: row.id, isActive: !row.isActive }),
    })
    if (res.ok) { showToast(row.isActive ? 'Deactivated' : 'Reactivated'); load() }
    else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  const del = async (row: MisCodeRow) => {
    if (!currentEntity) return
    const used = row._count?.journalLines ?? 0
    if (used > 0) {
      if (!confirm(`This code is used in ${used} journal line(s). Deleting will deactivate it (historical lines keep the tag). Continue?`)) return
    } else {
      if (!confirm(`Delete "${row.code} — ${row.department}"? This is permanent (code is unused).`)) return
    }
    const res = await fetch(`/api/mis-codes?entityId=${currentEntity.id}&id=${row.id}`, { method: 'DELETE' })
    if (res.ok) { showToast('Done'); load() }
    else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
          {activeCount} active code{activeCount === 1 ? '' : 's'}
          {activeCount > softCap && <span style={{ color: '#d97706', marginLeft: 8 }}>⚠ exceeds soft cap of {softCap}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: '#64748b', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} />
            Show inactive
          </label>
          {canWrite && <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setShowForm(o => !o)}>+ New code</button>}
        </div>
      </div>

      {showForm && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={S.cardHeader}>New MIS / Department code</div>
          <div style={S.formGrid}>
            <div><label style={S.label}>Code</label><input style={S.input} value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="DEPT01" /></div>
            <div><label style={S.label}>Department</label><input style={S.input} value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="Sales — North" /></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={S.label}>Description (optional)</label><input style={S.input} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={save}>Save</button>
            <button style={S.btn} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={S.card}>
        <table style={S.table}>
          <thead><tr>{['Code','Department','Description','# of postings','Status',''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {codes.length === 0 && <tr><td colSpan={6} style={{ ...S.td, textAlign: 'center', color: '#94a3b8' }}>No MIS codes yet — add up to {softCap} departments to start tagging journal lines</td></tr>}
            {codes.map(c => (
              <tr key={c.id} style={{ opacity: c.isActive ? 1 : 0.5 }}>
                <td style={{ ...S.td, fontFamily: 'monospace', fontWeight: 600, fontSize: 12 }}>{c.code}</td>
                <td style={{ ...S.td, fontWeight: 500 }}>{c.department}</td>
                <td style={{ ...S.td, fontSize: 12, color: '#64748b' }}>{c.description ?? '—'}</td>
                <td style={{ ...S.td, textAlign: 'right', fontSize: 12, color: '#64748b' }}>{c._count?.journalLines ?? 0}</td>
                <td style={S.td}>
                  <span style={{ background: c.isActive ? '#f0fdf4' : '#f1f5f9', color: c.isActive ? '#166534' : '#475569', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                    {c.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ ...S.td, textAlign: 'right' }}>
                  {canWrite && <>
                    <button style={S.textBtn} onClick={() => toggleActive(c)}>{c.isActive ? 'Deactivate' : 'Reactivate'}</button>
                    <span style={{ color: '#cbd5e1', margin: '0 8px' }}>·</span>
                    <button style={{ ...S.textBtn, color: '#dc2626' }} onClick={() => del(c)}>Delete</button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Configuration panel ─────────────────────────────────────────────────────
function MisConfigPanel({ showToast, canEdit }: { showToast: (m: string, t?: 'ok'|'err') => void; canEdit: boolean }) {
  const { currentEntity } = useApp()
  const [config, setConfig] = useState<MisConfig | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!currentEntity) return
    fetch(`/api/mis-config?entityId=${currentEntity.id}`).then(r => r.json()).then(setConfig)
  }, [currentEntity])
  useEffect(() => { load() }, [load])

  const save = async (next: Partial<MisConfig>) => {
    if (!currentEntity || !config) return
    setBusy(true)
    try {
      const res = await fetch('/api/mis-config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityId: currentEntity.id, enabled: config.enabled, requiredForTypes: config.requiredForTypes, allowOverride: config.allowOverride, ...next }),
      })
      if (res.ok) { setConfig(await res.json()); showToast('Saved') }
      else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
    } finally { setBusy(false) }
  }

  const toggleType = (t: AccountTypeT) => {
    if (!config) return
    const set = new Set(config.requiredForTypes)
    if (set.has(t)) set.delete(t)
    else set.add(t)
    save({ requiredForTypes: [...set] })
  }

  if (!config) return <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>

  return (
    <div>
      <div style={{ ...S.card, marginBottom: 16 }}>
        <div style={S.cardHeader}>Master toggle</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
          <div>
            <div style={{ fontWeight: 500, fontSize: 14 }}>Enable MIS coding on this entity</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>When off, the MIS dropdown is hidden from posting screens entirely. When on, the rules below apply.</div>
          </div>
          {canEdit && (
            <button
              style={{ ...S.btn, ...(config.enabled ? { background: '#0f172a', color: '#fff', borderColor: '#0f172a' } : {}) }}
              disabled={busy}
              onClick={() => save({ enabled: !config.enabled })}
            >
              {config.enabled ? 'Enabled' : 'Disabled'}
            </button>
          )}
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: 16, opacity: config.enabled ? 1 : 0.5, pointerEvents: config.enabled && canEdit ? 'auto' : 'none' }}>
        <div style={S.cardHeader}>Require MIS code on these account types</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, lineHeight: 1.5 }}>
          When the lines being posted touch any of these account types, the user must pick an MIS code on each such line. Lines for other types remain optional.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ACCOUNT_TYPES_FOR_MIS.map(t => {
            const on = config.requiredForTypes.includes(t)
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                style={{
                  padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                  border: '1px solid ' + (on ? '#0f172a' : '#cbd5e1'),
                  background: on ? '#0f172a' : '#fff',
                  color: on ? '#fff' : '#475569',
                  cursor: canEdit ? 'pointer' : 'default',
                }}
              >
                {on ? '✓ ' : ''}{t}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ ...S.card, opacity: config.enabled ? 1 : 0.5, pointerEvents: config.enabled && canEdit ? 'auto' : 'none' }}>
        <div style={S.cardHeader}>Override behavior</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
          <div>
            <div style={{ fontWeight: 500, fontSize: 14 }}>Allow override (downgrade required → optional)</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, lineHeight: 1.5 }}>
              When ON: posting screens show a warning if a "required" line is missing an MIS code, but won't block submission.<br />
              When OFF (strict): missing MIS codes on required lines block posting entirely.
            </div>
          </div>
          <button
            style={{ ...S.btn, ...(config.allowOverride ? { background: '#d97706', color: '#fff', borderColor: '#d97706' } : {}) }}
            disabled={busy || !canEdit}
            onClick={() => save({ allowOverride: !config.allowOverride })}
          >
            {config.allowOverride ? 'Override ON (lenient)' : 'Override OFF (strict)'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Vendor Reconciliation ────────────────────────────────────────────────────
interface VendorRecon {
  id: string
  vendor: string
  statementDate: string
  statementBalance: number | string
  internalBalance: number | string
  difference: number | string
  status: 'DRAFT' | 'FINALIZED'
  notes: string | null
  finalizedAt: string | null
  createdAt: string
  internalBalanceLive?: number
  differenceLive?: number
}

function VendorReconPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { currentEntity, role } = useApp()
  const [recons, setRecons] = useState<VendorRecon[]>([])
  const [vendors, setVendors] = useState<string[]>([])
  const [showForm, setShowForm] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ vendor: '', statementDate: today, statementBalance: '', notes: '' })
  const [preview, setPreview] = useState<{ internalBalance: number } | null>(null)
  const canWrite = ['OWNER','ADMIN','ACCOUNTANT','AP_CLERK'].includes(role)

  const load = useCallback(() => {
    if (!currentEntity) return
    fetch(`/api/vendor-recon?entityId=${currentEntity.id}`).then(r => r.json()).then(d => setRecons(d.reconciliations ?? []))
    fetch(`/api/vendor-recon?entityId=${currentEntity.id}&vendors=1`).then(r => r.json()).then(d => setVendors(d.vendors ?? []))
  }, [currentEntity])
  useEffect(() => { load() }, [load])

  // When vendor + date set, fetch a preview of the internal balance.
  useEffect(() => {
    if (!currentEntity || !form.vendor || !form.statementDate) { setPreview(null); return }
    const sp = new URLSearchParams({ entityId: currentEntity.id, preview: '1', vendor: form.vendor, statementDate: form.statementDate })
    fetch(`/api/vendor-recon?${sp}`).then(r => r.json()).then(d => {
      if (d.error) setPreview(null)
      else setPreview({ internalBalance: d.internalBalance })
    })
  }, [currentEntity, form.vendor, form.statementDate])

  const create = async () => {
    if (!currentEntity) return
    if (!form.vendor) return showToast('Vendor required', 'err')
    const res = await fetch('/api/vendor-recon', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityId: currentEntity.id,
        vendor: form.vendor,
        statementDate: form.statementDate,
        statementBalance: parseFloat(form.statementBalance) || 0,
        notes: form.notes || undefined,
      }),
    })
    if (res.ok) {
      showToast('Reconciliation created')
      setShowForm(false)
      setForm({ vendor: '', statementDate: today, statementBalance: '', notes: '' })
      load()
    } else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  if (selectedId) {
    return <VendorReconDetail id={selectedId} onClose={() => { setSelectedId(null); load() }} canWrite={canWrite} showToast={showToast} />
  }

  const previewDiff = preview ? (parseFloat(form.statementBalance) || 0) - preview.internalBalance : 0

  return (
    <div>
      <div style={S.pageActions}>
        <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
          Reconcile vendor statements against your internal AP records. Track differences and audit them before finalizing.
        </div>
        {canWrite && <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setShowForm(o => !o)}>+ New reconciliation</button>}
      </div>

      {showForm && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={S.cardHeader}>New vendor reconciliation</div>
          {vendors.length === 0 && (
            <div style={{ padding: 12, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, fontSize: 13, color: '#92400e', marginBottom: 12 }}>
              No vendors found in your AP module. Create at least one vendor invoice first, then come back.
            </div>
          )}
          <div style={S.formGrid}>
            <div>
              <label style={S.label}>Vendor</label>
              <select style={S.select} value={form.vendor} onChange={e => setForm(f => ({...f, vendor: e.target.value}))}>
                <option value="">Select…</option>
                {vendors.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>Statement date</label>
              <input style={S.input} type="date" value={form.statementDate} onChange={e => setForm(f => ({...f, statementDate: e.target.value}))} />
            </div>
            <div>
              <label style={S.label}>Vendor's statement balance</label>
              <input style={S.input} value={form.statementBalance} onChange={e => setForm(f => ({...f, statementBalance: e.target.value}))} placeholder="0.00" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              {preview && form.vendor && (
                <div style={{ padding: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, lineHeight: 1.6 }}>
                  Internal AP balance: <strong>${fmt(preview.internalBalance)}</strong><br />
                  Difference (their − yours): <strong style={{ color: Math.abs(previewDiff) < 0.01 ? '#16a34a' : '#dc2626' }}>${fmt(previewDiff)}</strong>
                </div>
              )}
            </div>
          </div>
          <textarea
            style={{ width: '100%', minHeight: 60, padding: 8, border: '1px solid #e2e8f0', borderRadius: 6, marginTop: 12, fontFamily: 'inherit', fontSize: 13 }}
            placeholder="Notes (optional): describe known timing differences, disputed items, etc."
            value={form.notes}
            onChange={e => setForm(f => ({...f, notes: e.target.value}))}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={create} disabled={!form.vendor}>Create reconciliation</button>
            <button style={S.btn} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={S.card}>
        <table style={S.table}>
          <thead><tr>{['Vendor','Statement date','Statement bal.','Internal bal.','Difference','Status','Created'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {recons.length === 0 && <tr><td colSpan={7} style={{ ...S.td, textAlign: 'center', color: '#94a3b8' }}>No vendor reconciliations yet</td></tr>}
            {recons.map(r => {
              const diff = Number(r.difference)
              return (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedId(r.id)}>
                  <td style={{ ...S.td, fontWeight: 500 }}>{r.vendor}</td>
                  <td style={S.td}>{fmtDate(r.statementDate)}</td>
                  <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace' }}>${fmt(Number(r.statementBalance))}</td>
                  <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace' }}>${fmt(Number(r.internalBalance))}</td>
                  <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', color: Math.abs(diff) < 0.01 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>${fmt(diff)}</td>
                  <td style={S.td}>
                    <span style={{ background: r.status === 'FINALIZED' ? '#f0fdf4' : '#fef3c7', color: r.status === 'FINALIZED' ? '#166534' : '#92400e', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                      {r.status}
                    </span>
                  </td>
                  <td style={{ ...S.td, fontSize: 12, color: '#64748b' }}>{fmtDate(r.createdAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function VendorReconDetail({ id, onClose, canWrite, showToast }: {
  id: string; onClose: () => void; canWrite: boolean
  showToast: (m: string, t?: 'ok'|'err') => void
}) {
  const { currentEntity } = useApp()
  const [rec, setRec] = useState<VendorRecon | null>(null)
  const [editStmt, setEditStmt] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editing, setEditing] = useState(false)

  const load = useCallback(() => {
    if (!currentEntity) return
    fetch(`/api/vendor-recon?entityId=${currentEntity.id}&id=${id}`).then(r => r.json()).then(d => {
      setRec(d)
      setEditStmt(String(d.statementBalance))
      setEditNotes(d.notes ?? '')
    })
  }, [currentEntity, id])
  useEffect(() => { load() }, [load])

  const saveEdit = async () => {
    if (!currentEntity || !rec) return
    const res = await fetch('/api/vendor-recon', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'edit', entityId: currentEntity.id, id,
        statementBalance: parseFloat(editStmt) || 0,
        notes: editNotes || null,
      }),
    })
    if (res.ok) { showToast('Saved'); setEditing(false); load() }
    else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  const finalize = async () => {
    if (!currentEntity || !rec) return
    if (!confirm('Finalize this reconciliation? Recomputes the internal balance from current AP data and locks it. You can reopen later if needed.')) return
    const res = await fetch('/api/vendor-recon', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'finalize', entityId: currentEntity.id, id, notes: editNotes || undefined }),
    })
    if (res.ok) { showToast('Finalized'); load() }
    else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  const reopen = async () => {
    if (!currentEntity || !rec) return
    if (!confirm('Reopen this reconciliation for editing?')) return
    const res = await fetch('/api/vendor-recon', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reopen', entityId: currentEntity.id, id }),
    })
    if (res.ok) { showToast('Reopened'); load() }
    else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  const del = async () => {
    if (!currentEntity || !rec) return
    if (!confirm('Delete this reconciliation? Cannot be undone.')) return
    const res = await fetch(`/api/vendor-recon?entityId=${currentEntity.id}&id=${id}`, { method: 'DELETE' })
    if (res.ok) { showToast('Deleted'); onClose() }
    else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  if (!rec) return <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>

  // For DRAFT, show live vs stored difference if AP changed in the meantime.
  const showLive = rec.status === 'DRAFT' && rec.internalBalanceLive !== undefined
  const liveInternal = rec.internalBalanceLive ?? Number(rec.internalBalance)
  const liveDiff = rec.differenceLive ?? Number(rec.difference)

  return (
    <div>
      <div style={S.pageActions}>
        <button style={S.btn} onClick={onClose}>← Back to list</button>
        <div style={{ display: 'flex', gap: 8 }}>
          {canWrite && rec.status === 'DRAFT' && <>
            <button style={S.btn} onClick={() => setEditing(o => !o)}>{editing ? 'Cancel edit' : 'Edit'}</button>
            <button style={{ ...S.btn, color: '#dc2626', borderColor: '#fecaca' }} onClick={del}>Delete</button>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={finalize}>Finalize</button>
          </>}
          {canWrite && rec.status === 'FINALIZED' && (
            <button style={S.btn} onClick={reopen}>Reopen</button>
          )}
        </div>
      </div>

      <div style={S.card}>
        <div style={S.cardHeader}>
          {rec.vendor} — Statement {fmtDate(rec.statementDate)}
          <span style={{ marginLeft: 12, background: rec.status === 'FINALIZED' ? '#f0fdf4' : '#fef3c7', color: rec.status === 'FINALIZED' ? '#166534' : '#92400e', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
            {rec.status}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, padding: '4px 4px 16px' }}>
          <div>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.06, marginBottom: 4 }}>Vendor's statement</div>
            {editing
              ? <input style={S.input} value={editStmt} onChange={e => setEditStmt(e.target.value)} />
              : <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace' }}>${fmt(Number(rec.statementBalance))}</div>
            }
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.06, marginBottom: 4 }}>Your internal AP balance</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: '#475569' }}>${fmt(Number(rec.internalBalance))}</div>
            {showLive && Math.abs(liveInternal - Number(rec.internalBalance)) > 0.01 && (
              <div style={{ fontSize: 11, color: '#d97706', marginTop: 2 }}>Live: ${fmt(liveInternal)} (AP changed since recon created)</div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.06, marginBottom: 4 }}>Difference (theirs − yours)</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: Math.abs(Number(rec.difference)) < 0.01 ? '#16a34a' : '#dc2626' }}>${fmt(Number(rec.difference))}</div>
            {showLive && Math.abs(liveDiff - Number(rec.difference)) > 0.01 && (
              <div style={{ fontSize: 11, color: '#d97706', marginTop: 2 }}>Live: ${fmt(liveDiff)}</div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.06, marginBottom: 4 }}>Notes</div>
          {editing
            ? <textarea style={{ width: '100%', minHeight: 80, padding: 8, border: '1px solid #e2e8f0', borderRadius: 6, fontFamily: 'inherit', fontSize: 13 }} value={editNotes} onChange={e => setEditNotes(e.target.value)} />
            : <div style={{ fontSize: 13, color: '#475569', whiteSpace: 'pre-wrap' }}>{rec.notes ?? '—'}</div>
          }
        </div>

        {editing && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={saveEdit}>Save</button>
            <button style={S.btn} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        )}

        {rec.finalizedAt && (
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 14, paddingTop: 12, borderTop: '1px solid #e2e8f0' }}>
            Finalized {fmtDate(rec.finalizedAt)}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Expense Requests (maker-checker AP workflow) ────────────────────────────
type ApRequestStatusUI = 'SUBMITTED'|'APPROVED'|'POSTED'|'RETURNED_TO_REQUESTER'|'RETURNED_TO_APPROVER'
type ApPaymentModeUI = 'ACH'|'CHEQUE'|'WIRE'|'OTHER'

interface ApRequestRow {
  id: string
  vendor: string
  invoiceNo: string
  invoiceDate: string
  dueDate: string | null
  amount: number | string
  accountId: string
  paymentMode: ApPaymentModeUI | null
  description: string | null
  attachmentId: string | null
  status: ApRequestStatusUI
  requesterId: string
  requesterName: string
  approverId: string | null
  accountantId: string | null
  submittedAt: string
  approvedAt: string | null
  postedAt: string | null
  apInvoiceId: string | null
  createdAt: string
  account: { code: string; name: string }
  attachment: { id: string; filename: string } | null
}

interface ApRequestDetail extends ApRequestRow {
  account: { id: string; code: string; name: string; type: string }
  attachment: { id: string; filename: string; mimeType: string; size: number } | null
  apInvoice: { id: string; status: string; invoiceNo: string } | null
  requester: { id: string; name: string; email: string } | null
  approver:  { id: string; name: string; email: string } | null
  accountant:{ id: string; name: string; email: string } | null
  comments: Array<{ id: string; userId: string; action: string; comment: string | null; createdAt: string; user: { id: string; name: string } | null }>
  allowedActions: Array<'submit'|'approve'|'return-to-requester'|'return-to-approver'|'post'|'resubmit'|'delete'>
}

const STATUS_COLORS: Record<ApRequestStatusUI, { bg: string; fg: string; label: string }> = {
  SUBMITTED:              { bg: '#dbeafe', fg: '#1d4ed8', label: 'Submitted' },
  APPROVED:               { bg: '#ddd6fe', fg: '#6d28d9', label: 'Approved' },
  POSTED:                 { bg: '#dcfce7', fg: '#166534', label: 'Posted' },
  RETURNED_TO_REQUESTER:  { bg: '#fef3c7', fg: '#92400e', label: 'Returned to requester' },
  RETURNED_TO_APPROVER:   { bg: '#fed7aa', fg: '#9a3412', label: 'Returned to approver' },
}

function ApRequestsPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { currentEntity, role, user } = useApp()
  const [filter, setFilter] = useState<'mine'|'pending-approval'|'pending-posting'|'all'>('mine')
  const [requests, setRequests] = useState<ApRequestRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const isApprover = role === 'OWNER' || role === 'ADMIN'
  const isAccountant = isApprover || role === 'ACCOUNTANT'

  const load = useCallback(() => {
    if (!currentEntity) return
    fetch(`/api/ap-requests?entityId=${currentEntity.id}`).then(r => r.json()).then(d => setRequests(d.requests ?? []))
  }, [currentEntity])
  useEffect(() => { load() }, [load])

  const filtered = requests.filter(r => {
    if (filter === 'mine') return r.requesterId === user.id
    if (filter === 'pending-approval') return r.status === 'SUBMITTED' || r.status === 'RETURNED_TO_APPROVER'
    if (filter === 'pending-posting') return r.status === 'APPROVED'
    return true
  })

  if (selectedId) {
    return <ApRequestDetailView
      id={selectedId}
      showToast={showToast}
      onClose={() => { setSelectedId(null); load() }}
    />
  }

  return (
    <div>
      <div style={S.pageActions}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={{ ...S.filterBtn, ...(filter==='mine' ? S.filterBtnActive : {}) }} onClick={() => setFilter('mine')}>My requests</button>
          {isApprover && (
            <button style={{ ...S.filterBtn, ...(filter==='pending-approval' ? S.filterBtnActive : {}) }} onClick={() => setFilter('pending-approval')}>
              Pending my approval
              {requests.filter(r => r.status === 'SUBMITTED' || r.status === 'RETURNED_TO_APPROVER').length > 0 && (
                <span style={{ marginLeft: 6, padding: '1px 6px', background: '#dc2626', color: '#fff', borderRadius: 8, fontSize: 10, fontWeight: 700 }}>
                  {requests.filter(r => r.status === 'SUBMITTED' || r.status === 'RETURNED_TO_APPROVER').length}
                </span>
              )}
            </button>
          )}
          {isAccountant && (
            <button style={{ ...S.filterBtn, ...(filter==='pending-posting' ? S.filterBtnActive : {}) }} onClick={() => setFilter('pending-posting')}>
              Pending posting
              {requests.filter(r => r.status === 'APPROVED').length > 0 && (
                <span style={{ marginLeft: 6, padding: '1px 6px', background: '#7c3aed', color: '#fff', borderRadius: 8, fontSize: 10, fontWeight: 700 }}>
                  {requests.filter(r => r.status === 'APPROVED').length}
                </span>
              )}
            </button>
          )}
          <button style={{ ...S.filterBtn, ...(filter==='all' ? S.filterBtnActive : {}) }} onClick={() => setFilter('all')}>All</button>
        </div>
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setShowForm(true)}>+ New expense request</button>
      </div>

      {showForm && (
        <ApRequestForm
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); load() }}
          showToast={showToast}
        />
      )}

      <div style={S.card}>
        <table style={S.table}>
          <thead><tr>{['Vendor','Invoice #','Date','Amount','GL','Payment','Status','Requester',''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={9} style={{ ...S.td, textAlign: 'center', color: '#94a3b8' }}>
              {filter === 'mine' ? 'You haven\'t submitted any requests yet' : 'No requests in this view'}
            </td></tr>}
            {filtered.map(r => {
              const s = STATUS_COLORS[r.status]
              return (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedId(r.id)}>
                  <td style={{ ...S.td, fontWeight: 500 }}>{r.vendor}</td>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{r.invoiceNo}</td>
                  <td style={S.td}>{fmtDate(r.invoiceDate)}</td>
                  <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>${fmt(Number(r.amount))}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{r.account?.code} — {r.account?.name}</td>
                  <td style={{ ...S.td, fontSize: 11, color: '#64748b' }}>{r.paymentMode ?? '—'}</td>
                  <td style={S.td}>
                    <span style={{ background: s.bg, color: s.fg, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {s.label}
                    </span>
                  </td>
                  <td style={{ ...S.td, fontSize: 12 }}>{r.requesterName}</td>
                  <td style={{ ...S.td, color: '#94a3b8' }}>›</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Request creation form ───────────────────────────────────────────────────
function ApRequestForm({ onClose, onCreated, showToast }: {
  onClose: () => void
  onCreated: () => void
  showToast: (m: string, t?: 'ok'|'err') => void
}) {
  const { currentEntity } = useApp()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [vendors, setVendors] = useState<string[]>([])
  const [form, setForm] = useState({
    vendor: '', invoiceNo: '', invoiceDate: new Date().toISOString().slice(0,10),
    dueDate: '', amount: '', accountId: '', paymentMode: 'ACH' as ApPaymentModeUI,
    description: '',
  })
  const [attachment, setAttachment] = useState<{ id: string; filename: string; size: number } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Load expense + COGS accounts only for the GL picker
  useEffect(() => {
    if (!currentEntity) return
    fetch(`/api/accounts?entityId=${currentEntity.id}`).then(r => r.json()).then((all: Account[]) =>
      setAccounts(all.filter(a => a.type === 'EXPENSE' || a.type === 'COGS'))
    )
    // Pull vendor list from existing AP invoices
    fetch(`/api/vendor-recon?entityId=${currentEntity.id}&vendors=1`).then(r => r.json()).then(d => setVendors(d.vendors ?? []))
  }, [currentEntity])

  // Vendor-default GL lookup
  useEffect(() => {
    if (!currentEntity || !form.vendor) return
    const sp = new URLSearchParams({ entityId: currentEntity.id, vendorDefault: '1', vendor: form.vendor })
    fetch(`/api/ap-requests?${sp}`).then(r => r.json()).then(d => {
      if (d.accountId && !form.accountId) {
        setForm(f => ({ ...f, accountId: d.accountId }))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.vendor, currentEntity])

  const handleFile = async (file: File) => {
    if (!currentEntity) return
    if (file.size > 5 * 1024 * 1024) return showToast('File too large (max 5MB)', 'err')
    setUploading(true)
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          // result is "data:mime;base64,XXXX" — strip the prefix
          resolve(result.split(',')[1] ?? '')
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const res = await fetch('/api/attachments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityId: currentEntity.id,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          dataBase64,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setAttachment(data)
        showToast(`Uploaded ${file.name}`)
      } else showToast(data.error ?? 'Upload failed', 'err')
    } finally { setUploading(false) }
  }

  const submit = async () => {
    if (!currentEntity) return
    if (!form.vendor || !form.invoiceNo || !form.amount || !form.accountId) {
      return showToast('Vendor, invoice number, amount, and GL account are required', 'err')
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/ap-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityId: currentEntity.id,
          vendor: form.vendor,
          invoiceNo: form.invoiceNo,
          invoiceDate: form.invoiceDate,
          dueDate: form.dueDate || undefined,
          amount: parseFloat(form.amount) || 0,
          accountId: form.accountId,
          paymentMode: form.paymentMode,
          description: form.description || undefined,
          attachmentId: attachment?.id,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        showToast('Request submitted for approval')
        onCreated()
      } else showToast(data.error ?? 'Failed to submit', 'err')
    } finally { setSubmitting(false) }
  }

  return (
    <div style={{ ...S.card, marginBottom: 16 }}>
      <div style={S.cardHeader}>New expense request</div>
      <div style={S.formGrid}>
        <div>
          <label style={S.label}>Vendor</label>
          <input
            list="apreq-vendors"
            style={S.input}
            value={form.vendor}
            onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))}
            placeholder="Vendor name"
          />
          <datalist id="apreq-vendors">{vendors.map(v => <option key={v} value={v} />)}</datalist>
        </div>
        <div>
          <label style={S.label}>Invoice #</label>
          <input style={S.input} value={form.invoiceNo} onChange={e => setForm(f => ({ ...f, invoiceNo: e.target.value }))} placeholder="INV-1234" />
        </div>
        <div>
          <label style={S.label}>Invoice date</label>
          <input style={S.input} type="date" value={form.invoiceDate} onChange={e => setForm(f => ({ ...f, invoiceDate: e.target.value }))} />
        </div>
        <div>
          <label style={S.label}>Due date (optional)</label>
          <input style={S.input} type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
        </div>
        <div>
          <label style={S.label}>Amount</label>
          <input style={S.input} value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
        </div>
        <div>
          <label style={S.label}>GL account (expense)</label>
          <select style={S.select} value={form.accountId} onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))}>
            <option value="">Select expense account…</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        </div>
        <div>
          <label style={S.label}>Payment mode</label>
          <select style={S.select} value={form.paymentMode} onChange={e => setForm(f => ({ ...f, paymentMode: e.target.value as ApPaymentModeUI }))}>
            <option value="ACH">ACH</option>
            <option value="CHEQUE">Cheque</option>
            <option value="WIRE">Wire</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
        <div>
          <label style={S.label}>Invoice attachment (PDF / image)</label>
          {attachment ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6 }}>
              <span style={{ fontSize: 12 }}>✓ {attachment.filename} ({fmtCompactBytes(attachment.size)})</span>
              <button style={{ ...S.textBtn, color: '#dc2626', marginLeft: 'auto' }} onClick={() => setAttachment(null)}>Remove</button>
            </div>
          ) : (
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp"
              disabled={uploading}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
              style={{ fontSize: 12 }}
            />
          )}
          {uploading && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Uploading…</div>}
        </div>
      </div>
      <textarea
        style={{ width: '100%', minHeight: 60, padding: 8, border: '1px solid #e2e8f0', borderRadius: 6, marginTop: 12, fontFamily: 'inherit', fontSize: 13 }}
        placeholder="Description / notes (optional)"
        value={form.description}
        onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={submit} disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit for approval'}
        </button>
        <button style={S.btn} onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

function fmtCompactBytes(b: number): string {
  if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB'
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB'
  return b + ' B'
}

// ─── Detail view with workflow actions and comment trail ─────────────────────
function ApRequestDetailView({ id, onClose, showToast }: {
  id: string
  onClose: () => void
  showToast: (m: string, t?: 'ok'|'err') => void
}) {
  const { currentEntity, user } = useApp()
  const [data, setData] = useState<ApRequestDetail | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [commentText, setCommentText] = useState('')
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<{
    vendor: string; invoiceNo: string; invoiceDate: string; dueDate: string
    amount: string; accountId: string; paymentMode: ApPaymentModeUI; description: string
  } | null>(null)

  const load = useCallback(() => {
    if (!currentEntity) return
    fetch(`/api/ap-requests?entityId=${currentEntity.id}&id=${id}`).then(r => r.json()).then(d => {
      if (!d.error) setData(d)
    })
    fetch(`/api/accounts?entityId=${currentEntity.id}`).then(r => r.json()).then((all: Account[]) =>
      setAccounts(all.filter(a => a.type === 'EXPENSE' || a.type === 'COGS'))
    )
  }, [currentEntity, id])
  useEffect(() => { load() }, [load])

  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>

  const isRequester = data.requesterId === user.id
  const canEdit = data.allowedActions.length > 0 && (
    (isRequester && (data.status === 'SUBMITTED' || data.status === 'RETURNED_TO_REQUESTER')) ||
    (data.status === 'APPROVED' && data.allowedActions.includes('post'))
  )

  const startEdit = () => {
    setEditForm({
      vendor: data.vendor,
      invoiceNo: data.invoiceNo,
      invoiceDate: data.invoiceDate.slice(0,10),
      dueDate: data.dueDate ? data.dueDate.slice(0,10) : '',
      amount: String(Number(data.amount)),
      accountId: data.accountId,
      paymentMode: data.paymentMode ?? 'ACH',
      description: data.description ?? '',
    })
    setEditing(true)
  }
  const saveEdit = async () => {
    if (!currentEntity || !editForm) return
    const res = await fetch('/api/ap-requests', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityId: currentEntity.id, id, action: 'edit',
        comment: commentText || undefined,
        edit: {
          vendor: editForm.vendor,
          invoiceNo: editForm.invoiceNo,
          invoiceDate: editForm.invoiceDate,
          dueDate: editForm.dueDate || null,
          amount: parseFloat(editForm.amount) || 0,
          accountId: editForm.accountId,
          paymentMode: editForm.paymentMode,
          description: editForm.description || null,
        },
      }),
    })
    const d = await res.json()
    if (res.ok) { showToast('Saved'); setEditing(false); setCommentText(''); load() }
    else showToast(d.error ?? 'Error', 'err')
  }

  const doAction = async (action: 'approve'|'return-to-requester'|'return-to-approver'|'post'|'resubmit'|'delete') => {
    if (!currentEntity) return
    const labels: Record<string, string> = {
      approve: 'Approve this request?',
      'return-to-requester': 'Return to requester — please add a comment explaining what to fix',
      'return-to-approver': 'Return to approver — please add a comment',
      post: 'Post this request to the GL? This creates a journal entry and cannot be easily undone.',
      resubmit: 'Resubmit this request for approval?',
      delete: 'Delete this request permanently?',
    }
    if (!confirm(labels[action])) return
    if (action.startsWith('return') && !commentText.trim()) {
      showToast('Please add a comment explaining the reason', 'err')
      return
    }
    const res = await fetch('/api/ap-requests', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityId: currentEntity.id, id, action,
        comment: commentText || undefined,
      }),
    })
    const d = await res.json()
    if (res.ok) {
      showToast(action === 'delete' ? 'Deleted' : 'Done')
      setCommentText('')
      if (action === 'delete') onClose()
      else load()
    } else showToast(d.error ?? 'Error', 'err')
  }

  const downloadAttachment = async () => {
    if (!currentEntity || !data.attachment) return
    const res = await fetch(`/api/attachments?entityId=${currentEntity.id}&id=${data.attachment.id}`)
    const d = await res.json()
    if (!res.ok) return showToast(d.error ?? 'Download failed', 'err')
    // Reconstruct the file from base64 and trigger a download in-browser.
    const bin = atob(d.dataBase64)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    const blob = new Blob([arr], { type: d.mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = d.filename; a.click()
    URL.revokeObjectURL(url)
  }

  const status = STATUS_COLORS[data.status]
  const allow = new Set(data.allowedActions)

  return (
    <div>
      <div style={S.pageActions}>
        <button style={S.btn} onClick={onClose}>← Back to list</button>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canEdit && !editing && <button style={S.btn} onClick={startEdit}>Edit fields</button>}
          {allow.has('approve') && <button style={{ ...S.btn, ...S.btnPrimary, background: '#7c3aed', borderColor: '#7c3aed' }} onClick={() => doAction('approve')}>Approve</button>}
          {allow.has('post') && <button style={{ ...S.btn, ...S.btnPrimary, background: '#16a34a', borderColor: '#16a34a' }} onClick={() => doAction('post')}>Post to GL</button>}
          {allow.has('resubmit') && <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => doAction('resubmit')}>Resubmit</button>}
          {allow.has('return-to-approver') && <button style={{ ...S.btn, background: '#fed7aa', borderColor: '#fb923c', color: '#9a3412' }} onClick={() => doAction('return-to-approver')}>Send back to approver</button>}
          {allow.has('return-to-requester') && <button style={{ ...S.btn, background: '#fef3c7', borderColor: '#fbbf24', color: '#92400e' }} onClick={() => doAction('return-to-requester')}>Send back to requester</button>}
          {allow.has('delete') && <button style={{ ...S.btn, color: '#dc2626', borderColor: '#fecaca' }} onClick={() => doAction('delete')}>Delete</button>}
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{data.vendor}</div>
            <div style={{ fontSize: 13, color: '#64748b' }}>Invoice {data.invoiceNo} · {fmtDate(data.invoiceDate)}</div>
          </div>
          <span style={{ background: status.bg, color: status.fg, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
            {status.label}
          </span>
        </div>

        {editing && editForm ? (
          <div style={S.formGrid}>
            <div><label style={S.label}>Vendor</label><input style={S.input} value={editForm.vendor} onChange={e => setEditForm(f => f ? ({ ...f, vendor: e.target.value }) : f)} /></div>
            <div><label style={S.label}>Invoice #</label><input style={S.input} value={editForm.invoiceNo} onChange={e => setEditForm(f => f ? ({ ...f, invoiceNo: e.target.value }) : f)} /></div>
            <div><label style={S.label}>Invoice date</label><input style={S.input} type="date" value={editForm.invoiceDate} onChange={e => setEditForm(f => f ? ({ ...f, invoiceDate: e.target.value }) : f)} /></div>
            <div><label style={S.label}>Due date</label><input style={S.input} type="date" value={editForm.dueDate} onChange={e => setEditForm(f => f ? ({ ...f, dueDate: e.target.value }) : f)} /></div>
            <div><label style={S.label}>Amount</label><input style={S.input} value={editForm.amount} onChange={e => setEditForm(f => f ? ({ ...f, amount: e.target.value }) : f)} /></div>
            <div>
              <label style={S.label}>GL account</label>
              <select style={S.select} value={editForm.accountId} onChange={e => setEditForm(f => f ? ({ ...f, accountId: e.target.value }) : f)}>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>Payment mode</label>
              <select style={S.select} value={editForm.paymentMode} onChange={e => setEditForm(f => f ? ({ ...f, paymentMode: e.target.value as ApPaymentModeUI }) : f)}>
                <option value="ACH">ACH</option><option value="CHEQUE">Cheque</option><option value="WIRE">Wire</option><option value="OTHER">Other</option>
              </select>
            </div>
            <div style={{ gridColumn: '1/-1' }}><label style={S.label}>Description</label><input style={S.input} value={editForm.description} onChange={e => setEditForm(f => f ? ({ ...f, description: e.target.value }) : f)} /></div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
            <Field label="Amount" value={`$${fmt(Number(data.amount))}`} mono />
            <Field label="GL Account" value={`${data.account.code} — ${data.account.name}`} />
            <Field label="Payment mode" value={data.paymentMode ?? '—'} />
            <Field label="Due date" value={data.dueDate ? fmtDate(data.dueDate) : '—'} />
            <Field label="Requester" value={data.requester?.name ?? '—'} />
            {data.approver && <Field label="Approver" value={data.approver.name} />}
            {data.accountant && <Field label="Posted by" value={data.accountant.name} />}
          </div>
        )}

        {!editing && data.description && (
          <div style={{ marginTop: 16, padding: 10, background: '#f8fafc', borderRadius: 6, fontSize: 13 }}>
            <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>Description</div>
            {data.description}
          </div>
        )}

        {data.attachment && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>Attachment</div>
            <button style={{ ...S.btn, padding: '6px 14px' }} onClick={downloadAttachment}>
              📎 {data.attachment.filename} ({fmtCompactBytes(data.attachment.size)})
            </button>
          </div>
        )}

        {data.apInvoice && (
          <div style={{ marginTop: 16, padding: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, fontSize: 13 }}>
            <strong>Posted as AP invoice {data.apInvoice.invoiceNo}</strong> — status: {data.apInvoice.status}
          </div>
        )}

        {editing && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={saveEdit}>Save changes</button>
            <button style={S.btn} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        )}
      </div>

      {/* Comment input for workflow actions */}
      {data.allowedActions.length > 0 && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={S.cardHeader}>Add a comment with your action</div>
          <textarea
            style={{ width: '100%', minHeight: 60, padding: 8, border: '1px solid #e2e8f0', borderRadius: 6, fontFamily: 'inherit', fontSize: 13 }}
            placeholder="Optional for approve/post. Required for 'send back' actions."
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
          />
        </div>
      )}

      {/* Comment trail */}
      <div style={S.card}>
        <div style={S.cardHeader}>Activity</div>
        <div>
          {data.comments.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No activity yet</div>}
          {data.comments.map(c => (
            <div key={c.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ flex: '0 0 32px', width: 32, height: 32, borderRadius: 16, background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, color: '#475569' }}>
                {c.user?.name.charAt(0).toUpperCase() ?? '?'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13 }}>
                  <strong>{c.user?.name ?? '(unknown)'}</strong>
                  <span style={{ marginLeft: 6, fontSize: 11, color: '#64748b' }}>{c.action.replace(/_/g, ' ').toLowerCase()}</span>
                  <span style={{ marginLeft: 'auto', float: 'right', fontSize: 11, color: '#94a3b8' }}>{new Date(c.createdAt).toLocaleString()}</span>
                </div>
                {c.comment && <div style={{ marginTop: 4, padding: 8, background: '#f8fafc', borderRadius: 6, fontSize: 13 }}>{c.comment}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.06, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500, ...(mono ? { fontFamily: 'monospace' } : {}) }}>{value}</div>
    </div>
  )
}

// ─── Constants ────────────────────────────────────────────────────────────────
const TYPE_COLORS: Record<string,string> = {
  ASSET:'#0891b2', LIABILITY:'#dc2626', EQUITY:'#7c3aed', REVENUE:'#16a34a', EXPENSE:'#d97706', COGS:'#ea580c'
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  app:        { display:'flex', height:'100vh', overflow:'hidden', fontFamily:"'Inter',-apple-system,sans-serif", background:'#f8fafc', color:'#0f172a' },
  sidebar:    { display:'flex', flexDirection:'column', background:'#0f172a', overflow:'hidden', flexShrink:0, transition:'width .2s' },
  sidebarTop: { padding:'0 0 8px', borderBottom:'1px solid #1e293b' },
  logoRow:    { display:'flex', alignItems:'center', gap:10, padding:'16px 16px 12px', cursor:'pointer' },
  logoMark:   { width:28, height:28, background:'#7c3aed', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:800, fontSize:15, flexShrink:0 },
  logoText:   { color:'#f8fafc', fontWeight:700, fontSize:15, letterSpacing:-0.3 },
  entityBtn:  { margin:'0 10px', padding:'8px 10px', background:'#1e293b', borderRadius:8, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between', gap:6 },
  entityName: { color:'#94a3b8', fontSize:12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 },
  navItem:    { display:'flex', alignItems:'center', gap:10, padding:'9px 16px', cursor:'pointer', color:'#94a3b8', fontSize:13, transition:'all .1s', borderLeft:'2px solid transparent' },
  navActive:  { color:'#a78bfa', background:'#1e293b', borderLeft:'2px solid #7c3aed' },
  sidebarBottom: { borderTop:'1px solid #1e293b', padding:'10px 12px' },
  userRow:    { display:'flex', alignItems:'center', gap:8 },
  avatar:     { width:30, height:30, borderRadius:'50%', background:'#7c3aed', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:13, flexShrink:0 },
  userName:   { fontSize:12, fontWeight:600, color:'#e2e8f0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  userRole:   { fontSize:10, color:'#64748b', marginTop:1 },
  logoutBtn:  { background:'none', border:'none', color:'#64748b', cursor:'pointer', fontSize:13, padding:'2px 4px', lineHeight:1 },
  main:       { flex:1, display:'flex', flexDirection:'column', overflow:'hidden' },
  topbar:     { background:'#fff', borderBottom:'1px solid #e2e8f0', padding:'10px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', minHeight:50 },
  entityBadge:{ fontSize:11, color:'#7c3aed', background:'#ede9fe', padding:'2px 8px', borderRadius:20, fontWeight:600 },
  rolePill:   { fontSize:11, padding:'2px 8px', borderRadius:20, fontWeight:700 },
  content:    { flex:1, overflow:'auto', padding:20 },
  overlay:    { position:'absolute', inset:0, background:'rgba(0,0,0,0.4)', zIndex:100, display:'flex', alignItems:'flex-start', justifyContent:'flex-start' },
  switcher:   { background:'#fff', width:300, maxHeight:'80vh', overflow:'auto', marginTop:50, marginLeft:10, borderRadius:12, boxShadow:'0 20px 40px rgba(0,0,0,0.15)', padding:16 },
  switcherHeader: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, paddingBottom:8, borderBottom:'1px solid #f1f5f9' },
  switcherItem: { display:'flex', alignItems:'center', gap:10, padding:'10px 8px', borderRadius:8, cursor:'pointer', transition:'background .1s' },
  switcherActive:{ background:'#f5f3ff' },
  closeBtn:   { background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:16, lineHeight:1 },
  entityIcon: { width:32, height:32, borderRadius:8, background:'#7c3aed20', color:'#7c3aed', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:14, flexShrink:0 },
  authWrap:   { minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'linear-gradient(135deg,#f0f9ff 0%,#faf5ff 100%)', padding:20 },
  authCard:   { background:'#fff', borderRadius:16, padding:'36px 32px', width:'100%', maxWidth:440, boxShadow:'0 4px 40px rgba(0,0,0,0.08)' },
  authLogo:   { width:52, height:52, background:'#7c3aed', borderRadius:14, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:900, fontSize:24, margin:'0 auto 12px' },
  kpiGrid:    { display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:4 },
  kpiCard:    { background:'#fff', borderRadius:10, padding:16, border:'1px solid #f1f5f9' },
  card:       { background:'#fff', border:'1px solid #e2e8f0', borderRadius:10, padding:16, marginBottom:0 },
  cardHeader: { fontSize:13, fontWeight:600, color:'#334155', marginBottom:12 },
  table:      { width:'100%', borderCollapse:'collapse', fontSize:12 },
  th:         { textAlign:'left', padding:'8px 10px', fontSize:11, color:'#94a3b8', borderBottom:'1px solid #f1f5f9', fontWeight:600, whiteSpace:'nowrap' },
  td:         { padding:'9px 10px', borderBottom:'1px solid #f8fafc', color:'#374151' },
  pageActions:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 },
  btn:        { padding:'7px 14px', fontSize:12, borderRadius:8, border:'1px solid #e2e8f0', background:'#fff', color:'#374151', cursor:'pointer', display:'inline-flex', alignItems:'center', gap:6, fontFamily:'inherit' },
  btnPrimary: { background:'#7c3aed', color:'#fff', border:'1px solid #7c3aed' },
  label:      { display:'block', fontSize:11, color:'#64748b', marginBottom:4, fontWeight:600 },
  input:      { display:'block', width:'100%', padding:'8px 10px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:12, marginBottom:12, fontFamily:'inherit', background:'#fff', color:'#0f172a', boxSizing:'border-box' },
  select:     { display:'block', width:'100%', padding:'8px 10px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:12, marginBottom:12, fontFamily:'inherit', background:'#fff', color:'#0f172a' },
  errMsg:     { fontSize:12, color:'#dc2626', background:'#fef2f2', padding:'8px 12px', borderRadius:8, marginBottom:12 },
  formGrid:   { display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:4 },
  filterBtn:  { padding:'5px 12px', fontSize:12, borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', color:'#64748b', cursor:'pointer' },
  filterBtnActive: { background:'#7c3aed', color:'#fff', border:'1px solid #7c3aed' },
  typeBadge:  { padding:'2px 8px', borderRadius:20, fontSize:11, fontWeight:600 },
  greenBadge: { padding:'2px 8px', borderRadius:20, fontSize:11, fontWeight:600, background:'#f0fdf4', color:'#166534' },
  toast:      { position:'fixed', bottom:24, right:24, padding:'12px 18px', borderRadius:10, color:'#fff', fontSize:13, fontWeight:600, zIndex:999 },
  textBtn:    { background:'none', border:'none', color:'#7c3aed', cursor:'pointer', fontSize:13, fontWeight:600, padding:0 },
  demoBtn:    { display:'flex', justifyContent:'space-between', alignItems:'center', width:'100%', padding:'7px 10px', marginBottom:4, background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, cursor:'pointer', fontSize:12, fontFamily:'inherit' },
}
