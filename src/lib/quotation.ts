// ============================================================================
// src/lib/quotation.ts
// ============================================================================
// Renders the A4 customer quotation ("Invoice" sheet) that workers hand out
// before a customer pays. One package per sheet, features listed under the
// description, money summarised on the right:
//
//   Total             = KOKO price          (what they pay in instalments)
//   Advance Payments  = usually 0
//   Special Discount  = what they save by paying up front ("customer saves")
//   Balance Due       = the bank-transfer price
//
// The generated HTML is stored on public.quotations.html and served from
// /quotation/[id], the same way invoices are served from /invoice/[id].
// ============================================================================

// ── Package catalogue ────────────────────────────────────────
// Keyed by the CRM `packages.name` so the picker can hand us a package straight
// from the orders flow. `bank` matches packages.price in the database; `koko`
// and `saves` come from the pricing structure and are set by hand — KOKO price
// is NOT bank × 12.36%, it is rounded to a clean figure.
export interface QuotationPackage {
    /** Matches public.packages.name */
    name: string
    /** Name printed on the sheet */
    displayName: string
    audience: 'Male' | 'Female'
    days: number
    matches: string
    /** KOKO price — printed as "Total" */
    koko: number
    /** Bank-transfer price — printed as "Balance Due" */
    bank: number
    /** koko - bank — printed as "Special Discount" */
    saves: number
    features: string[]
}

export const QUOTATION_PACKAGES: QuotationPackage[] = [
    {
        name: 'Silver Pass', displayName: 'Silver Package', audience: 'Male',
        days: 30, matches: '4 matches', koko: 11500, bank: 9990, saves: 1510,
        features: [
            'Unlimited free profile browsing',
            'Personally reviewed matches (4 profiles)',
            'Direct WhatsApp support',
            'Verified member database (face + NIC checked)',
        ],
    },
    {
        name: 'Gold Pass', displayName: 'Gold Package', audience: 'Male',
        days: 90, matches: '6 matches', koko: 17200, bank: 14990, saves: 2210,
        features: [
            'Unlimited free profile browsing',
            'Unlimited two-way messaging',
            '6 hand-selected matches',
            'Dedicated agent for the full journey',
            'Priority WhatsApp support',
            'Private 30-min counselling session',
            'Profile perfection guide',
        ],
    },
    {
        name: 'VIP Pass', displayName: 'VIP Package', audience: 'Male',
        days: 120, matches: '8+ matches', koko: 20600, bank: 17990, saves: 2610,
        features: [
            'Unlimited free profile browsing',
            'Unlimited two-way messaging',
            '8+ deeply compatible matches',
            'Senior matchmaker assigned',
            'Full 1-hour counselling session',
            'Profile perfection guide',
            'Porondam horoscope compatibility check',
            'First date planning guide',
        ],
    },
    {
        name: 'Platinum', displayName: 'Platinum Package', audience: 'Male',
        days: 180, matches: '10+ matches', koko: 28600, bank: 24990, saves: 3610,
        features: [
            'Unlimited free profile browsing',
            'Unlimited two-way messaging',
            '10+ elite matches',
            'Dedicated personal matchmaker',
            '2 private counselling sessions',
            'Photoshoot preparation guide',
            'Profile crafted by our experts',
            'Full Porondam horoscope check',
            'Family introduction meetings',
            'First date fully arranged',
            'Priority access to new profiles',
            'Money-back guarantee',
        ],
    },
    {
        name: 'Princess Silver', displayName: 'Princess Silver Package', audience: 'Female',
        days: 30, matches: '4 matches', koko: 8000, bank: 6990, saves: 1010,
        features: [
            'Unlimited free profile browsing',
            'Unlimited two-way messaging',
            '100% verified profiles (face + NIC)',
            'Direct WhatsApp agent support',
        ],
    },
    {
        name: 'Princess Gold', displayName: 'Princess Gold Package', audience: 'Female',
        days: 90, matches: '6 matches', koko: 11500, bank: 9990, saves: 1510,
        features: [
            'Unlimited free profile browsing',
            'Unlimited two-way messaging',
            '6 hand-selected matches',
            'Dedicated female agent',
            'Priority WhatsApp support',
            'Private 30-min counselling session',
            'Profile perfection guide',
        ],
    },
    {
        name: 'Princess VIP', displayName: 'Princess VIP Package', audience: 'Female',
        days: 120, matches: '8+ matches', koko: 13800, bank: 11990, saves: 1810,
        features: [
            'Unlimited free profile browsing',
            'Unlimited two-way messaging',
            '8+ deeply compatible matches',
            'Senior female matchmaker assigned',
            'Full 1-hour counselling session',
            'Photoshoot preparation guide',
            'Profile perfection guide',
            'Porondam horoscope compatibility check',
            'Full profile privacy',
        ],
    },
    {
        name: 'Princess Platinum', displayName: 'Princess Platinum Package', audience: 'Female',
        days: 180, matches: '10+ matches', koko: 19500, bank: 16990, saves: 2510,
        features: [
            'Unlimited free profile browsing',
            'Unlimited two-way messaging',
            '10+ elite matches',
            'Dedicated personal female matchmaker',
            '2 private counselling sessions',
            'Photoshoot preparation guide',
            'Profile crafted by our experts',
            'Full Porondam horoscope check',
            'Family introduction meetings',
            'First date fully arranged',
            'Money-back guarantee',
        ],
    },
]

export function findQuotationPackage(name: string): QuotationPackage | undefined {
    const n = (name || '').trim().toLowerCase()
    return QUOTATION_PACKAGES.find(p => p.name.toLowerCase() === n)
}

// ── Formatting ───────────────────────────────────────────────
const money = (n: number) =>
    'LKR ' + Number(n || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
    })

/** Negative money reads "LKR -9,900.00"; zero stays "LKR 0.00". */
const moneyNeg = (n: number) =>
    Number(n || 0) === 0 ? money(0) : 'LKR -' + Number(n).toLocaleString('en-US', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
    })

const esc = (s: string) =>
    (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))

// ── HTML generator ───────────────────────────────────────────
export interface QuotationParams {
    quotationNumber: string
    clientName: string
    clientNumber?: string
    pkg: QuotationPackage
    /** "Total" row. Defaults to the package KOKO price. */
    total?: number
    /** "Advance Payments" row — normally 0. */
    advance?: number
    /** "Special Discount" row. Defaults to the package saving. */
    discount?: number
    /** Absolute origin, used to load the logo. */
    appUrl?: string
    /** Sheet date. Defaults to now. */
    date?: Date
}

export function generateQuotationHtml(params: QuotationParams): string {
    const pkg = params.pkg
    const total = typeof params.total === 'number' ? params.total : pkg.koko
    const advance = Number(params.advance || 0)
    const discount = typeof params.discount === 'number' ? params.discount : pkg.saves
    const balance = Math.max(0, total - advance - discount)

    const date = (params.date || new Date()).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'long', year: 'numeric',
    })

    const logo = `${params.appUrl || ''}/emma-logo-full.png`

    const months = Math.round(pkg.days / 30)
    const feats = pkg.features.map(f => `<li>${esc(f)}</li>`).join('')

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Invoice ${esc(params.quotationNumber)} — Emma Thinking (Pvt) Ltd</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;background:#e9e9ec;color:#1a1a1a;
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
.bar{background:#EA1E63;padding:14px;text-align:center;position:sticky;top:0;z-index:100}
.bar button{background:#fff;color:#EA1E63;border:none;border-radius:25px;padding:10px 28px;
  font-size:13px;font-weight:900;cursor:pointer}
.sheet{width:210mm;min-height:297mm;background:#fff;margin:26px auto;padding:16mm 15mm 12mm;
  box-shadow:0 4px 26px rgba(0,0,0,.14);display:flex;flex-direction:column}
/* Logo is the only colour on the sheet. */
.brand{text-align:center;margin-bottom:20px}
.brand img{width:185px;height:auto;display:inline-block}
h1.title{text-align:center;font-size:25px;font-weight:800;letter-spacing:.5px;margin:4px 0 22px}
.topgrid{display:flex;justify-content:space-between;gap:24px;margin-bottom:20px}
.billto .lbl{font-size:12px;font-weight:800;margin-bottom:5px}
.billto .name{font-size:12.5px;text-transform:uppercase;letter-spacing:.2px}
.billto .sub{font-size:11px;color:#555;margin-top:3px}
.meta{display:grid;grid-template-columns:auto auto;gap:6px 24px;font-size:12px;align-content:start}
.meta .k{font-weight:800}
table.items{width:100%;border-collapse:collapse;border:1px solid #9a9a9a}
table.items th{background:#f0f0f0;font-size:11.5px;font-weight:800;padding:9px 12px;
  border:1px solid #9a9a9a;text-align:center}
table.items th.desc{width:76%}
table.items td{border:1px solid #9a9a9a;padding:12px;font-size:11.5px;vertical-align:top}
table.items td.amt{text-align:right;vertical-align:middle;white-space:nowrap;font-variant-numeric:tabular-nums}
.pkgline{font-weight:800;margin-bottom:9px;font-size:12px}
.pkgmeta{color:#555;font-size:10.5px;margin-bottom:9px}
ul.feats{list-style:none;margin:0;padding:0}
ul.feats li{font-size:11px;line-height:1.62;padding-left:13px;position:relative}
ul.feats li::before{content:"";position:absolute;left:2px;top:7px;width:3.5px;height:3.5px;
  border-radius:50%;background:#1a1a1a}
.bottom{display:flex;justify-content:space-between;gap:26px;margin-top:22px}
.paycol{width:55%;font-size:11px;line-height:1.7}
.paycol h4{font-size:11.5px;font-weight:800;margin:0 0 5px}
.paycol .note{margin-top:11px}
.paycol .fineprint{margin-top:11px;font-size:10.5px;color:#555}
.totcol{width:45%;padding-top:2px}
.totrow{display:flex;justify-content:space-between;align-items:baseline;gap:14px;margin-bottom:11px}
.totrow .k{font-size:12.5px;font-weight:800}
.totrow .v{font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.totrow.grand{border-top:1.5px solid #1a1a1a;padding-top:11px;margin-top:2px}
.totrow.grand .k,.totrow.grand .v{font-size:14px;font-weight:800}
.foot{margin-top:auto;padding-top:18px;text-align:center;font-size:10px;color:#555;line-height:1.65}
.foot .co{font-weight:800;color:#1a1a1a;font-size:10.5px}
.foot a{color:#555;text-decoration:none}

/* ── Phone ────────────────────────────────────────────────────
   Scoped to \`screen\` so print is never affected. The A4 sheet is
   reflowed into a readable single column instead of being shrunk to
   fit — a 210mm sheet squeezed onto a 375px screen leaves the text
   around 5px tall, which no one can check before sending. */
@media screen and (max-width:820px){
  body{background:#fff}
  .sheet{width:100%;min-height:0;margin:0;padding:20px 16px 24px;box-shadow:none}
  .brand img{width:150px}
  h1.title{font-size:22px;margin:2px 0 18px}
  .topgrid{flex-direction:column;gap:14px}
  .meta{justify-content:start;font-size:13px}
  .billto .lbl{font-size:13px}
  .billto .name{font-size:13.5px}
  .billto .sub{font-size:12px}
  table.items th{font-size:12px;padding:8px 10px}
  table.items td{padding:11px 10px;font-size:12.5px}
  .pkgline{font-size:13.5px}
  .pkgmeta{font-size:11.5px}
  ul.feats li{font-size:12.5px;line-height:1.75}
  ul.feats li::before{top:8px}
  /* Money must never sit in a cramped side column on a phone. */
  .bottom{flex-direction:column;gap:22px;margin-top:20px}
  .paycol,.totcol{width:100%}
  .paycol{font-size:12.5px}
  .paycol h4{font-size:13px}
  .paycol .fineprint{font-size:11.5px}
  .totrow .k,.totrow .v{font-size:14px}
  .totrow.grand .k,.totrow.grand .v{font-size:16px}
  .foot{margin-top:26px;font-size:11px}
  .foot .co{font-size:11.5px}
}

/* ── Print — identical on a laptop and a phone ────────────────
   No forced 297mm height. The tallest package renders 239mm, so the
   sheet always fits one A4 page even when a mobile browser insists on
   adding its own page margins on top of \`@page\`. */
@page{size:A4;margin:0}
@media print{
  body{background:#fff}
  .bar{display:none !important}
  .sheet{width:210mm;min-height:0;margin:0;box-shadow:none;padding:14mm 15mm 10mm;
    break-inside:avoid;page-break-inside:avoid;page-break-after:avoid}
  .foot{margin-top:14mm}
}
</style>
</head>
<body>
<div class="bar"><button onclick="window.print()">Download / Print Invoice</button></div>

<div class="sheet">
  <div class="brand">
    <img src="${logo}" alt="Emma Thinking — A world beyond matrimony"/>
  </div>

  <h1 class="title">Invoice</h1>

  <div class="topgrid">
    <div class="billto">
      <div class="lbl">Bill to</div>
      <div class="name">${esc(params.clientName)}</div>
      ${params.clientNumber ? `<div class="sub">Mobile: ${esc(params.clientNumber)}</div>` : ''}
    </div>
    <div class="meta">
      <div class="k">Date</div><div class="v">${date}</div>
      <div class="k">Invoice#</div><div class="v">${esc(params.quotationNumber)}</div>
    </div>
  </div>

  <table class="items">
    <thead><tr><th class="desc">Description</th><th>Amount</th></tr></thead>
    <tbody>
      <tr>
        <td>
          <div class="pkgline">${esc(pkg.displayName)}</div>
          <div class="pkgmeta">${pkg.days} days &nbsp;•&nbsp; ${months} month${months > 1 ? 's' : ''} &nbsp;•&nbsp; ${esc(pkg.matches)} &nbsp;•&nbsp; ${pkg.audience}</div>
          <ul class="feats">${feats}</ul>
        </td>
        <td class="amt">${money(total)}</td>
      </tr>
    </tbody>
  </table>

  <div class="bottom">
    <div class="paycol">
      <h4>For Direct Deposits &amp; Transfers</h4>
      <div>
        Emma Thinking (Private) Limited<br/>
        Current Account Number: 1001040170<br/>
        Bank - Commercial Bank of Ceylon PLC<br/>
        Branch - Seeduwa (Code - 064)<br/>
        Bank SWIFT Code - CCEYLKLX
      </div>
      <div class="note">
        Kindly mention your NAME as the Beneficiary<br/>
        Reference
      </div>
      <div class="fineprint">*This is a computer-generated invoice. No signature is required.</div>
    </div>

    <div class="totcol">
      <div class="totrow"><span class="k">Total</span><span class="v">${money(total)}</span></div>
      <div class="totrow"><span class="k">Advance Payments</span><span class="v">${moneyNeg(advance)}</span></div>
      <div class="totrow"><span class="k">Special Discount</span><span class="v">${moneyNeg(discount)}</span></div>
      <div class="totrow grand"><span class="k">Balance Due</span><span class="v">${money(balance)}</span></div>
    </div>
  </div>

  <div class="foot">
    <div class="co">Emma Thinking (Pvt) Ltd | PV00326395</div>
    RP 578, Rajapakshapura, Seeduwa, Sri Lanka.<br/>
    Tel: 0117822228, 0744120725<br/>
    Email: info@emmathinking.com<br/>
    Web: <a href="https://www.emmathinking.com">www.emmathinking.com</a>
  </div>
</div>
</body>
</html>`
}
