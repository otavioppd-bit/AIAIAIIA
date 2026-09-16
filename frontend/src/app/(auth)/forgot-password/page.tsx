'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Mail } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { api, ApiError } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const response = await api.auth.forgotPassword(email.trim());
      setMessage(response.message);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível enviar a solicitação.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">Recuperar senha</h1>
      <p className="mt-1.5 text-[13px] text-ink-muted">
        Informe o e-mail da conta e enviaremos as instruções de redefinição.
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

        {message && (
          <div className="rounded-md border border-positive/25 bg-positive/10 p-3 text-xs leading-relaxed text-positive">
            <p className="break-all">{message}</p>
            {message.includes('token:') && (
              <Link
                href={`/reset-password?token=${encodeURIComponent(message.split('token: ')[1]?.trim() ?? '')}`}
                className="mt-2 inline-block font-medium underline"
              >
                Abrir tela de redefinição
              </Link>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-negative/25 bg-negative/10 p-2.5 text-xs text-negative">
            {error}
          </p>
        )}

        <Button type="submit" fullWidth loading={loading}>
          Enviar instruções
        </Button>
      </form>

      <Link
        href="/login"
        className="mt-5 inline-flex items-center gap-1.5 text-[13px] text-ink-muted transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para o login
      </Link>
    </div>
  );
}
