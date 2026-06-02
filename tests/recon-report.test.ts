import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReconReportData, type ReconReportInput } from '../src/lib/recon/report-data'

function baseInput(over: Partial<ReconReportInput> = {}): ReconReportInput {
  return {
    entityName: 'Acme Corp',
    bankAccount: { code: '1001', name: 'Checking' },
    statementDate: '2026-06-30',
    status: 'IN_PROGRESS',
    cleared: [],
    uncleared: [],
    summary: {
      beginningBalance: 1000,
      endingBalance: 1500,
      clearedBalance: 1500,
      clearedCount: 0,
      unclearedCount: 0,
      difference: 0,
      isBalanced: true,
    },
    generatedAt: new Date('2026-07-01T10:00:00Z'),
    ...over,
  }
}

test('header passes through entity/account/status', () => {
  const out = buildReconReportData(baseInput())
  assert.equal(out.header.entityName, 'Acme Corp')
  assert.equal(out.header.accountCode, '1001')
  assert.equal(out.header.accountName, 'Checking')
  assert.equal(out.header.statementDate, '2026-06-30')
  assert.equal(out.header.status, 'IN_PROGRESS')
})

test('tick: cleared + IN_PROGRESS → "*", no clearedDate column value', () => {
  const out = buildReconReportData(baseInput({
    status: 'IN_PROGRESS',
    cleared: [{
      id: '1', date: '2026-06-15', ref: 'JE-1', description: 'Deposit',
      debit: 500, credit: 0,
      clearedStatus: 'CLEARED', clearedDate: '2026-06-16', inThisRecon: true,
    }],
  }))
  const t = out.transactions[0]
  assert.equal(t.tick, '*')
  assert.equal(t.clearedDate, '')         // hidden while in progress
})

test('tick: cleared + COMPLETED → "✓" with clearedDate', () => {
  const out = buildReconReportData(baseInput({
    status: 'COMPLETED',
    cleared: [{
      id: '1', date: '2026-06-15', ref: 'JE-1', description: 'Deposit',
      debit: 500, credit: 0,
      clearedStatus: 'RECONCILED', clearedDate: '2026-06-16', inThisRecon: true,
    }],
  }))
  const t = out.transactions[0]
  assert.equal(t.tick, '✓')
  assert.equal(t.clearedDate, '2026-06-16')
})

test('tick: uncleared → blank regardless of recon status', () => {
  const out = buildReconReportData(baseInput({
    status: 'COMPLETED',
    uncleared: [{
      id: '1', date: '2026-06-15', ref: 'JE-1', description: 'Outstanding cheque',
      debit: 0, credit: 100,
      clearedStatus: 'UNCLEARED', clearedDate: null, inThisRecon: false,
    }],
  }))
  const t = out.transactions[0]
  assert.equal(t.tick, '')
  assert.equal(t.clearedDate, '')
})

test('summary: outstanding deposits/withdrawals computed from uncleared', () => {
  const out = buildReconReportData(baseInput({
    uncleared: [
      { id: 'a', date: '2026-06-29', ref: 'D1', description: 'Pending deposit',  debit: 800, credit: 0,
        clearedStatus: 'UNCLEARED', clearedDate: null, inThisRecon: false },
      { id: 'b', date: '2026-06-30', ref: 'C1', description: 'Outstanding cheque', debit: 0, credit: 300,
        clearedStatus: 'UNCLEARED', clearedDate: null, inThisRecon: false },
    ],
  }))
  assert.equal(out.summary.outstandingDeposits, 800)
  assert.equal(out.summary.outstandingWithdrawals, 300)
})

test('summary: book balance = clearedBalance + (uncleared deposits - uncleared withdrawals)', () => {
  const out = buildReconReportData(baseInput({
    summary: {
      beginningBalance: 1000, endingBalance: 1500, clearedBalance: 1500,
      clearedCount: 0, unclearedCount: 2, difference: 0, isBalanced: true,
    },
    uncleared: [
      { id: 'a', date: '2026-06-29', ref: 'D1', description: '', debit: 800, credit: 0,
        clearedStatus: 'UNCLEARED', clearedDate: null, inThisRecon: false },
      { id: 'b', date: '2026-06-30', ref: 'C1', description: '', debit: 0, credit: 300,
        clearedStatus: 'UNCLEARED', clearedDate: null, inThisRecon: false },
    ],
  }))
  // bookBalance = 1500 + (800 - 300) = 2000
  assert.equal(out.summary.bookBalance, 2000)
  // adjustedBankBalance = 1500 + 800 - 300 = 2000 → equals book balance
  assert.equal(out.summary.adjustedBankBalance, 2000)
})

test('transactions sorted by date then ref', () => {
  const out = buildReconReportData(baseInput({
    cleared: [
      { id: '2', date: '2026-06-20', ref: 'B', description: '', debit: 100, credit: 0,
        clearedStatus: 'CLEARED', clearedDate: '2026-06-21', inThisRecon: true },
    ],
    uncleared: [
      { id: '1', date: '2026-06-10', ref: 'A', description: '', debit: 0, credit: 50,
        clearedStatus: 'UNCLEARED', clearedDate: null, inThisRecon: false },
      { id: '3', date: '2026-06-20', ref: 'A', description: '', debit: 0, credit: 20,
        clearedStatus: 'UNCLEARED', clearedDate: null, inThisRecon: false },
    ],
  }))
  assert.equal(out.transactions[0].ref, 'A')         // earliest date
  assert.equal(out.transactions[0].date, '2026-06-10')
  assert.equal(out.transactions[1].ref, 'A')         // same date, A < B
  assert.equal(out.transactions[2].ref, 'B')
})
