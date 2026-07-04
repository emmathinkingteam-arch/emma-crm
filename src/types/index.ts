// ═══════════════════════════════════════════════════════════
// EMMA THINKING CRM — All Types
// ═══════════════════════════════════════════════════════════

export type UserRole =
  | 'admin'
  | 'crm_agent'
  | 'back_office'
  | 'counselor'
  | 'manager'
  | 'designer'
  | 'accountant'
  | 'ceo'

export type OrderStatus = 'draft' | 'active' | 'expired' | 'cancelled'
export type StepStatus = 'pending' | 'in_progress' | 'done' | 'overdue' | 'rejected'
export type AttendanceStatus = 'present' | 'late' | 'absent' | 'approved_leave' | 'holiday'
export type PaymentType = 'cash' | 'bank_transfer' | 'card' | 'koko' | 'other'
export type LeaveType = 'annual' | 'casual' | 'sick' | 'other'
export type RequestStatus = 'pending' | 'approved' | 'rejected'
export type MilestoneType = 'wallet_balance' | 'order_count' | 'package_specific' | 'daily_entry' | 'custom'
export type TimeSlot = 'W' | 'X' | 'Y' | 'Z' // four daily sittings; clock time varies by weekday/weekend — see getSlotLabel
export type FlowVariant = 'standard' | 'silver_bronze' | 'free'

// ── Database row types ───────────────────────────────────────

export interface User {
  id: string
  auth_user_id: string
  username: string
  full_name: string
  role: UserRole
  agent_code?: string
  meeting_link?: string
  profile_photo_url?: string
  phone_number?: string
  address?: string
  birthday?: string
  employee_id?: string
  commission_rates: Record<string, number> // { packageId: amount }
  wallet_balance: number
  is_permanent: boolean
  annual_leaves_remaining: number
  casual_leaves_remaining: number
  work_start_time: string
  is_active: boolean
  is_supervisor?: boolean
  created_at: string
}

export interface Package {
  id: string
  name: string
  tier: string
  flow_variant: FlowVariant
  price: number
  process_validity_days: number
  post_validity_days: number
  second_pass_eligible: boolean
  is_active: boolean
  created_at: string
}

export interface Customer {
  id: string
  phone: string
  name?: string
  title?: string        // honorific: 'Mr.' | 'Miss.' — used to address the customer in the confirmation SMS
  is_priority: boolean
  notes?: string
  created_by: string
  created_at: string
  // joined
  created_by_user?: User
}

export interface Order {
  id: string
  customer_id: string
  package_id: string
  current_step: number // 2–6
  step_variant: FlowVariant
  pass_number: number // 1 or 2
  status: OrderStatus
  amount_paid: number
  payment_type: PaymentType
  payment_slip_url?: string
  invoice_html?: string
  validity_expires_at?: string
  planned_post_date?: string
  post_image_url?: string
  published_at?: string
  created_by: string
  created_at: string
  // joined
  customer?: Customer
  package?: Package
  current_step_row?: OrderStep
}

export interface OrderStep {
  id: string
  order_id: string
  step_number: number
  sub_step?: string
  step_name: string
  assigned_to?: string
  started_at?: string
  completed_at?: string
  deadline?: string
  extended_deadline?: string
  extension_reason?: string
  extended_by_days?: number
  description?: string
  brief_version: number
  planned_post_date?: string
  status: StepStatus
  is_overdue: boolean
  is_late_completion: boolean
  created_at: string
  // joined
  assigned_user?: User
}

export interface Interaction {
  id: string
  customer_id: string
  type: 'message' | 'call' | 'feedback' | 'order'
  description: string
  tags?: string[]        // structured quick-status tags — see lib/crm-tags.ts
  created_by: string
  created_at: string
  created_by_user?: User
}

export interface Attendance {
  id: string
  user_id: string
  date: string
  punch_in?: string
  punch_in_lat?: number
  punch_in_lng?: number
  punch_out?: string
  punch_out_lat?: number
  punch_out_lng?: number
  hours_worked?: number
  lunch_start?: string
  lunch_end?: string
  status: AttendanceStatus
  note?: string
  user?: User
}

export interface LeaveRequest {
  id: string
  user_id: string
  leave_date: string
  leave_type: LeaveType
  reason: string
  status: RequestStatus
  reviewed_by?: string
  reviewed_at?: string
  review_note?: string
  created_at: string
  user?: User
  reviewer?: User
}

export interface OTRequest {
  id: string
  user_id: string
  ot_date: string
  ot_hours: number
  reason: string
  status: RequestStatus
  reviewed_by?: string
  reviewed_at?: string
  review_note?: string
  created_at: string
  user?: User
}

export interface Commission {
  id: string
  user_id: string
  order_id: string
  package_id: string
  step_number: number
  amount: number
  earned_at: string
  month_year: string
  order?: Order
  package?: Package
}

export interface MonthlyTarget {
  id: string
  user_id: string
  month_year: string
  target_amount: number
  set_by: string
  created_at: string
}

export interface SalaryPayment {
  id: string
  user_id: string
  amount_paid: number
  month_year: string
  paid_at: string
  paid_by: string
  note?: string
}

export interface RewardMilestone {
  id: string
  user_id: string
  title: string
  milestone_type: MilestoneType
  package_id?: string
  target_value: number
  gift_description: string
  is_active: boolean
  reached_at?: string
  created_by: string
  created_at: string
  user?: User
  package?: Package
}

export interface CalendarSlot {
  id: string
  order_id: string
  order_step_id?: string
  slot_date: string
  slot_time: TimeSlot
  post_id_code: string // e.g. L/26/H/D1/W
  assigned_to?: string
  planned_at: string
  published_at?: string
  validity_expires_at?: string
  order?: Order
  designer?: User
}

// Client feedback planned into an FR Plan slot (no order behind it).
// The artwork is generated by api/generate-feedback.py from the four
// Girltemp/Boytemp templates.
export interface FeedbackPost {
  id: string
  display_name: string
  body: string
  template: string // girltemp1 | girltemp2 | boytemp1 | boytemp2
  post_link?: string
  image_url?: string
  screenshot_urls: string[]
  slot_date: string
  slot_time: TimeSlot
  post_id_code?: string
  created_by?: string
  created_at: string
}

export interface Task {
  id: string
  assigned_to: string
  assigned_by: string
  title: string
  description?: string
  deadline: string
  status: 'active' | 'done'
  completed_at?: string
  created_at: string
  assignee?: User
  assigner?: User
}

// ── Utility types ─────────────────────────────────────────────

export interface WaMessageParams {
  phone: string
  message: string
}

export interface CalendarCell {
  date: string
  slot: TimeSlot
  entry?: CalendarSlot
}

// Post ID code builder
// Format: L/[year2d]/[agentCode]/[monthCode][day]/[timeSlot]
// Month codes: A=Jan B=Feb C=Mar D=Apr E=May F=Jun G=Jul H=Aug I=Sep J=Oct K=Nov L=Dec
export const MONTH_CODES: Record<number, string> = {
  1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E', 6: 'F',
  7: 'G', 8: 'H', 9: 'I', 10: 'J', 11: 'K', 12: 'L'
}

// W/X/Y/Z are the four daily sittings, but the actual clock time depends on the
// day of week:
//   Mon–Fri : 8:30am · 11:30am · 1:30pm · 7:00pm
//   Saturday: 9:00am · 12:00pm · 2:00pm · 8:00pm
//   Sunday  : 10:00am · 1:00pm · 3:00pm · 7:00pm
const SLOT_ORDER: TimeSlot[] = ['W', 'X', 'Y', 'Z']
const WEEKDAY_SLOT_TIMES = ['8:30am', '11:30am', '1:30pm', '7:00pm']
const SATURDAY_SLOT_TIMES = ['9:00am', '12:00pm', '2:00pm', '8:00pm']
const SUNDAY_SLOT_TIMES = ['10:00am', '1:00pm', '3:00pm', '7:00pm']

// Day of week (0=Sun..6=Sat) for a 'YYYY-MM-DD' string, parsed in LOCAL time so
// it never drifts a day versus a UTC interpretation.
function slotDayOfWeek(date?: string | Date | null): number {
  if (!date) return 1 // no date → treat as a weekday
  if (date instanceof Date) return date.getDay()
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return 1
  return new Date(y, m - 1, d).getDay()
}

// Clock-time label for a slot on a given date. With no date it falls back to the
// weekday schedule (used for generic row headers that span multiple days).
export function getSlotLabel(slot: TimeSlot | string, date?: string | Date | null): string {
  const idx = SLOT_ORDER.indexOf(slot as TimeSlot)
  if (idx === -1) return ''
  const dow = slotDayOfWeek(date)
  const times = dow === 0 ? SUNDAY_SLOT_TIMES : dow === 6 ? SATURDAY_SLOT_TIMES : WEEKDAY_SLOT_TIMES
  return times[idx]
}

// Kept for backwards-compatible imports; defaults to the weekday schedule.
export const TIME_SLOT_LABELS: Record<TimeSlot, string> = {
  W: WEEKDAY_SLOT_TIMES[0], X: WEEKDAY_SLOT_TIMES[1], Y: WEEKDAY_SLOT_TIMES[2], Z: WEEKDAY_SLOT_TIMES[3]
}

// Absolute instant (ISO string) for a slot on a given 'YYYY-MM-DD' date, using
// the slot's clock time in Sri Lanka time (UTC+5:30, no DST). Used to schedule
// Facebook posts at the real slot time instead of midnight. Returns null if the
// date or slot can't be resolved.
export function slotInstantISO(slot: TimeSlot | string, date?: string | null): string | null {
  if (!date) return null
  const [y, mo, d] = date.split('-').map(Number)
  if (!y || !mo || !d) return null
  const label = getSlotLabel(slot, date) // e.g. '7:00pm'
  const m = label.match(/^(\d{1,2}):(\d{2})(am|pm)$/i)
  if (!m) return null
  let hh = Number(m[1]) % 12
  if (m[3].toLowerCase() === 'pm') hh += 12
  const mm = Number(m[2])
  // Sri Lanka = UTC+5:30 → subtract to get the UTC instant for that local time.
  const utcMs = Date.UTC(y, mo - 1, d, hh, mm) - (5 * 60 + 30) * 60 * 1000
  return new Date(utcMs).toISOString()
}
// ── Legacy Invoices (from old Kalpani Back Office) ──

export interface LegacyInvoice {
  id: string
  customer_name: string
  phone_number: string | null
  invoice_date: string | null
  invoice_number: string
  slip_number: string | null
  payment_method: string | null
  service_date: string | null
  package_name: string | null
  description: string | null
  total_amount: number | null
  invoice_link: string | null
  payment_slip_link: string | null
  first_post_code: string | null
  first_post_content: string | null
  second_post_code: string | null
  second_post_content: string | null
  sent_number_1: string | null
  sent_number_2: string | null
  sent_number_3: string | null
  sent_number_4: string | null
  sent_number_5: string | null
  sent_number_6: string | null
  sent_number_7: string | null
  sent_number_8: string | null
  sent_number_9: string | null
  sent_number_10: string | null
  sent_number_11: string | null
  sent_number_12: string | null
  sent_number_13: string | null
  sent_number_14: string | null
  sent_number_15: string | null
  sent_number_16: string | null
  sent_number_17: string | null
  sent_number_18: string | null
  numbers_sent_count: number
  imported_at: string
}

// ═══════════════════════════════════════════════════════════
// Accounts module types (appended)
// ═══════════════════════════════════════════════════════════

export type LedgerType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

export interface AccLedger {
  id: string
  code: string
  name: string
  type: LedgerType
  is_bank: boolean
  currency: string
  parent_id?: string | null
  opening_balance: number
  sort_order: number
  is_active: boolean
  created_at: string
}

export interface AccCategory {
  id: string
  name: string
  parent_id?: string | null
  ledger_id: string
  is_active: boolean
  sort_order: number
  // joined
  parent?: AccCategory
  ledger?: AccLedger
}

export type AccEntryType =
  | 'expense'
  | 'customer_payment'
  | 'other_income'
  | 'transfer'
  | 'salary'
  | 'wallet'
  | 'penalty'
  | 'owner_capital'
  | 'bank_fee'
  | 'adjustment'
  | 'opening'

export interface AccEntry {
  id: string
  entry_date: string
  description: string
  entry_type: AccEntryType
  category_id?: string | null
  order_id?: string | null
  customer_id?: string | null
  worker_id?: string | null
  status: 'draft' | 'pending' | 'posted' | 'void'
  period_month?: string
  created_by?: string | null
  approved_by?: string | null
  created_at: string
  // joined
  lines?: AccLine[]
  attachments?: AccAttachment[]
  category?: AccCategory
}

export interface AccLine {
  id: string
  entry_id: string
  ledger_id: string
  debit: number
  credit: number
  memo?: string | null
  ledger?: AccLedger
}

export interface AccAttachment {
  id: string
  entry_id: string
  drive_url: string
  drive_file_id?: string | null
  file_name?: string | null
  kind: 'expense_slip' | 'income_slip' | 'bank_statement' | 'other'
  uploaded_by?: string | null
  uploaded_at: string
}

export type WalletTxnType =
  | 'earning'
  | 'penalty'
  | 'advance'
  | 'salary_payout'
  | 'bonus'
  | 'adjustment'
  | 'month_reset'

export interface AccWalletTxn {
  id: string
  user_id: string
  txn_type: WalletTxnType
  amount: number
  balance_after?: number | null
  month_year: string
  ref_entry_id?: string | null
  ref_commission_id?: string | null
  ref_salary_id?: string | null
  ref_order_step_id?: string | null
  note?: string | null
  created_by?: string | null
  created_at: string
  // joined
  user?: User
}