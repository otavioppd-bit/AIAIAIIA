'use client';

import { Suspense, useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, ArrowRight, Database, FileSpreadsheet, LayoutGrid,
  MoreHorizontal, Sparkles, Trash2, TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { Logo } from '@/components/layout/Logo';
import { ThemePicker } from '@/components/layout/ThemePicker';
import { UserMenu } from '@/components/layout/UserMenu';
import { Dropzone } from '@/components/upload/Dropzone';
import { AnalysisProgress } from '@/components/upload/AnalysisProgress';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { api, ApiError } from '@/lib/api';
import { formatBytes, formatInteger, formatRelativeTime } from '@/lib/format';
import { useAuth } from '@/hooks/useAuth';
import { cn, createId } from '@/lib/utils';
import type { DatasetSummary, UploadResponse } from '@/types/api';

const DOMAIN_LABELS: Record<string, string> = {
  sales: 'Vendas',
  finance: 'Financeiro',
  education: 'Educação',
  marketing: 'Marketing',
  hr: 'Pessoas',
  operations: 'Operações',
  health: 'Saúde',
  generic: 'Geral',
};

function WorkspaceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { user, updateUser } = useAuth();

  const [uploadPercent, setUploadPercent] = useState(0);
  const [processing, setProcessing] = useState(false);
  // Identifies this upload to the server's progress endpoint, so the stages
  // shown are the ones the pipeline actually reached.
  const [progressToken, setProgressToken] = useState('');
  // A toast disappears; a failed upload should not. The reason stays on screen
  // until the user acts on it.
  const [uploadError, setUploadError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<DatasetSummary | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(
    searchParams.get('onboarding') === '1' && !user?.onboarding_completed,
  );

  const datasets = useQuery({ queryKey: ['datasets'], queryFn: api.datasets.list });
  const stats = useQuery({ queryKey: ['workspace-stats'], queryFn: api.datasets.stats });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const token = createId();
      setProgressToken(token);
      setUploadError('');
      setUploadPercent(0);
      setProcessing(false);
      return api.datasets.upload(
        file,
        (percent) => {
          setUploadPercent(percent);
          if (percent >= 100) setProcessing(true);
        },
        token,
      );
    },
    onSuccess: async (response: UploadResponse) => {
      await queryClient.invalidateQueries({ queryKey: ['datasets'] });
      await queryClient.invalidateQueries({ queryKey: ['workspace-stats'] });
      if (!user?.onboarding_completed) {
        void updateUser({ onboarding_completed: true }).catch(() => undefined);
      }
      response.warnings.forEach((warning) => toast.warning(warning));
      toast.success('Dashboard gerado a partir dos seus dados.');
      router.push(`/app/datasets/${response.dataset.id}/overview`);
    },
    onError: (error) => {
      setProcessing(false);
      setUploadPercent(0);
      setUploadError(
        error instanceof ApiError
          ? error.message
          : 'Não foi possível processar o arquivo. Verifique a conexão e tente novamente.',
      );
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.datasets.remove(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['datasets'] });
      await queryClient.invalidateQueries({ queryKey: ['workspace-stats'] });
      toast.success('Conjunto de dados removido.');
      setPendingDelete(null);
    },
    onError: () => toast.error('Não foi possível remover o conjunto de dados.'),
  });

  const handleUpload = useCallback((file: File) => upload.mutate(file), [upload]);

  const isUploading = upload.isPending;
  const firstName = user?.full_name?.split(' ')[0];

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-5">
          <Link href="/app">
            <Logo />
          </Link>
          <div className="flex items-center gap-1">
            <ThemePicker />
            <UserMenu />
          </div>
        </div>
      </header>

      <main id="conteudo" className="mx-auto max-w-6xl px-5 py-10">
        <div className="animate-fade-up">
          <h1 className="text-2xl font-semibold tracking-[-0.025em] sm:text-[28px]">
            {firstName ? `Olá, ${firstName}` : 'Seu workspace'}
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            Envie um CSV e a plataforma analisa os dados, escolhe as visualizações e monta o
            dashboard.
          </p>
        </div>

        {stats.data && stats.data.datasets > 0 && (
          <div className="mt-6 grid animate-fade-up grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Conjuntos de dados" value={formatInteger(stats.data.datasets)} icon={Database} />
            <StatTile label="Dashboards" value={formatInteger(stats.data.dashboards)} icon={LayoutGrid} />
            <StatTile label="Registros analisados" value={formatInteger(stats.data.total_rows)} icon={TrendingUp} />
            <StatTile
              label="Qualidade média"
              value={`${stats.data.average_quality}/100`}
              icon={Sparkles}
            />
          </div>
        )}

        <section className="mt-8 animate-fade-up" aria-label="Enviar novo conjunto de dados">
          {uploadError ? (
            <Card className="px-6 py-14 sm:py-16">
              <EmptyState
                icon={<AlertCircle className="h-5 w-5 text-negative" />}
                title="Não conseguimos analisar este arquivo"
                description={uploadError}
                action={
                  <Button size="sm" onClick={() => setUploadError('')}>
                    Tentar outro arquivo
                  </Button>
                }
              />
            </Card>
          ) : isUploading ? (
            <Card className="flex flex-col items-center justify-center px-6 py-14 sm:py-20">
              <AnalysisProgress
                uploadPercent={uploadPercent}
                processing={processing}
                done={upload.isSuccess}
                token={progressToken}
              />
            </Card>
          ) : (
            <Dropzone onSubmit={handleUpload} disabled={isUploading} />
          )}
        </section>

        <section className="mt-10" aria-label="Histórico de conjuntos de dados">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-base font-semibold tracking-[-0.01em]">Seus conjuntos de dados</h2>
            {datasets.data && datasets.data.length > 0 && (
              <span className="text-xs text-ink-subtle">{datasets.data.length} no total</span>
            )}
          </div>

          {datasets.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-32" />
              ))}
            </div>
          ) : datasets.isError ? (
            <EmptyState
              icon={<AlertCircle className="h-5 w-5 text-negative" />}
              title="Não foi possível carregar seus dados"
              description="Verifique se a API está em execução e tente novamente."
              action={
                <Button size="sm" variant="secondary" onClick={() => datasets.refetch()}>
                  Tentar novamente
                </Button>
              }
              className="rounded-lg border border-dashed border-line"
            />
          ) : !datasets.data || datasets.data.length === 0 ? (
            <EmptyState
              icon={<FileSpreadsheet className="h-5 w-5" />}
              title="Nenhum conjunto de dados ainda"
              description="Envie seu primeiro CSV acima para gerar um dashboard automaticamente."
              className="rounded-lg border border-dashed border-line"
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {datasets.data.map((dataset) => (
                <li key={dataset.id}>
                  <DatasetCard dataset={dataset} onDelete={() => setPendingDelete(dataset)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <Dialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        title="Remover conjunto de dados"
        description={`“${pendingDelete?.name}” e todos os dashboards e conversas ligados a ele serão apagados permanentemente.`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => pendingDelete && remove.mutate(pendingDelete.id)}
            >
              Remover
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-muted">Esta ação não pode ser desfeita.</p>
      </Dialog>

      <OnboardingDialog open={showOnboarding} onClose={() => setShowOnboarding(false)} />
    </div>
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-ink-muted">{label}</p>
        <Icon className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums tracking-[-0.02em]">{value}</p>
    </Card>
  );
}

function DatasetCard({ dataset, onDelete }: { dataset: DatasetSummary; onDelete: () => void }) {
  const ready = dataset.status === 'ready';
  const qualityTone =
    dataset.quality_score >= 80 ? 'positive' : dataset.quality_score >= 60 ? 'warning' : 'negative';

  return (
    <Card className="group relative h-full transition-all duration-200 hover:border-line-strong hover:shadow-md">
      <Link
        href={ready ? `/app/datasets/${dataset.id}/overview` : '#'}
        className={cn('block p-4', !ready && 'pointer-events-none')}
        aria-disabled={!ready}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <FileSpreadsheet className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate pr-6 text-[13px] font-semibold" title={dataset.name}>
              {dataset.name}
            </p>
            <p className="mt-0.5 text-xs text-ink-subtle">
              {formatRelativeTime(dataset.created_at)}
            </p>
          </div>
        </div>

        {ready ? (
          <>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge tone="neutral">{DOMAIN_LABELS[dataset.domain] ?? dataset.domain}</Badge>
              <Badge tone={qualityTone}>Qualidade {dataset.quality_score}</Badge>
            </div>
            <p className="mt-3 text-xs text-ink-subtle">
              {formatInteger(dataset.row_count)} linhas · {dataset.column_count} colunas ·{' '}
              {formatBytes(dataset.size_bytes)}
            </p>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
              Abrir dashboard
              <ArrowRight className="h-3 w-3" />
            </span>
          </>
        ) : (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-negative">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            {dataset.error_message ?? 'Processamento não concluído.'}
          </p>
        )}
      </Link>

      <IconButton
        label="Remover"
        size="xs"
        className="absolute right-2 top-2 opacity-0 transition-opacity hover:text-negative group-hover:opacity-100"
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </IconButton>
    </Card>
  );
}

const ONBOARDING_STEPS = [
  {
    title: 'Envie um CSV',
    body: 'Separadores, acentuação e formatos brasileiros de data e moeda são detectados automaticamente.',
  },
  {
    title: 'A plataforma entende os dados',
    body: 'Cada coluna recebe um tipo semântico e um papel: métrica, dimensão, data ou identificador.',
  },
  {
    title: 'O dashboard é montado',
    body: 'As visualizações são escolhidas por princípios de visualização de dados — e cada gráfico explica por que foi escolhido.',
  },
  {
    title: 'Converse com os dados',
    body: 'Pergunte em português. Toda resposta é calculada sobre o seu arquivo, nunca estimada.',
  },
];

function OnboardingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const current = ONBOARDING_STEPS[step];
  const last = step === ONBOARDING_STEPS.length - 1;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Bem-vindo ao Prisma"
      footer={
        <>
          <span className="mr-auto flex items-center gap-1.5" aria-hidden>
            {ONBOARDING_STEPS.map((_, index) => (
              <span
                key={index}
                className={cn(
                  'h-1 rounded-full transition-all duration-300',
                  index === step ? 'w-4 bg-primary' : 'w-1 bg-line-strong',
                )}
              />
            ))}
          </span>
          <Button variant="ghost" onClick={onClose}>
            Pular
          </Button>
          <Button onClick={() => (last ? onClose() : setStep(step + 1))}>
            {last ? 'Começar' : 'Próximo'}
          </Button>
        </>
      }
    >
      <div className="animate-fade-in">
        <p className="text-2xs font-semibold uppercase tracking-wide text-primary">
          Passo {step + 1} de {ONBOARDING_STEPS.length}
        </p>
        <h3 className="mt-1.5 text-base font-semibold tracking-[-0.01em]">{current.title}</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{current.body}</p>
      </div>
    </Dialog>
  );
}

export default function WorkspacePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <WorkspaceContent />
    </Suspense>
  );
}
