'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export type FieldVariant = 'hero' | 'dashboard' | 'analyst' | 'quality' | 'upload';

interface BackgroundFieldProps {
  variant?: FieldVariant;
  /** Pointer parallax. Off for dense screens, where movement is a distraction. */
  interactive?: boolean;
  className?: string;
}

/**
 * The environment every screen sits on.
 *
 * Built from CSS and inline SVG rather than a canvas: the whole field costs one
 * paint and no frame loop, which is what lets it run behind a dashboard that is
 * already spending its budget on charts and WebGL.
 *
 * Pointer parallax writes to CSS custom properties on the container, so moving
 * the mouse never re-renders React — it only moves two layers by a few pixels.
 */
export function BackgroundField({
  variant = 'dashboard',
  interactive = true,
  className,
}: BackgroundFieldProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!interactive) return undefined;
    const element = ref.current;
    if (!element) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        // −1..1 from the viewport centre, then damped hard: the field should
        // feel like it has depth, not like it is following the cursor.
        const x = (event.clientX / window.innerWidth - 0.5) * 2;
        const y = (event.clientY / window.innerHeight - 0.5) * 2;
        element.style.setProperty('--px', x.toFixed(3));
        element.style.setProperty('--py', y.toFixed(3));
      });
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [interactive]);

  return (
    <div
      ref={ref}
      aria-hidden
      data-variant={variant}
      className={cn('field', className)}
      style={{ ['--px' as string]: 0, ['--py' as string]: 0 }}
    >
      <div className="field-wash" />
      {(variant === 'hero' || variant === 'upload') && <div className="field-horizon" />}
      {variant !== 'hero' && variant !== 'upload' && <div className="field-grid" />}
      {(variant === 'analyst' || variant === 'hero' || variant === 'upload') && <FieldNodes />}
      {variant === 'quality' && <FieldWireframe />}
      <div className="field-grain" />
      <div className="field-vignette" />
    </div>
  );
}

/**
 * Data nodes: the same vocabulary the 3D structure is built from, so the
 * background reads as the far field of one continuous space rather than
 * decoration behind an unrelated object.
 */
function FieldNodes() {
  return (
    <svg className="field-nodes" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
      <g stroke="currentColor" strokeWidth="0.5" opacity="0.55">
        {NODE_EDGES.map(([a, b], index) => (
          <line
            key={index}
            x1={NODES[a][0]}
            y1={NODES[a][1]}
            x2={NODES[b][0]}
            y2={NODES[b][1]}
          />
        ))}
      </g>
      <g fill="currentColor">
        {NODES.map(([x, y, r], index) => (
          <circle key={index} cx={x} cy={y} r={r} opacity={0.35 + r * 0.22}>
            <animate
              attributeName="opacity"
              values={`${0.2 + r * 0.16};${0.5 + r * 0.2};${0.2 + r * 0.16}`}
              dur={`${5 + (index % 5)}s`}
              repeatCount="indefinite"
            />
          </circle>
        ))}
      </g>
    </svg>
  );
}

/** Ordinate pattern for Data Quality: measurement, not atmosphere. */
function FieldWireframe() {
  return (
    <svg className="field-wireframe" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id="bp-ticks" width="100" height="100" patternUnits="userSpaceOnUse">
          <path d="M0 0 H100 M0 0 V100" stroke="currentColor" strokeWidth="0.5" fill="none" />
          <path d="M20 0 V6 M40 0 V6 M60 0 V6 M80 0 V6" stroke="currentColor" strokeWidth="0.5" />
          <path d="M0 20 H6 M0 40 H6 M0 60 H6 M0 80 H6" stroke="currentColor" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#bp-ticks)" />
    </svg>
  );
}

// Hand-placed so the constellation reads as a structure rather than noise:
// a denser core, a sparse periphery. [x, y, radius]
const NODES: [number, number, number][] = [
  [140, 180, 1.6], [260, 120, 1.1], [360, 250, 2.1], [200, 330, 1.3],
  [480, 160, 1.4], [560, 320, 1.8], [420, 430, 1.1], [300, 520, 1.5],
  [660, 220, 1.2], [760, 380, 2.0], [620, 520, 1.3], [880, 180, 1.1],
  [960, 330, 1.6], [820, 600, 1.2], [1060, 460, 1.4], [520, 660, 1.0],
  [180, 620, 1.2], [1120, 250, 1.0], [700, 700, 1.3], [980, 660, 1.1],
];

const NODE_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [0, 3], [2, 4], [4, 5], [5, 6], [3, 7],
  [6, 7], [5, 8], [8, 9], [9, 10], [6, 10], [8, 11], [11, 12], [12, 9],
  [10, 13], [12, 14], [7, 15], [15, 18], [3, 16], [11, 17], [13, 18], [14, 19],
];
