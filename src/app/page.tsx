'use client'
import { useState, useEffect, useCallback, createContext, useContext, Fragment } from 'react'

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Entity { id: string; name: string; slug: string; currency: string; userAccess?: { role: string }[] }
interface User   { id: string; name: string; email: string; isSuperAdmin: boolean }
interface Account{ id: string; code: string; name: string; type: string; subType?: string; isBankAccount?: boolean }
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
  payments:   ['OWNER','ADMIN','ACCOUNTANT','AP_CLERK'],
  recon:      ['OWNER','ADMIN','ACCOUNTANT','AUDITOR'],
  reports:    ['OWNER','ADMIN','ACCOUNTANT','AUDITOR','CLIENT_VIEW'],
  assets:     ['OWNER','ADMIN','ACCOUNTANT','AUDITOR'],
  audit:      ['OWNER','ADMIN','AUDITOR'],
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
    { id: 'payments',  label: 'Payments',           icon: '✓' },
    { id: 'recon',     label: 'Bank Recon',         icon: '↔' },
    { id: 'assets',    label: 'Fixed Assets',       icon: '⬚' },
    { id: 'reports',   label: 'Reports',            icon: '▤' },
    { id: 'audit',     label: 'Audit Trail',        icon: '⊙' },
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
                {page === 'payments'  && <PaymentsPage   showToast={showToast} />}
                {page === 'recon'     && <ReconPage      showToast={showToast} />}
                {page === 'assets'    && <AssetsPage     showToast={showToast} />}
                {page === 'reports'   && <ReportsPage    showToast={showToast} />}
                {page === 'audit'     && <AuditPage      showToast={showToast} />}
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
function DashboardPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { currentEntity } = useApp()
  const [data, setData] = useState<{ accounts?: Account[]; apSummary?: { total: number; overdueCount: number; overdue30: number } }>({})

  useEffect(() => {
    if (!currentEntity) return
    Promise.all([
      fetch(`/api/accounts?entityId=${currentEntity.id}`).then(r => r.json()),
      fetch(`/api/ap?entityId=${currentEntity.id}`).then(r => r.json()),
    ]).then(([accts, ap]) => setData({ accounts: accts, apSummary: ap.summary }))
  }, [currentEntity])

  const totalAssets    = data.accounts?.filter(a => a.type === 'ASSET').length ?? 0
  const totalAccounts  = data.accounts?.length ?? 0

  return (
    <div>
      <div style={S.kpiGrid}>
        {[
          { label: 'Total accounts', value: totalAccounts, sub: 'in chart of accounts', color: '#7c3aed' },
          { label: 'AP outstanding', value: `$${fmt(data.apSummary?.total ?? 0)}`, sub: `${data.apSummary?.overdueCount ?? 0} overdue`, color: '#dc2626' },
          { label: 'Asset accounts', value: totalAssets, sub: 'active asset accounts', color: '#0891b2' },
          { label: 'AP overdue (30d)', value: `$${fmt(data.apSummary?.overdue30 ?? 0)}`, sub: 'needs attention', color: '#d97706' },
        ].map(k => (
          <div key={k.label} style={S.kpiCard}>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>{k.sub}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <AccountsWidget />
        <ApWidget />
      </div>
    </div>
  )
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
  const [form, setForm] = useState({ code: '', name: '', type: 'EXPENSE', subType: '', description: '' })

  const load = useCallback(() => {
    if (!currentEntity) return
    fetch(`/api/accounts?entityId=${currentEntity.id}`).then(r => r.json()).then(setAccounts)
  }, [currentEntity])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!currentEntity) return
    const res = await fetch('/api/accounts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId: currentEntity.id, ...form }),
    })
    if (res.ok) { showToast('Account created'); setShowForm(false); setForm({ code:'',name:'',type:'EXPENSE',subType:'',description:'' }); load() }
    else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  const filtered = filter === 'ALL' ? accounts : accounts.filter(a => a.type === filter)
  const canWrite = ['OWNER','ADMIN','ACCOUNTANT'].includes(role)

  return (
    <div>
      <div style={S.pageActions}>
        <div style={{ display: 'flex', gap: 6 }}>
          {['ALL','ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','COGS'].map(t => (
            <button key={t} style={{ ...S.filterBtn, ...(filter === t ? S.filterBtnActive : {}) }} onClick={() => setFilter(t)}>{t}</button>
          ))}
        </div>
        {canWrite && <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setShowForm(o => !o)}>+ Add account</button>}
      </div>

      {showForm && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={S.cardHeader}>New account</div>
          <div style={S.formGrid}>
            <div><label style={S.label}>Account code</label><input style={S.input} value={form.code} onChange={e => setForm(f => ({...f,code:e.target.value}))} placeholder="1000" /></div>
            <div><label style={S.label}>Account name</label><input style={S.input} value={form.name} onChange={e => setForm(f => ({...f,name:e.target.value}))} placeholder="Cash & Equivalents" /></div>
            <div><label style={S.label}>Type</label>
              <select style={S.select} value={form.type} onChange={e => setForm(f => ({...f,type:e.target.value}))}>
                {['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','COGS'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div><label style={S.label}>Sub-type</label><input style={S.input} value={form.subType} onChange={e => setForm(f => ({...f,subType:e.target.value}))} placeholder="Current" /></div>
          </div>
          <input style={{ ...S.input, marginBottom: 12 }} value={form.description} onChange={e => setForm(f => ({...f,description:e.target.value}))} placeholder="Description (optional)" />
          <div style={{ display:'flex',gap:8 }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={save}>Save account</button>
            <button style={S.btn} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={S.card}>
        <table style={S.table}>
          <thead><tr>{['Code','Account name','Type','Sub-type','Status'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>{filtered.map(a => (
            <tr key={a.id}>
              <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{a.code}</td>
              <td style={{ ...S.td, fontWeight: 500 }}>{a.name}</td>
              <td style={S.td}><span style={{ ...S.typeBadge, background: TYPE_COLORS[a.type] + '18', color: TYPE_COLORS[a.type] }}>{a.type}</span></td>
              <td style={S.td}>{a.subType ?? '—'}</td>
              <td style={S.td}><span style={S.greenBadge}>Active</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Journal Entries ──────────────────────────────────────────────────────────
function JournalsPage({ showToast }: { showToast: (m: string, t?: 'ok'|'err') => void }) {
  const { currentEntity, role } = useApp()
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [showForm, setShowForm] = useState(false)
  const [lines, setLines] = useState([{ accountId: '', debit: '', credit: '', description: '' }, { accountId: '', debit: '', credit: '', description: '' }])
  const [hdr, setHdr] = useState({ date: new Date().toISOString().split('T')[0], description: '', memo: '' })
  const canWrite = ['OWNER','ADMIN','ACCOUNTANT'].includes(role)

  const load = useCallback(() => {
    if (!currentEntity) return
    fetch(`/api/journals?entityId=${currentEntity.id}&limit=20`).then(r => r.json()).then(d => setEntries(d.entries ?? []))
    fetch(`/api/accounts?entityId=${currentEntity.id}`).then(r => r.json()).then(setAccounts)
  }, [currentEntity])

  useEffect(() => { load() }, [load])

  const totalDebit  = lines.reduce((s,l) => s + (parseFloat(l.debit)  || 0), 0)
  const totalCredit = lines.reduce((s,l) => s + (parseFloat(l.credit) || 0), 0)
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005

  const save = async (status: 'DRAFT'|'POST') => {
    if (!currentEntity) return
    const res = await fetch('/api/journals', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityId: currentEntity.id, ...hdr,
        lines: lines.filter(l => l.accountId).map((l,i) => ({
          accountId: l.accountId, description: l.description,
          debit: parseFloat(l.debit)||0, credit: parseFloat(l.credit)||0, lineOrder: i,
        })),
      }),
    })
    if (res.ok) {
      showToast('Journal entry saved')
      setShowForm(false)
      setLines([{ accountId:'',debit:'',credit:'',description:'' },{ accountId:'',debit:'',credit:'',description:'' }])
      setHdr({ date: new Date().toISOString().split('T')[0], description:'', memo:'' })
      load()
    } else { const d = await res.json(); showToast(d.error ?? 'Error', 'err') }
  }

  return (
    <div>
      <div style={S.pageActions}>
        <span style={{ fontSize: 13, color: '#64748b' }}>{entries.length} entries shown</span>
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
            <table style={{ ...S.table, minWidth: 600 }}>
              <thead><tr>{['Account','Description','Debit','Credit',''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {lines.map((l, i) => (
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
                    <td style={S.td}><button style={{ ...S.btn, padding: '3px 8px', fontSize: 11 }} onClick={() => setLines(ls => ls.filter((_,j) => j!==i))}>✕</button></td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...S.td, fontWeight: 600 }}>Totals</td>
                  <td style={S.td}></td>
                  <td style={{ ...S.td, fontWeight: 700, color: '#dc2626' }}>${fmt(totalDebit)}</td>
                  <td style={{ ...S.td, fontWeight: 700, color: '#16a34a' }}>${fmt(totalCredit)}</td>
                  <td style={S.td}></td>
                </tr>
              </tbody>
            </table>
          </div>
          {!balanced && <div style={S.errMsg}>Entry is unbalanced — debits ${fmt(totalDebit)} ≠ credits ${fmt(totalCredit)}</div>}
          <div style={{ display:'flex', gap:8 }}>
            <button style={S.btn} onClick={() => setLines(ls => [...ls, { accountId:'',debit:'',credit:'',description:'' }])}>+ Add line</button>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => save('POST')} disabled={!balanced || lines.filter(l=>l.accountId).length < 2}>Post entry</button>
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
        {!loading && data && <ReportBody def={def} data={data} />}
        {!loading && !data && <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>No data</div>}
      </div>
    </div>
  )
}

// ─── Renderers per report type ────────────────────────────────────────────────
function ReportBody({ def, data }: { def: ReportDef; data: unknown }) {
  switch (def.id) {
    case 'pnl':                return <PnlReport data={data as PnlData} />
    case 'pnl-comparison':     return <PnlComparisonReport data={data as PnlComparisonData} />
    case 'balance-sheet':      return <BalanceSheetReport data={data as BsData} />
    case 'cash-flows':         return <CashFlowsReport data={data as CashFlowsData} />
    case 'trial-balance':      return <TrialBalanceReport data={data as TrialBalanceData} />
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
  rows: { code: string; name: string; type: string; debit: number; credit: number }[]
  totalDebit: number; totalCredit: number; balanced: boolean
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

function TrialBalanceReport({ data }: { data: TrialBalanceData }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr>
        <th style={reportTableHeader}>Account</th>
        <th style={{ ...reportTableHeader, textAlign: 'right' }}>Debit</th>
        <th style={{ ...reportTableHeader, textAlign: 'right' }}>Credit</th>
      </tr></thead>
      <tbody>
        {data.rows.map(r => (
          <tr key={r.code}>
            <td style={reportTableCell}>{r.code} — {r.name}</td>
            <td style={{ ...reportTableCell, textAlign: 'right' }}>{r.debit > 0 ? `$${fmt(r.debit)}` : ''}</td>
            <td style={{ ...reportTableCell, textAlign: 'right' }}>{r.credit > 0 ? `$${fmt(r.credit)}` : ''}</td>
          </tr>
        ))}
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
