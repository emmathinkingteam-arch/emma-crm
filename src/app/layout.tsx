export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import './globals.css'
import SessionTracker from '@/components/shared/SessionTracker'

export const metadata: Metadata = {
  title: 'Emma Thinking CRM',
  description: 'Internal CRM system for Emma Thinking (Pvt) Ltd',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased bg-white text-gray-900">
        {children}
        <SessionTracker />
      </body>
    </html>
  )
}
