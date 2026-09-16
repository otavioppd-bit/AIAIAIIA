'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Lock, Mail } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const next = searchParams.get('next') || '/app';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
      router.replace(next);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Não foi possível conectar ao servidor. Verifique se a API está em execução.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">Entrar</h1>
      <p className="mt-1.5 text-[13px] text-ink-muted">
        Acesse seu workspace e continue de onde parou.
      </p>

      <form onSubmit={handleSubmit} className="mt-7 space-y-4" noValidate>
        <Input
          label="E-mail"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="voce@empresa.com"
          icon={<Mail className="h-4 w-4" />}
        />
        <Input
          label="Senha"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="••••••••"
          icon={<Lock className="h-4 w-4" />}
        />

        {error && (
          <p role="alert" className="rounded-md border border-negative/25 bg-negative/10 p-2.5 text-xs text-negative">
            {error}
          </p>
        )}

        <Button type="submit" fullWidth loading={loading} iconRight={<ArrowRight className="h-4 w-4" />}>
          Entrar
        </Button>
      </form>

      <div className="mt-5 flex items-center justify-between text-[13px]">
        <Link href="/forgot-password" className="text-ink-muted transition-colors hover:text-primary">
          Esqueci minha senha
        </Link>
        <Link href="/register" className="font-medium text-primary hover:underline">
          Criar conta
        </Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="h-72 animate-pulse rounded-lg bg-surface-sunken" />}>
      <LoginForm />
    </Suspense>
  );
}
