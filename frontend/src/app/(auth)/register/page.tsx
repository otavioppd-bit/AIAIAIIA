'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Building2, Lock, Mail, User } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Mirrors the backend rule: at least 8 characters, with letters and digits. */
function passwordStrength(password: string): { score: number; label: string; tone: string } {
  if (!password) return { score: 0, label: '', tone: '' };
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-zA-Z]/.test(password) && /\d/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;

  const levels = [
    { label: 'Muito fraca', tone: 'bg-negative' },
    { label: 'Fraca', tone: 'bg-negative' },
    { label: 'Razoável', tone: 'bg-warning' },
    { label: 'Boa', tone: 'bg-positive' },
    { label: 'Forte', tone: 'bg-positive' },
  ];
  return { score, ...levels[score] };
}

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();

  const [form, setForm] = useState({ full_name: '', email: '', company: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const strength = useMemo(() => passwordStrength(form.password), [form.password]);
  const valid =
    form.email.includes('@') && form.password.length >= 8 && /[a-zA-Z]/.test(form.password) && /\d/.test(form.password);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register({
        email: form.email.trim(),
        password: form.password,
        full_name: form.full_name.trim(),
        company: form.company.trim(),
      });
      router.replace('/app?onboarding=1');
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.fieldErrors[0] ?? caught.message);
      } else {
        setError('Não foi possível conectar ao servidor. Verifique se a API está em execução.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">Criar conta</h1>
      <p className="mt-1.5 text-[13px] text-ink-muted">
        Envie seu primeiro CSV em menos de um minuto.
      </p>

      <form onSubmit={handleSubmit} className="mt-7 space-y-4" noValidate>
        <Input
          label="Nome"
          autoComplete="name"
          value={form.full_name}
          onChange={(event) => setForm({ ...form, full_name: event.target.value })}
          placeholder="Como devemos te chamar"
          icon={<User className="h-4 w-4" />}
        />
        <Input
          label="E-mail"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
          placeholder="voce@empresa.com"
          icon={<Mail className="h-4 w-4" />}
        />
        <Input
          label="Empresa"
          autoComplete="organization"
          value={form.company}
          onChange={(event) => setForm({ ...form, company: event.target.value })}
          placeholder="Opcional"
          icon={<Building2 className="h-4 w-4" />}
        />

        <div>
          <Input
            label="Senha"
            type="password"
            autoComplete="new-password"
            required
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            placeholder="Mínimo de 8 caracteres"
            hint="Precisa conter letras e números."
            icon={<Lock className="h-4 w-4" />}
          />
          {form.password && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex flex-1 gap-1" aria-hidden>
                {[0, 1, 2, 3].map((index) => (
                  <span
                    key={index}
                    className={cn(
                      'h-1 flex-1 rounded-full transition-colors duration-300',
                      index < strength.score ? strength.tone : 'bg-line',
                    )}
                  />
                ))}
              </div>
              <span className="text-2xs text-ink-subtle">{strength.label}</span>
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-negative/25 bg-negative/10 p-2.5 text-xs text-negative">
            {error}
          </p>
        )}

        <Button
          type="submit"
          fullWidth
          loading={loading}
          disabled={!valid}
          iconRight={<ArrowRight className="h-4 w-4" />}
        >
          Criar conta gratuita
        </Button>
      </form>

      <p className="mt-5 text-center text-[13px] text-ink-muted">
        Já tem conta?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}
