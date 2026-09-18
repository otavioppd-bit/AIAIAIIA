'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface DataLatticeProps {
  /** Record count — drives node density, so the structure describes the data. */
  recordCount?: number;
  /** 0–1. Data-quality score; a low score visibly dislocates the lattice. */
  coherence?: number;
  accent?: string;
  secondary?: string;
  mode?: 'light' | 'dark';
}

const MAX_NODES = 900;
const MIN_NODES = 120;
/** Two draw calls is the whole budget; past this the edge pass starts to cost. */
const MAX_EDGES = 1500;

/**
 * A lattice of data nodes standing on the same ruled floor the background
 * draws, so the object reads as the near field of one continuous space rather
 * than a shape floating in front of a picture.
 *
 * It is a measurement, not an ornament: node count is the dataset's row count
 * on a log scale, and the quality score is structural integrity — a clean
 * dataset stands as an ordered lattice, a dirty one visibly dislocates and its
 * connections thin out.
 */
export function DataLattice({
  recordCount = 2000,
  coherence = 1,
  accent = '#7089ba',
  secondary = '#ffffff',
  mode = 'dark',
}: DataLatticeProps) {
  const groupRef = useRef<THREE.Group>(null);
  const nodesRef = useRef<THREE.Points>(null);
  const edgesRef = useRef<THREE.LineSegments>(null);
  const settled = useRef(0);
  const visible = useRef(0);

  const dark = mode === 'dark';
  const target = Math.min(Math.max(coherence, 0), 1);

  /*
   * Geometry is built once, at full capacity, and never rebuilt when the row
   * count changes. Filtering a dashboard would otherwise throw away every
   * buffer and snap a new structure into place; instead the lattice is ordered
   * centre-outwards and the frame loop simply draws fewer of it, so applying a
   * filter reads as the structure thinning rather than being replaced.
   */
  const { nodeGeometry, edgeGeometry, basePositions, edgeCutoffs } = useMemo(() => {
    const perSide = Math.max(3, Math.ceil(Math.cbrt(MAX_NODES)));
    const spacing = 3.4 / perSide;
    const points: THREE.Vector3[] = [];

    for (let ix = 0; ix < perSide; ix += 1) {
      for (let iy = 0; iy < perSide; iy += 1) {
        for (let iz = 0; iz < perSide; iz += 1) {
          const x = (ix - (perSide - 1) / 2) * spacing;
          const y = (iy - (perSide - 1) / 2) * spacing * 0.62;
          const z = (iz - (perSide - 1) / 2) * spacing;
          // Deterministic jitter — the same dataset always draws the same
          // structure, so the object is a portrait and not a lava lamp.
          const seed = ix * 73856093 + iy * 19349663 + iz * 83492791;
          const jitter = (n: number) => (((Math.sin(seed * n) * 43758.5453) % 1) + 1) % 1 - 0.5;
          points.push(
            new THREE.Vector3(
              x + jitter(1.1) * spacing * 0.5,
              y + jitter(2.3) * spacing * 0.4,
              z + jitter(3.7) * spacing * 0.5,
            ),
          );
        }
      }
    }

    // Centre-out, so any prefix of the list is a coherent structure rather
    // than a corner of one.
    points.sort((a, b) => a.lengthSq() - b.lengthSq());

    const positions = new Float32Array(points.length * 3);
    const sizes = new Float32Array(points.length);
    points.forEach((point, index) => {
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = point.y;
      positions[index * 3 + 2] = point.z;
      // A handful of nodes read as hubs; the rest recede.
      sizes[index] = index % 11 === 0 ? 1 : 0.45;
    });

    const nodes = new THREE.BufferGeometry();
    nodes.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    nodes.setAttribute('aScale', new THREE.BufferAttribute(sizes, 1));

    /*
     * Each node gets its own small share of the edge budget, rather than the
     * budget being spent front to back — otherwise the first corner of the
     * lattice is fully wired and the rest of it hangs there as loose dots.
     */
    const perNode = Math.max(1, Math.floor(MAX_EDGES / Math.max(points.length, 1)));
    const reach = spacing * 1.35;
    const pairs: { a: number; b: number }[] = [];

    for (let i = 0; i < points.length; i += 1) {
      const neighbours: { index: number; distance: number }[] = [];
      for (let j = 0; j < points.length; j += 1) {
        if (i === j) continue;
        const distance = points[i].distanceTo(points[j]);
        if (distance <= reach) neighbours.push({ index: j, distance });
      }
      neighbours.sort((a, b) => a.distance - b.distance);
      for (const neighbour of neighbours.slice(0, perNode)) {
        // One line per pair, not two.
        if (neighbour.index < i) continue;
        pairs.push({ a: i, b: neighbour.index });
      }
    }

    // Ordered by their furthest endpoint, so drawing a prefix of the edges
    // never leaves a line hanging off a node that is not being drawn.
    pairs.sort((p, q) => Math.max(p.a, p.b) - Math.max(q.a, q.b));

    const edgeArray = new Float32Array(pairs.length * 6);
    // cutoffs[n] = how many edges are safe to draw when n nodes are visible.
    const cutoffs = new Uint32Array(points.length + 1);
    let pairIndex = 0;
    pairs.forEach((pair, index) => {
      const offset = index * 6;
      edgeArray[offset] = points[pair.a].x;
      edgeArray[offset + 1] = points[pair.a].y;
      edgeArray[offset + 2] = points[pair.a].z;
      edgeArray[offset + 3] = points[pair.b].x;
      edgeArray[offset + 4] = points[pair.b].y;
      edgeArray[offset + 5] = points[pair.b].z;
    });
    for (let visible = 0; visible <= points.length; visible += 1) {
      while (pairIndex < pairs.length && Math.max(pairs[pairIndex].a, pairs[pairIndex].b) < visible) {
        pairIndex += 1;
      }
      cutoffs[visible] = pairIndex;
    }

    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgeArray, 3));

    return {
      nodeGeometry: nodes,
      edgeGeometry: edgeGeo,
      basePositions: positions.slice(),
      edgeCutoffs: cutoffs,
    };
  }, []);

  /** How much of the lattice this many rows should light up. */
  const targetNodes = useMemo(() => {
    // Log scale: 1k and 100k rows should look different, not 100x apart.
    const density = Math.log10(Math.max(recordCount, 10)) / 6;
    const total = edgeCutoffs.length - 1;
    return Math.round(
      Math.min(MIN_NODES + (total - MIN_NODES) * Math.min(density, 1), total),
    );
  }, [recordCount, edgeCutoffs]);

  useFrame((state, delta) => {
    // Ease toward the real score so finishing an analysis resolves the
    // structure instead of snapping it.
    settled.current += (target - settled.current) * Math.min(1, delta * 1.6);
    const dislocation = 1 - settled.current;

    const group = groupRef.current;
    if (group) {
      group.rotation.y += delta * 0.055;
      // Parallax, damped hard: the structure acknowledges the pointer, it does
      // not chase it.
      group.rotation.x += (state.pointer.y * 0.16 - group.rotation.x) * 0.04;
      group.position.x += (state.pointer.x * 0.22 - group.position.x) * 0.04;
    }

    // Ease the visible share toward the row count so a filter reshapes the
    // structure instead of replacing it.
    visible.current += (targetNodes - visible.current) * Math.min(1, delta * 2.4);
    const shown = Math.max(1, Math.round(visible.current));

    const points = nodesRef.current;
    if (points) {
      points.geometry.setDrawRange(0, shown);
      const attribute = points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const array = attribute.array as Float32Array;
      const time = state.clock.elapsedTime;
      for (let i = 0; i < shown * 3; i += 3) {
        const drift = Math.sin(time * 0.6 + i) * 0.012;
        array[i] = basePositions[i] + drift * (1 + dislocation * 9);
        array[i + 1] = basePositions[i + 1] + Math.cos(time * 0.5 + i) * 0.01 * (1 + dislocation * 9);
        array[i + 2] = basePositions[i + 2] + drift * (1 + dislocation * 6);
      }
      attribute.needsUpdate = true;
    }

    // Connections are the first thing a dirty dataset loses.
    const edges = edgesRef.current;
    if (edges) {
      edges.geometry.setDrawRange(0, edgeCutoffs[Math.min(shown, edgeCutoffs.length - 1)] * 2);
      const material = edges.material as THREE.LineBasicMaterial;
      material.opacity = (dark ? 0.3 : 0.24) * (0.25 + settled.current * 0.75);
    }
  });

  return (
    <group ref={groupRef}>
      <lineSegments ref={edgesRef} geometry={edgeGeometry}>
        <lineBasicMaterial
          color={accent}
          transparent
          opacity={0.3}
          depthWrite={false}
          blending={dark ? THREE.AdditiveBlending : THREE.NormalBlending}
        />
      </lineSegments>

      <points ref={nodesRef} geometry={nodeGeometry}>
        <pointsMaterial
          color={dark ? secondary : accent}
          size={0.032}
          sizeAttenuation
          transparent
          opacity={dark ? 0.85 : 0.7}
          depthWrite={false}
          blending={dark ? THREE.AdditiveBlending : THREE.NormalBlending}
        />
      </points>

      {/* The floor the lattice stands on — the background's ruling, in space. */}
      <gridHelper
        args={[9, 18, accent, accent]}
        position={[0, -1.55, 0]}
        material-transparent
        material-opacity={dark ? 0.12 : 0.16}
        material-depthWrite={false}
      />
    </group>
  );
}
