'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Package,
  BarChart3,
  Calendar,
  Settings,
  DollarSign,
  ClipboardList,
  BookOpen,
  MessageSquare,
  ChevronRight,
  LogOut,
  UserCog,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

interface NavItem {
  href: string
  label: string
  icon: React.ElementType
  badge?: string
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [
      { href: '/admin',          label: 'Dashboard',      icon: LayoutDashboard },
      { href: '/admin/reports',  label: 'Reports',        icon: BarChart3 },
    ],
  },
  {
    title: 'Team',
    items: [
      { href: '/admin/workers',    label: 'Workers',        icon: Users },
      { href: '/admin/attendance', label: 'Attendance',     icon: ClipboardList },
      { href: '/admin/leaves',     label: 'Leave Requests', icon: Calendar },
      { href: '/admin/salary',     label: 'Salary & Wallet',icon: DollarSign },
    ],
  },
  {
    title: 'CRM',
    items: [
      { href: '/admin/orders',     label: 'Orders',         icon: Package },
      { href: '/admin/customers',  label: 'Customers',      icon: MessageSquare },
      { href: '/admin/calendar',   label: 'Post Calendar',  icon: Calendar },
    ],
  },
  {
    title: 'Finance',
    items: [
      { href: '/admin/accounts',   label: 'Accounts',       icon: BookOpen },
    ],
  },
  {
    title: 'System',
    items: [
      { href: '/admin/packages',   label: 'Packages',       icon: Package },
      { href: '/admin/settings',   label: 'Settings',       icon: Settings },
    ],
  },
]

function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname()
  // exact match for dashboard, prefix match for others
  const isActive =
    item.href === '/admin'
      ? pathname === '/admin'
      : pathname.startsWith(item.href)

  return (
    <Link
      href={item.href}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group ${
        isActive
          ? 'bg-pink-600 text-white shadow-sm'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`}
    >
      <item.icon
        size={16}
        className={isActive ? 'text-white' : 'text-gray-400 group-hover:text-gray-600'}
      />
      <span className="flex-1">{item.label}</span>
      {item.badge && (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
          isActive ? 'bg-white/30 text-white' : 'bg-pink-100 text-pink-600'
        }`}>
          {item.badge}
        </span>
      )}
      {isActive && <ChevronRight size={12} className="text-white/60" />}
    </Link>
  )
}

export default function AdminSidebar() {
  const router = useRouter()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace('/auth/login')
  }

  return (
    <aside className="w-60 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col h-screen sticky top-0 overflow-hidden">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-100">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-pink-500 to-pink-700 flex items-center justify-center text-white font-bold text-sm shadow-sm">
          ET
        </div>
        <div>
          <p className="text-sm font-bold text-gray-900 leading-tight">Emma Thinking</p>
          <p className="text-[10px] text-gray-400">Admin Panel</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {NAV_GROUPS.map(group => (
          <div key={group.title}>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest px-3 mb-1.5">
              {group.title}
            </p>
            <div className="space-y-0.5">
              {group.items.map(item => (
                <NavLink key={item.href} item={item} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-gray-100 space-y-0.5">
        <Link
          href="/admin/profile"
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition"
        >
          <UserCog size={16} className="text-gray-400" />
          My Profile
        </Link>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 transition"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
