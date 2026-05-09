import { MONTH_CODES, TimeSlot } from '@/types'

// ── KOKO service charge constant ─────────────────────────────
export const KOKO_SERVICE_CHARGE_RATE = 0.1236 // 12.36%

// ── Phone normalisation ──────────────────────────────────────
// Converts any local/international format to plain international digits
// (e.g. "94777887542") given a dial-code hint.
//
// Handles four input shapes:
//   "+94 77 788 7542"  → already international with +     → "94777887542"
//   "0094 77 788 7542" → already international with 00    → "94777887542"
//   "0777887542"       → local with leading 0             → "94777887542"
//   "777887542"        → bare local digits (no leading 0) → "94777887542"
//
// The last case is the important one: paste-detector strips the dial code
// before handing the number to us, so by the time we save it the leading
// zero is gone too. Without prepending the dial, the CRM saves the number
// without any country code and wa.me later interprets the leading "7"
// as the Russia/Kazakhstan dial.
export function normalisePhone(phone: string, countryCode = '94'): string {
  const digits = phone.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('00')) return digits.slice(2)
  if (digits.startsWith('0')) return countryCode + digits.slice(1)
  // Already starts with the supplied dial code — assume international.
  if (digits.startsWith(countryCode)) return digits
  // Bare local digits (no leading 0, no dial code) — prepend the dial.
  return countryCode + digits
}
// ── WhatsApp wa.me link builder ──────────────────────────────
// Customer phones are stored in international format (e.g. "94777887542",
// "919876543210", "971557876839") so we trust that and just strip
// non-digits / a stray "00" prefix.
//
// DEFENSIVE FALLBACK: legacy entries created before the smart-paste fix
// got saved without any country code (e.g. "723092676") because a bare
// SL local number starting with "7" was misclassified as Russia (+7),
// the "7" stripped, and "94" never prepended. International numbers
// with their dial code are always ≥10 digits, so anything shorter is
// assumed to be a bare Sri Lankan local — prepend "94" so the WhatsApp
// link still works for those legacy customers.
export function buildWaLink(phone: string, message: string): string {
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length < 10) digits = '94' + digits.replace(/^0+/, '')
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

// ── Popup-blocker-safe WhatsApp opener ───────────────────────
// window.open() is blocked by iOS Safari and many mobile browsers when
// the call stack passes through an async function (even without awaits).
// The synthetic anchor click below preserves the user-gesture context
// across more browsers and is the most reliable way to open wa.me.
//
// IMPORTANT: this MUST be called inside a click handler BEFORE any await.
// If you do `await something(); openWaLink(...)`, the browser still drops
// the gesture and blocks the tab. Always: openWaLink first, then await.
export function openWaLink(url: string): void {
  if (typeof window === 'undefined') return
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

// ── WA Message templates ─────────────────────────────────────
export const WA = {
  greeting: (name: string) =>
    `Hi ${name},\n\nWelcome to Emma Thinking.\n\nYour order has been received and we are getting everything ready for you.\n\n---\n\nTo maintain privacy and fairness, Emma Thinking controls the sharing of contact information between members. If you wish to connect directly with someone, you must first register with us.\n\nඔබට අප හරහා කවුරුන්හෝ සම්බන්ධ කරගැනීමට අවශ්‍ය නම්, ප්‍රථමයෙන් අප සමග ලියාපදිංචි වීම අත්‍යවශ්‍යයවේ.\n\nලියාපදිංචිය සම්පූර්ණයෙන්ම නොමිලේ වන අතර, ඔබට පහත Website එක Fill කර එය සිදු කල හැකිය:\n\nලියාපදිංචි වීමට - https://www.emmathinking.com/login\n\nඔබට අදාළ පුද්ගලයා / පුද්ගලයන් සම්බන්ධ කර ගත හැකි වන්නෙ ලියාපදිංචියෙන් පසුව පමණක් බව කරුණාවෙන් සලකන්න.\n\nEmma Thinking (Pvt) Ltd කෙරෙහි තැබූ විශ්වාසට ඔබට තූති.`,

  sendInvoice: (name: string, invoiceUrl: string) =>
    `Hi ${name},\n\nPlease find your invoice below for your reference.\n\n${invoiceUrl}\n\n---\n\nThis is your personal Relationship Manager.\n\nIf you have any questions or need assistance, please feel free to contact me at any time.\n\nEmma Thinking (Pvt) Ltd`,

  send2ndInstallmentInvoice: (name: string, invoiceUrl: string) =>
    `Hi ${name},\n\nPlease find your 2nd installment invoice below for your reference.\n\n${invoiceUrl}\n\n---\n\nThank you for completing your payment.\n\nEmma Thinking (Pvt) Ltd`,

  sessionStart: (name: string) =>
    `Hi ${name},\n\nYour counselling session has now started and I will be your personal counselor throughout this process.\n\nCould you please share your available dates and times so we can schedule our meeting at a time that suits you?\n\nLooking forward to speaking with you.\n\nEmma Thinking (Pvt) Ltd`,

  confirmTime: (name: string, date: string, time: string, meetLink: string) =>
    `Hi ${name},\n\nYour counselling session has been confirmed. Please find the details below.\n\n   Date     : ${date}\n   Time     : ${time}\n   Meeting  : ${meetLink}\n\nKindly join the meeting on time. If you need to reschedule, please let us know in advance.\n\nWe look forward to speaking with you.\n\nEmma Thinking (Pvt) Ltd`,

  sendBriefToCustomer: (name: string, briefSummary: string) =>
    `Hi ${name},\n\nWe have prepared your profile content brief. Please review the details below carefully.\n\n---\n\n${briefSummary}\n\n---\n\nIf you are happy with the above, please confirm your approval.\n\nIf you would like any changes, please let us know and we will be happy to assist.\n\nEmma Thinking (Pvt) Ltd`,

  planningConfirmation: (name: string, date: string, time: string) =>
    `Hi ${name},\n\nYour post has been planned for publication on ${date} at ${time}.\n\nWe will take care of everything and notify you once it goes live.\n\nEmma Thinking (Pvt) Ltd`,

  // Combined plan + expiry confirmation — sent by the designer in one go
  planAndExpiry: (name: string, postDate: string, postTime: string, expiryDate: string) =>
    `Hi ${name},\n\nYour Emma Thinking profile post has been planned. Please find the details below.\n\n   Post Date    : ${postDate}\n   Post Time    : ${postTime}\n   Plan Expires : ${expiryDate}\n\nWe will take care of everything and notify you once your post goes live. Your post will remain active until the expiry date above.\n\nThank you for choosing Emma Thinking.\n\nEmma Thinking (Pvt) Ltd`,
}

// ── Post ID code generator ────────────────────────────────────
// Format: L/26/H/D1/W  (region/year/agentCode/monthDay/timeSlot)
export function generatePostId(
  agentCode: string,
  date: Date,
  slot: TimeSlot
): string {
  const year = String(date.getFullYear()).slice(-2)
  const monthCode = MONTH_CODES[date.getMonth() + 1]
  const day = date.getDate()
  return `L/${year}/${agentCode}/${monthCode}${day}/${slot}`
}

// ── Date helpers ─────────────────────────────────────────────
export function getDaysLeft(deadline: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const end = new Date(deadline)
  end.setHours(0, 0, 0, 0)
  return Math.ceil((end.getTime() - today.getTime()) / 86400000)
}

export function getProgressPercent(createdAt: string, deadline: string): number {
  const start = new Date(createdAt).getTime()
  const end = new Date(deadline).getTime()
  const now = Date.now()
  if (end <= start) return 100
  return Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)))
}

export function formatLastSeen(ts?: string): string {
  if (!ts) return 'Never'
  const diff = Date.now() - new Date(ts).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function currentMonthYear(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function fmtDate(ts: string): string {
  return new Date(ts).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric'
  })
}

export function fmtTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ── Punch-out 5-hour rule ─────────────────────────────────────
export function canPunchOut(punchInTime: string): { canPunch: boolean; minsLeft: number } {
  const punchIn = new Date(punchInTime).getTime()
  const fiveHoursMs = 5 * 60 * 60 * 1000
  const elapsed = Date.now() - punchIn
  const minsLeft = Math.max(0, Math.ceil((fiveHoursMs - elapsed) / 60000))
  return { canPunch: elapsed >= fiveHoursMs, minsLeft }
}

// ── Step names ────────────────────────────────────────────────
export const STEP_NAMES: Record<number, string> = {
  1: 'CRM — Intake',
  2: 'CRM — Order Creation',
  3: 'Back Office — Onboarding',
  4: 'Counselor — Brief Creation',
  5: 'Manager — Review & Approve',
  6: 'Designer — Production & Publish',
}

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  crm_agent: 'CRM Agent',
  back_office: 'Back Office',
  counselor: 'Counselor',
  manager: 'Manager',
  designer: 'Designer',
}

// ── LKR formatter ────────────────────────────────────────────
function fmtLkr(n: number): string {
  return Number(Math.round(n)).toLocaleString()
}

// ── Invoice HTML generator ────────────────────────────────────
export interface InvoiceParams {
  invoiceNumber: string
  clientName: string
  clientNumber: string
  paymentMethod: string           // "Bank Transfer", "Genie", "KOKO"
  bankName?: string               // "BOC", "Commercial Bank" etc. — only when bank transfer
  packageName: string
  finalAmount: number             // For non-KOKO non-installment: actual amount paid (= line item & total)
  // For KOKO: package amount (X). KOKO charge & total are derived.
  // For installment: amount of THIS installment payment.
  discountPercent?: number
  // KOKO breakdown
  isKoko?: boolean                // when true, render Package + KOKO 12.36% charge + Total
  // Installment info
  installmentType?: '1st' | '2nd' | null
  packageTotal?: number           // Full package price (after discount) — needed for installment context
  otherInstallmentAmount?: number // For 1st invoice: 2nd installment amount (remaining). For 2nd invoice: 1st installment amount.
}

export function generateInvoiceHtml(params: InvoiceParams): string {
  const today = new Date().toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric'
  })

  // ── Build description ─────────────────────────────────────
  let desc = params.discountPercent && params.discountPercent > 0
    ? `${params.packageName} — ${params.discountPercent}% Discount`
    : `${params.packageName} — Profile Publishing & Ad Boost`

  if (params.installmentType === '1st') desc = `${params.packageName} — 1st Installment`
  if (params.installmentType === '2nd') desc = `${params.packageName} — 2nd Installment (Final)`

  // ── Build line items table ────────────────────────────────
  let rowsHtml = ''
  let total = 0

  if (params.isKoko && !params.installmentType) {
    // KOKO: 2 line items
    const X = params.finalAmount
    const charge = Math.round(X * KOKO_SERVICE_CHARGE_RATE)
    total = X + charge
    rowsHtml = `
      <tr><td>${today}</td><td>${desc}</td><td style="text-align:right">LKR ${fmtLkr(X)}.00</td></tr>
      <tr><td>${today}</td><td>KOKO 12.36% Service Charge</td><td style="text-align:right">LKR ${fmtLkr(charge)}.00</td></tr>
    `
  } else if (params.installmentType) {
    // Installment: this payment's amount as the line item
    total = params.finalAmount
    rowsHtml = `
      <tr><td>${today}</td><td>${desc}</td><td style="text-align:right">LKR ${fmtLkr(params.finalAmount)}.00</td></tr>
    `
  } else {
    // Standard: single line
    total = params.finalAmount
    rowsHtml = `
      <tr><td>${today}</td><td>${desc}</td><td style="text-align:right">LKR ${fmtLkr(params.finalAmount)}.00</td></tr>
    `
  }

  // ── Installment summary block (under total) ───────────────
  let installmentBlock = ''
  if (params.installmentType && typeof params.packageTotal === 'number') {
    if (params.installmentType === '1st') {
      const remaining = params.otherInstallmentAmount ?? Math.max(0, params.packageTotal - params.finalAmount)
      installmentBlock = `
        <div class="inst">
          <p><strong>Package Total:</strong> LKR ${fmtLkr(params.packageTotal)}.00</p>
          <p><strong>Paid Now (1st Installment):</strong> LKR ${fmtLkr(params.finalAmount)}.00</p>
          <p class="inst-due"><strong>Remaining Balance:</strong> LKR ${fmtLkr(remaining)}.00</p>
        </div>
      `
    } else {
      const firstPaid = params.otherInstallmentAmount ?? Math.max(0, params.packageTotal - params.finalAmount)
      installmentBlock = `
        <div class="inst inst-paid">
          <p><strong>Package Total:</strong> LKR ${fmtLkr(params.packageTotal)}.00</p>
          <p><strong>1st Installment Paid:</strong> LKR ${fmtLkr(firstPaid)}.00</p>
          <p><strong>2nd Installment Paid Now:</strong> LKR ${fmtLkr(params.finalAmount)}.00</p>
          <p class="inst-done"><strong>✓ Fully Paid</strong></p>
        </div>
      `
    }
  }

  // ── Payment line in customer block ────────────────────────
  const bankLine = params.bankName
    ? `<p><strong>Bank :</strong> ${params.bankName}</p>`
    : ''

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Invoice ${params.invoiceNumber} - Emma Thinking</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:13px;color:#222;background:#f5f5f5}
.bar{background:#EA1E63;padding:14px;text-align:center;position:sticky;top:0;z-index:100}
.bar button{background:#fff;color:#EA1E63;border:none;border-radius:25px;padding:10px 28px;font-size:13px;font-weight:900;cursor:pointer}
.page{background:#fff;max-width:750px;margin:30px auto;padding:50px;border-radius:8px;box-shadow:0 2px 20px rgba(0,0,0,.08)}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #222;padding-bottom:16px;margin-bottom:20px}
.co-name{font-size:18px;font-weight:900}
.co-addr{font-size:11px;color:#555;margin-top:4px}
.inv-title{font-size:32px;font-weight:900}
.inv-tag{display:inline-block;background:#EA1E63;color:#fff;font-size:10px;font-weight:900;padding:3px 8px;border-radius:4px;margin-left:6px;vertical-align:middle;letter-spacing:.5px}
.two-col{display:flex;justify-content:space-between;margin-bottom:20px;gap:20px}
.cust label{font-weight:700;font-size:14px;margin-bottom:6px;display:block}
.cust p{font-size:12px;margin:3px 0}
.meta{text-align:right;font-size:12px}
.meta p{margin:3px 0}
table{width:100%;border-collapse:collapse;margin:20px 0}
th{font-weight:900;font-size:13px;padding:12px 8px;border-top:2px solid #222;border-bottom:1px solid #ccc;text-align:left}
td{padding:14px 8px;font-size:12px;border-bottom:1px solid #eee}
.total{border-top:2px solid #222;padding-top:12px;text-align:right;font-size:15px;font-weight:900;margin:8px 0 12px}
.inst{background:#FEF3C7;border:1px solid #FCD34D;border-radius:6px;padding:12px 14px;margin:8px 0 20px;font-size:12px}
.inst p{margin:3px 0}
.inst-due{color:#B45309;margin-top:6px !important;font-size:13px}
.inst-paid{background:#D1FAE5;border-color:#6EE7B7}
.inst-done{color:#047857;margin-top:6px !important;font-size:14px}
.terms{font-size:10.5px;color:#333;line-height:1.7;margin-top:20px;border-top:1px solid #ccc;padding-top:16px}
.terms h4{font-size:13px;font-weight:900;margin-bottom:8px}
.thanks{text-align:center;margin-top:30px;font-size:15px;font-weight:900;color:#EA1E63;padding:20px}
@media print{.bar{display:none}body{background:#fff}.page{box-shadow:none;margin:0;border-radius:0;padding:30px}}
</style>
</head>
<body>
<div class="bar"><button onclick="window.print()">Download / Print Invoice</button></div>
<div class="page">
  <div class="header">
    <div><div class="co-name">EMMA THINKING (PVT) LTD</div><div class="co-addr">RP 578, Rajapakshapura, Seeduwa, SRI LANKA</div></div>
    <div class="inv-title">Invoice${params.installmentType ? `<span class="inv-tag">${params.installmentType.toUpperCase()} INSTALLMENT</span>` : ''}</div>
  </div>
  <div style="font-size:12px;border-bottom:1px solid #ccc;padding-bottom:12px;margin-bottom:18px"><strong>Mobile:</strong> 077 734 8733</div>
  <div class="two-col">
    <div class="cust">
      <label>Customer</label>
      <p><strong>Name :</strong> ${params.clientName}</p>
      <p><strong>Mobile :</strong> ${params.clientNumber}</p>
      <p><strong>Payment :</strong> ${params.paymentMethod}</p>
      ${bankLine}
    </div>
    <div class="meta">
      <p>Invoice No: <strong>${params.invoiceNumber}</strong></p>
      <p>Date: <strong>${today}</strong></p>
      <br/><p>Emma Thinking (Pvt) Ltd</p>
    </div>
  </div>
  <table>
    <thead><tr><th>Date</th><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="total">Total: LKR ${fmtLkr(total)}.00</div>
  ${installmentBlock}
  <div class="terms">
    <h4>Terms &amp; Conditions</h4>
    <p>1. Emma Thinking (Pvt) Ltd is a legally registered Sri Lankan matchmaking service provider.</p>
    <p>2. All clients must be 18+ and legally free to marry.</p>
    <p>3. Services include profile publishing, ad boosting, and matchmaking introductions. No guarantee of relationship outcome.</p>
    <p>4. Contact info shared only after mutual consent.</p>
    <p>5. Full payment required before service begins. Non-refundable once post is live (except VIP).</p>
    <p>6. VIP Refund Policy: Full refund if no genuine responses within 14 days of publication.</p>
    <p>7. Client data used solely for matchmaking. Never sold or rented.</p>
    <p>8. Emma Thinking not liable for disputes between matched clients.</p>
    <p>9. By paying you accept all terms effective April 2025.</p>
  </div>
  <div class="thanks">Thank You</div>
</div>
</body>
</html>`
}
