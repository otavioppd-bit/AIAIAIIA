import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/themes';
import { Providers } from './providers';
import './globals.css';

// Self-hosted by Next at build time: no render-blocking request, no layout
// shift, and the families are exposed as the CSS variables the theme uses.
// The variable axis is loaded whole: the display type needs weight 900, which
// a fixed weight list would not reach, and the variable file is smaller than
// the six static cuts it replaces.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans-loaded',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono-loaded',
  weight: ['400', '500'],
});

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
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <head>
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
