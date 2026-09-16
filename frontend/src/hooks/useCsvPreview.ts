'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CsvPreviewResult } from '@/workers/csv-preview.worker';

/**
 * Runs the CSV pre-flight in a Web Worker so parsing a large file never blocks
 * the interface. Falls back to no preview if workers are unavailable.
 */
export function useCsvPreview() {
  const workerRef = useRef<Worker | null>(null);
  const [preview, setPreview] = useState<CsvPreviewResult | null>(null);
  const [analysing, setAnalysing] = useState(false);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const inspect = useCallback((file: File) => {
    setAnalysing(true);
    setPreview(null);

    try {
      workerRef.current?.terminate();
      const worker = new Worker(new URL('../workers/csv-preview.worker.ts', import.meta.url));
      workerRef.current = worker;

      worker.onmessage = (event: MessageEvent<CsvPreviewResult>) => {
        setPreview(event.data);
        setAnalysing(false);
      };
      worker.onerror = () => {
        setPreview(null);
        setAnalysing(false);
      };
      worker.postMessage({ file, maxRows: 6 });
    } catch {
      // No worker support: the server still validates the file on upload.
      setAnalysing(false);
    }
  }, []);

  const reset = useCallback(() => {
    setPreview(null);
    setAnalysing(false);
  }, []);

  return { preview, analysing, inspect, reset };
}
