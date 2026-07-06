'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, ClipboardList, History,
  MapPin, Briefcase, UserPlus, BarChart2,
  CalendarRange, ShieldCheck, Settings, LogOut,
  Bell, DollarSign, Target, Archive, MessageSquare, MessageCircle, MessagesSquare, AlertOctagon,
  Wallet, Megaphone, Eye, Headphones, FileSignature, Facebook, ReceiptText, Sparkles,
  UserCircle2, Menu, X,
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
      { href: '/admin/orders/slips', icon: ReceiptText, label: 'Slip Audit' },
      { href: '/dashboard/legacy-history', icon: Archive, label: 'Legacy History' },
      { href: '/admin/approvals', icon: ShieldCheck, label: 'Approvals', badge: true },
      { href: '/admin/complaints', icon: AlertOctagon, label: 'Complaints', badge: true },
    ],
  },
  {
    title: 'Team',
    items: [
      { href: '/admin/team-chat', icon: MessagesSquare, label: 'Team Chat' },
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
      { href: '/admin/facebook', icon: Facebook, label: 'Connect Facebook' },
      { href: '/admin/platinum-photos', icon: Sparkles, label: 'Platinum Photos' },
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

// The Team Leader runs the CRM off her phone: she gets a slice of the panel
// (Overview + CRM + the team tools) plus her own Profile & Wallet, but none of
// Finance / Config / E-Sign / Team Chat / Workers / Slip Audit.
const TEAM_LEADER_ALLOWED = new Set<string>([
  '/admin', '/admin/inspector', '/admin/alerts',
  '/admin/crm-entries', '/admin/leads', '/admin/orders',
  '/dashboard/legacy-history', '/admin/approvals', '/admin/complaints',
  '/admin/attendance', '/admin/tasks', '/admin/calendar', '/admin/locations',
  '/admin/add-worker',
])

// Extra section appended for the Team Leader — the "like others" personal pages.
const TEAM_LEADER_ACCOUNT: Section = {
  title: 'My Account',
  items: [
    { href: '/dashboard/profile', icon: UserCircle2, label: 'Profile' },
    { href: '/dashboard/wallet', icon: Wallet, label: 'Wallet' },
  ],
}

// Routes whose sub-paths should still light up their parent tab.
const ACTIVE_PREFIXES = [
  '/admin/notifications', '/admin/leads', '/admin/accounts', '/admin/inspector',
  '/admin/workers', '/admin/documents', '/admin/crm-entries', '/admin/attendance',
  '/admin/tasks', '/admin/calendar', '/dashboard/legacy-history',
  '/dashboard/profile', '/dashboard/wallet',
]

function isActive(href: string, pathname: string): boolean {
  if (href === '/admin') return pathname === '/admin'
  if (ACTIVE_PREFIXES.includes(href)) return pathname === href || pathname.startsWith(href + '/')
  return pathname === href
}

export default function AdminSidebar() {
  const pathname = usePathname()
  const { clear, role } = useAuthStore()
  const [mobileOpen, setMobileOpen] = useState(false)

  const teamLeader = role === 'team_leader'
  // accountant/ceo are restricted to Accounts. The CEO additionally gets the
  // one-time "Connect Facebook" setup screen. Back office only sees Orders.
  const restricted = role === 'accountant' || role === 'ceo' || role === 'back_office'
  const restrictedAllows = (href: string) =>
    role === 'back_office'
      ? href === '/admin/orders'
      : href.startsWith('/admin/accounts') || (role === 'ceo' && href === '/admin/facebook')

  // Sections this role actually sees.
  const sections: Section[] = teamLeader
    ? [
        ...SECTIONS
          .map(s => ({ ...s, items: s.items.filter(t => TEAM_LEADER_ALLOWED.has(t.href)) }))
          .filter(s => s.items.length > 0),
        TEAM_LEADER_ACCOUNT,
      ]
    : restricted
      ? SECTIONS
          .map(s => ({ ...s, items: s.items.filter(t => restrictedAllows(t.href)) }))
          .filter(s => s.items.length > 0)
      : SECTIONS

  const panelName =
    role === 'accountant' ? 'Emma Accounts'
      : role === 'ceo' ? 'Emma CEO'
        : role === 'back_office' ? 'Emma Orders'
          : teamLeader ? 'Emma Team Lead'
            : 'Emma Admin'
  const panelSub =
    role === 'accountant' ? 'Accounting panel'
      : role === 'ceo' ? 'CEO panel'
        : role === 'back_office' ? 'Orders panel'
          : teamLeader ? 'Team Leader panel'
            : 'Management panel'

  const handleLogout = async () => {
    clear()
    await supabase.auth.signOut()
    window.location.replace('/auth/login')
  }

  const NavItems = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex-1 overflow-y-auto px-2 py-3">
      {sections.map((section, si) => (
        <div key={section.title} className={si > 0 ? 'mt-3' : ''}>
          <p className="px-3 mb-1 text-[8px] font-bold text-gray-300 uppercase tracking-widest">{section.title}</p>
          <div className="space-y-0.5">
            {section.items.map(({ href, icon: Icon, label, badge }) => {
              const active = isActive(href, pathname)
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onNavigate}
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
      ))}
    </nav>
  )

  const Logout = () => (
    <div className="px-2 py-3 border-t border-gray-50">
      <button
        onClick={handleLogout}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all"
      >
        <LogOut size={15} />
        Logout
      </button>
    </div>
  )

  const Brand = () => (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 bg-pink-600 rounded-xl flex items-center justify-center">
        <span className="text-white font-bold text-xs">E</span>
      </div>
      <div>
        <p className="text-pink-600 font-bold text-sm tracking-tight italic">{panelName}</p>
        <p className="text-gray-400 text-[9px] font-medium">{panelSub}</p>
      </div>
    </div>
  )

  return (
    <>
      {/* ── Mobile top bar (phones/tablets) ── */}
      <header className="md:hidden fixed top-0 inset-x-0 h-14 bg-white border-b border-pink-50 flex items-center justify-between px-4 z-40">
        <Brand />
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="w-9 h-9 rounded-xl bg-pink-50 text-pink-600 flex items-center justify-center active:scale-90 transition-transform"
        >
          <Menu size={18} />
        </button>
      </header>

      {/* ── Mobile slide-over drawer ── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex animate-fade-in">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-64 max-w-[82%] bg-white h-full flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b border-pink-50 flex items-center justify-between">
              <Brand />
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-400"
              >
                <X size={14} />
              </button>
            </div>
            <NavItems onNavigate={() => setMobileOpen(false)} />
            <Logout />
          </aside>
        </div>
      )}

      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex w-56 bg-white border-r border-gray-100 flex-col h-screen sticky top-0 overflow-hidden">
        <div className="px-5 py-5 border-b border-pink-50">
          <Brand />
        </div>
        <NavItems />
        <Logout />
      </aside>
    </>
  )
}
