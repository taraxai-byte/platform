export const metadata = {
  title: 'TARAX AI',
  description: 'Autonomous Global B2B Trade Engine',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
