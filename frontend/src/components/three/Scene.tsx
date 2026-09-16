'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { cn } from '@/lib/utils';

interface SceneProps {
  children: React.ReactNode;
  className?: string;
  camera?: { position: [number, number, number]; fov?: number };
  /** Renders a static frame instead of animating, for reduced-motion users. */
  interactive?: boolean;
  fallback?: React.ReactNode;
}

/**
 * WebGL host.
 *
 * Three guards keep the 3D layer from costing what it is worth:
 *  - it only mounts once scrolled into view;
 *  - the frame loop stops while offscreen or when the tab is hidden;
 *  - device pixel ratio is capped at 2, and reduced-motion renders one frame.
 */
export function Scene({
  children,
  className,
  camera = { position: [0, 0, 6], fov: 45 },
  interactive = true,
  fallback,
}: SceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(query.matches);
    const listener = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '120px', threshold: 0.01 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // WebGL is unavailable in some environments; fail to the fallback rather
    // than crashing the page.
    try {
      const canvas = document.createElement('canvas');
      const supported =
        Boolean(canvas.getContext('webgl2')) || Boolean(canvas.getContext('webgl'));
      if (!supported) setFailed(true);
    } catch {
      setFailed(true);
    }
  }, []);

  const animate = interactive && !reducedMotion;

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {!failed && visible ? (
        <Canvas
          camera={{ position: camera.position, fov: camera.fov ?? 45, near: 0.1, far: 100 }}
          dpr={[1, 2]}
          frameloop={animate ? 'always' : 'demand'}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: false,
          }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 0);
          }}
          style={{ pointerEvents: 'none' }}
        >
          <Suspense fallback={null}>{children}</Suspense>
        </Canvas>
      ) : (
        fallback ?? null
      )}
    </div>
  );
}
