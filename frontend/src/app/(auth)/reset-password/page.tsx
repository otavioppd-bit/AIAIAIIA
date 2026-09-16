'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { api, ApiError } from '@/lib/api';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [token, setToken] = useState(searchParams.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const mismatch = confirmation.length > 0 && password !== confirmation;
  const valid = password.length >= 8 && /[a-zA-Z]/.test(password) && /\d/.test(password) && !mismatch;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.auth.resetPassword({ token: token.trim(), password });
      router.replace('/login?reset=1');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível redefinir a senha.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">Definir nova senha</h1>
      <p className="mt-1.5 text-[13px] text-ink-muted">
        O link de redefinição só pode ser usado uma vez.
      </p>

      <form onSubmit={handleSubmit} className="mt-7 space-y-4" noValidate>
        {!searchParams.get('token') && (
          <Input
            label="Token de redefinição"
            required
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Cole o token recebido"
          />
        )}
        <Input
          label="Nova senha"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          hint="Mínimo de 8 caracteres, com letras e números."
          icon={<Lock className="h-4 w-4" />}
        />
        <Input
          label="Confirmar nova senha"
          type="password"
          autoComplete="new-password"
          required
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          error={mismatch ? 'As senhas não coincidem.' : undefined}
          icon={<Lock className="h-4 w-4" />}
        />

        {error && (
          <p role="alert" className="rounded-md border border-negative/25 bg-negative/10 p-2.5 text-xs text-negative">
            {error}
          </p>
        )}

        <Button type="submit" fullWidth loading={loading} disabled={!valid || !token}>
          Redefinir senha
        </Button>
      </form>

      <p className="mt-5 text-center text-[13px] text-ink-muted">
        <Link href="/login" className="font-medium text-primary hover:underline">
          Voltar para o login
        </Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface-sunken" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
