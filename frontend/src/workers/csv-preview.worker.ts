/**
 * Client-side CSV pre-flight, off the main thread.
 *
 * Parses only the head of the file to show a preview and to catch obviously
 * broken uploads before spending a round trip. The server re-validates
 * everything — this is a courtesy, never a trust boundary.
 */
import Papa from 'papaparse';

export interface CsvPreviewRequest {
  file: File;
  maxRows: number;
}

export interface CsvPreviewResult {
  ok: boolean;
  error?: string;
  columns: string[];
  rows: string[][];
  delimiter: string;
  estimatedRows: number;
  sizeBytes: number;
}

const HEAD_BYTES = 512 * 1024;

self.onmessage = async (event: MessageEvent<CsvPreviewRequest>) => {
  const { file, maxRows = 8 } = event.data;

  try {
    const slice = file.slice(0, Math.min(HEAD_BYTES, file.size));
    const text = await slice.text();

    const parsed = Papa.parse<string[]>(text, {
      skipEmptyLines: 'greedy',
      preview: maxRows + 1,
    });

    if (!parsed.data || parsed.data.length === 0) {
      post({
        ok: false,
        error: 'O arquivo não contém linhas legíveis.',
        columns: [],
        rows: [],
        delimiter: ',',
        estimatedRows: 0,
        sizeBytes: file.size,
      });
      return;
    }

    const [header, ...rows] = parsed.data;
    if (!header || header.length === 0) {
      post({
        ok: false,
        error: 'Não foi possível identificar o cabeçalho do CSV.',
        columns: [],
        rows: [],
        delimiter: parsed.meta.delimiter ?? ',',
        estimatedRows: 0,
        sizeBytes: file.size,
      });
      return;
    }

    // A header with nothing under it parses cleanly and then fails on the
    // server, so it is caught here — before the user waits for an upload that
    // was never going to work.
    const dataRows = rows.filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''));
    if (dataRows.length === 0) {
      post({
        ok: false,
        error: 'O arquivo tem cabeçalho mas nenhuma linha de dados.',
        columns: header.map((value, index) => String(value ?? `coluna_${index + 1}`).trim()),
        rows: [],
        delimiter: parsed.meta.delimiter ?? ',',
        estimatedRows: 0,
        sizeBytes: file.size,
      });
      return;
    }

    // Estimate total rows from the average line length in the sampled head.
    const sampledLines = text.split('\n').length;
    const bytesPerLine = slice.size / Math.max(sampledLines, 1);
    const estimatedRows = Math.max(
      dataRows.length,
      Math.round(file.size / Math.max(bytesPerLine, 1)) - 1,
    );

    post({
      ok: true,
      columns: header.map((value, index) => String(value ?? `coluna_${index + 1}`).trim()),
      rows: dataRows.slice(0, maxRows).map((row) => row.map((cell) => String(cell ?? ''))),
      delimiter: parsed.meta.delimiter ?? ',',
      estimatedRows,
      sizeBytes: file.size,
    });
  } catch (error) {
    post({
      ok: false,
      error: error instanceof Error ? error.message : 'Falha ao ler o arquivo.',
      columns: [],
      rows: [],
      delimiter: ',',
      estimatedRows: 0,
      sizeBytes: file.size,
    });
  }
};

function post(result: CsvPreviewResult) {
  (self as unknown as Worker).postMessage(result);
}
