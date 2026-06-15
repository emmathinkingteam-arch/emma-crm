'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, ClipboardList, History,
  MapPin, Briefcase, UserPlus, BarChart2,
  CalendarRange, ShieldCheck, Settings, LogOut,
  Bell, DollarSign, Target, Archive, MessageSquare, MessageCircle, AlertOctagon,
  Wallet, Megaphone, Eye, Headphones, FileSignature,
} from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'


type Tab = { href: string; icon: any; label: string; badge?: boolean }
type Section = { title: string; items: Tab[] }

const SECTIONS: Section[] = [
  {
    title: 'Overview',
    items: [
      { href: '/admin', icon: LayoutDashboard, label: 'Dashboard' },
      { href: '/admin/inspector', icon: Eye, label: 'Inspector' },
      { href: '/admin/alerts', icon: Bell, label: 'Overdue Alerts', badge: true },
    ],
  },
  {
    title: 'CRM',
    items: [
      { href: '/admin/crm-entries', icon: History, label: 'CRM Entries' },
      { href: '/admin/leads', icon: Megaphone, label: 'Lead Distribution' },
      { href: '/admin/orders', icon: ClipboardList, label: 'Orders' },
      { href: '/dashboard/legacy-history', icon: Archive, label: 'Legacy History' },
      { href: '/admin/approvals', icon: ShieldCheck, label: 'Approvals', badge: true },
      { href: '/admin/complaints', icon: AlertOctagon, label: 'Complaints', badge: true },
    ],
  },
  {
    title: 'Team',
    items: [
      { href: '/admin/workers', icon: Users, label: 'Workers' },
      { href: '/admin/attendance', icon: CalendarRange, label: 'Attendance' },
      { href: '/admin/tasks', icon: ClipboardList, label: 'Tasks' },
      { href: '/admin/calendar', icon: CalendarRange, label: 'Calendar' },
      { href: '/admin/locations', icon: MapPin, label: 'Locations' },
      { href: '/admin/add-worker', icon: UserPlus, label: 'Add Worker' },
    ],
  },
  {
    title: 'Documents',
    items: [
      { href: '/admin/documents', icon: FileSignature, label: 'E-Sign' },
    ],
  },
  {
    title: 'Finance',
    items: [
      { href: '/admin/accounts', icon: Wallet, label: 'Accounts' },
      { href: '/admin/commission-rates', icon: DollarSign, label: 'Commission Rates' },
      { href: '/admin/targets-rewards', icon: Target, label: 'Targets & Rewards' },
    ],
  },
  {
    title: 'Config',
    items: [
      { href: '/admin/packages', icon: Briefcase, label: 'Packages' },
      { href: '/admin/whatsapp', icon: MessageCircle, label: 'WhatsApp' },
      { href: '/admin/whatsapp/delivery', icon: BarChart2, label: 'WA Delivery' },
      { href: '/admin/whatsapp/support', icon: Headphones, label: 'WA Support' },
      { href: '/admin/whatsapp/complaints', icon: AlertOctagon, label: 'WA Complaints' },
      { href: '/admin/notifications', icon: MessageSquare, label: 'Notifications' },
      { href: '/admin/settings', icon: Settings, label: 'Settings' },
    ],
  },
]

// flat list kept for accountant/CEO filter
const TABS = SECTIONS.flatMap(s => s.items)

export default function AdminSidebar() {
  const pathname = usePathname()
  const { clear, role } = useAuthStore()

  const visibleTabs =
    role === 'accountant' || role === 'ceo'
      ? TABS.filter((t) => t.href.startsWith('/admin/accounts'))
      : TABS

  const handleLogout = async () => {
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
            <p className="text-pink-600 font-bold text-sm tracking-tight italic">{role === 'accountant' ? 'Emma Accounts' : role === 'ceo' ? 'Emma CEO' : 'Emma Admin'}</p>
            <p className="text-gray-400 text-[9px] font-medium">{role === 'accountant' ? 'Accounting panel' : role === 'ceo' ? 'CEO panel' : 'Management panel'}</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {(role === 'accountant' || role === 'ceo'
          ? SECTIONS.filter(s => s.items.some(t => t.href.startsWith('/admin/accounts')))
          : SECTIONS
        ).map((section, si) => {
          const items = role === 'accountant' || role === 'ceo'
            ? section.items.filter(t => t.href.startsWith('/admin/accounts'))
            : section.items
          if (items.length === 0) return null
          return (
            <div key={section.title} className={si > 0 ? 'mt-3' : ''}>
              <p className="px-3 mb-1 text-[8px] font-bold text-gray-300 uppercase tracking-widest">{section.title}</p>
              <div className="space-y-0.5">
                {items.map(({ href, icon: Icon, label, badge }) => {
                  const active =
                    href === '/admin/notifications'
                      ? pathname.startsWith('/admin/notifications')
                      : href === '/admin/leads'
                        ? pathname.startsWith('/admin/leads')
                        : href === '/admin/accounts'
                          ? pathname.startsWith('/admin/accounts')
                          : href === '/admin/inspector'
                            ? pathname.startsWith('/admin/inspector')
                            : href === '/admin/workers'
                              ? pathname.startsWith('/admin/workers')
                              : href === '/admin/documents'
                                ? pathname.startsWith('/admin/documents')
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
              </div>
            </div>
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