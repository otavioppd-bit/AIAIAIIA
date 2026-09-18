'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUp, Bot, CircleSlash, Info, Loader2, Plus, User,
} from 'lucide-react';
import { toast } from 'sonner';
import { EChart } from '@/components/charts/EChart';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { api, ApiError } from '@/lib/api';
import { buildChartOption } from '@/lib/chart-options';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';
import { formatValue, humanize } from '@/lib/format';
import type { AnalystChart, ChatMessage, ColumnProfile } from '@/types/api';

const CHART_LABELS: Record<string, string> = {
  line: 'Linha', area: 'Área', bar: 'Barras', bar_horizontal: 'Barras horizontais',
  stacked_bar: 'Barras empilhadas', scatter: 'Dispersão', donut: 'Rosca', pie: 'Pizza',
  histogram: 'Histograma', box_plot: 'Box plot', heatmap: 'Mapa de calor',
  treemap: 'Treemap', radar: 'Radar', funnel: 'Funil', table: 'Tabela', kpi: 'Indicador',
};

/**
 * The hero-number form. When the answer is a single value, the value is the
 * whole visualisation — a one-bar bar chart would say nothing more.
 */
function SingleValue({ chart }: { chart: AnalystChart }) {
  const columns = chart.inline_data?.columns ?? [];
  const row = chart.inline_data?.rows[0];
  if (!row || columns.length === 0) return null;

  const measure = columns[columns.length - 1];
  const dimension = columns.length > 1 ? columns[0] : null;
  const value = row[measure];

  return (
    <div className="mt-3 rounded-md border border-line bg-surface p-4">
      {dimension && (
        <p className="truncate text-xs text-ink-subtle" title={String(row[dimension])}>
          {humanize(dimension)}: <span className="text-ink-muted">{String(row[dimension])}</span>
        </p>
      )}
      <p className="mt-1 truncate text-2xl font-semibold tabular-nums tracking-[-0.03em]">
        {typeof value === 'number' ? formatValue(value, 'auto', { compact: true }) : String(value)}
      </p>
      <p className="mt-0.5 text-xs text-ink-subtle">{humanize(measure)}</p>
    </div>
  );
}

interface ChatPanelProps {
  datasetId: string;
  columnProfiles: ColumnProfile[];
  className?: string;
  onAddChartToDashboard?: (chart: AnalystChart) => void;
}

export function ChatPanel({
  datasetId,
  columnProfiles,
  className,
  onAddChartToDashboard,
}: ChatPanelProps) {
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const aiStatus = useQuery({
    queryKey: ['ai-status'],
    queryFn: api.analyst.status,
    staleTime: 10 * 60_000,
  });

  const suggestions = useQuery({
    queryKey: ['suggested-questions', datasetId],
    queryFn: () => api.datasets.suggestedQuestions(datasetId),
    staleTime: 15 * 60_000,
  });

  const ask = useMutation({
    mutationFn: (question: string) => api.analyst.ask(datasetId, question, conversationId),
    onMutate: (question) => {
      // Optimistic echo so the question appears the instant it is sent.
      const optimistic: ChatMessage = {
        id: `local-${Date.now()}`,
        role: 'user',
        content: question,
        created_at: new Date().toISOString(),
      };
      setMessages((current) => [...current, optimistic]);
      setDraft('');
    },
    onSuccess: (response) => {
      setConversationId(response.conversation_id);
      setMessages((current) => [...current, response.message]);
      void queryClient.invalidateQueries({ queryKey: ['conversations', datasetId] });
    },
    onError: (error) => {
      const message =
        error instanceof ApiError ? error.message : 'Não foi possível processar a pergunta.';
      toast.error(message);
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: message,
          payload: { intent: 'error' },
          created_at: new Date().toISOString(),
        },
      ]);
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, ask.isPending]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const question = draft.trim();
    if (!question || ask.isPending) return;
    ask.mutate(question);
  }

  function startNew() {
    setConversationId(null);
    setMessages([]);
    inputRef.current?.focus();
  }

  const deterministic = aiStatus.data?.mode === 'deterministic';

  return (
    <div className={cn('flex h-full flex-col bg-surface', className)}>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
            <Bot className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">AI Data Analyst</p>
            <p className="truncate text-2xs text-ink-subtle">
              {aiStatus.isLoading
                ? 'verificando…'
                : deterministic
                  ? 'modo determinístico'
                  : `${aiStatus.data?.provider} · ${aiStatus.data?.model}`}
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <IconButton label="Nova conversa" size="sm" onClick={startNew}>
            <Plus className="h-4 w-4" />
          </IconButton>
        )}
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="animate-fade-in mx-auto max-w-3xl pt-6 sm:pt-10">
            <div className="text-center">
              <p className="eyebrow text-primary">Analista de dados</p>
              <p className="display mt-4 text-[28px] text-ink sm:text-[34px]">
                Pergunte sobre os seus dados.
              </p>
              <p className="mx-auto mt-4 max-w-md text-body-sm leading-relaxed text-ink-muted">
                Toda resposta é calculada sobre o arquivo que você enviou. Se um número não existir
                nos dados, a resposta diz isso em vez de estimar.
              </p>
              {deterministic && (
                <p className="mx-auto mt-5 flex max-w-lg items-start gap-2 rounded-md border border-dashed border-line-strong/50 p-2.5 text-left text-2xs leading-relaxed text-ink-subtle">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                  Nenhum modelo de linguagem está configurado. As perguntas são interpretadas por
                  regras e respondidas com os números calculados — o recurso segue funcional.
                </p>
              )}
            </div>

            {suggestions.data && (
              <div className="mt-10">
                <p className="mono-label mb-3 text-[10px] text-ink-subtle">
                  Comece por uma destas
                </p>
                {/* Two columns and numbered, so eight prompts read as a menu
                    rather than as eight identical rows of the same thing. */}
                <ul className="grid gap-px overflow-hidden rounded-lg border border-dashed border-line-strong/50 sm:grid-cols-2">
                  {suggestions.data.questions.map((question, index) => (
                    <li key={question}>
                      <button
                        type="button"
                        onClick={() => ask.mutate(question)}
                        className="group flex h-full w-full items-start gap-3 bg-surface/40 p-4 text-left
                          transition-colors hover:bg-surface"
                      >
                        <span className="mono-label mt-px shrink-0 text-[10px] text-ink-subtle transition-colors group-hover:text-primary">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className="text-body-sm leading-snug text-ink-muted transition-colors group-hover:text-ink">
                          {question}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            columnProfiles={columnProfiles}
            onAskFollowUp={(question) => ask.mutate(question)}
            onAddChart={onAddChartToDashboard}
          />
        ))}

        {ask.isPending && (
          <div className="flex items-center gap-2 text-[13px] text-ink-subtle">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Calculando sobre os dados…
          </div>
        )}
      </div>

      <form onSubmit={submit} className="shrink-0 border-t border-line p-3">
        <div className="relative">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit(event);
              }
            }}
            rows={2}
            placeholder="Ex.: qual mês teve o maior faturamento?"
            aria-label="Pergunta para o analista"
            className="w-full resize-none rounded-lg border border-line bg-surface-sunken py-2.5 pl-3 pr-11
              text-[13px] leading-relaxed text-ink placeholder:text-ink-subtle outline-none
              transition-all focus:border-primary focus:bg-surface focus:ring-2 focus:ring-primary/20"
          />
          <button
            type="submit"
            disabled={!draft.trim() || ask.isPending}
            aria-label="Enviar pergunta"
            className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-md
              bg-primary text-primary-ink transition-all hover:brightness-110 disabled:opacity-35"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({
  message,
  columnProfiles,
  onAskFollowUp,
  onAddChart,
}: {
  message: ChatMessage;
  columnProfiles: ColumnProfile[];
  onAskFollowUp: (question: string) => void;
  onAddChart?: (chart: AnalystChart) => void;
}) {
  const { mode } = useTheme();
  const isUser = message.role === 'user';
  const chart = message.payload?.chart ?? null;
  const followUps = message.payload?.follow_ups ?? [];
  const source = message.payload?.source;

  // A one-row answer is a number, not a plot: rendering it as a single bar
  // would be a chart with nothing to compare against.
  const isSingleValue =
    chart?.chart_type === 'kpi' || (chart?.inline_data?.rows.length ?? 0) === 1;

  const option =
    chart?.inline_data && chart.inline_data.rows.length > 0 && !isSingleValue
      ? buildChartOption({
          mode,
          chartType: chart.chart_type,
          data: {
            columns: chart.inline_data.columns,
            rows: chart.inline_data.rows,
            row_count: chart.inline_data.rows.length,
            truncated: false,
            notes: [],
            meta: {},
          },
          encoding: chart.encoding,
          style: { showLegend: true, showGrid: true },
        })
      : null;

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[85%] items-start gap-2">
          <p className="rounded-lg rounded-tr-sm bg-primary px-3 py-2 text-[13px] leading-relaxed text-primary-ink">
            {message.content}
          </p>
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-raised text-ink-subtle">
            <User className="h-3 w-3" />
          </span>
        </div>
      </div>
    );
  }

  const isError = message.payload?.intent === 'error';

  return (
    <div className="flex items-start gap-2">
      <span
        className={cn(
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
          isError ? 'bg-negative/10 text-negative' : 'bg-primary-soft text-primary',
        )}
      >
        {isError ? <CircleSlash className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
      </span>

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'rounded-lg rounded-tl-sm border p-3',
            isError ? 'border-negative/25 bg-negative/5' : 'border-line bg-surface-sunken',
          )}
        >
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{message.content}</p>

          {chart && isSingleValue && chart.inline_data?.rows[0] && (
            <SingleValue chart={chart} />
          )}

          {option && chart && (
            <div className="mt-3">
              <div className="h-56 rounded-md border border-line bg-surface p-2">
                <EChart option={option} resetKey={chart.chart_type} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{CHART_LABELS[chart.chart_type] ?? chart.chart_type}</Badge>
                {onAddChart && (
                  <Button size="xs" variant="secondary" onClick={() => onAddChart(chart)}>
                    Adicionar ao dashboard
                  </Button>
                )}
              </div>
            </div>
          )}

          {source && !isError && (
            <p className="mt-2.5 border-t border-line pt-2 text-2xs text-ink-subtle">
              {source.startsWith('llm')
                ? 'Números calculados pelo motor determinístico; texto redigido por modelo.'
                : 'Pergunta interpretada por regras e respondida com números calculados.'}
            </p>
          )}
        </div>

        {followUps.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {followUps.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => onAskFollowUp(question)}
                className="rounded-full border border-line px-2.5 py-1 text-2xs text-ink-muted
                  transition-all hover:border-primary/40 hover:text-primary"
              >
                {question}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
