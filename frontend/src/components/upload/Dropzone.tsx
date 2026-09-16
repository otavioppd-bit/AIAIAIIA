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
          'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-all duration-200 sm:p-12',
          dragging
            ? 'border-primary bg-primary-soft/50 scale-[1.01]'
            : 'border-line bg-surface/50 hover:border-line-strong hover:bg-surface',
          disabled && 'pointer-events-none opacity-50',
        )}
      >
        <span
          className={cn(
            'flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-surface transition-transform duration-200',
            dragging && 'scale-110 border-primary text-primary',
          )}
        >
          <Upload className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-medium">
            {dragging ? 'Solte o arquivo aqui' : 'Arraste seu CSV ou clique para selecionar'}
          </p>
          <p className="mt-1 text-xs text-ink-subtle">
            .csv, .tsv ou .txt · até {formatBytes(MAX_BYTES)} · separadores , ; tab | detectados automaticamente
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
