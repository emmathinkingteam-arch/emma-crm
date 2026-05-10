// ─────────────────────────────────────────────────────────────
// COUNTRY DIAL CODES — Comprehensive list for paste auto-detect
// Sorted by dial length DESC ensures longer codes (971, 974, 968)
// match before shorter ones (1, 7) when scanning a pasted number.
// ─────────────────────────────────────────────────────────────

export interface CountryCode {
  flag: string
  code: string   // ISO-2
  name: string
  dial: string   // without +
  digits?: number // typical local digit count (optional, used as hint only)
}

export const COUNTRY_CODES: CountryCode[] = [
  // Pinned at top — Sri Lanka & most-used by Emma Thinking
  { flag: '🇱🇰', code: 'LK', name: 'Sri Lanka', dial: '94', digits: 9 },
  { flag: '🇦🇪', code: 'AE', name: 'United Arab Emirates', dial: '971', digits: 9 },
  { flag: '🇶🇦', code: 'QA', name: 'Qatar', dial: '974', digits: 8 },
  { flag: '🇸🇦', code: 'SA', name: 'Saudi Arabia', dial: '966', digits: 9 },
  { flag: '🇰🇼', code: 'KW', name: 'Kuwait', dial: '965', digits: 8 },
  { flag: '🇴🇲', code: 'OM', name: 'Oman', dial: '968', digits: 8 },
  { flag: '🇧🇭', code: 'BH', name: 'Bahrain', dial: '973', digits: 8 },
  { flag: '🇦🇺', code: 'AU', name: 'Australia', dial: '61', digits: 9 },
  { flag: '🇬🇧', code: 'GB', name: 'United Kingdom', dial: '44', digits: 10 },
  { flag: '🇺🇸', code: 'US', name: 'United States', dial: '1', digits: 10 },
  { flag: '🇨🇦', code: 'CA', name: 'Canada', dial: '1', digits: 10 },
  { flag: '🇮🇹', code: 'IT', name: 'Italy', dial: '39', digits: 10 },
  { flag: '🇯🇵', code: 'JP', name: 'Japan', dial: '81', digits: 10 },
  { flag: '🇮🇳', code: 'IN', name: 'India', dial: '91', digits: 10 },

  // Rest, alphabetical by name
  { flag: '🇦🇫', code: 'AF', name: 'Afghanistan', dial: '93', digits: 9 },
  { flag: '🇦🇱', code: 'AL', name: 'Albania', dial: '355', digits: 9 },
  { flag: '🇩🇿', code: 'DZ', name: 'Algeria', dial: '213', digits: 9 },
  { flag: '🇦🇩', code: 'AD', name: 'Andorra', dial: '376', digits: 6 },
  { flag: '🇦🇴', code: 'AO', name: 'Angola', dial: '244', digits: 9 },
  { flag: '🇦🇷', code: 'AR', name: 'Argentina', dial: '54', digits: 10 },
  { flag: '🇦🇲', code: 'AM', name: 'Armenia', dial: '374', digits: 8 },
  { flag: '🇦🇼', code: 'AW', name: 'Aruba', dial: '297', digits: 7 },
  { flag: '🇦🇹', code: 'AT', name: 'Austria', dial: '43', digits: 11 },
  { flag: '🇦🇿', code: 'AZ', name: 'Azerbaijan', dial: '994', digits: 9 },
  { flag: '🇧🇸', code: 'BS', name: 'Bahamas', dial: '1', digits: 10 },
  { flag: '🇧🇩', code: 'BD', name: 'Bangladesh', dial: '880', digits: 10 },
  { flag: '🇧🇧', code: 'BB', name: 'Barbados', dial: '1', digits: 10 },
  { flag: '🇧🇾', code: 'BY', name: 'Belarus', dial: '375', digits: 9 },
  { flag: '🇧🇪', code: 'BE', name: 'Belgium', dial: '32', digits: 9 },
  { flag: '🇧🇿', code: 'BZ', name: 'Belize', dial: '501', digits: 7 },
  { flag: '🇧🇯', code: 'BJ', name: 'Benin', dial: '229', digits: 8 },
  { flag: '🇧🇹', code: 'BT', name: 'Bhutan', dial: '975', digits: 8 },
  { flag: '🇧🇴', code: 'BO', name: 'Bolivia', dial: '591', digits: 8 },
  { flag: '🇧🇦', code: 'BA', name: 'Bosnia and Herzegovina', dial: '387', digits: 8 },
  { flag: '🇧🇼', code: 'BW', name: 'Botswana', dial: '267', digits: 8 },
  { flag: '🇧🇷', code: 'BR', name: 'Brazil', dial: '55', digits: 11 },
  { flag: '🇧🇳', code: 'BN', name: 'Brunei', dial: '673', digits: 7 },
  { flag: '🇧🇬', code: 'BG', name: 'Bulgaria', dial: '359', digits: 9 },
  { flag: '🇧🇫', code: 'BF', name: 'Burkina Faso', dial: '226', digits: 8 },
  { flag: '🇧🇮', code: 'BI', name: 'Burundi', dial: '257', digits: 8 },
  { flag: '🇰🇭', code: 'KH', name: 'Cambodia', dial: '855', digits: 9 },
  { flag: '🇨🇲', code: 'CM', name: 'Cameroon', dial: '237', digits: 9 },
  { flag: '🇨🇻', code: 'CV', name: 'Cape Verde', dial: '238', digits: 7 },
  { flag: '🇨🇫', code: 'CF', name: 'Central African Republic', dial: '236', digits: 8 },
  { flag: '🇹🇩', code: 'TD', name: 'Chad', dial: '235', digits: 8 },
  { flag: '🇨🇱', code: 'CL', name: 'Chile', dial: '56', digits: 9 },
  { flag: '🇨🇳', code: 'CN', name: 'China', dial: '86', digits: 11 },
  { flag: '🇨🇴', code: 'CO', name: 'Colombia', dial: '57', digits: 10 },
  { flag: '🇰🇲', code: 'KM', name: 'Comoros', dial: '269', digits: 7 },
  { flag: '🇨🇬', code: 'CG', name: 'Congo', dial: '242', digits: 9 },
  { flag: '🇨🇩', code: 'CD', name: 'Congo (DRC)', dial: '243', digits: 9 },
  { flag: '🇨🇷', code: 'CR', name: 'Costa Rica', dial: '506', digits: 8 },
  { flag: '🇨🇮', code: 'CI', name: "Côte d'Ivoire", dial: '225', digits: 10 },
  { flag: '🇭🇷', code: 'HR', name: 'Croatia', dial: '385', digits: 9 },
  { flag: '🇨🇺', code: 'CU', name: 'Cuba', dial: '53', digits: 8 },
  { flag: '🇨🇾', code: 'CY', name: 'Cyprus', dial: '357', digits: 8 },
  { flag: '🇨🇿', code: 'CZ', name: 'Czech Republic', dial: '420', digits: 9 },
  { flag: '🇩🇰', code: 'DK', name: 'Denmark', dial: '45', digits: 8 },
  { flag: '🇩🇯', code: 'DJ', name: 'Djibouti', dial: '253', digits: 8 },
  { flag: '🇩🇲', code: 'DM', name: 'Dominica', dial: '1', digits: 10 },
  { flag: '🇩🇴', code: 'DO', name: 'Dominican Republic', dial: '1', digits: 10 },
  { flag: '🇪🇨', code: 'EC', name: 'Ecuador', dial: '593', digits: 9 },
  { flag: '🇪🇬', code: 'EG', name: 'Egypt', dial: '20', digits: 10 },
  { flag: '🇸🇻', code: 'SV', name: 'El Salvador', dial: '503', digits: 8 },
  { flag: '🇬🇶', code: 'GQ', name: 'Equatorial Guinea', dial: '240', digits: 9 },
  { flag: '🇪🇷', code: 'ER', name: 'Eritrea', dial: '291', digits: 7 },
  { flag: '🇪🇪', code: 'EE', name: 'Estonia', dial: '372', digits: 8 },
  { flag: '🇸🇿', code: 'SZ', name: 'Eswatini', dial: '268', digits: 8 },
  { flag: '🇪🇹', code: 'ET', name: 'Ethiopia', dial: '251', digits: 9 },
  { flag: '🇫🇯', code: 'FJ', name: 'Fiji', dial: '679', digits: 7 },
  { flag: '🇫🇮', code: 'FI', name: 'Finland', dial: '358', digits: 9 },
  { flag: '🇫🇷', code: 'FR', name: 'France', dial: '33', digits: 9 },
  { flag: '🇬🇦', code: 'GA', name: 'Gabon', dial: '241', digits: 8 },
  { flag: '🇬🇲', code: 'GM', name: 'Gambia', dial: '220', digits: 7 },
  { flag: '🇬🇪', code: 'GE', name: 'Georgia', dial: '995', digits: 9 },
  { flag: '🇩🇪', code: 'DE', name: 'Germany', dial: '49', digits: 11 },
  { flag: '🇬🇭', code: 'GH', name: 'Ghana', dial: '233', digits: 9 },
  { flag: '🇬🇷', code: 'GR', name: 'Greece', dial: '30', digits: 10 },
  { flag: '🇬🇩', code: 'GD', name: 'Grenada', dial: '1', digits: 10 },
  { flag: '🇬🇹', code: 'GT', name: 'Guatemala', dial: '502', digits: 8 },
  { flag: '🇬🇳', code: 'GN', name: 'Guinea', dial: '224', digits: 9 },
  { flag: '🇬🇼', code: 'GW', name: 'Guinea-Bissau', dial: '245', digits: 7 },
  { flag: '🇬🇾', code: 'GY', name: 'Guyana', dial: '592', digits: 7 },
  { flag: '🇭🇹', code: 'HT', name: 'Haiti', dial: '509', digits: 8 },
  { flag: '🇭🇳', code: 'HN', name: 'Honduras', dial: '504', digits: 8 },
  { flag: '🇭🇰', code: 'HK', name: 'Hong Kong', dial: '852', digits: 8 },
  { flag: '🇭🇺', code: 'HU', name: 'Hungary', dial: '36', digits: 9 },
  { flag: '🇮🇸', code: 'IS', name: 'Iceland', dial: '354', digits: 7 },
  { flag: '🇮🇩', code: 'ID', name: 'Indonesia', dial: '62', digits: 10 },
  { flag: '🇮🇷', code: 'IR', name: 'Iran', dial: '98', digits: 10 },
  { flag: '🇮🇶', code: 'IQ', name: 'Iraq', dial: '964', digits: 10 },
  { flag: '🇮🇪', code: 'IE', name: 'Ireland', dial: '353', digits: 9 },
  { flag: '🇮🇱', code: 'IL', name: 'Israel', dial: '972', digits: 9 },
  { flag: '🇯🇲', code: 'JM', name: 'Jamaica', dial: '1', digits: 10 },
  { flag: '🇯🇴', code: 'JO', name: 'Jordan', dial: '962', digits: 9 },
  { flag: '🇰🇿', code: 'KZ', name: 'Kazakhstan', dial: '7', digits: 10 },
  { flag: '🇰🇪', code: 'KE', name: 'Kenya', dial: '254', digits: 9 },
  { flag: '🇰🇮', code: 'KI', name: 'Kiribati', dial: '686', digits: 8 },
  { flag: '🇰🇷', code: 'KR', name: 'South Korea', dial: '82', digits: 10 },
  { flag: '🇰🇬', code: 'KG', name: 'Kyrgyzstan', dial: '996', digits: 9 },
  { flag: '🇱🇦', code: 'LA', name: 'Laos', dial: '856', digits: 10 },
  { flag: '🇱🇻', code: 'LV', name: 'Latvia', dial: '371', digits: 8 },
  { flag: '🇱🇧', code: 'LB', name: 'Lebanon', dial: '961', digits: 8 },
  { flag: '🇱🇸', code: 'LS', name: 'Lesotho', dial: '266', digits: 8 },
  { flag: '🇱🇷', code: 'LR', name: 'Liberia', dial: '231', digits: 9 },
  { flag: '🇱🇾', code: 'LY', name: 'Libya', dial: '218', digits: 10 },
  { flag: '🇱🇮', code: 'LI', name: 'Liechtenstein', dial: '423', digits: 7 },
  { flag: '🇱🇹', code: 'LT', name: 'Lithuania', dial: '370', digits: 8 },
  { flag: '🇱🇺', code: 'LU', name: 'Luxembourg', dial: '352', digits: 9 },
  { flag: '🇲🇴', code: 'MO', name: 'Macau', dial: '853', digits: 8 },
  { flag: '🇲🇰', code: 'MK', name: 'North Macedonia', dial: '389', digits: 8 },
  { flag: '🇲🇬', code: 'MG', name: 'Madagascar', dial: '261', digits: 9 },
  { flag: '🇲🇼', code: 'MW', name: 'Malawi', dial: '265', digits: 9 },
  { flag: '🇲🇾', code: 'MY', name: 'Malaysia', dial: '60', digits: 9 },
  { flag: '🇲🇻', code: 'MV', name: 'Maldives', dial: '960', digits: 7 },
  { flag: '🇲🇱', code: 'ML', name: 'Mali', dial: '223', digits: 8 },
  { flag: '🇲🇹', code: 'MT', name: 'Malta', dial: '356', digits: 8 },
  { flag: '🇲🇭', code: 'MH', name: 'Marshall Islands', dial: '692', digits: 7 },
  { flag: '🇲🇷', code: 'MR', name: 'Mauritania', dial: '222', digits: 8 },
  { flag: '🇲🇺', code: 'MU', name: 'Mauritius', dial: '230', digits: 8 },
  { flag: '🇲🇽', code: 'MX', name: 'Mexico', dial: '52', digits: 10 },
  { flag: '🇫🇲', code: 'FM', name: 'Micronesia', dial: '691', digits: 7 },
  { flag: '🇲🇩', code: 'MD', name: 'Moldova', dial: '373', digits: 8 },
  { flag: '🇲🇨', code: 'MC', name: 'Monaco', dial: '377', digits: 8 },
  { flag: '🇲🇳', code: 'MN', name: 'Mongolia', dial: '976', digits: 8 },
  { flag: '🇲🇪', code: 'ME', name: 'Montenegro', dial: '382', digits: 8 },
  { flag: '🇲🇦', code: 'MA', name: 'Morocco', dial: '212', digits: 9 },
  { flag: '🇲🇿', code: 'MZ', name: 'Mozambique', dial: '258', digits: 9 },
  { flag: '🇲🇲', code: 'MM', name: 'Myanmar', dial: '95', digits: 9 },
  { flag: '🇳🇦', code: 'NA', name: 'Namibia', dial: '264', digits: 9 },
  { flag: '🇳🇷', code: 'NR', name: 'Nauru', dial: '674', digits: 7 },
  { flag: '🇳🇵', code: 'NP', name: 'Nepal', dial: '977', digits: 10 },
  { flag: '🇳🇱', code: 'NL', name: 'Netherlands', dial: '31', digits: 9 },
  { flag: '🇳🇿', code: 'NZ', name: 'New Zealand', dial: '64', digits: 9 },
  { flag: '🇳🇮', code: 'NI', name: 'Nicaragua', dial: '505', digits: 8 },
  { flag: '🇳🇪', code: 'NE', name: 'Niger', dial: '227', digits: 8 },
  { flag: '🇳🇬', code: 'NG', name: 'Nigeria', dial: '234', digits: 10 },
  { flag: '🇰🇵', code: 'KP', name: 'North Korea', dial: '850', digits: 10 },
  { flag: '🇳🇴', code: 'NO', name: 'Norway', dial: '47', digits: 8 },
  { flag: '🇵🇰', code: 'PK', name: 'Pakistan', dial: '92', digits: 10 },
  { flag: '🇵🇼', code: 'PW', name: 'Palau', dial: '680', digits: 7 },
  { flag: '🇵🇸', code: 'PS', name: 'Palestine', dial: '970', digits: 9 },
  { flag: '🇵🇦', code: 'PA', name: 'Panama', dial: '507', digits: 8 },
  { flag: '🇵🇬', code: 'PG', name: 'Papua New Guinea', dial: '675', digits: 8 },
  { flag: '🇵🇾', code: 'PY', name: 'Paraguay', dial: '595', digits: 9 },
  { flag: '🇵🇪', code: 'PE', name: 'Peru', dial: '51', digits: 9 },
  { flag: '🇵🇭', code: 'PH', name: 'Philippines', dial: '63', digits: 10 },
  { flag: '🇵🇱', code: 'PL', name: 'Poland', dial: '48', digits: 9 },
  { flag: '🇵🇹', code: 'PT', name: 'Portugal', dial: '351', digits: 9 },
  { flag: '🇵🇷', code: 'PR', name: 'Puerto Rico', dial: '1', digits: 10 },
  { flag: '🇷🇴', code: 'RO', name: 'Romania', dial: '40', digits: 9 },
  { flag: '🇷🇺', code: 'RU', name: 'Russia', dial: '7', digits: 10 },
  { flag: '🇷🇼', code: 'RW', name: 'Rwanda', dial: '250', digits: 9 },
  { flag: '🇼🇸', code: 'WS', name: 'Samoa', dial: '685', digits: 7 },
  { flag: '🇸🇲', code: 'SM', name: 'San Marino', dial: '378', digits: 10 },
  { flag: '🇸🇳', code: 'SN', name: 'Senegal', dial: '221', digits: 9 },
  { flag: '🇷🇸', code: 'RS', name: 'Serbia', dial: '381', digits: 9 },
  { flag: '🇸🇨', code: 'SC', name: 'Seychelles', dial: '248', digits: 7 },
  { flag: '🇸🇱', code: 'SL', name: 'Sierra Leone', dial: '232', digits: 8 },
  { flag: '🇸🇬', code: 'SG', name: 'Singapore', dial: '65', digits: 8 },
  { flag: '🇸🇰', code: 'SK', name: 'Slovakia', dial: '421', digits: 9 },
  { flag: '🇸🇮', code: 'SI', name: 'Slovenia', dial: '386', digits: 8 },
  { flag: '🇸🇧', code: 'SB', name: 'Solomon Islands', dial: '677', digits: 7 },
  { flag: '🇸🇴', code: 'SO', name: 'Somalia', dial: '252', digits: 8 },
  { flag: '🇿🇦', code: 'ZA', name: 'South Africa', dial: '27', digits: 9 },
  { flag: '🇸🇸', code: 'SS', name: 'South Sudan', dial: '211', digits: 9 },
  { flag: '🇪🇸', code: 'ES', name: 'Spain', dial: '34', digits: 9 },
  { flag: '🇸🇩', code: 'SD', name: 'Sudan', dial: '249', digits: 9 },
  { flag: '🇸🇷', code: 'SR', name: 'Suriname', dial: '597', digits: 7 },
  { flag: '🇸🇪', code: 'SE', name: 'Sweden', dial: '46', digits: 9 },
  { flag: '🇨🇭', code: 'CH', name: 'Switzerland', dial: '41', digits: 9 },
  { flag: '🇸🇾', code: 'SY', name: 'Syria', dial: '963', digits: 9 },
  { flag: '🇹🇼', code: 'TW', name: 'Taiwan', dial: '886', digits: 9 },
  { flag: '🇹🇯', code: 'TJ', name: 'Tajikistan', dial: '992', digits: 9 },
  { flag: '🇹🇿', code: 'TZ', name: 'Tanzania', dial: '255', digits: 9 },
  { flag: '🇹🇭', code: 'TH', name: 'Thailand', dial: '66', digits: 9 },
  { flag: '🇹🇱', code: 'TL', name: 'Timor-Leste', dial: '670', digits: 8 },
  { flag: '🇹🇬', code: 'TG', name: 'Togo', dial: '228', digits: 8 },
  { flag: '🇹🇴', code: 'TO', name: 'Tonga', dial: '676', digits: 7 },
  { flag: '🇹🇹', code: 'TT', name: 'Trinidad and Tobago', dial: '1', digits: 10 },
  { flag: '🇹🇳', code: 'TN', name: 'Tunisia', dial: '216', digits: 8 },
  { flag: '🇹🇷', code: 'TR', name: 'Turkey', dial: '90', digits: 10 },
  { flag: '🇹🇲', code: 'TM', name: 'Turkmenistan', dial: '993', digits: 8 },
  { flag: '🇹🇻', code: 'TV', name: 'Tuvalu', dial: '688', digits: 6 },
  { flag: '🇺🇬', code: 'UG', name: 'Uganda', dial: '256', digits: 9 },
  { flag: '🇺🇦', code: 'UA', name: 'Ukraine', dial: '380', digits: 9 },
  { flag: '🇺🇾', code: 'UY', name: 'Uruguay', dial: '598', digits: 8 },
  { flag: '🇺🇿', code: 'UZ', name: 'Uzbekistan', dial: '998', digits: 9 },
  { flag: '🇻🇺', code: 'VU', name: 'Vanuatu', dial: '678', digits: 7 },
  { flag: '🇻🇦', code: 'VA', name: 'Vatican City', dial: '39', digits: 10 },
  { flag: '🇻🇪', code: 'VE', name: 'Venezuela', dial: '58', digits: 10 },
  { flag: '🇻🇳', code: 'VN', name: 'Vietnam', dial: '84', digits: 9 },
  { flag: '🇾🇪', code: 'YE', name: 'Yemen', dial: '967', digits: 9 },
  { flag: '🇿🇲', code: 'ZM', name: 'Zambia', dial: '260', digits: 9 },
  { flag: '🇿🇼', code: 'ZW', name: 'Zimbabwe', dial: '263', digits: 9 },
]

// ── Detection helper ─────────────────────────────────────────
// Tries to extract dial code + local part from any pasted string.
// Returns null if confidence is too low — caller falls back to the
// currently-selected country dial code in the dropdown.
//
// IMPORTANT: we ONLY auto-detect when the paste has an explicit
// international prefix (+ or 00). Without that signal, a bare local
// number like "72 309 2676" would falsely match dial '7' (Russia/
// Kazakhstan), strip the leading '7', and save '723092676' with no
// SL country code — breaking every WhatsApp link from there on.
//
// Now also handles pastes where the number is embedded inside other
// text (e.g. "Call me on +44 20 7946 0958 thanks") — we scan the
// string for a "+xx" or "00xx" pattern first, then fall back to the
// original "starts-with-+" check for backward compatibility.
export function detectCountryFromPaste(text: string): { dial: string; local: string } | null {
  if (!text) return null
  const cleaned = text.trim()

  let digits = ''
  let hasIntlPrefix = false

  // ── Pass 1: find a "+XX..." anywhere in the pasted text ────
  // Matches +, then 7-25 chars of digits/spaces/-/.()
  const plusMatch = cleaned.match(/\+(\d[\d\s\-().]{6,25})/)
  if (plusMatch) {
    digits = plusMatch[1].replace(/\D/g, '')
    hasIntlPrefix = true
  }

  // ── Pass 2: find a "00XX..." anywhere in the pasted text ───
  if (!hasIntlPrefix) {
    const zeroMatch = cleaned.match(/(?:^|[^\d])00(\d[\d\s\-().]{6,25})/)
    if (zeroMatch) {
      digits = zeroMatch[1].replace(/\D/g, '')
      hasIntlPrefix = true
    }
  }

  // ── Pass 3: legacy fallback — paste is just digits with + at start ──
  if (!hasIntlPrefix) {
    const digitsRaw = cleaned.replace(/\D/g, '')
    if (digitsRaw.length < 6) return null
    const hasPlusPrefix = /^\s*\+/.test(cleaned)
    if (digitsRaw.startsWith('00')) {
      digits = digitsRaw.slice(2)
      hasIntlPrefix = true
    } else if (hasPlusPrefix) {
      digits = digitsRaw
      hasIntlPrefix = true
    }
  }

  // No clear international prefix → don't guess. Caller will use the
  // dropdown's selected country dial code (defaults to Sri Lanka 94).
  if (!hasIntlPrefix) return null
  if (digits.length < 7) return null

  // Sort longest dial first so "971" is tried before "97" (none) and "9"
  // (none), and "1" doesn't accidentally swallow other countries' numbers.
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.dial.length - a.dial.length)

  for (const cc of sorted) {
    if (digits.startsWith(cc.dial)) {
      const local = digits.slice(cc.dial.length)
      // Local part should be 6–12 digits to count as a real phone number
      if (local.length >= 6 && local.length <= 12) {
        return { dial: cc.dial, local }
      }
    }
  }

  return null
}

// ── Display formatter ─────────────────────────────────────────
// Stored phones are bare international digits like "94777887542" or
// "442079460958". For the UI we want to show "+94 77 788 7542" or
// "+44 20 7946 0958" so the country is obvious to the agent.
//
// We split the dial code first (longest match wins, same algo as
// detectCountryFromPaste), then group the local part in chunks of
// 3-4 digits from the right for readability. If we can't match a
// dial code, we just prefix '+' and return the digits unchanged.
export function formatPhoneDisplay(phone: string): string {
  if (!phone) return ''
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (!digits) return ''

  const sorted = [...COUNTRY_CODES].sort((a, b) => b.dial.length - a.dial.length)
  for (const cc of sorted) {
    if (digits.startsWith(cc.dial)) {
      const local = digits.slice(cc.dial.length)
      if (local.length >= 6 && local.length <= 14) {
        // Group in 3s from the right, leaving a 2-4 digit head
        let grouped = ''
        let rest = local
        while (rest.length > 4) {
          grouped = ' ' + rest.slice(-3) + grouped
          rest = rest.slice(0, -3)
        }
        grouped = rest + grouped
        return `+${cc.dial} ${grouped}`
      }
    }
  }
  // Fallback — just prefix +
  return `+${digits}`
}
