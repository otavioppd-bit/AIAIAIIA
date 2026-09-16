'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface DataOrbProps {
  /** Record count — drives particle density, so the object describes the data. */
  recordCount?: number;
  /** 0–1. Data-quality score; a low score visibly scatters the shell. */
  coherence?: number;
  accent?: string;
  secondary?: string;
}

const MAX_PARTICLES = 4200;
const MIN_PARTICLES = 320;

/**
 * A particle shell whose density is the dataset's row count and whose
 * cohesion is its quality score: a clean dataset reads as a tight sphere, a
 * dirty one visibly frays. The 3D is describing the data, not decorating it.
 */
export function DataOrb({
  recordCount = 2000,
  coherence = 1,
  accent = '#7c7aff',
  secondary = '#2dd4bf',
}: DataOrbProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  const { positions, colors, sizes, count } = useMemo(() => {
    // Log scale: 1k and 100k rows should look different but not 100× apart.
    const density = Math.log10(Math.max(recordCount, 10)) / 6;
    const total = Math.round(
      MIN_PARTICLES + (MAX_PARTICLES - MIN_PARTICLES) * Math.min(density, 1),
    );

    const positionArray = new Float32Array(total * 3);
    const colorArray = new Float32Array(total * 3);
    const sizeArray = new Float32Array(total);

    const accentColor = new THREE.Color(accent);
    const secondaryColor = new THREE.Color(secondary);
    const scatter = 1 - Math.min(Math.max(coherence, 0), 1);

    // Fibonacci sphere: an even distribution with no polar clustering.
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < total; i += 1) {
      const y = 1 - (i / (total - 1)) * 2;
      const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;

      const jitter = scatter * 0.55 * (Math.random() - 0.5);
      const radius = 1.85 + jitter + (Math.random() - 0.5) * 0.04;

      positionArray[i * 3] = Math.cos(theta) * radiusAtY * radius;
      positionArray[i * 3 + 1] = y * radius;
      positionArray[i * 3 + 2] = Math.sin(theta) * radiusAtY * radius;

      const blend = (y + 1) / 2;
      const color = accentColor.clone().lerp(secondaryColor, blend * 0.85);
      colorArray[i * 3] = color.r;
      colorArray[i * 3 + 1] = color.g;
      colorArray[i * 3 + 2] = color.b;

      sizeArray[i] = 0.018 + Math.random() * 0.022;
    }

    return { positions: positionArray, colors: colorArray, sizes: sizeArray, count: total };
  }, [recordCount, coherence, accent, secondary]);

  // A soft round sprite; square points read as compression artefacts.
  const sprite = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (context) {
      const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.35, 'rgba(255,255,255,0.85)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }, []);

  useFrame((state, delta) => {
    const elapsed = state.clock.elapsedTime;
    if (pointsRef.current) {
      pointsRef.current.rotation.y += delta * 0.09;
      pointsRef.current.rotation.x = Math.sin(elapsed * 0.16) * 0.12;
    }
    if (coreRef.current) {
      coreRef.current.rotation.y -= delta * 0.14;
      const pulse = 1 + Math.sin(elapsed * 0.7) * 0.015;
      coreRef.current.scale.setScalar(pulse);
    }
    if (ringRef.current) {
      ringRef.current.rotation.z += delta * 0.05;
      ringRef.current.rotation.x = Math.PI / 2.4 + Math.sin(elapsed * 0.22) * 0.06;
    }
  });

  return (
    <group>
      {/* Key + rim lighting gives the core real depth instead of a flat disc. */}
      <ambientLight intensity={0.35} />
      <pointLight position={[4, 4, 5]} intensity={70} color={accent} distance={20} decay={2} />
      <pointLight position={[-5, -2, -4]} intensity={45} color={secondary} distance={20} decay={2} />

      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} count={count} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} count={count} />
          <bufferAttribute attach="attributes-size" args={[sizes, 1]} count={count} />
        </bufferGeometry>
        <pointsMaterial
          size={0.035}
          sizeAttenuation
          vertexColors
          transparent
          opacity={0.92}
          map={sprite}
          alphaTest={0.01}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      {/* Faceted inner core, lit rather than emissive, so it reads as a solid. */}
      <mesh ref={coreRef}>
        <icosahedronGeometry args={[1.12, 1]} />
        <meshPhysicalMaterial
          color={accent}
          roughness={0.28}
          metalness={0.65}
          clearcoat={0.8}
          clearcoatRoughness={0.25}
          transmission={0.25}
          thickness={1.4}
          transparent
          opacity={0.42}
          flatShading
        />
      </mesh>

      {/* Wireframe overlay reads as structure on top of the solid core. */}
      <mesh scale={1.13}>
        <icosahedronGeometry args={[1.12, 1]} />
        <meshBasicMaterial color={accent} wireframe transparent opacity={0.09} />
      </mesh>

      <mesh ref={ringRef} rotation={[Math.PI / 2.4, 0, 0]}>
        <torusGeometry args={[2.45, 0.006, 8, 128]} />
        <meshBasicMaterial color={secondary} transparent opacity={0.45} />
      </mesh>
    </group>
  );
}
