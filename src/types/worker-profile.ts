// ─── Add to src/types/index.ts after the existing types ───────────────────────
// Paste this block at the bottom of types/index.ts

export interface WorkerProfile {
  id?: string
  user_id: string
  emp_no?: string
  full_name?: string
  date_of_birth?: string
  nic_number?: string
  contact_number?: string
  email_address?: string
  residential_address?: string
  marital_status?: 'Single' | 'Married' | 'Divorced' | 'Widowed'
  job_title?: string
  job_role?: string
  employment_type?: 'Full-time' | 'Part-time' | 'Contract'
  date_of_hire?: string
  work_location?: string
  basic_salary_expect?: number
  overtime_eligible?: boolean
  epf_number?: string
  etf_number?: string
  bank_name?: string
  branch_name?: string
  account_number?: string
  emergency_contact_name?: string
  emergency_relationship?: string
  emergency_contact_number?: string
  highest_education?: string
  professional_certs?: string
  languages_spoken?: string
  skills_competencies?: string
  // Document URLs — stored in account-slips bucket under worker-docs/{userId}/
  nic_front_url?: string
  nic_back_url?: string
  proof_of_address_url?: string
  employee_photo_url?: string
  bank_passbook_url?: string
  educational_certs_url?: string
  birth_certificate_url?: string
  service_letters_url?: string
  appointment_letter_url?: string
  other_document_url?: string
  // Admin-managed
  is_hidden?: boolean
  profile_completed_at?: string
  updated_at?: string
  created_at?: string
}
