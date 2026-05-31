import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCsvAccounts,
  normalizeIifAccounts,
  splitCsvRow,
  QB_ACCOUNT_TYPE_MAP,
  CSV_TEMPLATE_SAMPLE,
} from '../src/lib/accounts/import-parse'

// ─── CSV parsing ──────────────────────────────────────────────────────────────

test('parseCsvAccounts: parses the sample template', () => {
  const r = parseCsvAccounts(CSV_TEMPLATE_SAMPLE)
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors))
  assert.equal(r.rows.length, 12)
  const cash = r.rows.find(x => x.code === '1000')!
  assert.equal(cash.name, 'Cash - Operating')
  assert.equal(cash.type, 'ASSET')
  assert.equal(cash.subType, 'Bank')
})

test('parseCsvAccounts: extracts parent code', () => {
  const r = parseCsvAccounts(CSV_TEMPLATE_SAMPLE)
  const accumDep = r.rows.find(x => x.code === '1510')!
  assert.equal(accumDep.parentCode, '1500')
})

test('parseCsvAccounts: missing required columns', () => {
  const r = parseCsvAccounts('Name,Type\nCash,ASSET')
  assert.equal(r.rows.length, 0)
  assert.match(r.errors[0].message, /Code.*Name/)
})

test('parseCsvAccounts: rejects unknown type', () => {
  const csv = 'Code,Name,Type\n1000,Cash,WIDGETS'
  const r = parseCsvAccounts(csv)
  assert.equal(r.rows.length, 0)
  assert.match(r.errors[0].message, /Unknown type.*WIDGETS/)
})

test('parseCsvAccounts: skips empty rows silently', () => {
  const csv = 'Code,Name,Type\n1000,Cash,ASSET\n,,\n2000,AP,LIABILITY'
  const r = parseCsvAccounts(csv)
  assert.equal(r.errors.length, 0)
  assert.equal(r.rows.length, 2)
})

test('parseCsvAccounts: reports rows missing code or name', () => {
  const csv = 'Code,Name,Type\n,Has name only,ASSET\n3000,,EXPENSE'
  const r = parseCsvAccounts(csv)
  assert.equal(r.rows.length, 0)
  assert.equal(r.errors.length, 2)
})

test('parseCsvAccounts: accepts QB-style type codes as a fallback', () => {
  const csv = 'Code,Name,Type,Description\n1000,Checking,BANK,Bank account\n2000,AP,AP,Accounts payable'
  const r = parseCsvAccounts(csv)
  assert.equal(r.errors.length, 0)
  assert.equal(r.rows[0].type, 'ASSET')
  assert.equal(r.rows[0].subType, 'Bank')
  assert.equal(r.rows[0].isBankAccount, true)
  assert.equal(r.rows[1].type, 'LIABILITY')
  assert.equal(r.rows[1].subType, 'Accounts Payable')
})

test('parseCsvAccounts: case-insensitive headers, flexible naming', () => {
  const csv = 'ACCOUNT_CODE,account name,Account Type,parent code\n1000,Cash,ASSET,'
  const r = parseCsvAccounts(csv)
  assert.equal(r.rows.length, 1)
  assert.equal(r.rows[0].code, '1000')
})

test('splitCsvRow: handles quoted commas and embedded quotes', () => {
  assert.deepEqual(splitCsvRow('a,"b,c",d'), ['a', 'b,c', 'd'])
  assert.deepEqual(splitCsvRow('a,"say ""hi""",b'), ['a', 'say "hi"', 'b'])
})

// ─── IIF normalization ───────────────────────────────────────────────────────

test('normalizeIifAccounts: maps QB types correctly', () => {
  const r = normalizeIifAccounts([
    { name: 'Operating Checking', accntType: 'BANK', accNum: '1000', description: 'Primary' },
    { name: 'Accounts Payable',   accntType: 'AP',   accNum: '2000' },
    { name: 'Sales',              accntType: 'INC',  accNum: '4000' },
    { name: 'COGS',               accntType: 'COGS', accNum: '5000' },
  ])
  assert.equal(r.errors.length, 0)
  assert.equal(r.rows[0].type, 'ASSET')
  assert.equal(r.rows[0].subType, 'Bank')
  assert.equal(r.rows[0].isBankAccount, true)
  assert.equal(r.rows[1].type, 'LIABILITY')
  assert.equal(r.rows[2].type, 'REVENUE')
  assert.equal(r.rows[3].type, 'COGS')
})

test('normalizeIifAccounts: parses parent from colon-separated names', () => {
  const r = normalizeIifAccounts([
    { name: 'Bank', accntType: 'BANK', accNum: '1000' },
    { name: 'Bank:Operating', accntType: 'BANK', accNum: '1001' },
    { name: 'Bank:Operating:USD Account', accntType: 'BANK', accNum: '1001-USD' },
  ])
  assert.equal(r.rows[0].name, 'Bank')
  assert.equal(r.rows[0].parentName, undefined)
  assert.equal(r.rows[1].name, 'Operating')
  assert.equal(r.rows[1].parentName, 'Bank')
  assert.equal(r.rows[2].name, 'USD Account')
  assert.equal(r.rows[2].parentName, 'Bank:Operating')
})

test('normalizeIifAccounts: synthesizes a code when ACCNUM is missing', () => {
  const r = normalizeIifAccounts([
    { name: 'Equity', accntType: 'EQUITY' },
  ])
  assert.equal(r.rows[0].code, 'IIF-1')
  assert.equal(r.rows[0].warnings.length, 1)
  assert.match(r.rows[0].warnings[0], /auto-assigned/)
})

test('normalizeIifAccounts: rejects rows with unknown QB types', () => {
  const r = normalizeIifAccounts([
    { name: 'Mystery', accntType: 'NONPOSTING', accNum: '9999' },
  ])
  assert.equal(r.rows.length, 0)
  assert.match(r.errors[0].message, /unknown account type/)
})

test('QB_ACCOUNT_TYPE_MAP: covers the documented QB types', () => {
  for (const code of ['BANK','AR','OCASSET','FIXASSET','OASSET','AP','CCARD','OCLIAB','LTLIAB','EQUITY','INC','OINC','COGS','EXP','OEXP']) {
    assert.ok(QB_ACCOUNT_TYPE_MAP[code], `missing mapping for ${code}`)
  }
})
