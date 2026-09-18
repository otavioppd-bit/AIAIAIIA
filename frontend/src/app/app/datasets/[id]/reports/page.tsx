'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { api } from '@/lib/api';
import { downloadMarkdown } from '@/lib/export';
import { useDataset } from '@/hooks/useDataset';

export default function ReportsPage() {
  const params = useParams<{ id: string }>();
  const { data: dataset } = useDataset(params.id);

  const report = useQuery({
    queryKey: ['report', params.id],
    queryFn: () => api.datasets.report(params.id),
    enabled: Boolean(params.id),
    staleTime: 5 * 60_000,
  });

  const blocks = useMemo(
    () => (report.data ? parseMarkdown(report.data.markdown) : []),
    [report.data],
  );

  if (!dataset) return null;

  return (
    <div className="p-4 sm:p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.02em]">Reports</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            Relatório de insights montado a partir da análise do seu arquivo.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<Printer className="h-3.5 w-3.5" />}
            onClick={() => window.print()}
          >
            Imprimir
          </Button>
          <Button
            size="sm"
            icon={<Download className="h-3.5 w-3.5" />}
            disabled={!report.data}
            onClick={() => {
              if (!report.data) return;
              downloadMarkdown(report.data.markdown, `${dataset.name}-insights`);
              toast.success('Relatório exportado.');
            }}
          >
            Baixar Markdown
          </Button>
        </div>
      </header>

      {report.isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-ink-subtle" />
        </div>
      ) : report.isError || !report.data ? (
        <EmptyState
          icon={<FileText className="h-5 w-5" />}
          title="Relatório indisponível"
          description="Não foi possível gerar o relatório para este conjunto de dados."
          className="rounded-lg border border-dashed border-line"
        />
      ) : (
        <Card className="mx-auto max-w-3xl">
          <CardContent className="pt-6">
            <article className="space-y-4">
              {blocks.map((block, index) => (
                <MarkdownBlock key={index} block={block} />
              ))}
            </article>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'rule' };

/**
 * A small, deliberately limited Markdown reader for the report the backend
 * produces. It handles only the constructs that report actually uses, and
 * renders text as text — no HTML is ever interpreted.
 */
function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith('---')) {
      blocks.push({ kind: 'rule' });
      index += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }

    if (line.startsWith('> ')) {
      blocks.push({ kind: 'quote', text: line.slice(2) });
      index += 1;
      continue;
    }

    if (line.startsWith('|')) {
      const tableLines: string[] = [];
      while (index < lines.length && lines[index].startsWith('|')) {
        tableLines.push(lines[index]);
        index += 1;
      }
      const cells = (row: string) =>
        row.split('|').slice(1, -1).map((cell) => cell.trim());
      const header = cells(tableLines[0]);
      // Line 1 is the alignment row; data starts at 2.
      const rows = tableLines.slice(2).map(cells);
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (index < lines.length && lines[index].startsWith('- ')) {
        items.push(lines[index].slice(2));
        index += 1;
      }
      blocks.push({ kind: 'list', items });
      continue;
    }

    blocks.push({ kind: 'paragraph', text: line });
    index += 1;
  }

  return blocks;
}

/** Renders **bold** and *italic* as elements; everything else stays literal. */
function inline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return (
        <em key={index} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

function MarkdownBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading': {
      const sizes = ['text-xl', 'text-lg', 'text-base', 'text-[15px]'];
      const Tag = (['h1', 'h2', 'h3', 'h4'] as const)[block.level - 1] ?? 'h4';
      return (
        <Tag
          className={`${sizes[block.level - 1] ?? 'text-[15px]'} font-semibold tracking-[-0.015em] ${
            block.level > 1 ? 'mt-6' : ''
          }`}
        >
          {inline(block.text)}
        </Tag>
      );
    }
    case 'paragraph':
      return <p className="text-[13.5px] leading-relaxed text-ink-muted">{inline(block.text)}</p>;
    case 'quote':
      return (
        <p className="border-l-2 border-primary/40 py-1 pl-3 text-xs italic leading-relaxed text-ink-subtle">
          {inline(block.text)}
        </p>
      );
    case 'list':
      return (
        <ul className="space-y-1.5">
          {block.items.map((item, index) => (
            <li key={index} className="flex items-start gap-2 text-[13.5px] leading-relaxed text-ink-muted">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
              <span>{inline(item)}</span>
            </li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-surface-sunken">
                {block.header.map((cell, index) => (
                  <th key={index} className="border-b border-line px-3 py-2 text-left font-medium text-ink-muted">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-line/60 last:border-0">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-3 py-2 text-ink-muted">
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rule':
      return <hr className="border-line" />;
    default:
      return null;
  }
}
