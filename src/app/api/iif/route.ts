import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'
import {
  parseIif, generateTransactionIif, generateAccountIif, generatePayrollIif,
  ACCOUNT_TYPE_TO_IIF,
} from '@/lib/iif'

// ─── POST /api/iif — import IIF file ──────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { entityId, content, filename } = body

  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'journals:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const parsed = parseIif(content)

  // Save import record
  const importRecord = await db.iifImport.create({
    data: {
      entityId,
      filename: filename ?? 'import.iif',
      type: parsed.type,
      rawContent: content,
      rowCount: parsed.rowCount,
      status: 'PROCESSING',
      errors: parsed.errors.length > 0 ? JSON.stringify(parsed.errors) : null,
    },
  })

  // Dry-run mode — just return preview
  if (body.dryRun) {
    return NextResponse.json({
      importId: importRecord.id,
      parsed,
      preview: {
        transactions: parsed.transactions.slice(0, 10),
        accounts: parsed.accounts.slice(0, 10),
        payroll: parsed.payroll.slice(0, 10),
      },
    })
  }

  // Import accounts
  let accountsImported = 0
  if (parsed.accounts.length > 0) {
    for (const acct of parsed.accounts) {
      const type = Object.entries(ACCOUNT_TYPE_TO_IIF)
        .find(([, v]) => v === acct.accntType)?.[0] ?? 'EXPENSE'

      await db.account.upsert({
        where: { entityId_code: { entityId, code: acct.accNum ?? acct.name.slice(0, 10) } },
        create: {
          entityId,
          code: acct.accNum ?? acct.name.slice(0, 10),
          name: acct.name,
          type: type as never,
          description: acct.description,
        },
        update: { name: acct.name, description: acct.description },
      })
      accountsImported++
    }
  }

  // Import transactions as journal entries
  let txnsImported = 0
  if (parsed.transactions.length > 0) {
    for (const txn of parsed.transactions) {
      const mainAccount = await db.account.findFirst({
        where: { entityId, name: { contains: txn.account, mode: 'insensitive' } },
      })
      if (!mainAccount) continue

      const count = await db.journalEntry.count({ where: { entityId } })
      const ref = `IIF-${String(count + 1).padStart(5, '0')}`

      const lines = []
      if (txn.amount > 0) {
        lines.push({ accountId: mainAccount.id, debit: txn.amount, credit: 0, lineOrder: 0 })
      } else {
        lines.push({ accountId: mainAccount.id, debit: 0, credit: Math.abs(txn.amount), lineOrder: 0 })
      }

      for (let i = 0; i < txn.splits.length; i++) {
        const spl = txn.splits[i]
        const splAcct = await db.account.findFirst({
          where: { entityId, name: { contains: spl.account, mode: 'insensitive' } },
        })
        if (!splAcct) continue
        if (spl.amount > 0) {
          lines.push({ accountId: splAcct.id, debit: spl.amount, credit: 0, lineOrder: i + 1 })
        } else {
          lines.push({ accountId: splAcct.id, debit: 0, credit: Math.abs(spl.amount), lineOrder: i + 1 })
        }
      }

      if (lines.length >= 2) {
        await db.journalEntry.create({
          data: {
            entityId, ref,
            date: new Date(txn.date),
            description: txn.memo ?? `${txn.trnsType}: ${txn.name ?? txn.account}`,
            status: 'POSTED',
            source: 'IIF_IMPORT',
            postedAt: new Date(),
            lines: { create: lines },
          },
        })
        txnsImported++
      }
    }
  }

  await db.iifImport.update({
    where: { id: importRecord.id },
    data: { status: 'COMPLETED', importedAt: new Date() },
  })

  return NextResponse.json({
    importId: importRecord.id,
    accountsImported,
    txnsImported,
    errors: parsed.errors,
  })
}

// ─── GET /api/iif — export to IIF ─────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const entityId = searchParams.get('entityId')
  const type = searchParams.get('type') ?? 'trns'
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'journals:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let iifContent = ''

  if (type === 'accnt') {
    const accounts = await db.account.findMany({ where: { entityId, isActive: true } })
    iifContent = generateAccountIif(accounts.map(a => ({
      name: a.name,
      accntType: ACCOUNT_TYPE_TO_IIF[a.type] ?? 'Exp',
      description: a.description ?? '',
      accNum: a.code,
    })))
  } else if (type === 'payroll') {
    const runs = await db.payrollRun.findMany({
      where: {
        entityId,
        ...(from ? { periodEnd: { gte: new Date(from) } } : {}),
        ...(to ? { periodEnd: { lte: new Date(to) } } : {}),
      },
      include: { employee: true },
    })
    iifContent = generatePayrollIif(runs.map(r => ({
      emplId: r.employee.employeeNo,
      lastName: r.employee.lastName,
      firstName: r.employee.firstName,
      wages: Number(r.grossPay),
      fedTax: Number(r.fedTax),
      ssTax: Number(r.ssTax),
      medTax: Number(r.medicareTax),
      stateTax: Number(r.stateTax),
    })))
  } else {
    // transactions
    const entries = await db.journalEntry.findMany({
      where: {
        entityId,
        status: 'POSTED',
        ...(from ? { date: { gte: new Date(from) } } : {}),
        ...(to ? { date: { lte: new Date(to) } } : {}),
      },
      include: { lines: { include: { account: true } } },
    })

    const txns = entries.map(e => ({
      trnsId: e.id.slice(0, 8),
      trnsType: e.source === 'AP' ? 'BILL' : e.source === 'PAYROLL' ? 'PAYCHECK' : 'GENERAL',
      date: e.date.toISOString(),
      account: e.lines[0]?.account.name ?? 'General',
      amount: e.lines.reduce((s, l) => s + Number(l.debit), 0),
      memo: e.description,
      splits: e.lines.slice(1).map((l, i) => ({
        trnsType: 'GENERAL',
        date: e.date.toISOString(),
        account: l.account.name,
        amount: Number(l.credit) > 0 ? -Number(l.credit) : Number(l.debit),
        memo: l.description ?? '',
      })),
    }))

    iifContent = generateTransactionIif(txns)
  }

  return new NextResponse(iifContent, {
    headers: {
      'Content-Type': 'text/plain',
      'Content-Disposition': `attachment; filename="export-${type}-${Date.now()}.iif"`,
    },
  })
}
