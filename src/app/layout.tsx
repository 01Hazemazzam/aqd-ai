import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Inter:wght@400;500;600;700&family=Amiri:wght@400;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap"
        />
      </head>
      <body className="bg-surface text-ink antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
