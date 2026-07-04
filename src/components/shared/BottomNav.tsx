'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, CalendarRange,
  PlusCircle, Wallet, Award, ClipboardList, Search, MessageCircle,
  ArrowDownToLine, ListOrdered, Landmark, Receipt, DollarSign
} from 'lucide-react'
import { useAuthStore } from '@/store/auth'

// CEO accounts sub-tabs shown in a horizontal strip above the main nav
const CEO_ACCOUNT_TABS = [
  { href: '/admin/accounts', label: 'Overview' },
  { href: '/admin/accounts/add-expense', label: 'Add Expense' },
  { href: '/admin/accounts/income', label: 'Income' },
  { href: '/admin/accounts/transactions', label: 'Transactions' },
  { href: '/admin/accounts/banks', label: 'Bank & Cash' },
  { href: '/admin/accounts/wallets', label: 'Wallets' },
  { href: '/admin/accounts/costing', label: 'Costing' },
  { href: '/admin/accounts/reports', label: 'Reports' },
]

const NAV_CONFIG = {
  crm_agent: [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Home' },
    { href: '/entry', icon: PlusCircle, label: 'Entry' },
    { href: '/dashboard/customers', icon: Users, label: 'Clients' },
    { href: '/dashboard/wallet', icon: Wallet, label: 'Wallet' },
    { href: '/dashboard/profile', icon: Award, label: 'Profile' },
    { href: '/dashboard/chat', icon: MessageCircle, label: 'Chat' },
  ],
  back_office: [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Home' },
    { href: '/dashboard/customers', icon: Users, label: 'Clients' },
    { href: '/admin/orders', icon: ListOrdered, label: 'Orders' },
    { href: '/dashboard/legacy-history', icon: Search, label: 'Search' },
    { href: '/dashboard/calendar', icon: CalendarRange, label: 'Plan' },
    { href: '/dashboard/profile', icon: Award, label: 'Profile' },
    { href: '/dashboard/chat', icon: MessageCircle, label: 'Chat' },
  ],
  counselor: [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Home' },
    { href: '/dashboard/customers', icon: Users, label: 'Clients' },
    { href: '/dashboard/calendar', icon: CalendarRange, label: 'Plan' },
    { href: '/dashboard/wallet', icon: Wallet, label: 'Wallet' },
    { href: '/dashboard/profile', icon: Award, label: 'Profile' },
    { href: '/dashboard/chat', icon: MessageCircle, label: 'Chat' },
  ],
  manager: [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Home' },
    { href: '/dashboard/customers', icon: Users, label: 'Clients' },
    { href: '/dashboard/tasks', icon: ClipboardList, label: 'Tasks' },
    { href: '/dashboard/calendar', icon: CalendarRange, label: 'Plan' },
    { href: '/dashboard/profile', icon: Award, label: 'Profile' },
    { href: '/dashboard/chat', icon: MessageCircle, label: 'Chat' },
  ],
  designer: [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Home' },
    { href: '/dashboard/customers', icon: Users, label: 'Clients' },
    { href: '/dashboard/calendar', icon: CalendarRange, label: 'Plan' },
    { href: '/dashboard/wallet', icon: Wallet, label: 'Wallet' },
    { href: '/dashboard/profile', icon: Award, label: 'Profile' },
    { href: '/dashboard/chat', icon: MessageCircle, label: 'Chat' },
  ],
}

export default function BottomNav() {
  const pathname = usePathname()
  const { role } = useAuthStore()

  if (!role || role === 'admin') return null

  // CEO gets accounts tab strip as bottom nav
  if (role === 'ceo') {
    return (
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-pink-100 z-40 shadow-lg">
        <div className="flex overflow-x-auto scrollbar-none px-2 py-2 gap-1.5">
          {CEO_ACCOUNT_TABS.map(({ href, label }) => {
            const active = href === '/admin/accounts'
              ? pathname === '/admin/accounts'
              : pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[10px] font-bold whitespace-nowrap transition-all ${active
                  ? 'bg-pink-600 text-white shadow-sm'
                  : 'text-gray-400 bg-gray-100'
                  }`}
              >
                {label}
              </Link>
            )
          })}
        </div>
      </div>
    )
  }

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
              className={`flex-1 flex flex-col items-center py-2 rounded-full transition-all duration-200 ${active ? 'bg-pink-600 text-white shadow-md' : 'text-gray-300 hover:text-gray-400'}`}
            >
              <Icon size={15} strokeWidth={active ? 2.5 : 2} />
              <span className="text-[6px] font-bold mt-0.5 uppercase tracking-tight">{label}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}