import Link from 'next/link';
import { Logo } from '@/components/layout/Logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="flex h-16 shrink-0 items-center px-5 sm:px-8">
        <Link href="/" aria-label="Voltar à página inicial">
          <Logo />
        </Link>
      </header>

      <main id="conteudo" className="flex flex-1 items-center justify-center px-5 pb-16">
        <div className="w-full max-w-sm animate-fade-up">{children}</div>
      </main>

      <footer className="shrink-0 px-5 pb-6 text-center text-xs text-ink-subtle">
        Seus dados permanecem isolados na sua conta e nunca são compartilhados.
      </footer>
    </div>
  );
}
