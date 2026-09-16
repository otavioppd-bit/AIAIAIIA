'use client';

import { useParams, useRouter } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';
import { DatasetShell } from '@/components/layout/DatasetShell';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useDataset } from '@/hooks/useDataset';
import { ApiError } from '@/lib/api';

export default function DatasetLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: dataset, isLoading, error } = useDataset(params.id);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-ink-subtle" />
          <p className="text-[13px] text-ink-subtle">Carregando conjunto de dados…</p>
        </div>
      </div>
    );
  }

  if (error || !dataset) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-5">
        <EmptyState
          icon={<AlertCircle className="h-5 w-5 text-negative" />}
          title={notFound ? 'Conjunto de dados não encontrado' : 'Erro ao carregar'}
          description={
            notFound
              ? 'Ele pode ter sido removido, ou o link pertence a outra conta.'
              : 'Não foi possível carregar este conjunto de dados.'
          }
          action={
            <Button size="sm" variant="secondary" onClick={() => router.push('/app')}>
              Voltar ao workspace
            </Button>
          }
        />
      </div>
    );
  }

  if (dataset.status !== 'ready') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-5">
        <EmptyState
          icon={<AlertCircle className="h-5 w-5 text-warning" />}
          title="Este conjunto de dados não foi processado"
          description={dataset.error_message ?? 'O processamento não foi concluído.'}
          action={
            <Button size="sm" variant="secondary" onClick={() => router.push('/app')}>
              Voltar ao workspace
            </Button>
          }
        />
      </div>
    );
  }

  return <DatasetShell dataset={dataset}>{children}</DatasetShell>;
}
