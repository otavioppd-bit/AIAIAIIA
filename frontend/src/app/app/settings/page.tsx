'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Lock, Palette } from 'lucide-react';
import { toast } from 'sonner';
import { Logo } from '@/components/layout/Logo';
import { UserMenu } from '@/components/layout/UserMenu';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  const { user, updateUser } = useAuth();
  const { theme, themes, setTheme } = useTheme();

  const [profile, setProfile] = useState({
    full_name: user?.full_name ?? '',
    company: user?.company ?? '',
  });
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setSavingProfile(true);
    try {
      await updateUser(profile);
      toast.success('Perfil atualizado.');
    } catch {
      toast.error('Não foi possível atualizar o perfil.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setSavingPassword(true);
    try {
      await api.auth.changePassword(passwords);
      setPasswords({ current_password: '', new_password: '' });
      toast.success('Senha alterada.');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Não foi possível alterar a senha.');
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-5">
          <Link href="/app">
            <Logo />
          </Link>
          <UserMenu />
        </div>
      </header>

      <main id="conteudo" className="mx-auto max-w-3xl px-5 py-8">
        <Link
          href="/app"
          className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-ink-muted transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar ao workspace
        </Link>

        <h1 className="text-2xl font-semibold tracking-[-0.025em]">Configurações</h1>

        <div className="mt-6 space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Perfil</CardTitle>
                <CardDescription>Como você aparece na plataforma.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveProfile} className="space-y-4">
                <Input label="E-mail" value={user?.email ?? ''} disabled hint="O e-mail não pode ser alterado." />
                <Input
                  label="Nome"
                  value={profile.full_name}
                  onChange={(event) => setProfile({ ...profile, full_name: event.target.value })}
                />
                <Input
                  label="Empresa"
                  value={profile.company}
                  onChange={(event) => setProfile({ ...profile, company: event.target.value })}
                />
                <Button type="submit" loading={savingProfile} icon={<Check className="h-4 w-4" />}>
                  Salvar perfil
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-1.5">
                  <Palette className="h-4 w-4" />
                  Tema
                </CardTitle>
                <CardDescription>Aplicado a toda a interface e aos gráficos.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-2">
                {themes.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setTheme(item.id);
                      void updateUser({ preferred_theme: item.id }).catch(() => undefined);
                    }}
                    className={cn(
                      'flex items-start gap-2.5 rounded-lg border p-3 text-left transition-all',
                      theme === item.id ? 'border-primary bg-primary-soft' : 'border-line hover:border-line-strong',
                    )}
                  >
                    <span className="mt-0.5 flex shrink-0 overflow-hidden rounded-sm border border-line">
                      {item.preview.map((color) => (
                        <span key={color} className="h-5 w-2.5" style={{ backgroundColor: color }} />
                      ))}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{item.name}</span>
                      <span className="mt-0.5 block text-2xs leading-snug text-ink-subtle">
                        {item.description}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-1.5">
                  <Lock className="h-4 w-4" />
                  Senha
                </CardTitle>
                <CardDescription>Mínimo de 8 caracteres, com letras e números.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={changePassword} className="space-y-4">
                <Input
                  label="Senha atual"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={passwords.current_password}
                  onChange={(event) =>
                    setPasswords({ ...passwords, current_password: event.target.value })
                  }
                />
                <Input
                  label="Nova senha"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={passwords.new_password}
                  onChange={(event) => setPasswords({ ...passwords, new_password: event.target.value })}
                />
                <Button
                  type="submit"
                  loading={savingPassword}
                  disabled={passwords.new_password.length < 8 || !passwords.current_password}
                >
                  Alterar senha
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
