'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/Controls';
import { cn } from '@/lib/utils';

export const ANALYSIS_STAGES = [
  { id: 'read', label: 'Lendo o conjunto de dados', weight: 1 },
  { id: 'columns', label: 'Entendendo as colunas', weight: 1.4 },
  { id: 'patterns', label: 'Detectando padrões', weight: 1.6 },
  { id: 'correlations', label: 'Buscando correlações', weight: 1.4 },
  { id: 'charts', label: 'Selecionando visualizações', weight: 1.2 },
  { id: 'insights', label: 'Gerando insights', weight: 1.4 },
  { id: 'build', label: 'Montando o dashboard', weight: 1 },
] as const;

interface AnalysisProgressProps {
  /** 0–100, the real upload progress reported by the request. */
  uploadPercent: number;
  /** True once the bytes are sent and the server is processing. */
  processing: boolean;
  /** True when the response has arrived. */
  done: boolean;
  /** Used to pace the stages: bigger files genuinely take longer. */
  sizeBytes?: number;
}

/**
 * Upload progress is measured. Server-side analysis is a single request with
 * no streaming, so the stages are paced against a size-derived estimate and —
 * importantly — never reach completion until the response actually lands.
 */
export function AnalysisProgress({
  uploadPercent,
  processing,
  done,
  sizeBytes = 0,
}: AnalysisProgressProps) {
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    if (!processing || done) return undefined;

    const totalWeight = ANALYSIS_STAGES.reduce((sum, stage) => sum + stage.weight, 0);
    // ~1.1s per MB, floored at 2.4s and capped at 22s for the whole sequence.
    const estimatedMs = Math.min(Math.max((sizeBytes / 1_000_000) * 1100, 2400), 22000);

    let cancelled = false;
    let index = 0;

    const advance = () => {
      if (cancelled || index >= ANALYSIS_STAGES.length - 1) return;
      const stage = ANALYSIS_STAGES[index];
      window.setTimeout(() => {
        if (cancelled) return;
        index += 1;
        setStageIndex(index);
        advance();
      }, (stage.weight / totalWeight) * estimatedMs);
    };

    setStageIndex(0);
    advance();
    return () => {
      cancelled = true;
    };
  }, [processing, done, sizeBytes]);

  useEffect(() => {
    if (done) setStageIndex(ANALYSIS_STAGES.length);
  }, [done]);

  const uploading = uploadPercent < 100 && !processing;

  return (
    <div className="w-full max-w-md">
      <div className="mb-5">
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-[13px] font-medium">
            {uploading ? 'Enviando arquivo' : done ? 'Análise concluída' : 'Analisando seus dados'}
          </p>
          <span className="text-xs tabular-nums text-ink-subtle">
            {uploading ? `${uploadPercent}%` : done ? '100%' : ''}
          </span>
        </div>
        <Progress
          value={done ? 100 : uploading ? uploadPercent : 100}
          tone={done ? 'positive' : 'primary'}
          className={cn(!uploading && !done && 'animate-pulse')}
        />
      </div>

      <ol className="space-y-2.5">
        {ANALYSIS_STAGES.map((stage, index) => {
          const complete = index < stageIndex;
          const active = index === stageIndex && processing && !done;
          const pending = index > stageIndex;

          return (
            <li
              key={stage.id}
              className={cn(
                'flex items-center gap-2.5 text-[13px] transition-all duration-300',
                complete && 'text-ink-muted',
                active && 'text-ink',
                pending && 'text-ink-subtle/50',
              )}
            >
              <span
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all duration-300',
                  complete && 'border-positive bg-positive text-white',
                  active && 'border-primary',
                  pending && 'border-line',
                )}
              >
                {complete ? (
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                ) : active ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />
                ) : null}
              </span>
              {stage.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
