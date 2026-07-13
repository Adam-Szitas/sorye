import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/providers';
import { SdkInit } from '@/components/sdk-init';
import '@sorye/sdk/tokens.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sorye Hub',
  description: 'Your workspace OS — pick apps, connect tools, build your stack.',
};

export const viewport: Viewport = {
  themeColor: '#0b0f17',
  colorScheme: 'dark',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <SdkInit />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
