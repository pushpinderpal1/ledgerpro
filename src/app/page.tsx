'use client'
import { useState, useEffect, useCallback, createContext, useContext } from 'react'

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
