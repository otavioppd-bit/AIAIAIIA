'use client';

import { DragEvent, useCallback, useRef, useState } from 'react';
import { AlertCircle, FileSpreadsheet, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useCsvPreview } from '@/hooks/useCsvPreview';
import { formatBytes, formatInteger } from '@/lib/format';
import { cn } from '@/lib/utils';

const MAX_BYTES = 100 * 1024 * 1024;
const ACCEPTED = ['.csv', '.tsv', '.txt'];

interface DropzoneProps {
  onSubmit: (file: File) => void;
  disabled?: boolean;
  className?: string;
}

export function Dropzone({ onSubmit, disabled, className }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const { preview, analysing, inspect, reset } = useCsvPreview();

  const accept = useCallback(
    (candidate: File | undefined) => {
      setError('');
      if (!candidate) return;

      const name = candidate.name.toLowerCase();
      if (!ACCEPTED.some((extension) => name.endsWith(extension))) {
        setError('Formato não suportado. Envie um arquivo .csv, .tsv ou .txt.');
        return;
      }
      if (candidate.size > MAX_BYTES) {
        setError(
          `O arquivo tem ${formatBytes(candidate.size)} e o limite é ${formatBytes(MAX_BYTES)}.`,
        );
        return;
      }
      if (candidate.size === 0) {
        setError('O arquivo está vazio.');
        return;
      }

      setFile(candidate);
      inspect(candidate);
    },
    [inspect],
  );

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    accept(event.dataTransfer.files?.[0]);
  };

  const clear = () => {
    setFile(null);
    setError('');
    reset();
    if (inputRef.current) inputRef.current.value = '';
  };

  if (file) {
    return (
      <div className={cn('rounded-xl border border-line bg-surface p-5', className)}>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <FileSpreadsheet className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium" title={file.name}>
              {file.name}
            </p>
            <p className="mt-0.5 text-xs text-ink-subtle">
              {formatBytes(file.size)}
              {preview?.ok && ` · ~${formatInteger(preview.estimatedRows)} linhas · ${preview.columns.length} colunas`}
              {analysing && ' · analisando…'}
            </p>
          </div>
          <Button variant="ghost" size="xs" onClick={clear} disabled={disabled} icon={<X className="h-3.5 w-3.5" />}>
            Trocar
          </Button>
        </div>

        {preview?.ok && preview.columns.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-md border border-line">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-surface-sunken">
                    {preview.columns.slice(0, 7).map((column, index) => (
                      <th
                        key={`${column}-${index}`}
                        className="whitespace-nowrap border-b border-line px-2.5 py-1.5 text-left font-medium text-ink-muted"
                      >
                        {column || `coluna ${index + 1}`}
                      </th>
                    ))}
                    {preview.columns.length > 7 && (
                      <th className="border-b border-line px-2.5 py-1.5 text-left text-ink-subtle">
                        +{preview.columns.length - 7}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 4).map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-b border-line/50 last:border-0">
                      {row.slice(0, 7).map((cell, cellIndex) => (
                        <td key={cellIndex} className="max-w-[140px] truncate px-2.5 py-1.5 text-ink-muted">
                          {cell || '—'}
                        </td>
                      ))}
                      {preview.columns.length > 7 && <td className="px-2.5 py-1.5 text-ink-subtle">…</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {preview && !preview.ok && (
          <p className="mt-3 flex items-start gap-1.5 rounded-md border border-warning/25 bg-warning/10 p-2.5 text-xs text-warning">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {preview.error} Você ainda pode tentar enviar — o servidor fará uma validação completa.
          </p>
        )}

        <Button
          fullWidth
          className="mt-4"
          loading={disabled}
          onClick={() => onSubmit(file)}
          icon={<Upload className="h-4 w-4" />}
        >
          Analisar e gerar dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className={className}>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Selecionar arquivo CSV"
        className={cn(
          'group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden',
          'rounded-xl px-6 py-16 text-center transition-colors duration-200 sm:py-20',
          'border border-dashed',
          dragging
            ? 'border-primary bg-primary/[0.06]'
            : 'border-line-strong/60 bg-surface/40 hover:border-ink/40',
          disabled && 'pointer-events-none opacity-50',
        )}
      >
        <DropField active={dragging} />

        <div className="relative z-10">
          <p className="eyebrow text-primary">01 · Envie seus dados</p>
          <p className="display mt-4 text-[26px] text-ink sm:text-[34px]">
            {dragging ? 'Solte para começar' : 'Solte seu CSV aqui'}
          </p>
          <p className="mt-3 text-body-sm text-ink-muted">
            Ou clique para escolher um arquivo. A plataforma lê o resto sozinha.
          </p>
          <p className="mono-label mt-6 text-[10px] text-ink-subtle">
            csv · tsv · txt — até {formatBytes(MAX_BYTES)} — separador detectado
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.tsv,.txt,text/csv"
        className="sr-only"
        onChange={(event) => accept(event.target.files?.[0])}
        disabled={disabled}
      />

      {error && (
        <p role="alert" className="mt-3 flex items-start gap-1.5 rounded-md border border-negative/25 bg-negative/10 p-2.5 text-xs text-negative">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The drop target as a data field: ruled floor, converging lines and a few
 * nodes waiting to be filled. It reacts to the drag rather than animating on
 * its own, so an idle page stays still.
 */
function DropField({ active }: { active: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 600 260"
      preserveAspectRatio="xMidYMid slice"
      className={cn(
        'pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-300',
        active ? 'opacity-90 text-primary' : 'opacity-40 text-primary group-hover:opacity-60',
      )}
    >
      {/* Lines converging on the centre, where the file lands. */}
      <g stroke="currentColor" strokeWidth="0.5" opacity="0.5">
        {Array.from({ length: 13 }, (_, i) => {
          const x = (i / 12) * 600;
          return <line key={i} x1={x} y1={260} x2={300} y2={96} />;
        })}
      </g>
      <g stroke="currentColor" strokeWidth="0.5" opacity="0.28">
        {[170, 196, 222, 248].map((y) => (
          <line key={y} x1={0} y1={y} x2={600} y2={y} />
        ))}
      </g>
      <g fill="currentColor">
        {[[92, 58], [168, 34], [430, 42], [520, 70], [268, 26], [352, 60]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={active ? 2 : 1.4} opacity={0.5} />
        ))}
      </g>
    </svg>
  );
}
