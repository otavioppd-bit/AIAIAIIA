/**
 * Client-side export: PNG and PDF snapshots of the rendered dashboard.
 *
 * CSV and the insights report come from the backend so they reflect the stored
 * data rather than the DOM.
 */
import { downloadBlob, slugify } from '@/lib/utils';

interface CaptureOptions {
  /** Background colour baked into the image; transparent PNGs print badly. */
  backgroundColor?: string;
  scale?: number;
}

function resolveBackground(fallback?: string): string {
  if (fallback) return fallback;
  if (typeof window === 'undefined') return '#ffffff';
  const value = getComputedStyle(document.documentElement).getPropertyValue('--color-canvas').trim();
  if (!value) return '#ffffff';
  return `rgb(${value.replace(/\s+/g, ' ')})`;
}

/**
 * Elements that must not appear in an export: hover-only affordances, edit
 * chrome and scrollbars.
 */
function prepareForCapture(element: HTMLElement): () => void {
  const hidden = Array.from(element.querySelectorAll<HTMLElement>('.presentation-hide'));
  const previous = hidden.map((node) => node.style.display);
  hidden.forEach((node) => {
    node.style.display = 'none';
  });
  return () => {
    hidden.forEach((node, index) => {
      node.style.display = previous[index];
    });
  };
}

export async function exportElementToPng(
  element: HTMLElement,
  filename: string,
  options: CaptureOptions = {},
): Promise<void> {
  const { toPng } = await import('html-to-image');
  const restore = prepareForCapture(element);
  try {
    const dataUrl = await toPng(element, {
      cacheBust: true,
      pixelRatio: options.scale ?? 2,
      backgroundColor: resolveBackground(options.backgroundColor),
      // Google Fonts are cross-origin; skipping them avoids a CORS failure and
      // the rendered text still uses the already-loaded family.
      filter: (node) =>
        !(node instanceof HTMLElement && node.dataset.exportIgnore === 'true'),
    });
    const blob = await (await fetch(dataUrl)).blob();
    downloadBlob(blob, `${slugify(filename) || 'dashboard'}.png`);
  } finally {
    restore();
  }
}

export async function exportElementToPdf(
  element: HTMLElement,
  filename: string,
  options: CaptureOptions & { title?: string } = {},
): Promise<void> {
  const [{ toPng }, { jsPDF }] = await Promise.all([
    import('html-to-image'),
    import('jspdf'),
  ]);
  const restore = prepareForCapture(element);

  try {
    const dataUrl = await toPng(element, {
      cacheBust: true,
      pixelRatio: options.scale ?? 2,
      backgroundColor: resolveBackground(options.backgroundColor),
    });

    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Falha ao renderizar a imagem do dashboard.'));
      image.src = dataUrl;
    });

    // Landscape A4, with the capture scaled to fit inside a 12mm margin.
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 12;
    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2;

    const ratio = Math.min(maxWidth / image.width, maxHeight / image.height);
    const width = image.width * ratio;
    const height = image.height * ratio;

    pdf.addImage(dataUrl, 'PNG', (pageWidth - width) / 2, margin, width, height, undefined, 'FAST');

    if (options.title) {
      pdf.setFontSize(8);
      pdf.setTextColor(140);
      pdf.text(
        `${options.title} · gerado em ${new Date().toLocaleString('pt-BR')}`,
        margin,
        pageHeight - 5,
      );
    }

    pdf.save(`${slugify(filename) || 'dashboard'}.pdf`);
  } finally {
    restore();
  }
}

/** Exports arbitrary rows the user is looking at (e.g. an Explore result). */
export function exportRowsToCsv(
  columns: string[],
  rows: Record<string, unknown>[],
  filename: string,
): void {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    let text = String(value);
    // Neutralise spreadsheet formula triggers, but never a plain negative
    // number: prefixing "-1234.5" would turn a value into text.
    const looksLikeNumber = /^[+-]?(\d+([.,]\d+)?|[.,]\d+)$/.test(text.trim());
    if (/^[=@\t\r]/.test(text) || (/^[+-]/.test(text) && !looksLikeNumber)) {
      text = `'${text}`;
    }
    if (/[",;\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
    return text;
  };

  const lines = [
    columns.map(escape).join(','),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(',')),
  ];
  // The BOM makes Excel open UTF-8 accented text correctly.
  const blob = new Blob(['﻿', lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `${slugify(filename) || 'dados'}.csv`);
}

export function downloadMarkdown(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
  downloadBlob(blob, `${slugify(filename) || 'relatorio'}.md`);
}
