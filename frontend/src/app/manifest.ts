import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Prisma Analytics',
    short_name: 'Prisma',
    description: 'Transforme seus dados em decisões. Do CSV ao dashboard interativo.',
    start_url: '/app',
    display: 'standalone',
    background_color: '#09090e',
    theme_color: '#09090e',
    lang: 'pt-BR',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
