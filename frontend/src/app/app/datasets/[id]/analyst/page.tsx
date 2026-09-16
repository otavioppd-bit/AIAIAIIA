'use client';

import { useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChatPanel } from '@/components/analyst/ChatPanel';
import { api } from '@/lib/api';
import { DEFAULT_WIDGET_STYLE } from '@/store/dashboardStore';
import { useDataset, usePrimaryDashboard } from '@/hooks/useDataset';
import { createId } from '@/lib/utils';
import type { AnalystChart, Widget } from '@/types/api';

export default function AnalystPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: dataset } = useDataset(params.id);
  const { dashboard } = usePrimaryDashboard(params.id);

  /**
   * Adding a chart the analyst produced persists the *encoding*, not the rows
   * it happened to return, so the widget re-queries live data and honours the
   * dashboard's filters like any other widget.
   */
  const addChartToDashboard = useCallback(
    async (chart: AnalystChart) => {
      if (!dashboard) {
        toast.error('Nenhum dashboard disponível para receber o gráfico.');
        return;
      }

      const widget: Widget = {
        id: createId(),
        type: 'chart',
        title: chart.title,
        subtitle: chart.subtitle || 'Criado a partir de uma pergunta ao analista',
        layout: { x: 0, y: 0, w: 6, h: 2 },
        config: {
          chart_type: chart.chart_type,
          encoding: chart.encoding,
          options: chart.options ?? {},
          style: { ...DEFAULT_WIDGET_STYLE },
        },
        rationale:
          'Visualização gerada a partir de uma pergunta no AI Data Analyst. '
          + 'Os dados são recalculados sobre o conjunto a cada carregamento.',
        principle: 'Pergunta → plano de consulta → visualização',
        locked: false,
      };

      try {
        const spec = { ...dashboard.spec, widgets: [...dashboard.spec.widgets, widget] };
        await api.dashboards.update(dashboard.id, { spec });
        // The detail query holds the spec; the list only holds metadata.
        await queryClient.invalidateQueries({ queryKey: ['dashboard', dashboard.id] });
        toast.success('Gráfico adicionado ao dashboard.', {
          action: {
            label: 'Ver',
            onClick: () => router.push(`/app/datasets/${params.id}/overview`),
          },
        });
      } catch {
        toast.error('Não foi possível adicionar o gráfico ao dashboard.');
      }
    },
    [dashboard, params.id, queryClient, router],
  );

  if (!dataset) return null;

  return (
    <div className="h-[calc(100vh-3.5rem)]">
      <ChatPanel
        datasetId={dataset.id}
        columnProfiles={dataset.profile.columns}
        onAddChartToDashboard={addChartToDashboard}
        className="h-full"
      />
    </div>
  );
}
