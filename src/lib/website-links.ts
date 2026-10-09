// ============================================================================
// Website links — one-tap tiles on the customer page that WhatsApp a page of
// emmathinking.com to the customer with a short message, and log it to the
// customer's history. The admin CRM Entries page parses that log line back out
// (WEBSITE_LINK_RE) to filter by which link was sent.
// ============================================================================

export interface WebsiteLink {
  key: string
  label: string
  url: string
  emoji: string
  blurb: string   // one line that sits above the link in the message
}

export const WEBSITE_LINKS: WebsiteLink[] = [
  { key: 'counseling', label: 'Counselling', emoji: '💬', url: 'https://www.emmathinking.com/services/counseling', blurb: 'Here are the details of our Counselling service' },
  { key: 'secret_crush', label: 'Secret Crush', emoji: '💌', url: 'https://www.emmathinking.com/services/secret-crush', blurb: 'Here are the details of our Secret Crush service' },
  { key: 'family_gathering', label: 'Family Gathering', emoji: '👨‍👩‍👧', url: 'https://www.emmathinking.com/services/family-gathering', blurb: 'Here are the details of our Family Gathering service' },
  { key: 'matchmaking', label: 'Matchmaking', emoji: '💞', url: 'https://www.emmathinking.com/services/matchmaking', blurb: 'Here are the details of our Matchmaking service' },
  { key: 'date_arrangement', label: 'Date Arrangement', emoji: '🌹', url: 'https://www.emmathinking.com/services/date-arrangement', blurb: 'Here are the details of our Date Arrangement service' },
  { key: 'horoscope', label: 'Horoscope', emoji: '✨', url: 'https://www.emmathinking.com/services/horoscope-matching', blurb: 'Here are the details of our Horoscope Matching service' },
  { key: 'about', label: 'About Us', emoji: '🏢', url: 'https://www.emmathinking.com/about', blurb: 'Here is a little more about Emma Thinking' },
  { key: 'reviews', label: 'Reviews', emoji: '⭐', url: 'https://www.emmathinking.com/about#reviews', blurb: 'Here is what our clients say about us' },
  { key: 'pricing', label: 'Membership Plans', emoji: '💎', url: 'https://www.emmathinking.com/pricing', blurb: 'Here are our membership plans' },
  { key: 'pricing_men', label: 'Mens', emoji: '👨', url: 'https://www.emmathinking.com/pricing/for-men', blurb: 'Here are our membership plans for men' },
  { key: 'pricing_women', label: 'Women', emoji: '👩', url: 'https://www.emmathinking.com/pricing/for-women', blurb: 'Here are our membership plans for women' },
  { key: 'how_it_works', label: 'How it Works', emoji: '🧭', url: 'https://www.emmathinking.com/how-it-works', blurb: 'Here is how Emma Thinking works' },
]

export const WEBSITE_LINK_MAP = Object.fromEntries(WEBSITE_LINKS.map(l => [l.label, l])) as Record<string, WebsiteLink>

export function websiteLinkMessage(name: string, link: WebsiteLink): string {
  return `Hi ${name},\n\n${link.blurb}:\n\n${link.url}\n\nIf you have any questions, feel free to contact me at any time.\n\nEmma Thinking (Pvt) Ltd`
}

// History line written when a tile is tapped — keep in sync with WEBSITE_LINK_RE.
export function websiteLinkLog(link: WebsiteLink): string {
  return `🔗 Website link sent — ${link.label} | ${link.url}`
}

// Captures the label from a history line.
export const WEBSITE_LINK_RE = /^🔗 Website link sent — (.+?) \| /

// ── Match profiles (Match Finder) ────────────────────────────────────────────
// When an agent decides a Match Finder suggestion suits the customer, the
// customer gets her / his public emmathinking.com profile on WhatsApp. The
// message carries no phone number — the website decides when contact details
// are shared. Plain text only: some phones show emoji in wa.me drafts as �.

export const VIEW_USER_URL = 'https://www.emmathinking.com/view-user/'
export const viewUserUrl = (websiteUserId: string) => VIEW_USER_URL + websiteUserId

export interface ProfileShare {
  userId: string        // website user id
  name: string | null
  age: number | null
  place: string         // "Maharagama, Colombo"
  facts: string         // "Buddhist · Single · 5'4\" · Teacher"
  pronoun: 'her' | 'his'
}

const firstName = (s: string | null) => (s || '').trim().split(/\s+/)[0] || 'A member'
const shareLine = (p: ProfileShare) => `${firstName(p.name)}${p.age ? `, ${p.age}` : ''} — ${p.place}`

export function matchProfileMessage(customerName: string, p: ProfileShare): string {
  return `Hi ${customerName},\n\nWe found a profile that suits what you are looking for:\n\n${shareLine(p)}${p.facts ? `\n${p.facts}` : ''}\n\nView ${p.pronoun} profile here:\n${viewUserUrl(p.userId)}\n\nIf you like this profile, reply to this message and we will help you with the next step.\n\nEmma Thinking (Pvt) Ltd`
}

export function matchProfilesMessage(customerName: string, list: ProfileShare[]): string {
  const items = list.map((p, i) => `${i + 1}) ${shareLine(p)}${p.facts ? `\n${p.facts}` : ''}\n${viewUserUrl(p.userId)}`)
  return `Hi ${customerName},\n\nHere are some profiles we picked for you:\n\n${items.join('\n\n')}\n\nTell us which profile you would like to know more about.\n\nEmma Thinking (Pvt) Ltd`
}

// History line written when a profile is sent to the customer.
export function matchProfileLog(p: ProfileShare): string {
  return `💞 Match profile sent — ${p.name || 'Member'}${p.age ? `, ${p.age}` : ''} | ${viewUserUrl(p.userId)}`
}
