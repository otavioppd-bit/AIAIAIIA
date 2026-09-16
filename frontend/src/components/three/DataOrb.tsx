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
  /** Additive blending only reads as light on a dark surface. */
  mode?: 'light' | 'dark';
}

const MAX_PARTICLES = 4600;
const MIN_PARTICLES = 420;

/**
 * A particle shell whose density is the dataset's row count and whose cohesion
 * is its quality score: a clean dataset reads as a tight sphere, a dirty one
 * visibly frays. The 3D describes the data rather than decorating the page.
 *
 * Both themes are rendered deliberately. Additive blending adds light, so it is
 * brilliant on a dark surface and invisible on a white one — the light theme
 * uses normal blending with darker, denser marks instead.
 */
export function DataOrb({
  recordCount = 2000,
  coherence = 1,
  accent = '#7c7aff',
  secondary = '#2dd4bf',
  mode = 'dark',
}: DataOrbProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const coreRef2 = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  const dark = mode === 'dark';

  const { positions, colors, count } = useMemo(() => {
    // Log scale: 1k and 100k rows should look different but not 100× apart.
    const density = Math.log10(Math.max(recordCount, 10)) / 6;
    const total = Math.round(
      MIN_PARTICLES + (MAX_PARTICLES - MIN_PARTICLES) * Math.min(density, 1),
    );

    const positionArray = new Float32Array(total * 3);
    const colorArray = new Float32Array(total * 3);

    const accentColor = new THREE.Color(accent);
    const secondaryColor = new THREE.Color(secondary);
    const scatter = 1 - Math.min(Math.max(coherence, 0), 1);

    // Fibonacci sphere: an even distribution with no polar clustering.
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < total; i += 1) {
      const y = 1 - (i / (total - 1)) * 2;
      const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;

      const jitter = scatter * 0.6 * (Math.random() - 0.5);
      const radius = 1.9 + jitter + (Math.random() - 0.5) * 0.05;

      positionArray[i * 3] = Math.cos(theta) * radiusAtY * radius;
      positionArray[i * 3 + 1] = y * radius;
      positionArray[i * 3 + 2] = Math.sin(theta) * radiusAtY * radius;

      const blend = (y + 1) / 2;
      const color = accentColor.clone().lerp(secondaryColor, blend * 0.85);
      // On a light surface the marks must sit *darker* than the background to
      // be seen at all; on a dark one they are lifted toward white.
      if (dark) color.offsetHSL(0, 0.05, 0.08);
      else color.offsetHSL(0, 0.16, -0.2);

      colorArray[i * 3] = color.r;
      colorArray[i * 3 + 1] = color.g;
      colorArray[i * 3 + 2] = color.b;
    }

    return { positions: positionArray, colors: colorArray, count: total };
  }, [recordCount, coherence, accent, secondary, dark]);

  // A soft round sprite; square points read as compression artefacts.
  const sprite = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (context) {
      const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.4, 'rgba(255,255,255,0.9)');
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
      pointsRef.current.rotation.y += delta * 0.085;
      pointsRef.current.rotation.x = Math.sin(elapsed * 0.16) * 0.11;
    }
    if (coreRef.current) {
      coreRef.current.rotation.y -= delta * 0.13;
      coreRef.current.rotation.x = Math.cos(elapsed * 0.2) * 0.08;
      const pulse = 1 + Math.sin(elapsed * 0.7) * 0.014;
      coreRef.current.scale.setScalar(pulse);
      if (coreRef2.current) {
        coreRef2.current.rotation.copy(coreRef.current.rotation);
        coreRef2.current.scale.setScalar(pulse * 1.002);
      }
    }
    if (wireRef.current) {
      // Counter-rotation against the core gives the object real depth cues.
      wireRef.current.rotation.y += delta * 0.055;
      wireRef.current.rotation.z -= delta * 0.03;
    }
    if (ringRef.current) {
      ringRef.current.rotation.z += delta * 0.05;
      ringRef.current.rotation.x = Math.PI / 2.4 + Math.sin(elapsed * 0.22) * 0.07;
    }
  });

  return (
    <group>
      {/* Key, fill and rim: three lights are what stop a sphere reading as a
          flat disc. Intensities differ per theme because the surface does. */}
      <ambientLight intensity={dark ? 0.32 : 0.85} />
      <directionalLight position={[4, 5, 6]} intensity={dark ? 1.8 : 2.4} color="#ffffff" />
      <pointLight
        position={[5, 3, 4]}
        intensity={dark ? 90 : 55}
        color={accent}
        distance={22}
        decay={2}
      />
      <pointLight
        position={[-5, -3, -4]}
        intensity={dark ? 60 : 38}
        color={secondary}
        distance={22}
        decay={2}
      />

      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} count={count} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} count={count} />
        </bufferGeometry>
        <pointsMaterial
          size={dark ? 0.036 : 0.034}
          sizeAttenuation
          vertexColors
          transparent
          opacity={dark ? 0.95 : 0.92}
          map={sprite}
          alphaTest={0.02}
          depthWrite={false}
          blending={dark ? THREE.AdditiveBlending : THREE.NormalBlending}
        />
      </points>

      {/* Faceted core.
          `transmission` needs an environment map to refract anything; without
          one it renders as flat grey, so the glassy read comes from a highly
          specular metal at low opacity instead — the facets catch the three
          lights and the particle shell stays visible straight through it. */}
      <mesh ref={coreRef}>
        <icosahedronGeometry args={[1.08, 1]} />
        <meshPhysicalMaterial
          color={accent}
          roughness={0.08}
          metalness={0.95}
          clearcoat={1}
          clearcoatRoughness={0.06}
          reflectivity={1}
          transparent
          opacity={dark ? 0.34 : 0.26}
          depthWrite={false}
          flatShading
        />
      </mesh>

      {/* Facet edges give the core a defined silhouette at any opacity. */}
      <mesh ref={coreRef2} scale={1.002}>
        <icosahedronGeometry args={[1.08, 1]} />
        <meshBasicMaterial
          color={accent}
          wireframe
          transparent
          opacity={dark ? 0.32 : 0.45}
          depthWrite={false}
        />
      </mesh>

      {/* Wireframe shell: reads as structure and gives the rotation a reference. */}
      <mesh ref={wireRef} scale={1.32}>
        <icosahedronGeometry args={[1.1, 1]} />
        <meshBasicMaterial
          color={dark ? accent : secondary}
          wireframe
          transparent
          opacity={dark ? 0.12 : 0.22}
        />
      </mesh>

      <mesh ref={ringRef} rotation={[Math.PI / 2.4, 0, 0]}>
        <torusGeometry args={[2.5, 0.007, 8, 128]} />
        <meshBasicMaterial color={secondary} transparent opacity={dark ? 0.5 : 0.65} />
      </mesh>
    </group>
  );
}
