'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, CalendarRange,
  PlusCircle, Wallet, Award, ClipboardList, Search, MessageSquareWarning
} from 'lucide-react'
import { useAuthStore } from '@/store/auth'

const NAV_CONFIG = {
  crm_agent: [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Home' },
    { href: '/entry', icon: PlusCircle, label: 'Entry' },
    { href: '/dashboard/customers', icon: Users, label: 'Clients' },
    { href: '/dashboard/wallet', icon: Wallet, label: 'Wallet' },
    { href: '/dashboard/complaints', icon: MessageSquareWarning, label: 'Complaints' },
  ],
  back_office: [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Home' },
    { href: '/dashboard/customers', icon: Users, label: 'Clients' },
    { href: '/dashboard/legacy-history', icon: Search, label: 'Search' },
    { href: '/dashboard/calendar', icon: CalendarRange, label: 'Plan' },
    { href: '/dashboard/complaints', icon: MessageSquareWarning, label: 'Complaints' },
  ],
  counselor: [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Home' },
    { href: '/dashboard/customers', icon: Users, label: 'Clients' },
    { href: '/dashboard/calendar', icon: CalendarRange, label: 'Plan' },
    { href: '/dashboard/wallet', icon: Wallet, label: 'Wallet' },
    { href: '/dashboard/complaints', icon: MessageSquareWarning, label: 'Complaints' },
  ],
  manager: [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Home' },
    { href: '/dashboard/customers', icon: Users, label: 'Clients' },
    { href: '/dashboard/tasks', icon: ClipboardList, label: 'Tasks' },
    { href: '/dashboard/calendar', icon: CalendarRange, label: 'Plan' },
    { href: '/dashboard/complaints', icon: MessageSquareWarning, label: 'Complaints' },
  ],
  designer: [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Home' },
    { href: '/dashboard/customers', icon: Users, label: 'Clients' },
    { href: '/dashboard/calendar', icon: CalendarRange, label: 'Plan' },
    { href: '/dashboard/wallet', icon: Wallet, label: 'Wallet' },
    { href: '/dashboard/complaints', icon: MessageSquareWarning, label: 'Complaints' },
  ],
}

export default function BottomNav() {
  const pathname = usePathname()
  const { role } = useAuthStore()

  if (!role || role === 'admin') return null

  const items = NAV_CONFIG[role as keyof typeof NAV_CONFIG] ?? []

  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[500px] px-3 pb-3 pt-1 bg-white/80 backdrop-blur-md z-40">
      <div className="bg-white border-2 border-pink-100 rounded-full p-1 flex justify-between items-center shadow-lg shadow-pink-100/40">
        {items.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center py-2.5 rounded-full transition-all duration-200 ${active ? 'bg-pink-600 text-white shadow-md' : 'text-gray-300 hover:text-gray-400'}`}
            >
              <Icon size={17} strokeWidth={active ? 2.5 : 2} />
              <span className="text-[7px] font-bold mt-0.5 uppercase tracking-tight">{label}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}