// ============================================================================
// E-sign render helpers — pure functions, safe on server or client.
// Builds (1) the letterhead-backed signed document, and
//        (2) the PINK Certificate of Completion (PandaDoc-style, recoloured).
// ============================================================================

const PINK = '#EC4899'
const PINK_DARK = '#BE185D'
const PINK_SOFT = '#FCE7F3'

export const CURSIVE_FONT_LINK =
  'https://fonts.googleapis.com/css2?family=Great+Vibes&family=Dancing+Script:wght@600&display=swap'

export interface RDoc {
  id: string
  title: string
  body_html: string
  letterhead_url?: string | null
  certificate_no?: string | null
  completed_at?: string | null
  created_at?: string | null
}
export interface RSigner {
  id: string
  name: string
  email?: string | null
  status: string
  typed_name?: string | null
  signed_at?: string | null
  viewed_at?: string | null
  ip?: string | null
}
export interface RField {
  id: string
  signer_id: string
  type: 'signature' | 'date' | 'name' | 'text' | 'initials'
  page: number
  pos_x: number
  pos_y: number
  width: number
  height: number
  value?: string | null
}

const esc = (s?: string | null) =>
  (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const fmt = (d?: string | null) =>
  d
    ? new Date(d).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo',
      }) + ' (IST)'
    : '—'

// ── A single placed field, rendered as it appears on the finished doc ────────
export function fieldInnerHtml(f: RField): string {
  const v = esc(f.value)
  if (f.type === 'signature' || f.type === 'name' || f.type === 'initials') {
    return `<span style="font-family:'Great Vibes',cursive;font-size:30px;line-height:1;color:#0f172a">${v}</span>`
  }
  return `<span style="font-family:inherit;font-size:13px;color:#0f172a">${v}</span>`
}

// ── The full signed document — MULTI-PAGE.
// The letterhead tiles once per A4 page (repeat-y), the body flows across as many
// pages as the content needs, and each field is placed by (page, x%, y%) → exact mm.
// @page A4 + margin:0 makes the browser slice it into real pages on print/PDF.
const PAGE_MM = 297
const PAGE_W_MM = 210
const HEADER_MM = 40   // top text margin (clears the letterhead header band)
const FOOTER_MM = 32   // bottom text margin (clears the letterhead footer band)
const SIDE_MM = 22     // left / right text margin

export function renderDocumentHtml(
  doc: RDoc,
  fields: RField[],
  _opts: { forPrint?: boolean } = {},
): string {
  const lh = doc.letterhead_url
  const fieldsHtml = fields
    .filter((f) => f.value)
    .map((f) => {
      const topMm = (Math.max(1, f.page) - 1) * PAGE_MM + (f.pos_y / 100) * PAGE_MM
      return `
      <div style="position:absolute;left:${f.pos_x}%;top:${topMm}mm;width:${f.width}%;
                  display:flex;align-items:flex-end;border-bottom:1px solid #cbd5e1;padding-bottom:2px;">
        ${fieldInnerHtml(f)}
      </div>`
    })
    .join('')

  return `<!doctype html><html><head><meta charset="utf-8">
  <link href="${CURSIVE_FONT_LINK}" rel="stylesheet">
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: 'Segoe UI', Arial, sans-serif; color:#1e293b; background:#e2e8f0; }
    .sheet {
      position: relative; width: ${PAGE_W_MM}mm; min-height: ${PAGE_MM}mm; margin: 0 auto; background:#fff;
      ${lh ? `background-image:url('${lh}');background-size:${PAGE_W_MM}mm ${PAGE_MM}mm;background-repeat:repeat-y;background-position:top center;` : ''}
    }
    .content {
      position: relative; padding: ${HEADER_MM}mm ${SIDE_MM}mm ${FOOTER_MM}mm ${SIDE_MM}mm;
      font-size: 14px; line-height: 1.7;
    }
    .content h1,.content h2,.content h3 { color:#0f172a; }
    .content img { max-width: 100%; }
    .field-layer { position:absolute; inset:0; pointer-events:none; }
    @media print { body { background:#fff; } .sheet { margin:0; box-shadow:none; } }
  </style></head>
  <body>
    <div class="sheet">
      <div class="content">${doc.body_html || ''}</div>
      <div class="field-layer">${fieldsHtml}</div>
    </div>
  </body></html>`
}

// ── PINK Certificate of Completion (PandaDoc-style, recoloured) ──────────────
export function renderCertificateHtml(
  doc: RDoc,
  signers: RSigner[],
): string {
  const rows = signers
    .map(
      (s, i) => `
      <tr>
        <td style="padding:14px 16px;border-bottom:1px solid ${PINK_SOFT};">
          <div style="font-weight:700;color:#0f172a;font-size:14px;">${esc(s.name)}</div>
          <div style="color:#64748b;font-size:12px;">${esc(s.email) || '—'}</div>
          <div style="font-family:'Great Vibes',cursive;font-size:26px;color:${PINK_DARK};margin-top:4px;">${esc(s.typed_name || s.name)}</div>
        </td>
        <td style="padding:14px 16px;border-bottom:1px solid ${PINK_SOFT};font-size:12px;color:#475569;">
          <div><b>Viewed:</b> ${fmt(s.viewed_at)}</div>
          <div><b>Signed:</b> ${fmt(s.signed_at)}</div>
          <div><b>IP:</b> ${esc(s.ip) || '—'}</div>
        </td>
        <td style="padding:14px 16px;border-bottom:1px solid ${PINK_SOFT};text-align:center;">
          <span style="display:inline-block;background:${PINK};color:#fff;border-radius:999px;
                       width:26px;height:26px;line-height:26px;font-size:15px;">&#10003;</span>
          <div style="font-size:10px;color:${PINK_DARK};margin-top:4px;font-weight:700;">SIGNED</div>
          <div style="font-size:9px;color:#94a3b8;">ID ${s.id.slice(0, 8)}</div>
        </td>
      </tr>`,
    )
    .join('')

  return `<!doctype html><html><head><meta charset="utf-8">
  <link href="${CURSIVE_FONT_LINK}" rel="stylesheet">
  <style>
    @page { size: A4; margin: 0; }
    body { margin:0; font-family:'Segoe UI',Arial,sans-serif; color:#1e293b; background:#fff; }
    .wrap { max-width: 210mm; min-height: 297mm; margin:0 auto; padding: 24mm 20mm; }
    .bar { height: 8px; background: linear-gradient(90deg, ${PINK}, ${PINK_DARK}); border-radius: 999px; }
    .seal { width:64px;height:64px;border-radius:50%;background:${PINK_SOFT};border:2px solid ${PINK};
            display:flex;align-items:center;justify-content:center;color:${PINK_DARK};font-size:30px; }
    h1 { font-size: 24px; letter-spacing:.5px; margin: 14px 0 2px; color:${PINK_DARK}; }
    .sub { color:#64748b; font-size:13px; }
    table { width:100%; border-collapse:collapse; margin-top:10px; }
    th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.6px;
         color:${PINK_DARK}; padding:10px 16px; background:${PINK_SOFT}; }
    .meta { display:flex; flex-wrap:wrap; gap:10px 28px; margin:18px 0 8px; }
    .meta div { font-size:12px; color:#475569; }
    .meta b { color:#0f172a; }
    .foot { margin-top:26px; font-size:11px; color:#94a3b8; border-top:1px solid ${PINK_SOFT}; padding-top:12px; }
  </style></head>
  <body>
    <div class="wrap">
      <div class="bar"></div>
      <div style="display:flex;align-items:center;gap:16px;margin-top:22px;">
        <div class="seal">&#10003;</div>
        <div>
          <h1>Certificate of Completion</h1>
          <div class="sub">Emma Thinking &middot; Secure e-signature</div>
        </div>
      </div>

      <div class="meta">
        <div><b>Document</b><br>${esc(doc.title)}</div>
        <div><b>Certificate No.</b><br>${esc(doc.certificate_no) || '—'}</div>
        <div><b>Document ID</b><br>${esc(doc.id)}</div>
        <div><b>Status</b><br><span style="color:${PINK_DARK};font-weight:700;">COMPLETED</span></div>
        <div><b>Created</b><br>${fmt(doc.created_at)}</div>
        <div><b>Completed</b><br>${fmt(doc.completed_at)}</div>
      </div>

      <table>
        <thead><tr><th>Signer</th><th>Activity</th><th style="text-align:center;">Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="foot">
        This certificate documents the electronic signature of the parties listed above.
        Each signer accessed the document through a unique secure link and signed only their
        assigned fields. Timestamps recorded in Asia/Colombo (IST). Generated by Emma Thinking
        E-Sign. Certificate No.&nbsp;${esc(doc.certificate_no) || '—'}.
      </div>
    </div>
  </body></html>`
}
