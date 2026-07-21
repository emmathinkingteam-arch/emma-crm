'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import BottomNav from '@/components/shared/BottomNav'
import {
    Wallet,
    LayoutDashboard,
    PlusCircle,
    ArrowDownToLine,
    ListOrdered,
    Landmark,
    Building2,
    Users as UsersIcon,
    Receipt,
    Sparkles,
    Scale,
} from 'lucide-react'

const SUB_TABS = [
    { href: '/admin/accounts', icon: LayoutDashboard, label: 'Overview', exact: true },
    { href: '/admin/accounts/add-expense', icon: PlusCircle, label: 'Add Expense' },
    { href: '/admin/accounts/add-expense-auto', icon: Sparkles, label: 'Add Auto' },
    { href: '/admin/accounts/income', icon: ArrowDownToLine, label: 'Income' },
    { href: '/admin/accounts/transactions', icon: ListOrdered, label: 'Transactions' },
    { href: '/admin/accounts/tally', icon: Scale, label: 'Bank Tally' },
    { href: '/admin/accounts/commercial', icon: Building2, label: 'Commercial Bank' },
    { href: '/admin/accounts/banks', icon: Landmark, label: 'Bank & Cash' },
    { href: '/admin/accounts/wallets', icon: Wallet, label: 'Wallets' },
    { href: '/admin/accounts/costing', icon: UsersIcon, label: 'Customer Costing' },
    { href: '/admin/accounts/reports', icon: Receipt, label: 'Reports' },
]

export default function AccountsLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname()
    const { role } = useAuthStore()
    const isCeo = role === 'ceo'

    return (
        <div className="flex flex-col h-full">
            {/* Sticky header + subnav */}
            <div className="sticky top-0 z-30 bg-gray-50 pt-5 px-4 md:px-6 pb-0">
                {/* Section header */}
                <div className="mb-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-pink-100 flex items-center justify-center flex-shrink-0">
                        <Wallet size={16} className="text-pink-600" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-gray-800">Accounts</h1>
                        <p className="text-[10px] text-gray-400 font-medium">
                            Income · expenses · banks · wallets · profit
                        </p>
                    </div>
                </div>

                {/* Sub-nav tabs — horizontal scroll on mobile */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
                    <div className="flex overflow-x-auto scrollbar-none p-1.5 gap-1">
                        {SUB_TABS.map(({ href, icon: Icon, label, exact }) => {
                            const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/')
                            return (
                                <Link
                                    key={href}
                                    href={href}
                                    className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${active
                                        ? 'bg-pink-600 text-white shadow-sm'
                                        : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'
                                        }`}
                                >
                                    <Icon size={13} />
                                    {label}
                                </Link>
                            )
                        })}
                    </div>
                </div>
            </div>

            {/* Page content — extra bottom padding for CEO BottomNav */}
            <div className={`flex-1 overflow-y-auto p-4 md:p-6 pt-5 ${isCeo ? 'pb-24' : 'pb-6'}`}>
                {children}
            </div>
            {isCeo && <BottomNav />}
        </div>
    )
}