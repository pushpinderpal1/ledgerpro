import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCsvStatement,
  parseOfxStatement,
  parseStatement,
  parseMoney,
  parseFlexDate,
  splitCsvRow,
} from '../src/lib/recon/parse'

test('parseMoney: plain integer', () => {
  assert.equal(parseMoney('1500'), 1500)
})

test('parseMoney: decimal with $ and commas', () => {
  assert.equal(parseMoney('$1,234.56'), 1234.56)
})

test('parseMoney: parenthesized negative', () => {
  assert.equal(parseMoney('(750.25)'), -750.25)
})

test('parseMoney: empty / undefined returns 0', () => {
  assert.equal(parseMoney(''), 0)
  assert.equal(parseMoney(undefined), 0)
  assert.equal(parseMoney('   '), 0)
})

test('parseFlexDate: OFX YYYYMMDD', () => {
  const d = parseFlexDate('20260115')!
  assert.equal(d.getUTCFullYear(), 2026)
  assert.equal(d.getUTCMonth(), 0)
  assert.equal(d.getUTCDate(), 15)
})

test('parseFlexDate: MM/DD/YYYY', () => {
  const d = parseFlexDate('01/15/2026')!
  assert.equal(d.getFullYear(), 2026)
})

test('parseFlexDate: two-digit year', () => {
  const d = parseFlexDate('1/15/26')!
  assert.equal(d.getFullYear(), 2026)
})

test('parseFlexDate: invalid returns null', () => {
  assert.equal(parseFlexDate('garbage'), null)
  assert.equal(parseFlexDate(undefined), null)
})

test('splitCsvRow: handles quoted field with comma', () => {
  const cells = splitCsvRow('a,"hello, world",b')
  assert.deepEqual(cells, ['a', 'hello, world', 'b'])
})

test('splitCsvRow: handles escaped quotes', () => {
  const cells = splitCsvRow('a,"say ""hi""",b')
  assert.deepEqual(cells, ['a', 'say "hi"', 'b'])
})

test('parseCsvStatement: signed amount column', () => {
  const csv = `Date,Description,Amount,Reference
01/15/2026,Cheque 1001,-1500.00,1001
01/16/2026,Customer Deposit,"$2,300.50",DEP44
01/20/2026,ACH Payment,(750.25),ACH9`
  const r = parseCsvStatement(csv)
  assert.equal(r.length, 3)
  assert.equal(r[0].amount, -1500)
  assert.equal(r[1].amount, 2300.50)
  assert.equal(r[2].amount, -750.25)
  assert.equal(r[2].reference, 'ACH9')
})

test('parseCsvStatement: separate withdrawal/deposit columns', () => {
  const csv = `Posted,Memo,Withdrawal,Deposit
2026-02-01,Rent payment,1200.00,
2026-02-03,Invoice paid,,5000.00`
  const r = parseCsvStatement(csv)
  assert.equal(r.length, 2)
  assert.equal(r[0].amount, -1200)
  assert.equal(r[1].amount, 5000)
})

test('parseCsvStatement: tolerates blank lines + missing fields', () => {
  const csv = `Date,Description,Amount

01/15/2026,Test,100.00
,Missing date,50.00
01/16/2026,Empty amount,
`
  const r = parseCsvStatement(csv)
  // Rows with no date are skipped; empty amount becomes 0.
  assert.equal(r.length, 2)
  assert.equal(r[0].amount, 100)
  assert.equal(r[1].amount, 0)
})

test('parseCsvStatement: empty input', () => {
  assert.deepEqual(parseCsvStatement(''), [])
  assert.deepEqual(parseCsvStatement('only headers,here'), [])
})

test('parseOfxStatement: extracts STMTTRN blocks', () => {
  const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20260115000000
<TRNAMT>-1500.00
<FITID>20260115001
<NAME>Cheque 1001
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT</TRNTYPE>
<DTPOSTED>20260116000000
<TRNAMT>2300.50
<FITID>20260116001
<NAME>Customer Deposit
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`
  const r = parseOfxStatement(ofx)
  assert.equal(r.length, 2)
  assert.equal(r[0].amount, -1500)
  assert.equal(r[1].amount, 2300.50)
  assert.equal(r[0].reference, '20260115001')
})

test('parseStatement: dispatches by extension', () => {
  const csv = 'Date,Description,Amount\n01/15/2026,Test,100'
  assert.equal(parseStatement('foo.csv', csv).length, 1)
  const ofx = '<STMTTRN><DTPOSTED>20260115\n<TRNAMT>100\n<NAME>Test\n</STMTTRN>'
  assert.equal(parseStatement('foo.ofx', ofx).length, 1)
  // Content sniffing works even with wrong extension.
  assert.equal(parseStatement('foo.txt', ofx).length, 1)
})
