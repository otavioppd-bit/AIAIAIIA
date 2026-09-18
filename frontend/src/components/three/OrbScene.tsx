'use client';

import { Scene } from './Scene';
import { DataLattice } from './DataLattice';
import { OrbPlaceholder } from './LazyDataOrb';
import { PALETTES } from '@/lib/palette';
import { useTheme } from '@/hooks/useTheme';

/**
 * The lattice plus its WebGL host, bundled together so the whole 3D dependency
 * graph sits behind a single dynamic import.
 */
export function OrbScene({
  recordCount,
  coherence = 1,
  className,
  cameraDistance = 6.2,
}: {
  recordCount: number;
  coherence?: number;
  className?: string;
  cameraDistance?: number;
}) {
  const { mode } = useTheme();
  const palette = PALETTES[mode];

  return (
    <Scene
      className={className}
      camera={{ position: [0, 0.5, cameraDistance], fov: 42 }}
      fallback={<OrbPlaceholder />}
    >
      <DataLattice
        recordCount={recordCount}
        coherence={coherence}
        accent={palette.categorical[0]}
        secondary={mode === 'dark' ? '#ffffff' : palette.categorical[1]}
        mode={mode}
      />
    </Scene>
  );
}
