import { PrismaClient, EntityRole } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding LedgerPro...')

  // ── Super admin ─────────────────────────────────────────────────────────────
  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@ledgerpro.com' },
    update: {},
    create: {
      email: 'admin@ledgerpro.com',
      name: 'Super Admin',
      passwordHash: await bcrypt.hash('Admin123!', 12),
      isSuperAdmin: true,
    },
  })
  console.log('✓ Super admin:', superAdmin.email)

  // ── Legal Entity 1: Main Accounting Firm ────────────────────────────────────
  const firm = await prisma.legalEntity.upsert({
    where: { slug: 'apex-accounting' },
    update: {},
    create: {
      name: 'Apex Accounting Partners LLC',
      slug: 'apex-accounting',
      taxId: '12-3456789',
      email: 'info@apexaccounting.com',
      phone: '+1-212-555-0100',
      address: '450 Park Ave, New York, NY 10022',
      currency: 'USD',
      fiscalMonth: 1,
    },
  })

  // ── Legal Entity 2: Client Company A ────────────────────────────────────────
  const clientCo = await prisma.legalEntity.upsert({
    where: { slug: 'tech-startup-inc' },
    update: {},
    create: {
      name: 'TechStartup Inc.',
      slug: 'tech-startup-inc',
      taxId: '98-7654321',
      email: 'finance@techstartup.com',
      currency: 'USD',
      fiscalMonth: 1,
    },
  })

  // ── Legal Entity 3: Another subsidiary ──────────────────────────────────────
  const subsidiary = await prisma.legalEntity.upsert({
    where: { slug: 'apex-properties' },
    update: {},
    create: {
      name: 'Apex Properties LLC',
      slug: 'apex-properties',
      taxId: '55-1234567',
      email: 'finance@apexproperties.com',
      currency: 'USD',
      fiscalMonth: 4, // April fiscal year
    },
  })

  console.log('✓ Entities:', firm.name, '|', clientCo.name, '|', subsidiary.name)

  // ── Sample users with different roles ────────────────────────────────────────
  const users: Array<{ email: string; name: string; password: string }> = [
    { email: 'owner@apexaccounting.com',   name: 'Sarah Chen',    password: 'Owner123!' },
    { email: 'accountant@apexaccounting.com', name: 'Marcus Rodriguez', password: 'Acct123!' },
    { email: 'auditor@apexaccounting.com',  name: 'Priya Patel',   password: 'Audit123!' },
    { email: 'apclerk@apexaccounting.com',  name: 'James Wilson',  password: 'Clerk123!' },
    { email: 'payroll@apexaccounting.com',  name: 'Lisa Kim',      password: 'Payroll123!' },
    { email: 'client@techstartup.com',      name: 'Tom Bradley',   password: 'Client123!' },
  ]

  const createdUsers: Record<string, typeof superAdmin> = {}
  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        name: u.name,
        passwordHash: await bcrypt.hash(u.password, 12),
      },
    })
    createdUsers[u.email] = user
    console.log('✓ User:', u.email)
  }

  // ── Entity access assignments ─────────────────────────────────────────────────
  const accessMatrix: Array<{ email: string; entityId: string; role: EntityRole }> = [
    { email: 'owner@apexaccounting.com',    entityId: firm.id,       role: 'OWNER' },
    { email: 'owner@apexaccounting.com',    entityId: clientCo.id,   role: 'ADMIN' },
    { email: 'owner@apexaccounting.com',    entityId: subsidiary.id, role: 'OWNER' },
    { email: 'accountant@apexaccounting.com', entityId: firm.id,     role: 'ACCOUNTANT' },
    { email: 'accountant@apexaccounting.com', entityId: clientCo.id, role: 'ACCOUNTANT' },
    { email: 'auditor@apexaccounting.com',  entityId: firm.id,       role: 'AUDITOR' },
    { email: 'auditor@apexaccounting.com',  entityId: clientCo.id,   role: 'AUDITOR' },
    { email: 'apclerk@apexaccounting.com',  entityId: firm.id,       role: 'AP_CLERK' },
    { email: 'payroll@apexaccounting.com',  entityId: firm.id,       role: 'PAYROLL_CLERK' },
    { email: 'payroll@apexaccounting.com',  entityId: clientCo.id,   role: 'PAYROLL_CLERK' },
    { email: 'client@techstartup.com',      entityId: clientCo.id,   role: 'CLIENT_VIEW' },
  ]

  for (const a of accessMatrix) {
    const user = createdUsers[a.email]
    if (!user) continue
    await prisma.entityAccess.upsert({
      where: { userId_entityId: { userId: user.id, entityId: a.entityId } },
      update: { role: a.role },
      create: { userId: user.id, entityId: a.entityId, role: a.role, grantedBy: superAdmin.id },
    })
  }
  console.log('✓ Access matrix configured')

  // ── Chart of Accounts for each entity ────────────────────────────────────────
  for (const entity of [firm, clientCo, subsidiary]) {
    const existing = await prisma.account.count({ where: { entityId: entity.id } })
    if (existing > 0) continue

    await prisma.account.createMany({
      data: fullCoa(entity.id),
    })
    console.log('✓ CoA seeded for:', entity.name)
  }

  // ── Sample employees for firm ─────────────────────────────────────────────────
  const empCount = await prisma.employee.count({ where: { entityId: firm.id } })
  if (empCount === 0) {
    await prisma.employee.createMany({
      data: [
        { entityId: firm.id, employeeNo: 'EMP001', firstName: 'John', lastName: 'Smith',
          startDate: new Date('2020-01-15'), payType: 'SALARY', salary: 72000,
          filingStatus: 'SINGLE', allowances: 1, state: 'NY', retirement401k: 0.03,
          healthDeduction: 150, department: 'Accounting', jobTitle: 'Senior Accountant' },
        { entityId: firm.id, employeeNo: 'EMP002', firstName: 'Amy', lastName: 'Jones',
          startDate: new Date('2021-03-01'), payType: 'SALARY', salary: 65000,
          filingStatus: 'MARRIED', allowances: 2, state: 'NY', retirement401k: 0.05,
          healthDeduction: 200, department: 'Accounting', jobTitle: 'Staff Accountant' },
        { entityId: firm.id, employeeNo: 'EMP003', firstName: 'Mike', lastName: 'Lee',
          startDate: new Date('2022-06-15'), payType: 'HOURLY', hourlyRate: 35,
          filingStatus: 'SINGLE', allowances: 1, state: 'NY', retirement401k: 0,
          healthDeduction: 0, department: 'Operations', jobTitle: 'Bookkeeper' },
      ],
    })
    console.log('✓ Sample employees seeded')
  }

  // ── Sample AP invoices ────────────────────────────────────────────────────────
  const invCount = await prisma.apInvoice.count({ where: { entityId: firm.id } })
  if (invCount === 0) {
    const apAccount = await prisma.account.findFirst({ where: { entityId: firm.id, code: '2000' } })
    await prisma.apInvoice.createMany({
      data: [
        { entityId: firm.id, vendor: 'Office Depot', invoiceNo: 'OD-4421',
          invoiceDate: new Date('2024-03-01'), dueDate: new Date('2024-03-30'),
          amount: 1240, status: 'OVERDUE', accountId: apAccount?.id },
        { entityId: firm.id, vendor: 'Amazon Web Services', invoiceNo: 'AWS-9901',
          invoiceDate: new Date('2024-03-15'), dueDate: new Date('2024-04-05'),
          amount: 890, status: 'PENDING', accountId: apAccount?.id },
        { entityId: firm.id, vendor: 'Salesforce Inc', invoiceNo: 'SF-3310',
          invoiceDate: new Date('2024-03-20'), dueDate: new Date('2024-04-12'),
          amount: 4200, status: 'PENDING', accountId: apAccount?.id },
      ],
    })
    console.log('✓ Sample AP invoices seeded')
  }

  console.log('\n✅ Seed complete!\n')
  console.log('Login credentials:')
  console.log('  Super Admin:  admin@ledgerpro.com  /  Admin123!')
  console.log('  Owner:        owner@apexaccounting.com  /  Owner123!')
  console.log('  Accountant:   accountant@apexaccounting.com  /  Acct123!')
  console.log('  Auditor:      auditor@apexaccounting.com  /  Audit123!')
  console.log('  AP Clerk:     apclerk@apexaccounting.com  /  Clerk123!')
  console.log('  Payroll:      payroll@apexaccounting.com  /  Payroll123!')
  console.log('  Client View:  client@techstartup.com  /  Client123!')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())

function fullCoa(entityId: string) {
  return [
    { entityId, code: '1000', name: 'Cash & Equivalents', type: 'ASSET' as const, subType: 'Current', isBankAccount: true },
    { entityId, code: '1050', name: 'Petty Cash', type: 'ASSET' as const, subType: 'Current', isBankAccount: true },
    { entityId, code: '1100', name: 'Accounts Receivable', type: 'ASSET' as const, subType: 'Current' },
    { entityId, code: '1200', name: 'Prepaid Expenses', type: 'ASSET' as const, subType: 'Current' },
    { entityId, code: '1300', name: 'Inventory', type: 'ASSET' as const, subType: 'Current' },
    { entityId, code: '1500', name: 'Property & Equipment', type: 'ASSET' as const, subType: 'Fixed' },
    { entityId, code: '1550', name: 'Accumulated Depreciation', type: 'ASSET' as const, subType: 'Fixed' },
    { entityId, code: '1600', name: 'Intangible Assets', type: 'ASSET' as const, subType: 'Intangible' },
    { entityId, code: '2000', name: 'Accounts Payable', type: 'LIABILITY' as const, subType: 'Current' },
    { entityId, code: '2100', name: 'Accrued Liabilities', type: 'LIABILITY' as const, subType: 'Current' },
    { entityId, code: '2200', name: 'Payroll Taxes Payable', type: 'LIABILITY' as const, subType: 'Current' },
    { entityId, code: '2300', name: 'Sales Tax Payable', type: 'LIABILITY' as const, subType: 'Current' },
    { entityId, code: '2400', name: 'Deferred Revenue', type: 'LIABILITY' as const, subType: 'Current' },
    { entityId, code: '2500', name: 'Long-term Debt', type: 'LIABILITY' as const, subType: 'Non-Current' },
    { entityId, code: '3000', name: 'Common Stock', type: 'EQUITY' as const, subType: 'Capital' },
    { entityId, code: '3100', name: 'Retained Earnings', type: 'EQUITY' as const, subType: 'Earnings' },
    { entityId, code: '3200', name: 'Owner Draws', type: 'EQUITY' as const, subType: 'Drawings' },
    { entityId, code: '4000', name: 'Sales Revenue', type: 'REVENUE' as const, subType: 'Operating' },
    { entityId, code: '4100', name: 'Service Revenue', type: 'REVENUE' as const, subType: 'Operating' },
    { entityId, code: '4200', name: 'Consulting Revenue', type: 'REVENUE' as const, subType: 'Operating' },
    { entityId, code: '4900', name: 'Other Income', type: 'REVENUE' as const, subType: 'Other' },
    { entityId, code: '5000', name: 'Cost of Goods Sold', type: 'COGS' as const, subType: 'COGS' },
    { entityId, code: '5100', name: 'Direct Labor', type: 'COGS' as const, subType: 'COGS' },
    { entityId, code: '6000', name: 'Salaries & Wages', type: 'EXPENSE' as const, subType: 'Payroll' },
    { entityId, code: '6050', name: 'Bonus Expense', type: 'EXPENSE' as const, subType: 'Payroll' },
    { entityId, code: '6100', name: 'Payroll Tax Expense', type: 'EXPENSE' as const, subType: 'Payroll' },
    { entityId, code: '6150', name: 'Employee Benefits', type: 'EXPENSE' as const, subType: 'Payroll' },
    { entityId, code: '6200', name: '401(k) Employer Match', type: 'EXPENSE' as const, subType: 'Payroll' },
    { entityId, code: '6300', name: 'Rent & Facilities', type: 'EXPENSE' as const, subType: 'Facility' },
    { entityId, code: '6350', name: 'Utilities', type: 'EXPENSE' as const, subType: 'Facility' },
    { entityId, code: '6400', name: 'Office Supplies', type: 'EXPENSE' as const, subType: 'G&A' },
    { entityId, code: '6500', name: 'Marketing & Advertising', type: 'EXPENSE' as const, subType: 'Marketing' },
    { entityId, code: '6600', name: 'Software & Subscriptions', type: 'EXPENSE' as const, subType: 'Technology' },
    { entityId, code: '6700', name: 'Professional Fees', type: 'EXPENSE' as const, subType: 'G&A' },
    { entityId, code: '6800', name: 'Insurance', type: 'EXPENSE' as const, subType: 'G&A' },
    { entityId, code: '6900', name: 'Depreciation Expense', type: 'EXPENSE' as const, subType: 'G&A' },
    { entityId, code: '7000', name: 'Interest Expense', type: 'EXPENSE' as const, subType: 'Finance' },
    { entityId, code: '7100', name: 'Bank Charges', type: 'EXPENSE' as const, subType: 'Finance' },
    { entityId, code: '7200', name: 'Other Expenses', type: 'EXPENSE' as const, subType: 'Other' },
  ]
}
