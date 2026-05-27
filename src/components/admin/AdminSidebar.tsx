'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, ClipboardList, History,
  MapPin, Briefcase, UserPlus, BarChart2,
  CalendarRange, ShieldCheck, Settings, LogOut,
  Bell, DollarSign, Target, Archive, MessageSquare, MessageCircle, AlertOctagon,
  Wallet, Megaphone, Eye, Headphones,
} from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'


const TABS = [
  { href: '/admin', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/admin/inspector', icon: Eye, label: 'Inspector' },
  { href: '/admin/crm-entries', icon: History, label: 'CRM Entries' },
  { href: '/admin/leads', icon: Megaphone, label: 'Lead Distribution' },
  { href: '/admin/orders', icon: ClipboardList, label: 'Orders' },
  { href: '/dashboard/legacy-history', icon: Archive, label: 'Legacy History' },
  { href: '/admin/workers', icon: Users, label: 'Workers' },
  { href: '/admin/attendance', icon: CalendarRange, label: 'Attendance' },
  { href: '/admin/approvals', icon: ShieldCheck, label: 'Approvals', badge: true },
  { href: '/admin/complaints', icon: AlertOctagon, label: 'Complaints', badge: true },
  { href: '/admin/commission-rates', icon: DollarSign, label: 'Commission Rates' },
  { href: '/admin/accounts', icon: Wallet, label: 'Accounts' },
  { href: '/admin/targets-rewards', icon: Target, label: 'Targets & Rewards' },
  { href: '/admin/packages', icon: Briefcase, label: 'Packages' },
  { href: '/admin/tasks', icon: ClipboardList, label: 'Tasks' },
  { href: '/admin/calendar', icon: CalendarRange, label: 'Calendar' },
  { href: '/admin/alerts', icon: Bell, label: 'Overdue Alerts', badge: true },
  { href: '/admin/locations', icon: MapPin, label: 'Locations' },
  { href: '/admin/add-worker', icon: UserPlus, label: 'Add Worker' },
  { href: '/admin/settings', icon: Settings, label: 'Settings' },
  { href: '/admin/whatsapp', icon: MessageCircle, label: 'WhatsApp' },
  { href: '/admin/whatsapp/delivery', icon: BarChart2, label: 'WA Delivery' },
  { href: '/admin/whatsapp/support', icon: Headphones, label: 'WA Support' },  // ← add this
  // Notifications now points to the index (redirects to SMS Logs by default).
  // The notifications section has its own sub-tabs: SMS Logs · Cron Status · Worker Phones.
  { href: '/admin/notifications', icon: MessageSquare, label: 'Notifications' },
]

export default function AdminSidebar() {
  const pathname = usePathname()
  const { clear, role } = useAuthStore()

  // Accountants only ever see the Accounts world. Admins see everything.
  const visibleTabs =
    role === 'accountant'
      ? TABS.filter((t) => t.href === '/admin/accounts')
      : TABS

  const handleLogout = async () => {
    // Clear the local store FIRST so no stale admin role survives the
    // redirect, then sign out, then hard-navigate to login. Using a full
    // location replace (not router) guarantees a clean reload with no
    // lingering client state that could bounce back into admin.
    clear()
    await supabase.auth.signOut()
    window.location.replace('/auth/login')
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
            <p className="text-pink-600 font-bold text-sm tracking-tight italic">{role === 'accountant' ? 'Emma Accounts' : 'Emma Admin'}</p>
            <p className="text-gray-400 text-[9px] font-medium">{role === 'accountant' ? 'Accounting panel' : 'Management panel'}</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {visibleTabs.map(({ href, icon: Icon, label, badge }) => {
          // For the Notifications top-level entry, mark it active for ANY
          // /admin/notifications/* sub-route too.
          const active =
            href === '/admin/notifications'
              ? pathname.startsWith('/admin/notifications')
              : href === '/admin/leads'
                ? pathname.startsWith('/admin/leads')
                : href === '/admin/accounts'
                  ? pathname.startsWith('/admin/accounts')
                  : href === '/admin/inspector'
                    ? pathname.startsWith('/admin/inspector')
                    : pathname === href
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