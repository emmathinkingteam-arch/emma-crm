// ============================================================================
// Emma Thinking CRM — WhatsApp Support Bot (v2)
// ============================================================================
//
// Flow:
//   Step 0  → Language selection (EN / SI)
//   Step 1  → New or Existing customer?
//   Step 2  → New: Gender selection  |  Existing: DB lookup → personalised menu
//   Step 3  → New: Info menu (packages / payment / legitimacy / website / agent)
//   Step 4+ → New: package details by gender  |  Existing: sub-reply
//
// Escalation:
//   - Any message containing escalation keywords → instant agent queue
//   - Existing customer: 4+ unmatched replies → auto escalate
//
// DB tables used (read-only from bot):
//   customers        — phone → id, name
//   orders           — customer_id → id, current_step, status, tracking_token,
//                      planned_post_date, published_at, validity_expires_at,
//                      created_at, invoice_html, package_id
//   order_steps      — order_id + step_number → status, planned_post_date, completed_at
//   packages         — id → name, post_validity_days
//   support_conversations — existing columns + bot_lang, bot_gender, bot_customer_type,
//                           bot_unmatched_count  (run ALTER TABLE — see below)
//   support_messages — existing columns (unchanged)
//
// Required ALTER TABLE (run once in Supabase SQL editor):
//   ALTER TABLE support_conversations
//     ADD COLUMN IF NOT EXISTS bot_lang           TEXT DEFAULT 'en',
//     ADD COLUMN IF NOT EXISTS bot_gender         TEXT DEFAULT NULL,
//     ADD COLUMN IF NOT EXISTS bot_customer_type  TEXT DEFAULT NULL,
//     ADD COLUMN IF NOT EXISTS bot_unmatched_count INT  DEFAULT 0;
//
// ============================================================================

import { supabaseAdmin } from './supabase-admin'

const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!
const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN!
const VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://emmathinking.com'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ConvState = 'bot' | 'queued' | 'live' | 'closed'
export type Sender = 'customer' | 'bot' | 'agent'
export type BotLang = 'en' | 'si'

export interface SupportConversation {
  id: string
  customer_phone: string
  customer_name: string | null
  state: ConvState
  queue_number: number | null
  assigned_agent_id: string | null
  bot_step: number
  bot_lang: BotLang
  bot_gender: 'male' | 'female' | null
  bot_customer_type: 'new' | 'existing' | null
  bot_unmatched_count: number
  last_message: string | null
  last_message_at: string
  created_at: string
  closed_at: string | null
}

export interface SupportMessage {
  id: string
  conversation_id: string
  sender: Sender
  agent_id: string | null
  message: string
  created_at: string
}

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Cloud API — send plain text
// ─────────────────────────────────────────────────────────────────────────────

export async function sendSupportText(to: string, text: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${VERSION}/${PHONE_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to.startsWith('+') ? to : '+' + to,
          type: 'text',
          text: { body: text, preview_url: false },
        }),
      }
    )
    const data = await res.json()
    if (!res.ok) {
      console.error('[WA-support] send failed', JSON.stringify(data))
      return null
    }
    return data?.messages?.[0]?.id ?? null
  } catch (err) {
    console.error('[WA-support] network error', err)
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Escalation keywords — instant agent handoff
// ─────────────────────────────────────────────────────────────────────────────

const ESCALATE_KEYWORDS = ['agent', 'human', 'help', 'support', 'live', 'talk', 'person', 'niyojithaya', 'කතා']

// ─────────────────────────────────────────────────────────────────────────────
// Bilingual message templates
// ─────────────────────────────────────────────────────────────────────────────

const MSG = {

  // Step 0 — Language selection
  langSelect: () =>
    `Welcome to Emma Thinking. Please select your preferred language to continue.\n\n` +
    `1. English\n` +
    `2. සිංහල\n\n` +
    `---\n\n` +
    `එම්මා තින්කින් (Emma Thinking) වෙත සාදරයෙන් පිළිගනිමු. ඉදිරියට යාම සඳහා ඔබ කැමති භාෂාව තෝරන්න.\n\n` +
    `1. English\n` +
    `2. සිංහල`,

  // Step 1 — New or Existing
  newOrExisting: (lang: BotLang) => lang === 'en'
    ? `Thank you. Please select one of the options below so we can assist you better:\n\n` +
    `1. I am a new customer\n` +
    `2. I have already bought a package / Existing member`
    : `ස්තූතියි. ඔබට වඩාත් හොඳින් සහාය වීමට කරුණාකර පහත විකල්පයන්ගෙන් එකක් තෝරන්න:\n\n` +
    `1. මම නව පාරිභෝගිකයෙක්මි\n` +
    `2. මම දැනටමත් පැකේජයක් මිලදී ගෙන ඇත / දැනට සිටින සාමාජිකයෙක්මි`,

  // Step 2 (new) — Gender selection
  genderSelect: (lang: BotLang) => lang === 'en'
    ? `Welcome! To show you the most relevant options tailored for you, please select your gender:\n\n` +
    `1. Male\n` +
    `2. Female`
    : `සාදරයෙන් පිළිගනිමු! ඔබට වඩාත්ම ගැළපෙන විකල්ප පෙන්වීම සඳහා කරුණාකර ඔබේ ස්ත්‍රී පුරුෂ භාවය තෝරන්න:\n\n` +
    `1. පුරුෂ\n` +
    `2. ස්ත්‍රී`,

  // Step 3 (new) — Info menu
  newCustomerMenu: (lang: BotLang) => lang === 'en'
    ? `What would you like to know today? Please reply with a number:\n\n` +
    `1. View Available Packages\n` +
    `2. Payment Methods & Installments\n` +
    `3. Company Registration & Legitimacy\n` +
    `4. Visit Our Website\n` +
    `5. Speak to a Live Matchmaking Expert`
    : `අද දින ඔබ දැනගැනීමට කැමති කුමක් පිළිබඳවද? කරුණාකර අදාළ අංකය සමඟ පිළිතුරු සපයන්න:\n\n` +
    `1. පවතින පැකේජයන් බැලීමට\n` +
    `2. ගෙවීම් ක්‍රම සහ වාරික ගෙවීමේ පහසුකම්\n` +
    `3. සමාගම් ලියාපදිංචිය සහ නීත්‍යානුකූලභාවය\n` +
    `4. අපගේ වෙබ් අඩවියට පිවිසීමට\n` +
    `5. සහාය නියෝජිතයෙකු සමඟ සෘජුව සම්බන්ධ වීමට`,

  // Packages — Male
  packagesMale: (lang: BotLang): string[] => lang === 'en' ? [
    `*SILVER PACKAGE*\n\nDuration: 30 Days\n\n• Unlimited free profile browsing\n• 4 personally reviewed matches\n• 100% verified profiles (face + NIC)\n• Direct WhatsApp agent support\n• Basic compatibility matching`,
    `*GOLD PACKAGE*\n\nDuration: 90 Days (3 Months)\n\n• Unlimited free profile browsing\n• 6 hand-selected matches — reviewed for deep compatibility\n• Your own dedicated agent for the full journey\n• Priority WhatsApp — fast replies guaranteed\n• Private 30-min session with a certified relationship counselor\n• Profile perfection guide — make your profile stand out`,
    `*VIP PACKAGE — MOST POPULAR*\n\nDuration: 120 Days (4 Months)\n\n• Unlimited free profile browsing\n• 8+ deeply compatible matches — selected by a senior matchmaker\n• Senior matchmaker assigned to your journey\n• Full 1-hour private relationship counseling session\n• Photoshoot preparation guide — look your absolute best\n• Profile perfection guide — written by our experts\n• Traditional Porondam horoscope compatibility check\n• First date planning guide — confidence for the big moment`,
    `*PLATINUM PACKAGE — ELITE*\n\nDuration: 180 Days (6 Months)\nOnly 10 members accepted per month\n\n• Unlimited free profile browsing — no restrictions\n• 10+ elite matches — handpicked for deep compatibility\n• Dedicated personal matchmaker — exclusively yours\n• 2 private counseling sessions (1 before matching + 1 after)\n• Photoshoot preparation guide — look your absolute best\n• Profile crafted by our experts — written for you\n• Full Porondam horoscope compatibility check\n• Family introduction meetings — we coordinate everything\n• First date fully arranged — venue, timing, all handled\n• Priority access — first in line for every new compatible profile\n• If we can't find any match within 6 months, you get a full money-back guarantee.`,
  ] : [
    `*SILVER PACKAGE*\n\nකාලය: දින 30\n\n• සීමාවකින් තොරව යෝජනා බැලීමේ හැකියාව\n• අප විසින් පරීක්ෂා කර තෝරාගත් ගැළපෙන යෝජනා 4ක්\n• මුහුණ සහ හැඳුනුම්පත මගින් 100%ක් තහවුරු කරන ලද ගිණුම්\n• WhatsApp මගින් සෘජු සහාය\n• මූලික සුදුසුකම් මත ගැළපීම`,
    `*GOLD PACKAGE*\n\nකාලය: දින 90 (මාස 3)\n\n• සීමාවකින් තොරව මංගල යෝජනා බැලීමේ හැකියාව\n• ගැළපීම පිළිබඳව ගැඹුරින් සොයා බලා තෝරාගත් යෝජනා 6ක්\n• සම්පූර්ණ කාලය පුරාම ඔබටම වෙන්වූ විශේෂ සහායක නියෝජිතයෙකු\n• ප්‍රමුඛතාවය ලබාදෙන වේගවත් WhatsApp සේවාව\n• සහතික ලත් Counselor වරයෙකු සමඟ විනාඩි 30ක counseling session\n• Profile ආකර්ෂණීය ලෙස සකස් කර ගැනීමට මඟපෙන්වීම්`,
    `*VIP PACKAGE*\n\nකාලය: දින 120 (මාස 4)\n\n• සීමාවකින් තොරව මංගල යෝජනා බැලීමේ හැකියාව\n• ප්‍රධාන මංගල උපදේශක විසින් තෝරාගත් විශේෂ යෝජනා 8ක් හෝ ඊට වැඩි ගණනක්\n• සම්පූර්ණ ගමන පුරාම ප්‍රධාන මංගල උපදේශකවරයෙකුගේ සහාය\n• පැයක counseling session\n• Profile ඡායාරූප සඳහා සූදානම් වීමට මඟපෙන්වීම\n• ප්‍රවීණයන් විසින් සකස් කරන ලද Profile perfection උපදෙස්\n• සම්ප්‍රදායික පොරොන්දම් පරීක්ෂාව\n• පළමු හමුව (First date) සංවිධානය`,
    `*PLATINUM PACKAGE*\n\nකාලය: දින 180 (මාස 6)\nමෙම පැකේජය මිලදී ගත හැක්කේ මසකට සාමාජිකයින් 10 දෙනෙකුට පමණකි\n\n• සීමාවකින් තොරව යෝජනා බැලීමේ හැකියාව\n• ඉතාම ගැළපෙන යෝජනා 10ක් හෝ ඊට වැඩි ගණනක්\n• ඔබටම පමණක් වෙන්වූ විශේෂ මංගල උපදේශකවරයෙකු\n• Counseling sessions 2ක් (ගැළපීමට පෙර සහ පසු)\n• ඡායාරූප සූදානම් වීමට මඟපෙන්වීම\n• ප්‍රවීණයන් විසින් ඔබ වෙනුවෙන්ම සකස් කරන ලද Profile\n• සම්පූර්ණ පොරොන්දම් පරීක්ෂාව\n• පළමු හමුව ස්ථානය ඇතුළුව සූදානම් කර දීම\n• පවුල් හඳුන්වාදීමේ හමුව සංවිධානය\n• නව යෝජනා සඳහා Priority access\n• මාස 6 ඇතුළත ගැළපීමක් නොලැබුනහොත් සම්පූර්ණ මුදල ආපසු ලබාදීම`,
  ],

  // Packages — Female (Princess)
  packagesFemale: (lang: BotLang): string[] => lang === 'en' ? [
    `*PRINCESS SILVER PACKAGE*\n\nDuration: 30 Days\n\n• Unlimited free profile browsing\n• 4 personally reviewed matches\n• 100% verified profiles (face + NIC)\n• Direct WhatsApp agent support\n• Safe and private — your profile never shown publicly`,
    `*PRINCESS GOLD PACKAGE*\n\nDuration: 90 Days (3 Months)\n\n• Unlimited free profile browsing\n• 6 hand-selected matches — reviewed for deep compatibility\n• Your own dedicated female agent for the full journey\n• Priority WhatsApp — fast replies guaranteed\n• Private 30-min session with a female relationship counselor\n• Profile perfection guide — make your profile stand out`,
    `*PRINCESS VIP PACKAGE — MOST POPULAR*\n\nDuration: 120 Days (4 Months)\n\n• Unlimited free profile browsing\n• 8+ deeply compatible matches — selected by a senior female matchmaker\n• Senior female matchmaker assigned to your journey\n• Full 1-hour private counseling with a female counselor\n• Photoshoot preparation guide — look your absolute best\n• Profile perfection guide — written by our experts\n• Traditional Porondam horoscope compatibility check\n• First date planning guide — confidence for the big moment`,
    `*PRINCESS PLATINUM PACKAGE — ELITE*\n\nDuration: 180 Days (6 Months)\nOnly 10 members accepted per month\n\n• Unlimited free profile browsing — no restrictions\n• 10+ elite matches — handpicked for deep compatibility\n• Dedicated personal matchmaker — exclusively yours\n• 2 private counseling sessions (1 before matching + 1 after)\n• Photoshoot preparation guide — look your absolute best\n• Profile crafted by our experts — written for you\n• Full Porondam horoscope compatibility check\n• Family introduction meetings — we coordinate everything\n• First date fully arranged — venue, timing, all handled\n• Priority access — first in line for every new compatible profile\n• If we can't find any match within 6 months, you get a full money-back guarantee.`,
  ] : [
    `*PRINCESS SILVER PACKAGE*\n\nකාලය: දින 30\n\n• සීමාවකින් තොරව යෝජනා බැලීමේ හැකියාව\n• අප විසින් පරීක්ෂා කර තෝරාගත් ගැළපෙන යෝජනා 4ක්\n• මුහුණ සහ හැඳුනුම්පත මගින් 100%ක් තහවුරු කරන ලද ගිණුම්\n• WhatsApp මගින් සෘජු සහාය\n• ඔබේ Profile කිසිවිටෙකත් පොදු ස්ථානයක පෙන්වන්නේ නැත`,
    `*PRINCESS GOLD PACKAGE*\n\nකාලය: දින 90 (මාස 3)\n\n• සීමාවකින් තොරව මංගල යෝජනා බැලීමේ හැකියාව\n• ගැළපීම ගැඹුරින් සොයා බලා තෝරාගත් යෝජනා 6ක්\n• සම්පූර්ණ කාලය ඔබටම වෙන්වූ විශේෂ ස්ත්‍රී නියෝජිතයෙකු\n• ප්‍රමුඛතාවය ලබාදෙන WhatsApp සේවාව\n• ස්ත්‍රී Counselor සමඟ විනාඩි 30ක counseling session\n• Profile ආකර්ෂණීය ලෙස සකස් කර ගැනීමට මඟපෙන්වීම්`,
    `*PRINCESS VIP PACKAGE*\n\nකාලය: දින 120 (මාස 4)\n\n• සීමාවකින් තොරව මංගල යෝජනා බැලීමේ හැකියාව\n• ප්‍රධාන ස්ත්‍රී මංගල උපදේශක විසින් තෝරාගත් යෝජනා 8ක් හෝ ඊට වැඩි ගණනක්\n• සම්පූර්ණ ගමන ස්ත්‍රී ප්‍රධාන මංගල උපදේශකවරයෙකුගේ සහාය\n• පැයක counseling session\n• Profile ඡායාරූප සඳහා සූදානම් වීමට මඟපෙන්වීම\n• ප්‍රවීණයන් විසින් Profile perfection උපදෙස්\n• සම්ප්‍රදායික පොරොන්දම් පරීක්ෂාව\n• First date සංවිධානය`,
    `*PRINCESS PLATINUM PACKAGE*\n\nකාලය: දින 180 (මාස 6)\nමෙම පැකේජය මිලදී ගත හැක්කේ මසකට සාමාජිකයින් 10 දෙනෙකුට පමණකි\n\n• සීමාවකින් තොරව යෝජනා බැලීමේ හැකියාව\n• ඉතාම ගැළපෙන යෝජනා 10ක් හෝ ඊට වැඩි ගණනක්\n• ඔබටම පමණක් වෙන්වූ ස්ත්‍රී මංගල උපදේශකවරයෙකු\n• Counseling sessions 2ක්\n• ඡායාරූප සූදානම් වීමට මඟපෙන්වීම\n• ප්‍රවීණයන් විසින් ඔබ වෙනුවෙන්ම සකස් Profile\n• සම්පූර්ණ පොරොන්දම් පරීක්ෂාව\n• First date ස්ථානය ඇතුළුව සූදානම් කර දීම\n• පවුල් හඳුන්වාදීමේ හමුව සංවිධානය\n• Priority access\n• මාස 6 ඇතුළත ගැළපීමක් නොලැබුනහොත් සම්පූර්ණ මුදල ආපසු ලබාදීම`,
  ],

  // Payment methods
  paymentMethods: (lang: BotLang) => lang === 'en'
    ? `We accept credit cards, debit cards, Genie, Wise, and direct bank transfers. We also offer internal installment plans as well as flexible payment splits through Koko.`
    : `අපි ක්‍රෙඩිට් කාඩ්පත්, ඩෙබිට් කාඩ්පත්, Genie, Wise සහ ඍජු බැංකු හුවමාරු පිළිගන්නෙමු. එසේම අප ආයතනය හරහා ලබාදෙන අභ්‍යන්තර වාරික ක්‍රම මෙන්ම Koko හරහා ලබාදෙන පහසු ගෙවීමේ ක්‍රමද ඔබට භාවිත කළ හැකිය.`,

  // Company legitimacy
  legitimacy: (lang: BotLang) => lang === 'en'
    ? `Yes, Emma Thinking is a fully legitimate matchmaking agency officially registered under the Government of Sri Lanka.`
    : `ඔව්, එම්මා තින්කින් (Emma Thinking) යනු ශ්‍රී ලංකා රජය යටතේ නිල වශයෙන් ලියාපදිංචි කරන ලද පූර්ණ නීත්‍යානුකූල මංගල සේවා ආයතනයකි.`,

  // Website
  website: (lang: BotLang) => lang === 'en'
    ? `You can explore more about us, read success stories, and view details on our official website:\n\nhttps://www.emmathinking.com/`
    : `අපගේ නිල වෙබ් අඩවියට පිවිසීමෙන් ඔබට අප පිළිබඳ වැඩිදුර තොරතුරු සහ සාර්ථක විවාහ සබඳතා පිළිබඳ විස්තර දැනගත හැකිය:\n\nhttps://www.emmathinking.com/`,

  // Speak to expert (new customer)
  speakExpert: (lang: BotLang) => lang === 'en'
    ? `If you need personalized help selecting your package or have more questions, speak directly with our senior matchmaker on WhatsApp:\n\nhttps://wa.me/94744120725`
    : `ඔබේ පැකේජය තෝරා ගැනීමට උපකාර අවශ්‍ය නම් හෝ වෙනත් ගැටලු ඇත්නම්, අපගේ ප්‍රධාන උපදේශකවරයෙකු සමඟ WhatsApp ඔස්සේ සෘජුව සම්බන්ධ වන්න:\n\nhttps://wa.me/94744120725`,

  // Existing customer greeting
  existingGreeting: (name: string, lang: BotLang) => lang === 'en'
    ? `Hi ${name}, welcome back! How can we assist you with your active package today? Please select an option:\n\n` +
    `1. Get Invoice\n` +
    `2. Check Current Matching Stage / Status Update\n` +
    `3. Live Tracking Link\n` +
    `4. Package Description & Structural Details\n` +
    `5. Designer Post Plan Date\n` +
    `6. View Published Profile (MyJourney Link)`
    : `ආයුබෝවන් ${name}, ඔබව නැවතත් සාදරයෙන් පිළිගනිමු! ඔබගේ සක්‍රීය පැකේජය සම්බන්ධයෙන් අද දින ඔබට සහාය විය යුත්තේ කෙසේද? කරුණාකර විකල්පයක් තෝරන්න:\n\n` +
    `1. ඉන්වොයිසිය ලබා ගැනීමට\n` +
    `2. වත්මන් ගැලපීම් මට්ටම / තත්ත්වය පරීක්ෂා කිරීමට\n` +
    `3. සජීවී Tracking සබැඳිය ලබා ගැනීමට\n` +
    `4. පැකේජයේ විස්තර සහ ව්‍යුහාත්මක කරුණු බැලීමට\n` +
    `5. නිර්මාණ සැලසුම් දිනය (Designer Post Plan Date) බැලීමට\n` +
    `6. ප්‍රකාශිත පැතිකඩ බැලීමට (MyJourney සබැඳිය)`,

  // Existing customer — no order found
  noOrderFound: (lang: BotLang) => lang === 'en'
    ? `We could not find an active order linked to your number. Please contact us directly:\n\nhttps://wa.me/94744120725`
    : `ඔබගේ දුරකථන අංකය හා සම්බන්ධ සක්‍රීය ඇණවුමක් සොයාගත නොහැකි විය. කරුණාකර සෘජුව සම්බන්ධ වන්න:\n\nhttps://wa.me/94744120725`,

  // Option 1 — Invoice
  invoice: (lang: BotLang, link: string) => lang === 'en'
    ? `Here is the digital copy of your official invoice:\n\n${link}`
    : `ඔබගේ නිල ඉන්වොයිසියේ ඩිජිටල් පිටපත මෙතැනින් ලබා ගන්න:\n\n${link}`,

  // Option 2 — Status update
  statusUpdate: (lang: BotLang, stepName: string) => lang === 'en'
    ? `Your profile is currently at this stage: *${stepName}*`
    : `ඔබගේ පැතිකඩ දැනට පවතින්නේ මෙම මට්ටමේය: *${stepName}*`,

  // Option 3 — Tracking link
  trackingLink: (lang: BotLang, link: string) => lang === 'en'
    ? `You can view the live progress of your profile verification and matching process here:\n\n${link}`
    : `ඔබගේ පැතිකඩ තහවුරු කිරීමේ සහ ගැලපීම් ක්‍රියාවලියේ සජීවී ප්‍රගතිය මෙතැනින් නැරඹිය හැකිය:\n\n${link}`,

  // Option 4 — Package description
  packageDescription: (lang: BotLang, packageName: string, validityDays: number) => lang === 'en'
    ? `Here are the complete active details associated with your package:\n\n*Package:* ${packageName}\n*Duration:* ${validityDays} days\n\nFor full terms and features, visit: https://www.emmathinking.com/`
    : `ඔබගේ පැකේජයට අදාළ සම්පූර්ණ විස්තර:\n\n*පැකේජය:* ${packageName}\n*කාලය:* දින ${validityDays}\n\nසම්පූර්ණ කොන්දේසි සඳහා: https://www.emmathinking.com/`,

  // Option 5 — Post date
  postDate: (lang: BotLang, date: string | null, stepName: string) => {
    if (date) {
      return lang === 'en'
        ? `Your designer post is scheduled to be planned and prepared on: *${date}*`
        : `ඔබගේ නිර්මාණ සැලසුම් Post සකස් කිරීමට නියමිත දිනය: *${date}*`
    }
    return lang === 'en'
      ? `Your profile is currently at the *${stepName}* stage. The designer has not yet scheduled a post date. We will notify you as soon as it is confirmed.`
      : `ඔබගේ පැතිකඩ දැනට *${stepName}* මට්ටමේ ඇත. නිර්මාණකරු තවම Post දිනය නියම කර නොමැත. දිනය තහවුරු වූ වහාම ඔබව දැනුවත් කරන්නෙමු.`
  },

  // Option 6 — Published profile
  publishedProfile: (lang: BotLang, link: string | null) => {
    if (link) {
      return lang === 'en'
        ? `Your profile has been securely published! You can view your dynamic portal link here:\n\n${link}`
        : `ඔබගේ පැතිකඩ ආරක්ෂිතව ප්‍රකාශයට පත් කර ඇත! ඔබගේ සජීවී ද්වාර සබැඳිය:\n\n${link}`
    }
    return lang === 'en'
      ? `Your profile has not been published yet. It will appear here once it goes live.`
      : `ඔබගේ පැතිකඩ තවම ප්‍රකාශයට පත් කර නොමැත. ප්‍රකාශිත වූ වහාම සබැඳිය මෙහි ලබා ගත හැකිය.`
  },

  // Escalation message
  escalated: (lang: BotLang, queueNumber: number) => lang === 'en'
    ? `Your request has been received.\n\nQueue Number: *#${queueNumber}*\n\nAn available agent will connect with you shortly. Please wait.`
    : `ඔබේ request receive කරගන්නා ලදී.\n\nQueue Number: *#${queueNumber}*\n\nAvailable agent කෙනෙකු ඔබ සමඟ ඉක්මනින් සම්බන්ධ වනු ඇත. කරුණාකර wait කරන්න.`,

  // Invalid input
  invalidInput: (lang: BotLang) => lang === 'en'
    ? `Please reply with one of the numbered options shown above.`
    : `කරුණාකර ඉහත දෙනු ලැබූ අංකයකින් පිළිතුරු දෙන්න.`,

  // Ask again after reply (for new customer)
  askAgain: (lang: BotLang) => lang === 'en'
    ? `Is there anything else you would like to know? Please reply with a number:\n\n1. View Available Packages\n2. Payment Methods & Installments\n3. Company Registration & Legitimacy\n4. Visit Our Website\n5. Speak to a Live Matchmaking Expert`
    : `ඔබට තවත් කිසිවක් දැනගැනීමට කැමද? කරුණාකර අදාළ අංකය සමඟ පිළිතුරු සපයන්න:\n\n1. පවතින පැකේජයන් බැලීමට\n2. ගෙවීම් ක්‍රම සහ වාරික ගෙවීමේ පහසුකම්\n3. සමාගම් ලියාපදිංචිය සහ නීත්‍යානුකූලභාවය\n4. අපගේ වෙබ් අඩවියට පිවිසීමට\n5. සහාය නියෝජිතයෙකු සමඟ සෘජුව සම්බන්ධ වීමට`,

  // Ask again after reply (for existing customer)
  askAgainExisting: (lang: BotLang) => lang === 'en'
    ? `Is there anything else I can help you with?\n\n1. Get Invoice\n2. Check Current Matching Stage / Status Update\n3. Live Tracking Link\n4. Package Description & Structural Details\n5. Designer Post Plan Date\n6. View Published Profile (MyJourney Link)`
    : `තවත් කිසිවකින් සහාය කළ හැකිද?\n\n1. ඉන්වොයිසිය ලබා ගැනීමට\n2. වත්මන් ගැලපීම් මට්ටම / තත්ත්වය\n3. Tracking සබැඳිය\n4. පැකේජයේ විස්තර\n5. Designer Post Plan Date\n6. ප්‍රකාශිත පැතිකඩ`,
}

// ─────────────────────────────────────────────────────────────────────────────
// Step names map
// ─────────────────────────────────────────────────────────────────────────────

const STEP_NAMES: Record<number, { en: string; si: string }> = {
  1: { en: 'Customer Onboarding', si: 'ගනුදෙනුකරු ලියාපදිංචිය' },
  2: { en: 'Invoice Making', si: 'ඉන්වොයිස් සකස් කිරීම' },
  3: { en: 'Personal Relationship Manager', si: 'පෞද්ගලික RM යෙදවීම' },
  4: { en: 'Counselling Session', si: 'Counselling Session' },
  5: { en: 'Manager Post Approval', si: 'Manager අනුමැතිය' },
  6: { en: 'Design & Publish', si: 'නිර්මාණ සහ ප්‍රකාශනය' },
}

function stepName(step: number, lang: BotLang): string {
  const s = STEP_NAMES[step]
  if (!s) return `Step ${step}`
  return lang === 'en' ? s.en : s.si
}

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers
// ─────────────────────────────────────────────────────────────────────────────

interface CustomerOrder {
  customerName: string
  orderId: string
  currentStep: number
  status: string
  trackingToken: string | null
  plannedPostDate: string | null
  publishedAt: string | null
  validityExpiresAt: string | null
  createdAt: string
  packageName: string
  packageValidityDays: number
  step6PostDate: string | null
}

async function getCustomerOrder(
  phone: string,
  sb: ReturnType<typeof supabaseAdmin>
): Promise<CustomerOrder | null> {
  // Normalise phone — strip leading + for DB lookup, try both formats
  const normalised = phone.startsWith('+') ? phone.slice(1) : phone

  // Find customer
  const { data: customer } = await sb
    .from('customers')
    .select('id, name')
    .or(`phone.eq.${phone},phone.eq.${normalised},phone.eq.+${normalised}`)
    .maybeSingle()

  if (!customer) return null

  // Find latest active order
  const { data: order } = await sb
    .from('orders')
    .select(`
      id, current_step, status, tracking_token,
      planned_post_date, published_at, validity_expires_at, created_at,
      package_id,
      package:packages(name, post_validity_days)
    `)
    .eq('customer_id', customer.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!order) return null

  const pkg = (order.package as unknown) as { name: string; post_validity_days: number } | null

  // Get step 6 post date from order_steps
  const { data: step6 } = await sb
    .from('order_steps')
    .select('planned_post_date')
    .eq('order_id', order.id)
    .eq('step_number', 6)
    .maybeSingle()

  return {
    customerName: customer.name ?? 'Valued Customer',
    orderId: order.id,
    currentStep: order.current_step,
    status: order.status,
    trackingToken: (order as any).tracking_token ?? null,
    plannedPostDate: order.planned_post_date ?? null,
    publishedAt: order.published_at ?? null,
    validityExpiresAt: order.validity_expires_at ?? null,
    createdAt: order.created_at,
    packageName: pkg?.name ?? 'Your Package',
    packageValidityDays: pkg?.post_validity_days ?? 0,
    step6PostDate: step6?.planned_post_date ?? null,
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Colombo',
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry — called from /api/whatsapp/support-incoming
// ─────────────────────────────────────────────────────────────────────────────

export async function handleIncomingMessage(
  phoneNumber: string,
  messageText: string,
  customerName?: string
): Promise<void> {
  const sb = supabaseAdmin()

  // 1. Find open conversation or create new one
  let { data: conv } = await sb
    .from('support_conversations')
    .select('*')
    .eq('customer_phone', phoneNumber)
    .in('state', ['bot', 'queued', 'live'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!conv) {
    const { data: newConv } = await sb
      .from('support_conversations')
      .insert({
        customer_phone: phoneNumber,
        customer_name: customerName ?? null,
        state: 'bot',
        bot_step: 0,
        bot_lang: 'en',
        bot_gender: null,
        bot_customer_type: null,
        bot_unmatched_count: 0,
      })
      .select()
      .single()
    conv = newConv
  }

  if (!conv) return

  // 2. Save inbound message
  await sb.from('support_messages').insert({
    conversation_id: conv.id,
    sender: 'customer',
    message: messageText,
  })
  await sb
    .from('support_conversations')
    .update({
      last_message: messageText.slice(0, 200),
      last_message_at: new Date().toISOString(),
      ...(customerName && !conv.customer_name ? { customer_name: customerName } : {}),
    })
    .eq('id', conv.id)

  // 3. Route
  if (conv.state === 'bot') {
    await doBotStep(conv, messageText, sb)
  }
  // queued / live → agents see it via Supabase Realtime, bot silent
}

// ─────────────────────────────────────────────────────────────────────────────
// Bot state machine
// ─────────────────────────────────────────────────────────────────────────────

async function doBotStep(
  conv: SupportConversation,
  text: string,
  sb: ReturnType<typeof supabaseAdmin>
) {
  const input = text.trim()
  const lower = input.toLowerCase()
  const lang: BotLang = conv.bot_lang ?? 'en'

  // Any step — instant escalate on keyword
  if (ESCALATE_KEYWORDS.some(k => lower.includes(k))) {
    await escalate(conv, sb, lang)
    return
  }

  // ── Step 0: Language selection ──────────────────────────────────────────
  if (conv.bot_step === 0) {
    if (input === '1') {
      await updateConv(sb, conv.id, { bot_step: 1, bot_lang: 'en' })
      await botReply(conv, sb, MSG.newOrExisting('en'), false)
    } else if (input === '2') {
      await updateConv(sb, conv.id, { bot_step: 1, bot_lang: 'si' })
      await botReply(conv, sb, MSG.newOrExisting('si'), false)
    } else {
      // First ever message — show language select
      await updateConv(sb, conv.id, { bot_step: 0 })
      await botReply(conv, sb, MSG.langSelect(), false)
    }
    return
  }

  // ── Step 1: New or Existing ─────────────────────────────────────────────
  if (conv.bot_step === 1) {
    if (input === '1') {
      // New customer
      await updateConv(sb, conv.id, { bot_step: 2, bot_customer_type: 'new' })
      await botReply(conv, sb, MSG.genderSelect(lang), false)
    } else if (input === '2') {
      // Existing customer — look up DB
      await updateConv(sb, conv.id, { bot_step: 10, bot_customer_type: 'existing' })
      await handleExistingCustomer(conv, lang, sb)
    } else {
      await botReply(conv, sb, MSG.invalidInput(lang), false)
    }
    return
  }

  // ── Step 2: Gender selection (new customer) ─────────────────────────────
  if (conv.bot_step === 2 && conv.bot_customer_type === 'new') {
    if (input === '1') {
      await updateConv(sb, conv.id, { bot_step: 3, bot_gender: 'male' })
      await botReply(conv, sb, MSG.newCustomerMenu(lang), false)
    } else if (input === '2') {
      await updateConv(sb, conv.id, { bot_step: 3, bot_gender: 'female' })
      await botReply(conv, sb, MSG.newCustomerMenu(lang), false)
    } else {
      await botReply(conv, sb, MSG.invalidInput(lang), false)
    }
    return
  }

  // ── Step 3+: New customer info menu ────────────────────────────────────
  if (conv.bot_customer_type === 'new' && conv.bot_step >= 3) {
    await handleNewCustomerMenu(conv, input, lang, sb)
    return
  }

  // ── Step 10+: Existing customer sub-menu ───────────────────────────────
  if (conv.bot_customer_type === 'existing' && conv.bot_step >= 10) {
    await handleExistingCustomerMenu(conv, input, lang, sb)
    return
  }

  // Fallback — restart
  await updateConv(sb, conv.id, { bot_step: 0 })
  await botReply(conv, sb, MSG.langSelect(), false)
}

// ─────────────────────────────────────────────────────────────────────────────
// New customer — info menu handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleNewCustomerMenu(
  conv: SupportConversation,
  input: string,
  lang: BotLang,
  sb: ReturnType<typeof supabaseAdmin>
) {
  const gender = conv.bot_gender ?? 'male'
  const packages = gender === 'female' ? MSG.packagesFemale(lang) : MSG.packagesMale(lang)

  switch (input) {
    case '1': {
      // Send all 4 packages sequentially
      for (const pkg of packages) {
        await botReply(conv, sb, pkg, false)
      }
      // Ask again
      await botReply(conv, sb, MSG.askAgain(lang), false)
      break
    }
    case '2': {
      await botReply(conv, sb, MSG.paymentMethods(lang), false)
      await botReply(conv, sb, MSG.askAgain(lang), false)
      break
    }
    case '3': {
      await botReply(conv, sb, MSG.legitimacy(lang), false)
      await botReply(conv, sb, MSG.askAgain(lang), false)
      break
    }
    case '4': {
      await botReply(conv, sb, MSG.website(lang), false)
      await botReply(conv, sb, MSG.askAgain(lang), false)
      break
    }
    case '5': {
      await botReply(conv, sb, MSG.speakExpert(lang), false)
      // Count this as escalate-intent — escalate to queue
      await escalate(conv, sb, lang)
      break
    }
    default: {
      // Unmatched — increment counter
      const newCount = (conv.bot_unmatched_count ?? 0) + 1
      await updateConv(sb, conv.id, { bot_unmatched_count: newCount })
      if (newCount >= 4) {
        await escalate(conv, sb, lang)
      } else {
        await botReply(conv, sb, MSG.invalidInput(lang), false)
        await botReply(conv, sb, MSG.askAgain(lang), false)
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Existing customer — initial DB lookup + greeting
// ─────────────────────────────────────────────────────────────────────────────

async function handleExistingCustomer(
  conv: SupportConversation,
  lang: BotLang,
  sb: ReturnType<typeof supabaseAdmin>
) {
  const order = await getCustomerOrder(conv.customer_phone, sb)

  if (!order) {
    await botReply(conv, sb, MSG.noOrderFound(lang), false)
    await escalate(conv, sb, lang)
    return
  }

  await botReply(conv, sb, MSG.existingGreeting(order.customerName, lang), false)
}

// ─────────────────────────────────────────────────────────────────────────────
// Existing customer — sub-menu replies
// ─────────────────────────────────────────────────────────────────────────────

async function handleExistingCustomerMenu(
  conv: SupportConversation,
  input: string,
  lang: BotLang,
  sb: ReturnType<typeof supabaseAdmin>
) {
  // Re-fetch order fresh each time (data may have changed)
  const order = await getCustomerOrder(conv.customer_phone, sb)

  if (!order) {
    await botReply(conv, sb, MSG.noOrderFound(lang), false)
    await escalate(conv, sb, lang)
    return
  }

  switch (input) {
    case '1': {
      // Invoice
      const invoiceLink = `${APP_URL}/invoice/${order.orderId}`
      await botReply(conv, sb, MSG.invoice(lang, invoiceLink), false)
      await botReply(conv, sb, MSG.askAgainExisting(lang), false)
      break
    }
    case '2': {
      // Status
      const sName = stepName(order.currentStep, lang)
      await botReply(conv, sb, MSG.statusUpdate(lang, sName), false)
      await botReply(conv, sb, MSG.askAgainExisting(lang), false)
      break
    }
    case '3': {
      // Tracking link
      const trackLink = order.trackingToken
        ? `${APP_URL}/track/${order.trackingToken}`
        : `${APP_URL}/track/${order.orderId}`
      await botReply(conv, sb, MSG.trackingLink(lang, trackLink), false)
      await botReply(conv, sb, MSG.askAgainExisting(lang), false)
      break
    }
    case '4': {
      // Package description
      await botReply(conv, sb, MSG.packageDescription(lang, order.packageName, order.packageValidityDays), false)
      await botReply(conv, sb, MSG.askAgainExisting(lang), false)
      break
    }
    case '5': {
      // Designer post date
      const postDateRaw = order.step6PostDate ?? order.plannedPostDate
      const postDateStr = postDateRaw ? formatDate(postDateRaw) : null
      const sName = stepName(order.currentStep, lang)
      await botReply(conv, sb, MSG.postDate(lang, postDateStr, sName), false)
      await botReply(conv, sb, MSG.askAgainExisting(lang), false)
      break
    }
    case '6': {
      // Published profile / MyJourney
      const myJourneyLink = order.publishedAt && order.trackingToken
        ? `${APP_URL}/track/${order.trackingToken}`
        : null
      await botReply(conv, sb, MSG.publishedProfile(lang, myJourneyLink), false)
      await botReply(conv, sb, MSG.askAgainExisting(lang), false)
      break
    }
    default: {
      const newCount = (conv.bot_unmatched_count ?? 0) + 1
      await updateConv(sb, conv.id, { bot_unmatched_count: newCount })
      if (newCount >= 4) {
        await escalate(conv, sb, lang)
      } else {
        await botReply(conv, sb, MSG.invalidInput(lang), false)
        await botReply(conv, sb, MSG.askAgainExisting(lang), false)
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function updateConv(
  sb: ReturnType<typeof supabaseAdmin>,
  id: string,
  fields: Partial<SupportConversation>
) {
  await sb.from('support_conversations').update(fields).eq('id', id)
}

async function botReply(
  conv: SupportConversation,
  sb: ReturnType<typeof supabaseAdmin>,
  text: string,
  _updateStep: boolean // kept for signature compat, step now managed separately
) {
  await sendSupportText(conv.customer_phone, text)
  await sb.from('support_messages').insert({
    conversation_id: conv.id,
    sender: 'bot',
    message: text,
  })
  await sb.from('support_conversations')
    .update({
      last_message: text.slice(0, 200),
      last_message_at: new Date().toISOString(),
    })
    .eq('id', conv.id)
}

async function escalate(
  conv: SupportConversation,
  sb: ReturnType<typeof supabaseAdmin>,
  lang: BotLang = 'en'
) {
  const { data: top } = await sb
    .from('support_conversations')
    .select('queue_number')
    .not('queue_number', 'is', null)
    .order('queue_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const queueNumber = (top?.queue_number ?? 0) + 1

  await sb.from('support_conversations')
    .update({ state: 'queued', queue_number: queueNumber })
    .eq('id', conv.id)

  const msg = MSG.escalated(lang, queueNumber)

  await sendSupportText(conv.customer_phone, msg)
  await sb.from('support_messages').insert({
    conversation_id: conv.id,
    sender: 'bot',
    message: msg,
  })
  await sb.from('support_conversations')
    .update({
      last_message: msg.slice(0, 200),
      last_message_at: new Date().toISOString(),
    })
    .eq('id', conv.id)
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent — take a queued conversation (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

export async function agentTake(convId: string, agentId: string): Promise<{ ok: boolean; error?: string }> {
  const sb = supabaseAdmin()

  const { error } = await sb
    .from('support_conversations')
    .update({ state: 'live', assigned_agent_id: agentId })
    .eq('id', convId)
    .eq('state', 'queued')

  if (error) return { ok: false, error: error.message }

  const { data: conv } = await sb
    .from('support_conversations')
    .select('customer_phone, bot_lang')
    .eq('id', convId)
    .single()

  if (conv) {
    const lang: BotLang = (conv.bot_lang as BotLang) ?? 'en'
    const notif = lang === 'en'
      ? `An agent has connected with you. Please go ahead and type your question.`
      : `Agent කෙනෙකු ඔබ සමඟ සම්බන්ධ වූහ. ඔබේ question type කරන්න.`
    await sendSupportText(conv.customer_phone, notif)
    await sb.from('support_messages').insert({
      conversation_id: convId,
      sender: 'bot',
      message: notif,
    })
  }

  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent — send message in live conversation (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

export async function agentSend(
  convId: string,
  agentId: string,
  message: string
): Promise<{ ok: boolean; error?: string }> {
  const sb = supabaseAdmin()

  const { data: conv } = await sb
    .from('support_conversations')
    .select('customer_phone, state')
    .eq('id', convId)
    .single()

  if (!conv) return { ok: false, error: 'Conversation not found' }
  if (conv.state !== 'live') return { ok: false, error: 'Conversation is not live' }

  await sendSupportText(conv.customer_phone, message)

  await sb.from('support_messages').insert({
    conversation_id: convId,
    sender: 'agent',
    agent_id: agentId,
    message,
  })

  await sb.from('support_conversations')
    .update({
      last_message: message.slice(0, 200),
      last_message_at: new Date().toISOString(),
    })
    .eq('id', convId)

  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent — close conversation (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

export async function agentClose(convId: string): Promise<{ ok: boolean; error?: string }> {
  const sb = supabaseAdmin()

  const { data: conv } = await sb
    .from('support_conversations')
    .select('customer_phone, bot_lang')
    .eq('id', convId)
    .single()

  if (conv) {
    const lang: BotLang = (conv.bot_lang as BotLang) ?? 'en'
    const bye = lang === 'en'
      ? `Your conversation has been closed. Thank you for contacting Emma Thinking.\n\nFeel free to message us again whenever you need assistance.`
      : `ඔබගේ conversation close කරන ලදී. Emma Thinking contact කළාට ස්තූතියි.\n\nනැවත සහාය අවශ්‍ය වුවහොත් message කරන්න.`
    await sendSupportText(conv.customer_phone, bye)
    await sb.from('support_messages').insert({
      conversation_id: convId,
      sender: 'bot',
      message: bye,
    })
  }

  await sb.from('support_conversations')
    .update({ state: 'closed', closed_at: new Date().toISOString() })
    .eq('id', convId)

  return { ok: true }
}