/** Small CSV reader/writer (handles quotes, commas and new lines in cells). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** Rows as objects keyed by header (headers matched loosely: case and spaces ignored). */
export function csvObjects(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const all = parseCsv(text)
  if (!all.length) return { headers: [], rows: [] }
  const headers = all[0].map((h) => h.trim())
  const keys = headers.map(headerKey)
  const rows = all.slice(1).map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
  return { headers, rows }
}

export function headerKey(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const v = c == null ? '' : String(c)
          return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
        })
        .join(','),
    )
    .join('\r\n')
}

export function downloadFile(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
