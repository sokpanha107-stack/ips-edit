import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'IPS edit · AI production studio',
  description: 'A calm creative desk for AI-powered video and voice production.',
  manifest: '/manifest.json',
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-theme="system"><body className={inter.className}>{children}</body></html>;
}
