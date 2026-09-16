import type { Metadata, Viewport } from 'next';
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/themes';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Prisma Analytics — Transforme seus dados em decisões',
    template: '%s · Prisma Analytics',
  },
  description:
    'Envie um CSV e receba um dashboard interativo. A plataforma entende os dados, '
    + 'identifica padrões, escolhe as visualizações adequadas e explica o que encontrou.',
  keywords: ['análise de dados', 'dashboard', 'CSV', 'business intelligence', 'visualização'],
  authors: [{ name: 'Prisma Analytics' }],
  openGraph: {
    title: 'Prisma Analytics',
    description: 'Do CSV ao dashboard, com análise real dos seus dados.',
    type: 'website',
    locale: 'pt_BR',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#09090e' },
    { media: '(prefers-color-scheme: light)', color: '#f9f9fb' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        {/* Paints the stored theme before hydration to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200]
            focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-ink"
        >
          Pular para o conteúdo
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
