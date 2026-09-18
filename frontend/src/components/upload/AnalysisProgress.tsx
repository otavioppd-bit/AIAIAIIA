'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * The seven phases of the server's pipeline, in the order they run.
 *
 * They are not a script: each one is reported by the analyser as it begins, so
 * what the user watches is what the server did. Insights genuinely run before
 * chart selection — the list follows the code rather than rearranging itself to
 * look tidier.
 */
export const ANALYSIS_STAGES = [
  { id: 'read', label: 'Lendo o arquivo' },
  { id: 'schema', label: 'Entendendo as colunas' },
  { id: 'patterns', label: 'Detectando padrões' },
  { id: 'relations', label: 'Analisando relações' },
  { id: 'insights', label: 'Gerando insights' },
  { id: 'charts', label: 'Selecionando visualizações' },
  { id: 'build', label: 'Montando o dashboard' },
] as const;

const POLL_MS = 400;

interface AnalysisProgressProps {
  /** 0–100, the real upload progress reported by the request. */
  uploadPercent: number;
  /** True once the bytes are sent and the server is processing. */
  processing: boolean;
  /** True when the response has arrived. */
  done: boolean;
  /** Identifies this upload to the server's progress endpoint. */
  token?: string;
}

export function AnalysisProgress({
  uploadPercent,
  processing,
  done,
  token,
}: AnalysisProgressProps) {
  const [stageIndex, setStageIndex] = useState(-1);
  const highWater = useRef(-1);

  useEffect(() => {
    if (!processing || done || !token) return undefined;

    let cancelled = false;
    let timer: number;

    const poll = async () => {
      try {
        const state = await api.datasets.analysisProgress(token);
        if (cancelled) return;
        if (typeof state.index === 'number') {
          // Never walk backwards: a poll can land on a stale read, and a
          // sequence that retreats looks broken even when the work is fine.
          highWater.current = Math.max(highWater.current, state.index);
          setStageIndex(highWater.current);
        }
      } catch {
        // A dropped poll is not worth surfacing — the upload is unaffected and
        // the next tick will catch up.
      }
      if (!cancelled) timer = window.setTimeout(poll, POLL_MS);
    };

    poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [processing, done, token]);

  useEffect(() => {
    if (done) {
      highWater.current = ANALYSIS_STAGES.length;
      setStageIndex(ANALYSIS_STAGES.length);
    }
  }, [done]);

  const uploading = uploadPercent < 100 && !processing;
  const reached = done ? ANALYSIS_STAGES.length : stageIndex;

  return (
    <div className="w-full max-w-lg">
      <p className="eyebrow text-primary">
        {uploading ? 'Enviando' : done ? 'Concluído' : 'Analisando'}
      </p>
      <p className="display mt-3 text-[26px] sm:text-[32px]">
        {uploading
          ? 'Enviando seu arquivo'
          : done
            ? 'Dashboard pronto'
            : 'Entendendo seus dados'}
      </p>

      {uploading && (
        <div className="mt-5">
          <div className="h-px w-full bg-line">
            <div
              className="h-px bg-primary transition-[width] duration-200"
              style={{ width: `${uploadPercent}%` }}
            />
          </div>
          <p className="numeric mono-label mt-2 text-[10px] text-ink-subtle">{uploadPercent}%</p>
        </div>
      )}

      <ol className="mt-8 space-y-0">
        {ANALYSIS_STAGES.map((stage, index) => {
          const complete = index < reached;
          const active = index === reached && !done;
          const pending = index > reached;

          return (
            <li
              key={stage.id}
              className={cn(
                'flex items-center gap-4 border-t border-dashed border-line-strong/40 py-2.5',
                'transition-colors duration-300',
                complete && 'text-ink-muted',
                active && 'text-ink',
                pending && 'text-ink-subtle/40',
              )}
            >
              <span className="mono-label w-5 shrink-0 text-[10px]">
                {String(index + 1).padStart(2, '0')}
              </span>

              {/* A measured rule rather than a spinner: the row itself fills. */}
              <span className="relative h-px flex-1 bg-line/60">
                <span
                  className={cn(
                    'absolute inset-y-0 left-0 bg-primary transition-[width] duration-500 ease-smooth',
                    complete ? 'w-full' : active ? 'w-1/3 animate-pulse' : 'w-0',
                  )}
                />
              </span>

              <span className="w-52 shrink-0 text-right text-body-sm">{stage.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
