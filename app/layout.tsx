import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'IPS edit · AI production studio',
  description: 'A calm creative desk for AI-powered video and voice production.',
  manifest: '/manifest.json',
  applicationName: 'IPS edit',
  appleWebApp: { capable: true, title: 'IPS edit', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, { url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  themeColor: '#d4c5b9',
  viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-theme="system"><body className={inter.className}>{children}</body></html>;
}
