import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'LedgerPro — Multi-entity Accounting Platform',
  description: 'Full-stack accounting for accounting firms: Chart of Accounts, Journal Entries, QB IIF, Payroll, W-2, AP Tracker, Budget & MIS — multi-tenant, role-based.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, boxSizing: 'border-box' }}>
        {children}
      </body>
    </html>
  )
}
