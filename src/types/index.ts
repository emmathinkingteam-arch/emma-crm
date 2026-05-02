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

export type OrderStatus = 'draft' | 'active' | 'expired' | 'cancelled'
export type StepStatus = 'pending' | 'in_progress' | 'done' | 'overdue' | 'rejected'
export type AttendanceStatus = 'present' | 'late' | 'absent' | 'approved_leave' | 'holiday'
export type PaymentType = 'cash' | 'bank_transfer' | 'card' | 'koko' | 'other'
export type LeaveType = 'annual' | 'casual' | 'sick' | 'other'
export type RequestStatus = 'pending' | 'approved' | 'rejected'
export type MilestoneType = 'wallet_balance' | 'order_count' | 'package_specific' | 'daily_entry' | 'custom'
export type TimeSlot = 'W' | 'X' | 'Y' | 'Z' // W=6:30am X=11:30am Y=3:30pm Z=8:30pm
export type FlowVariant = 'standard' | 'silver_bronze'

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
  1:'A', 2:'B', 3:'C', 4:'D', 5:'E', 6:'F',
  7:'G', 8:'H', 9:'I', 10:'J', 11:'K', 12:'L'
}

export const TIME_SLOT_LABELS: Record<TimeSlot, string> = {
  W: '6:30am', X: '11:30am', Y: '3:30pm', Z: '8:30pm'
}
