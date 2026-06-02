import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
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

export async function renderReconPdf(
  data: ReconReportData,
  detail: 'detailed' | 'summary',
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40, info: {
        Title: `Bank Reconciliation - ${data.header.accountCode} ${data.header.accountName}`,
        Author: 'LedgerPro',
        CreationDate: new Date(),
      }})
      const chunks: Buffer[] = []
      doc.on('data', (c: Buffer) => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
      const left = doc.page.margins.left
      const right = doc.page.width - doc.page.margins.right

      // ── Header ──
      doc.font('Helvetica-Bold').fontSize(18).fillColor('#0F172A')
        .text('Bank Reconciliation Statement', { align: 'center' })
      doc.moveDown(0.3)
      doc.font('Helvetica').fontSize(11).fillColor('#64748B')
        .text(data.header.entityName, { align: 'center' })
      doc.moveDown(1)

      // 2-column meta
      const metaTop = doc.y
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#475569').text('Bank Account', left, metaTop)
      doc.font('Helvetica').fillColor('#0F172A').text(`${data.header.accountCode} — ${data.header.accountName}`, left, metaTop + 14)
      doc.font('Helvetica-Bold').fillColor('#475569').text('Statement Date', left + pageWidth / 2, metaTop)
      doc.font('Helvetica').fillColor('#0F172A').text(data.header.statementDate, left + pageWidth / 2, metaTop + 14)

      const metaRow2 = metaTop + 34
      doc.font('Helvetica-Bold').fillColor('#475569').text('Status', left, metaRow2)
      const statusColor = data.header.status === 'COMPLETED' ? '#16A34A' : '#D97706'
      doc.font('Helvetica-Bold').fillColor(statusColor).text(data.header.status === 'COMPLETED' ? 'Completed' : 'In Progress', left, metaRow2 + 14)
      doc.font('Helvetica-Bold').fillColor('#475569').text('Generated', left + pageWidth / 2, metaRow2)
      doc.font('Helvetica').fillColor('#0F172A').text(new Date(data.header.generatedAt).toLocaleString(), left + pageWidth / 2, metaRow2 + 14)
      doc.y = metaRow2 + 34
      doc.moveDown(1)

      // Section divider
      doc.strokeColor('#E2E8F0').lineWidth(1).moveTo(left, doc.y).lineTo(right, doc.y).stroke()
      doc.moveDown(0.5)

      // ── Reconciliation math ──
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#0F172A').text('Reconciliation')
      doc.moveDown(0.3)

      const drawRow = (label: string, value: number, opts: { bold?: boolean; indent?: number; topBorder?: boolean; valueColor?: string } = {}) => {
        if (opts.topBorder) {
          doc.strokeColor('#94A3B8').lineWidth(0.5).moveTo(left, doc.y).lineTo(right, doc.y).stroke()
          doc.moveDown(0.2)
        }
        const y = doc.y
        doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#0F172A')
        doc.text(label, left + (opts.indent ? 12 : 0), y, { width: pageWidth * 0.7 })
        doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(opts.valueColor ?? '#0F172A')
        doc.text(`$${fmt(value)}`, left, y, { width: pageWidth, align: 'right' })
        doc.y = y
        doc.moveDown(0.6)
      }

      drawRow('Beginning balance (per books)', data.summary.beginningBalance)
      drawRow('Statement ending balance (per bank)', data.summary.statementEnding)
      drawRow('Cleared balance (in this recon)', data.summary.clearedBalance, { topBorder: true })
      doc.moveDown(0.3)
      doc.font('Helvetica-Oblique').fontSize(10).fillColor('#475569').text('Outstanding items')
      doc.moveDown(0.2)
      drawRow('Outstanding deposits (uncleared receipts)', data.summary.outstandingDeposits, { indent: 1 })
      drawRow('Outstanding withdrawals (uncleared payments)', data.summary.outstandingWithdrawals, { indent: 1 })
      doc.moveDown(0.2)
      drawRow('Adjusted bank balance', data.summary.adjustedBankBalance, { bold: true, topBorder: true })
      drawRow('Book balance', data.summary.bookBalance, { bold: true })
      drawRow('Difference', data.summary.difference, {
        bold: true, topBorder: true,
        valueColor: data.summary.isBalanced ? '#16A34A' : '#DC2626',
      })

      doc.moveDown(0.3)
      doc.font('Helvetica-Bold').fontSize(11)
        .fillColor(data.summary.isBalanced ? '#16A34A' : '#DC2626')
        .text(data.summary.isBalanced ? '✓ Reconciliation is balanced' : '⚠ Out of balance — investigate and correct')
      doc.moveDown(1)

      // ── Transactions (detailed only) ──
      if (detail === 'detailed') {
        // New page if running tight on space
        if (doc.y > doc.page.height - 200) {
          doc.addPage()
        }
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#0F172A').text(`Transactions (${data.transactions.length})`)
        doc.moveDown(0.4)

        // Table columns: Date(60), Ref(75), Desc(220), Debit(75), Credit(75), Cleared(70)
        const cols = [
          { label: 'Date',         x: left,            w: 60,  align: 'left'  as const },
          { label: 'Ref',          x: left + 60,       w: 75,  align: 'left'  as const },
          { label: 'Description',  x: left + 135,      w: 195, align: 'left'  as const },
          { label: 'Deposit',      x: left + 330,      w: 65,  align: 'right' as const },
          { label: 'Withdrawal',   x: left + 395,      w: 65,  align: 'right' as const },
          { label: 'Cleared',      x: left + 460,      w: 55,  align: 'center'as const },
        ]

        const drawHeader = () => {
          const y = doc.y
          doc.rect(left, y, pageWidth, 18).fill('#1E293B')
          doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9)
          for (const c of cols) {
            doc.text(c.label, c.x + 4, y + 5, { width: c.w - 8, align: c.align })
          }
          doc.y = y + 18
        }

        drawHeader()
        let rowIdx = 0
        let totalDeb = 0, totalCr = 0
        const bottomLimit = doc.page.height - doc.page.margins.bottom - 30
        for (const t of data.transactions) {
          if (doc.y > bottomLimit) {
            doc.addPage()
            drawHeader()
          }
          const y = doc.y
          if (rowIdx % 2 === 1) {
            doc.rect(left, y, pageWidth, 16).fill('#F8FAFC')
          }
          doc.fillColor('#0F172A').font('Helvetica').fontSize(9)
          doc.text(t.date,   cols[0].x + 4, y + 4, { width: cols[0].w - 8 })
          doc.font('Courier').text(t.ref, cols[1].x + 4, y + 4, { width: cols[1].w - 8 })
          doc.font('Helvetica').text(truncate(t.description, 50), cols[2].x + 4, y + 4, { width: cols[2].w - 8 })
          if (t.debit > 0)  doc.text(`$${fmt(t.debit)}`,  cols[3].x + 4, y + 4, { width: cols[3].w - 8, align: 'right' })
          if (t.credit > 0) doc.text(`$${fmt(t.credit)}`, cols[4].x + 4, y + 4, { width: cols[4].w - 8, align: 'right' })
          // Cleared column
          const tickStr = t.tick === '✓' && t.clearedDate ? `✓ ${t.clearedDate}` : t.tick
          if (tickStr) {
            doc.font('Helvetica-Bold').fontSize(8)
              .fillColor(t.tick === '✓' ? '#16A34A' : '#D97706')
              .text(tickStr, cols[5].x + 4, y + 4, { width: cols[5].w - 8, align: 'center' })
          }
          totalDeb += t.debit
          totalCr  += t.credit
          doc.y = y + 16
          rowIdx++
        }

        // Totals row
        const ty = doc.y
        doc.strokeColor('#1E293B').lineWidth(1).moveTo(left, ty).lineTo(right, ty).stroke()
        doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(9)
        doc.text('Totals', cols[0].x + 4, ty + 4, { width: cols[0].w - 8 })
        doc.text(`$${fmt(totalDeb)}`, cols[3].x + 4, ty + 4, { width: cols[3].w - 8, align: 'right' })
        doc.text(`$${fmt(totalCr)}`,  cols[4].x + 4, ty + 4, { width: cols[4].w - 8, align: 'right' })
        doc.y = ty + 18

        doc.moveDown(0.5)
        doc.font('Helvetica-Oblique').fontSize(9).fillColor('#64748B')
          .text(data.header.status === 'COMPLETED'
            ? '✓  Cleared in this reconciliation (with clearing date)'
            : '*  Tentatively cleared (reconciliation still in progress)')
      }

      doc.end()
    } catch (e) {
      reject(e)
    }
  })
}

function truncate(s: string, n: number) {
  if (!s) return ''
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}
