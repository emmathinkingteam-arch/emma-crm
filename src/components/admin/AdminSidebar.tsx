'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRouter } from 'next/navigation'
import {
  LayoutDashboard, Users, ClipboardList, History,
  MapPin, Briefcase, UserPlus, BarChart2,
  CalendarRange, ShieldCheck, Settings, LogOut,
  Bell, DollarSign, Target
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'

const TABS = [
  { href: '/admin',                    icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/admin/crm-entries',        icon: History,         label: 'CRM Entries' },
  { href: '/admin/orders',             icon: ClipboardList,   label: 'Orders' },
  { href: '/admin/workers',            icon: Users,           label: 'Workers' },
  { href: '/admin/attendance',         icon: CalendarRange,   label: 'Attendance' },
  { href: '/admin/approvals',          icon: ShieldCheck,     label: 'Approvals', badge: true },
  { href: '/admin/commission-rates',   icon: DollarSign,      label: 'Commission Rates' },
  { href: '/admin/targets-rewards',    icon: Target,          label: 'Targets & Rewards' },
  { href: '/admin/packages',           icon: Briefcase,       label: 'Packages' },
  { href: '/admin/tasks',              icon: ClipboardList,   label: 'Tasks' },
  { href: '/admin/calendar',           icon: CalendarRange,   label: 'Calendar' },
  { href: '/admin/alerts',             icon: Bell,            label: 'Overdue Alerts', badge: true },
  { href: '/admin/locations',          icon: MapPin,          label: 'Locations' },
  { href: '/admin/add-worker',         icon: UserPlus,        label: 'Add Worker' },
  { href: '/admin/settings',           icon: Settings,        label: 'Settings' },
]

export default function AdminSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { clear } = useAuthStore()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    clear()
    router.replace('/auth/login')
  }

  return (
    <aside className="w-56 bg-white border-r border-gray-100 flex flex-col h-screen sticky top-0 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-5 border-b border-pink-50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-pink-600 rounded-xl flex items-center justify-center">
            <span className="text-white font-bold text-xs">E</span>
          </div>
          <div>
            <p className="text-pink-600 font-bold text-sm tracking-tight italic">Emma Admin</p>
            <p className="text-gray-400 text-[9px] font-medium">Management panel</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {TABS.map(({ href, icon: Icon, label, badge }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all
                ${active
                  ? 'bg-pink-50 text-pink-600 border-l-2 border-pink-600'
                  : 'text-gray-400 hover:bg-gray-50 border-l-2 border-transparent'}`}
            >
              <div className="flex items-center gap-2.5">
                <Icon size={15} />
                {label}
              </div>
              {badge && (
                <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
              )}
            </Link>
          )
        })}
      </nav>

      {/* Logout */}
      <div className="px-2 py-3 border-t border-gray-50">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all"
        >
          <LogOut size={15} />
          Logout
        </button>
      </div>
    </aside>
  )
}
