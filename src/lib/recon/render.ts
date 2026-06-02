import ExcelJS from 'exceljs'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { ReconReportData } from './report-data'

/**
 * Renders the bank reconciliation report in Excel (xlsx) and PDF formats,
 * in both Detailed and Summary variants.
 *
 * For both formats:
 *   - Summary variant: header + reconciliation math, no transaction list.
 *   - Detailed variant: header + reconciliation math + full transaction list
 *     with tick column.
 *
 * Tick column meaning (set in report-data.ts):
 *   "✓" — cleared in a COMPLETED reconciliation (also has clearedDate)
 *   "*" — cleared in an IN_PROGRESS reconciliation
 *   ""  — uncleared
 */

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ─── EXCEL ────────────────────────────────────────────────────────────────────

export async function renderReconExcel(
  data: ReconReportData,
  detail: 'detailed' | 'summary',
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'LedgerPro'
  wb.created = new Date()

  const ws = wb.addWorksheet('Bank Reconciliation', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
  })

  // ── Header block ──
  ws.mergeCells('A1:F1')
  ws.getCell('A1').value = 'Bank Reconciliation Statement'
  ws.getCell('A1').font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF0F172A' } }
  ws.getCell('A1').alignment = { horizontal: 'center' }
  ws.getRow(1).height = 26

  ws.mergeCells('A2:F2')
  ws.getCell('A2').value = data.header.entityName
  ws.getCell('A2').font = { size: 11, color: { argb: 'FF64748B' } }
  ws.getCell('A2').alignment = { horizontal: 'center' }

  ws.getCell('A4').value = 'Bank Account:'
  ws.getCell('A4').font = { bold: true }
  ws.getCell('B4').value = `${data.header.accountCode} — ${data.header.accountName}`

  ws.getCell('A5').value = 'Statement Date:'
  ws.getCell('A5').font = { bold: true }
  ws.getCell('B5').value = data.header.statementDate

  ws.getCell('A6').value = 'Status:'
  ws.getCell('A6').font = { bold: true }
  ws.getCell('B6').value = data.header.status === 'COMPLETED' ? 'Completed' : 'In Progress'
  ws.getCell('B6').font = {
    bold: true,
    color: { argb: data.header.status === 'COMPLETED' ? 'FF16A34A' : 'FFD97706' },
  }

  ws.getCell('D4').value = 'Generated:'
  ws.getCell('D4').font = { bold: true }
  ws.getCell('E4').value = new Date(data.header.generatedAt).toLocaleString()

  // ── Reconciliation math block ──
  let row = 8
  ws.getCell(`A${row}`).value = 'Reconciliation'
  ws.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: 'FF0F172A' } }
  ws.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
  ws.mergeCells(`A${row}:F${row}`)
  ws.getRow(row).height = 20
  row += 1

  const addSummaryRow = (label: string, value: number, opts: { bold?: boolean; topBorder?: boolean; indent?: number } = {}) => {
    ws.getCell(`A${row}`).value = label
    ws.getCell(`A${row}`).font = { bold: !!opts.bold }
    if (opts.indent) ws.getCell(`A${row}`).alignment = { indent: opts.indent }
    ws.getCell(`B${row}`).value = value
    ws.getCell(`B${row}`).numFmt = '$#,##0.00;[Red]($#,##0.00)'
    ws.getCell(`B${row}`).font = { bold: !!opts.bold, name: 'Consolas' }
    ws.getCell(`B${row}`).alignment = { horizontal: 'right' }
    if (opts.topBorder) {
      ws.getCell(`A${row}`).border = { top: { style: 'thin' } }
      ws.getCell(`B${row}`).border = { top: { style: 'thin' } }
    }
    row += 1
  }

  addSummaryRow('Beginning balance (per books)', data.summary.beginningBalance)
  addSummaryRow('Statement ending balance (per bank)', data.summary.statementEnding)
  addSummaryRow('Cleared balance (in this recon)', data.summary.clearedBalance, { topBorder: true })

  row += 1
  ws.getCell(`A${row}`).value = 'Outstanding items'
  ws.getCell(`A${row}`).font = { bold: true, italic: true, color: { argb: 'FF475569' } }
  row += 1
  addSummaryRow('  Outstanding deposits (uncleared receipts)', data.summary.outstandingDeposits, { indent: 1 })
  addSummaryRow('  Outstanding withdrawals (uncleared payments)', data.summary.outstandingWithdrawals, { indent: 1 })

  row += 1
  addSummaryRow('Adjusted bank balance', data.summary.adjustedBankBalance, { bold: true, topBorder: true })
  addSummaryRow('Book balance', data.summary.bookBalance, { bold: true })

  row += 1
  addSummaryRow('Difference', data.summary.difference, { bold: true, topBorder: true })
  ws.getCell(`B${row - 1}`).font = {
    bold: true, name: 'Consolas',
    color: { argb: data.summary.isBalanced ? 'FF16A34A' : 'FFDC2626' },
  }

  row += 1
  ws.getCell(`A${row}`).value = data.summary.isBalanced
    ? '✓ Reconciliation is balanced'
    : '⚠ Out of balance — investigate and correct'
  ws.getCell(`A${row}`).font = {
    bold: true,
    color: { argb: data.summary.isBalanced ? 'FF16A34A' : 'FFDC2626' },
  }
  ws.mergeCells(`A${row}:F${row}`)
  row += 2

  // ── Transactions (detailed only) ──
  if (detail === 'detailed') {
    ws.getCell(`A${row}`).value = `Transactions (${data.transactions.length})`
    ws.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: 'FF0F172A' } }
    ws.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
    ws.mergeCells(`A${row}:F${row}`)
    ws.getRow(row).height = 20
    row += 1

    // Header row
    const headers = ['Date', 'Reference', 'Description', 'Deposit (Dr)', 'Withdrawal (Cr)', 'Cleared']
    headers.forEach((h, i) => {
      const cell = ws.getCell(row, i + 1)
      cell.value = h
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
      cell.alignment = { horizontal: ['Date','Reference','Description'].includes(h) ? 'left' : 'right', vertical: 'middle' }
    })
    ws.getRow(row).height = 18
    const headerRow = row
    row += 1

    for (const t of data.transactions) {
      ws.getCell(row, 1).value = t.date
      ws.getCell(row, 2).value = t.ref
      ws.getCell(row, 2).font = { name: 'Consolas', size: 10 }
      ws.getCell(row, 3).value = t.description
      ws.getCell(row, 4).value = t.debit || null
      ws.getCell(row, 4).numFmt = '$#,##0.00'
      ws.getCell(row, 4).alignment = { horizontal: 'right' }
      ws.getCell(row, 5).value = t.credit || null
      ws.getCell(row, 5).numFmt = '$#,##0.00'
      ws.getCell(row, 5).alignment = { horizontal: 'right' }
      // Cleared column: "✓ 2026-06-30" or "*" or blank
      const clearedStr = t.tick === '✓' && t.clearedDate ? `✓ ${t.clearedDate}` : t.tick
      ws.getCell(row, 6).value = clearedStr
      ws.getCell(row, 6).alignment = { horizontal: 'center' }
      ws.getCell(row, 6).font = {
        bold: t.tick === '✓' || t.tick === '*',
        color: { argb: t.tick === '✓' ? 'FF16A34A' : t.tick === '*' ? 'FFD97706' : 'FF000000' },
      }
      row += 1
    }

    // Footer totals
    const totalDebit  = data.transactions.reduce((s, t) => s + t.debit, 0)
    const totalCredit = data.transactions.reduce((s, t) => s + t.credit, 0)
    ws.getCell(row, 1).value = 'Totals'
    ws.getCell(row, 1).font = { bold: true }
    ws.getCell(row, 4).value = totalDebit
    ws.getCell(row, 4).numFmt = '$#,##0.00'
    ws.getCell(row, 4).font = { bold: true }
    ws.getCell(row, 4).alignment = { horizontal: 'right' }
    ws.getCell(row, 5).value = totalCredit
    ws.getCell(row, 5).numFmt = '$#,##0.00'
    ws.getCell(row, 5).font = { bold: true }
    ws.getCell(row, 5).alignment = { horizontal: 'right' }
    for (let c = 1; c <= 6; c++) ws.getCell(row, c).border = { top: { style: 'medium' } }
    row += 1

    ws.views = [{ state: 'frozen', xSplit: 0, ySplit: headerRow }]
  }

  // ── Column widths ──
  ws.columns = [
    { width: 12 },                  // A
    { width: 18 },                  // B / Reference  ← also used by summary value column
    { width: 40 },                  // C / Description
    { width: 16 },                  // D
    { width: 16 },                  // E
    { width: 18 },                  // F  Cleared (or blank for summary)
  ]

  // ── Legend at bottom ──
  row += 1
  ws.getCell(`A${row}`).value = data.header.status === 'COMPLETED'
    ? '✓  Cleared in this reconciliation (with clearing date)'
    : '*  Tentatively cleared (reconciliation still in progress)'
  ws.getCell(`A${row}`).font = { italic: true, color: { argb: 'FF64748B' } }
  ws.mergeCells(`A${row}:F${row}`)

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}

// ─── PDF ──────────────────────────────────────────────────────────────────────
//
// Implemented with `pdf-lib` (pure JS, zero native deps).
//
// pdf-lib coordinates have origin at bottom-left; we maintain a top-down
// "cursor" (`y`) and convert to PDF coords on each draw via the helper.
// `cursor` decreases as we go down the page.
//
// Standard fonts (Helvetica family + Courier) are 14-font built-in PDF fonts
// — no font files to ship.

const PAGE_W = 595.28    // A4 width  in points
const PAGE_H = 841.89    // A4 height in points
const MARGIN = 40
const CONTENT_W = PAGE_W - 2 * MARGIN

const COLOR = {
  text:    rgb(0.06, 0.09, 0.16),    // slate-900
  muted:   rgb(0.40, 0.45, 0.51),    // slate-500
  border:  rgb(0.88, 0.91, 0.95),    // slate-200
  borderStrong: rgb(0.12, 0.16, 0.23), // slate-800
  green:   rgb(0.09, 0.64, 0.29),    // emerald-600
  red:     rgb(0.86, 0.15, 0.15),    // red-600
  amber:   rgb(0.85, 0.47, 0.02),    // amber-600
  rowAlt:  rgb(0.97, 0.98, 0.99),    // slate-50
  rowHead: rgb(0.12, 0.16, 0.23),    // slate-800
  white:   rgb(1, 1, 1),
}

interface PdfCtx {
  pdf: PDFDocument
  page: PDFPage
  helv: PDFFont
  helvB: PDFFont
  helvI: PDFFont
  courier: PDFFont
  zapf: PDFFont                  // ZapfDingbats — used for check mark glyph; '\u2713' renders as ✓
  cursor: number             // current Y from top, in points (we manage top-down)
}

function newPage(ctx: PdfCtx): PdfCtx {
  ctx.page = ctx.pdf.addPage([PAGE_W, PAGE_H])
  ctx.cursor = MARGIN
  return ctx
}

function ensureSpace(ctx: PdfCtx, needed: number) {
  if (ctx.cursor + needed > PAGE_H - MARGIN) newPage(ctx)
}

// Convert from top-down cursor to pdf-lib bottom-up Y for the BASELINE of text.
// pdf-lib renders text such that y is the baseline; baseline ≈ top + size * 0.78.
function baselineY(ctx: PdfCtx, topDownY: number, size: number) {
  return PAGE_H - topDownY - size * 0.78
}

function drawText(
  ctx: PdfCtx,
  text: string,
  x: number,
  size: number,
  opts: { font?: PDFFont; color?: ReturnType<typeof rgb>; align?: 'left'|'right'|'center'; width?: number; offsetY?: number } = {},
) {
  const font = opts.font ?? ctx.helv
  const color = opts.color ?? COLOR.text
  const offsetY = opts.offsetY ?? 0
  const baseY = baselineY(ctx, ctx.cursor + offsetY, size)
  let dx = x
  if (opts.align && opts.width != null) {
    const w = font.widthOfTextAtSize(text, size)
    if (opts.align === 'right')  dx = x + opts.width - w
    if (opts.align === 'center') dx = x + (opts.width - w) / 2
  }
  ctx.page.drawText(text, { x: dx, y: baseY, size, font, color })
}

function drawLine(ctx: PdfCtx, x1: number, x2: number, opts: { color?: ReturnType<typeof rgb>; thickness?: number; offsetY?: number } = {}) {
  const y = PAGE_H - (ctx.cursor + (opts.offsetY ?? 0))
  ctx.page.drawLine({
    start: { x: x1, y },
    end: { x: x2, y },
    thickness: opts.thickness ?? 0.5,
    color: opts.color ?? COLOR.border,
  })
}

function drawRect(ctx: PdfCtx, x: number, w: number, h: number, color: ReturnType<typeof rgb>) {
  const y = PAGE_H - (ctx.cursor + h)
  ctx.page.drawRectangle({ x, y, width: w, height: h, color })
}

function truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text
  let lo = 0, hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    const candidate = text.slice(0, mid) + '…'
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo) + '…'
}

export async function renderReconPdf(
  data: ReconReportData,
  detail: 'detailed' | 'summary',
): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Bank Reconciliation - ${data.header.accountCode} ${data.header.accountName}`)
  pdf.setAuthor('LedgerPro')
  pdf.setCreator('LedgerPro')

  const ctx: PdfCtx = {
    pdf,
    page: pdf.addPage([PAGE_W, PAGE_H]),
    helv:    await pdf.embedFont(StandardFonts.Helvetica),
    helvB:   await pdf.embedFont(StandardFonts.HelveticaBold),
    helvI:   await pdf.embedFont(StandardFonts.HelveticaOblique),
    courier: await pdf.embedFont(StandardFonts.Courier),
    zapf:    await pdf.embedFont(StandardFonts.ZapfDingbats),
    cursor: MARGIN,
  }

  // ── Title ──
  drawText(ctx, 'Bank Reconciliation Statement', MARGIN, 18, {
    font: ctx.helvB, align: 'center', width: CONTENT_W,
  })
  ctx.cursor += 24
  drawText(ctx, data.header.entityName, MARGIN, 11, {
    color: COLOR.muted, align: 'center', width: CONTENT_W,
  })
  ctx.cursor += 24

  // ── Meta block (2 columns) ──
  const colL = MARGIN
  const colR = MARGIN + CONTENT_W / 2
  const lineH = 16

  drawText(ctx, 'Bank Account',   colL, 9, { font: ctx.helvB, color: COLOR.muted })
  drawText(ctx, 'Statement Date', colR, 9, { font: ctx.helvB, color: COLOR.muted })
  ctx.cursor += 12
  drawText(ctx, `${data.header.accountCode} — ${data.header.accountName}`, colL, 11)
  drawText(ctx, data.header.statementDate, colR, 11)
  ctx.cursor += lineH + 4

  drawText(ctx, 'Status',    colL, 9, { font: ctx.helvB, color: COLOR.muted })
  drawText(ctx, 'Generated', colR, 9, { font: ctx.helvB, color: COLOR.muted })
  ctx.cursor += 12
  const statusColor = data.header.status === 'COMPLETED' ? COLOR.green : COLOR.amber
  drawText(ctx, data.header.status === 'COMPLETED' ? 'Completed' : 'In Progress', colL, 11, {
    font: ctx.helvB, color: statusColor,
  })
  drawText(ctx, new Date(data.header.generatedAt).toLocaleString(), colR, 11)
  ctx.cursor += lineH + 8

  // ── Divider ──
  drawLine(ctx, MARGIN, PAGE_W - MARGIN, { color: COLOR.border, thickness: 1 })
  ctx.cursor += 12

  // ── Reconciliation math ──
  drawText(ctx, 'Reconciliation', MARGIN, 12, { font: ctx.helvB })
  ctx.cursor += 18

  const drawSumRow = (label: string, value: number, opts: {
    bold?: boolean; indent?: number; topBorder?: boolean; valueColor?: ReturnType<typeof rgb>;
  } = {}) => {
    if (opts.topBorder) {
      drawLine(ctx, MARGIN, PAGE_W - MARGIN, { color: COLOR.muted, thickness: 0.4 })
      ctx.cursor += 4
    }
    const lx = MARGIN + (opts.indent ? 14 : 0)
    drawText(ctx, label, lx, 10, { font: opts.bold ? ctx.helvB : ctx.helv })
    const v = `$${fmt(value)}`
    drawText(ctx, v, MARGIN, 10, {
      font: opts.bold ? ctx.helvB : ctx.helv,
      color: opts.valueColor ?? COLOR.text,
      align: 'right', width: CONTENT_W,
    })
    ctx.cursor += 16
  }

  drawSumRow('Beginning balance (per books)',         data.summary.beginningBalance)
  drawSumRow('Statement ending balance (per bank)',   data.summary.statementEnding)
  drawSumRow('Cleared balance (in this recon)',       data.summary.clearedBalance, { topBorder: true })

  ctx.cursor += 6
  drawText(ctx, 'Outstanding items', MARGIN, 10, { font: ctx.helvI, color: COLOR.muted })
  ctx.cursor += 14

  drawSumRow('Outstanding deposits (uncleared receipts)',    data.summary.outstandingDeposits,    { indent: 1 })
  drawSumRow('Outstanding withdrawals (uncleared payments)', data.summary.outstandingWithdrawals, { indent: 1 })

  ctx.cursor += 4
  drawSumRow('Adjusted bank balance', data.summary.adjustedBankBalance, { bold: true, topBorder: true })
  drawSumRow('Book balance',          data.summary.bookBalance,        { bold: true })
  drawSumRow('Difference',            data.summary.difference, {
    bold: true, topBorder: true,
    valueColor: data.summary.isBalanced ? COLOR.green : COLOR.red,
  })

  ctx.cursor += 8
  if (data.summary.isBalanced) {
    // Use ZapfDingbats '\u2713' (= ✓) for the leading glyph, then Helvetica for the message
    drawText(ctx, '\u2713', MARGIN, 12, { font: ctx.zapf, color: COLOR.green })
    const tickW = ctx.zapf.widthOfTextAtSize('\u2713', 12)
    drawText(ctx, ' Reconciliation is balanced', MARGIN + tickW, 11, { font: ctx.helvB, color: COLOR.green })
  } else {
    // ⚠ glyph isn't in WinAnsi or ZapfDingbats — use a bracketed "!" instead
    drawText(ctx, '[!] Out of balance - investigate and correct', MARGIN, 11, {
      font: ctx.helvB, color: COLOR.red,
    })
  }
  ctx.cursor += 24

  // ── Transactions (detailed only) ──
  if (detail === 'detailed') {
    ensureSpace(ctx, 100)
    drawText(ctx, `Transactions (${data.transactions.length})`, MARGIN, 12, { font: ctx.helvB })
    ctx.cursor += 16

    // Columns: Date(60) Ref(75) Desc(195) Deposit(65) Withdrawal(65) Cleared(55)
    const cols = [
      { label: 'Date',        x: MARGIN,       w: 60,  align: 'left'   as const },
      { label: 'Ref',         x: MARGIN + 60,  w: 75,  align: 'left'   as const },
      { label: 'Description', x: MARGIN + 135, w: 195, align: 'left'   as const },
      { label: 'Deposit',     x: MARGIN + 330, w: 65,  align: 'right'  as const },
      { label: 'Withdrawal',  x: MARGIN + 395, w: 65,  align: 'right'  as const },
      { label: 'Cleared',     x: MARGIN + 460, w: 55,  align: 'center' as const },
    ]

    const drawTableHeader = () => {
      drawRect(ctx, MARGIN, CONTENT_W, 18, COLOR.rowHead)
      for (const c of cols) {
        drawText(ctx, c.label, c.x + 4, 9, {
          font: ctx.helvB, color: COLOR.white,
          align: c.align, width: c.w - 8, offsetY: 5,
        })
      }
      ctx.cursor += 18
    }

    drawTableHeader()

    let rowIdx = 0
    let totalDeb = 0, totalCr = 0
    for (const t of data.transactions) {
      ensureSpace(ctx, 18)
      if (ctx.cursor === MARGIN) drawTableHeader()                    // new page

      const rowH = 16
      if (rowIdx % 2 === 1) drawRect(ctx, MARGIN, CONTENT_W, rowH, COLOR.rowAlt)

      drawText(ctx, t.date, cols[0].x + 4, 9, { width: cols[0].w - 8, offsetY: 4 })
      drawText(ctx, t.ref,  cols[1].x + 4, 8.5, { font: ctx.courier, width: cols[1].w - 8, offsetY: 4 })
      drawText(ctx,
        truncateToWidth(t.description, ctx.helv, 9, cols[2].w - 8),
        cols[2].x + 4, 9, { width: cols[2].w - 8, offsetY: 4 },
      )
      if (t.debit > 0)  drawText(ctx, `$${fmt(t.debit)}`,  cols[3].x + 4, 9, { width: cols[3].w - 8, align: 'right', offsetY: 4 })
      if (t.credit > 0) drawText(ctx, `$${fmt(t.credit)}`, cols[4].x + 4, 9, { width: cols[4].w - 8, align: 'right', offsetY: 4 })
      // Cleared column tick: ZapfDingbats '\u2713' (= ✓) + clearedDate when COMPLETED,
      // plain '*' when IN_PROGRESS, blank when uncleared. We render the tick
      // glyph in ZapfDingbats and the date in Helvetica side-by-side, centered
      // in the cell.
      if (t.tick === '✓') {
        const dateStr = t.clearedDate ?? ''
        const tickSize = 9, dateSize = 8
        const tickW = ctx.zapf.widthOfTextAtSize('\u2713', tickSize)
        const gap = 3
        const dateW = dateStr ? ctx.helv.widthOfTextAtSize(dateStr, dateSize) : 0
        const totalW = tickW + (dateStr ? gap + dateW : 0)
        const startX = cols[5].x + (cols[5].w - totalW) / 2
        drawText(ctx, '\u2713', startX, tickSize, { font: ctx.zapf, color: COLOR.green, offsetY: 4 })
        if (dateStr) {
          drawText(ctx, dateStr, startX + tickW + gap, dateSize, {
            font: ctx.helv, color: COLOR.green, offsetY: 5,
          })
        }
      } else if (t.tick === '*') {
        drawText(ctx, '*', cols[5].x + 4, 11, {
          font: ctx.helvB, color: COLOR.amber,
          align: 'center', width: cols[5].w - 8, offsetY: 3,
        })
      }

      totalDeb += t.debit
      totalCr  += t.credit
      ctx.cursor += rowH
      rowIdx++
    }

    // Totals row
    drawLine(ctx, MARGIN, PAGE_W - MARGIN, { color: COLOR.borderStrong, thickness: 1 })
    ctx.cursor += 4
    drawText(ctx, 'Totals',                cols[0].x + 4, 9, { font: ctx.helvB, width: cols[0].w - 8, offsetY: 4 })
    drawText(ctx, `$${fmt(totalDeb)}`,     cols[3].x + 4, 9, { font: ctx.helvB, width: cols[3].w - 8, align: 'right', offsetY: 4 })
    drawText(ctx, `$${fmt(totalCr)}`,      cols[4].x + 4, 9, { font: ctx.helvB, width: cols[4].w - 8, align: 'right', offsetY: 4 })
    ctx.cursor += 20

    if (data.header.status === 'COMPLETED') {
      // Inline ZapfDingbats '\u2713' (= ✓) followed by an italic Helvetica caption
      drawText(ctx, '\u2713', MARGIN, 11, { font: ctx.zapf, color: COLOR.green })
      const w = ctx.zapf.widthOfTextAtSize('\u2713', 11)
      drawText(ctx, '  Cleared in this reconciliation (with clearing date)',
        MARGIN + w, 9, { font: ctx.helvI, color: COLOR.muted, offsetY: 2 })
    } else {
      drawText(ctx, '*  Tentatively cleared (reconciliation still in progress)',
        MARGIN, 9, { font: ctx.helvI, color: COLOR.muted })
    }
  }

  const bytes = await pdf.save()
  return Buffer.from(bytes)
}
