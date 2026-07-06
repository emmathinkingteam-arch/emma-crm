export const dynamic = 'force-dynamic'

import type { Metadata, Viewport } from 'next'
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

// Fit the app to each worker's screen exactly: the layout width follows the
// device width (phone, tablet or desktop) and zoom is locked, so iOS stops
// auto-zooming into the small text inputs — the "page looks zoomed / not
// mobile size" complaint.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
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
