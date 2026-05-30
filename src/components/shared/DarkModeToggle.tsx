'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

export default function DarkModeToggle() {
    const [dark, setDark] = useState(false)

    useEffect(() => {
        // On mount, read saved preference
        const saved = localStorage.getItem('emma-theme')
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        const isDark = saved ? saved === 'dark' : prefersDark
        setDark(isDark)
        document.documentElement.classList.toggle('dark', isDark)
    }, [])

    function toggle() {
        const next = !dark
        setDark(next)
        document.documentElement.classList.toggle('dark', next)
        localStorage.setItem('emma-theme', next ? 'dark' : 'light')
    }

    return (
        <button
            onClick={toggle}
            className="dark-toggle relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none"
            style={{ background: dark ? '#EA1E63' : '#E5E7EB' }}
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
            {/* Track */}
            <span
                className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md flex items-center justify-center transition-transform duration-300"
                style={{ transform: dark ? 'translateX(24px)' : 'translateX(0)' }}
            >
                {dark
                    ? <Moon size={11} className="text-pink-600" />
                    : <Sun size={11} className="text-gray-400" />
                }
            </span>
        </button>
    )
}