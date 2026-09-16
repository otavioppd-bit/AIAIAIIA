'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUp, Bot, CircleSlash, Info, Loader2, Plus, Sparkles, User,
} from 'lucide-react';
import { toast } from 'sonner';
import { EChart } from '@/components/charts/EChart';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { api, ApiError } from '@/lib/api';
import { buildChartOption } from '@/lib/chart-options';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';
import type { AnalystChart, ChatMessage, ColumnProfile } from '@/types/api';

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
          <div className="animate-fade-in">
            <div className="rounded-lg border border-line bg-surface-sunken p-4">
              <p className="text-[13px] font-medium">Pergunte sobre os seus dados</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                Toda resposta é calculada sobre o arquivo que você enviou. Se um número não existir
                nos dados, a resposta diz isso em vez de estimar.
              </p>
              {deterministic && (
                <p className="mt-2.5 flex items-start gap-1.5 rounded-md bg-surface p-2 text-2xs leading-relaxed text-ink-subtle">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                  Nenhum modelo de linguagem está configurado. As perguntas são interpretadas por
                  regras e respondidas com os números calculados — o recurso segue funcional.
                </p>
              )}
            </div>

            {suggestions.data && (
              <div className="mt-3 space-y-1.5">
                <p className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
                  Sugestões
                </p>
                {suggestions.data.questions.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => ask.mutate(question)}
                    className="flex w-full items-start gap-2 rounded-md border border-line p-2.5 text-left
                      text-[13px] text-ink-muted transition-all hover:border-primary/40 hover:bg-primary-soft/40 hover:text-ink"
                  >
                    <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                    {question}
                  </button>
                ))}
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

  const option =
    chart?.inline_data && chart.inline_data.rows.length > 0
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

          {option && chart && (
            <div className="mt-3">
              <div className="h-56 rounded-md border border-line bg-surface p-2">
                <EChart option={option} resetKey={chart.chart_type} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{chart.chart_type}</Badge>
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
