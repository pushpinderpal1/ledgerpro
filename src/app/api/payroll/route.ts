import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'
import { calculatePayroll, computeW2 } from '@/lib/payroll'
import type { FilingStatus, PayType } from '@prisma/client'

const employeeSchema = z.object({
  employeeNo: z.string(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  startDate: z.string(),
  payType: z.enum(['SALARY', 'HOURLY', 'COMMISSION']),
  salary: z.number().optional(),
  hourlyRate: z.number().optional(),
  filingStatus: z.enum(['SINGLE', 'MARRIED', 'MFS', 'HH']),
  allowances: z.number().default(1),
  state: z.string().default('NY'),
  retirement401k: z.number().min(0).max(1).default(0),
  healthDeduction: z.number().min(0).default(0),
  department: z.string().optional(),
  jobTitle: z.string().optional(),
})

// ─── GET employees ────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const entityId = req.nextUrl.searchParams.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'payroll:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const employees = await db.employee.findMany({
    where: { entityId, isActive: true },
    include: {
      payrollRuns: {
        orderBy: { periodEnd: 'desc' },
        take: 1,
        select: { grossPay: true, netPay: true, periodEnd: true },
      },
    },
    orderBy: { lastName: 'asc' },
  })

  return NextResponse.json(employees)
}

// ─── POST — run payroll for a period ─────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { entityId, action } = body

  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'payroll:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (action === 'create_employee') {
    try {
      const data = employeeSchema.parse(body.employee)
      const employee = await db.employee.create({
        data: { entityId, ...data, startDate: new Date(data.startDate) },
      })
      return NextResponse.json(employee, { status: 201 })
    } catch (e) {
      if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
      return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
  }

  if (action === 'run_payroll') {
    const { periodStart, periodEnd, payDate, employeeIds } = body

    const employees = await db.employee.findMany({
      where: { entityId, isActive: true, id: { in: employeeIds } },
    })

    const runs = []
    for (const emp of employees) {
      const grossPay = emp.payType === 'SALARY'
        ? Number(emp.salary) / 12
        : Number(emp.hourlyRate) * (body.hoursMap?.[emp.id] ?? 80)

      const result = calculatePayroll({
        grossPay,
        payPeriods: 12,
        filingStatus: emp.filingStatus as 'SINGLE' | 'MARRIED' | 'MFS' | 'HH',
        allowances: emp.allowances,
        state: emp.state,
        retirement401k: Number(emp.retirement401k),
        healthDeduction: Number(emp.healthDeduction),
      })

      const run = await db.payrollRun.create({
        data: {
          entityId,
          employeeId: emp.id,
          periodStart: new Date(periodStart),
          periodEnd: new Date(periodEnd),
          payDate: new Date(payDate),
          grossPay: result.grossPay,
          fedTax: result.fedTax,
          stateTax: result.stateTax,
          ssTax: result.ssTax,
          medicareTax: result.medicareTax,
          retirement: result.retirement,
          healthDed: result.healthDeduction,
          netPay: result.netPay,
          status: 'DRAFT',
        },
      })
      runs.push({ employee: emp, run, result })
    }

    // Auto-generate payroll journal entry
    const salaryAccount = await db.account.findFirst({ where: { entityId, code: '6000' } })
    const taxAccount = await db.account.findFirst({ where: { entityId, code: '6100' } })
    const cashAccount = await db.account.findFirst({ where: { entityId, code: '1000' } })
    const taxPayable = await db.account.findFirst({ where: { entityId, code: '2200' } })

    if (salaryAccount && cashAccount && taxPayable) {
      const totalGross = runs.reduce((s, r) => s + r.result.grossPay, 0)
      const totalTax = runs.reduce((s, r) => s + r.result.totalTax, 0)
      const totalNet = runs.reduce((s, r) => s + r.result.netPay, 0)
      const count = await db.journalEntry.count({ where: { entityId } })

      await db.journalEntry.create({
        data: {
          entityId,
          ref: `PR-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`,
          date: new Date(payDate),
          description: `Payroll run: ${periodStart} to ${periodEnd}`,
          status: 'POSTED',
          source: 'PAYROLL',
          postedAt: new Date(),
          lines: {
            create: [
              { accountId: salaryAccount.id, debit: totalGross, credit: 0, lineOrder: 0 },
              { accountId: taxPayable.id, debit: 0, credit: totalTax, lineOrder: 1 },
              { accountId: cashAccount.id, debit: 0, credit: totalNet, lineOrder: 2 },
              ...(taxAccount ? [{ accountId: taxAccount.id, debit: totalTax, credit: 0, lineOrder: 3 }] : []),
            ],
          },
        },
      })
    }

    return NextResponse.json({ runs, count: runs.length })
  }

  if (action === 'generate_w2') {
    const { taxYear, employeeId } = body

    const payrollRuns = await db.payrollRun.findMany({
      where: {
        employeeId,
        periodEnd: {
          gte: new Date(`${taxYear}-01-01`),
          lte: new Date(`${taxYear}-12-31`),
        },
        status: { in: ['APPROVED', 'PAID'] },
      },
    })

    if (!payrollRuns.length) {
      return NextResponse.json({ error: 'No payroll runs found for this year' }, { status: 400 })
    }

    const boxes = computeW2({
      payrollRuns: payrollRuns.map(r => ({
        grossPay: Number(r.grossPay),
        fedTax: Number(r.fedTax),
        ssTax: Number(r.ssTax),
        medicareTax: Number(r.medicareTax),
        retirement: Number(r.retirement),
      })),
    })

    const w2 = await db.w2Record.upsert({
      where: { employeeId_taxYear: { employeeId, taxYear } },
      create: { employeeId, taxYear, ...boxes },
      update: { ...boxes, status: 'DRAFT' },
    })

    return NextResponse.json(w2)
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
