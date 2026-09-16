'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export interface ClusterPoint {
  x: number;
  y: number;
  z: number;
  group?: string;
}

/**
 * A real 3D scatter: every point is one record, positioned by three columns the
 * user chose. Unlike the orb this is a plot, not an illustration — rotation is
 * what lets a viewer separate clusters that overlap in any single 2D projection.
 */
export function ClusterCloud({
  points,
  palette,
  autoRotate = true,
}: {
  points: ClusterPoint[];
  palette: string[];
  autoRotate?: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);

  const { positions, colors, count, axes } = useMemo(() => {
    const usable = points.filter(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z),
    );
    const total = Math.min(usable.length, 6000);
    const sample = total < usable.length
      ? usable.filter((_, index) => index % Math.ceil(usable.length / total) === 0).slice(0, total)
      : usable;

    const positionArray = new Float32Array(sample.length * 3);
    const colorArray = new Float32Array(sample.length * 3);

    // Normalise each axis to [-1.6, 1.6] so any unit scale fits the viewport.
    const bounds = (key: 'x' | 'y' | 'z') => {
      const values = sample.map((p) => p[key]);
      const min = Math.min(...values);
      const max = Math.max(...values);
      return { min, span: max - min || 1 };
    };
    const bx = bounds('x');
    const by = bounds('y');
    const bz = bounds('z');

    const groups = Array.from(new Set(sample.map((p) => p.group ?? 'todos')));
    const colorByGroup = new Map(
      groups.map((group, index) => [group, new THREE.Color(palette[index % palette.length])]),
    );

    sample.forEach((point, index) => {
      positionArray[index * 3] = ((point.x - bx.min) / bx.span) * 3.2 - 1.6;
      positionArray[index * 3 + 1] = ((point.y - by.min) / by.span) * 3.2 - 1.6;
      positionArray[index * 3 + 2] = ((point.z - bz.min) / bz.span) * 3.2 - 1.6;

      const color = colorByGroup.get(point.group ?? 'todos') ?? new THREE.Color(palette[0]);
      colorArray[index * 3] = color.r;
      colorArray[index * 3 + 1] = color.g;
      colorArray[index * 3 + 2] = color.b;
    });

    return {
      positions: positionArray,
      colors: colorArray,
      count: sample.length,
      axes: 1.75,
    };
  }, [points, palette]);

  useFrame((_, delta) => {
    if (autoRotate && groupRef.current) {
      groupRef.current.rotation.y += delta * 0.16;
    }
  });

  if (count === 0) return null;

  return (
    <group ref={groupRef}>
      <ambientLight intensity={0.6} />
      <pointLight position={[5, 5, 5]} intensity={40} distance={24} decay={2} />

      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} count={count} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} count={count} />
        </bufferGeometry>
        <pointsMaterial size={0.045} sizeAttenuation vertexColors transparent opacity={0.85} />
      </points>

      {/* Axis rails give the cloud a frame of reference while it turns. */}
      {([
        [[-axes, -axes, -axes], [axes, -axes, -axes]],
        [[-axes, -axes, -axes], [-axes, axes, -axes]],
        [[-axes, -axes, -axes], [-axes, -axes, axes]],
      ] as [number[], number[]][]).map(([start, end], index) => (
        <line key={index}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[new Float32Array([...start, ...end]), 3]}
              count={2}
            />
          </bufferGeometry>
          <lineBasicMaterial color="#888888" transparent opacity={0.28} />
        </line>
      ))}
    </group>
  );
}
