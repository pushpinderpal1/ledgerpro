import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { hashPassword, signToken, setSessionCookie } from '@/lib/auth'

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  firmName: z.string().min(2),  // First entity on signup
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, email, password, firmName } = schema.parse(body)

    const exists = await db.user.findUnique({ where: { email: email.toLowerCase() } })
    if (exists) return NextResponse.json({ error: 'Email already registered' }, { status: 409 })

    const slug = firmName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)
    const slugExists = await db.legalEntity.findUnique({ where: { slug } })
    const finalSlug = slugExists ? `${slug}-${Date.now()}` : slug

    const [user, entity] = await db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          name,
          email: email.toLowerCase(),
          passwordHash: await hashPassword(password),
        },
      })

      const e = await tx.legalEntity.create({
        data: { name: firmName, slug: finalSlug, email: email.toLowerCase() },
      })

      await tx.entityAccess.create({
        data: { userId: u.id, entityId: e.id, role: 'OWNER', grantedBy: u.id },
      })

      // Seed default Chart of Accounts
      await tx.account.createMany({ data: defaultCoa(e.id) })

      return [u, e]
    })

    const token = await signToken({
      userId: user.id, email: user.email, name: user.name,
      isSuperAdmin: user.isSuperAdmin, currentEntityId: entity.id,
    })

    const res = NextResponse.json({ user: { id: user.id, email: user.email, name: user.name }, entity })
    setSessionCookie(res, token)
    return res
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

function defaultCoa(entityId: string) {
  return [
    { entityId, code: '1000', name: 'Cash & Equivalents', type: 'ASSET' as const, subType: 'Current', isBankAccount: true },
    { entityId, code: '1100', name: 'Accounts Receivable', type: 'ASSET' as const, subType: 'Current' },
    { entityId, code: '1200', name: 'Prepaid Expenses', type: 'ASSET' as const, subType: 'Current' },
    { entityId, code: '1500', name: 'Property & Equipment', type: 'ASSET' as const, subType: 'Fixed' },
    { entityId, code: '1600', name: 'Accumulated Depreciation', type: 'ASSET' as const, subType: 'Fixed' },
    { entityId, code: '2000', name: 'Accounts Payable', type: 'LIABILITY' as const, subType: 'Current' },
    { entityId, code: '2100', name: 'Accrued Liabilities', type: 'LIABILITY' as const, subType: 'Current' },
    { entityId, code: '2200', name: 'Payroll Taxes Payable', type: 'LIABILITY' as const, subType: 'Current' },
    { entityId, code: '2500', name: 'Long-term Debt', type: 'LIABILITY' as const, subType: 'Non-Current' },
    { entityId, code: '3000', name: 'Common Stock', type: 'EQUITY' as const, subType: 'Capital' },
    { entityId, code: '3100', name: 'Retained Earnings', type: 'EQUITY' as const, subType: 'Earnings' },
    { entityId, code: '4000', name: 'Sales Revenue', type: 'REVENUE' as const, subType: 'Operating' },
    { entityId, code: '4100', name: 'Service Revenue', type: 'REVENUE' as const, subType: 'Operating' },
    { entityId, code: '4900', name: 'Other Income', type: 'REVENUE' as const, subType: 'Other' },
    { entityId, code: '5000', name: 'Cost of Goods Sold', type: 'COGS' as const, subType: 'COGS' },
    { entityId, code: '6000', name: 'Salaries & Wages', type: 'EXPENSE' as const, subType: 'Payroll' },
    { entityId, code: '6100', name: 'Payroll Tax Expense', type: 'EXPENSE' as const, subType: 'Payroll' },
    { entityId, code: '6200', name: 'Employee Benefits', type: 'EXPENSE' as const, subType: 'Payroll' },
    { entityId, code: '6300', name: 'Rent & Facilities', type: 'EXPENSE' as const, subType: 'Facility' },
    { entityId, code: '6400', name: 'Utilities', type: 'EXPENSE' as const, subType: 'Facility' },
    { entityId, code: '6500', name: 'Marketing & Advertising', type: 'EXPENSE' as const, subType: 'Marketing' },
    { entityId, code: '6600', name: 'Software & Subscriptions', type: 'EXPENSE' as const, subType: 'Technology' },
    { entityId, code: '6700', name: 'Professional Fees', type: 'EXPENSE' as const, subType: 'G&A' },
    { entityId, code: '6800', name: 'Insurance', type: 'EXPENSE' as const, subType: 'G&A' },
    { entityId, code: '6900', name: 'Depreciation Expense', type: 'EXPENSE' as const, subType: 'G&A' },
    { entityId, code: '7000', name: 'Interest Expense', type: 'EXPENSE' as const, subType: 'Finance' },
    { entityId, code: '7100', name: 'Other Expenses', type: 'EXPENSE' as const, subType: 'Other' },
  ]
}
