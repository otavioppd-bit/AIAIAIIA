'use client';

import { useEffect, useRef } from 'react';
import type { EChartsOption } from 'echarts';
import type { ECharts } from 'echarts/core';
import echarts from '@/lib/echarts';
import { cn } from '@/lib/utils';

interface EChartProps {
  option: EChartsOption;
  className?: string;
  onReady?: (instance: ECharts) => void;
  /** Re-creates the instance instead of merging — used when the type changes. */
  resetKey?: string;
}

/**
 * Thin ECharts binding.
 *
 * A ResizeObserver drives resize rather than a window listener, so a chart
 * inside a resizable dashboard widget reflows when its own box changes.
 */
export function EChart({ option, className, onReady, resetKey }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ECharts | null>(null);
  const previousResetKey = useRef(resetKey);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const instance = echarts.init(container, undefined, {
      renderer: 'canvas',
      // Charts are only ever visible inside a laid-out card; without this the
      // first render in a freshly mounted grid cell can measure zero.
      width: 'auto',
      height: 'auto',
    });
    instanceRef.current = instance;
    onReady?.(instance);

    const observer = new ResizeObserver(() => {
      instance.resize();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      instance.dispose();
      instanceRef.current = null;
    };
    // `onReady` is intentionally excluded: callers pass inline callbacks and
    // re-initialising the chart on every render would kill its animations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    // Changing the chart type leaves stale axes behind unless the option is
    // replaced wholesale rather than merged.
    const replace = previousResetKey.current !== resetKey;
    previousResetKey.current = resetKey;
    instance.setOption(option, { notMerge: replace, lazyUpdate: true });
  }, [option, resetKey]);

  return <div ref={containerRef} className={cn('h-full w-full', className)} role="img" />;
}
