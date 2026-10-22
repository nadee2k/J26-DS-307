import type { Metadata, Viewport } from "next"
import "./globals.css"
import { AuthProvider } from "@/hooks/use-auth"
import { DemoProvider } from "@/hooks/use-demo"

export const metadata: Metadata = {
  title: "FocusTrack — Integrated Demo",
  description:
    "The integrated FocusTrack experience: multimodal sensing, early focus alerts, session outcomes and feedback.",
}

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f6f1e8",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-background">
      <body className="font-sans antialiased">
        <AuthProvider>
          <DemoProvider>{children}</DemoProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
