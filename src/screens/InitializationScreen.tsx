import React, { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls as ThreeOrbitControls } from 'three/addons/controls/OrbitControls.js'
import * as THREE from "three";

// ---------------------------------------------------------
// Types
// ---------------------------------------------------------
const MODULES = ["Speech System", "Voice Engine", "Knowledge Core", "Vision System"] as const;
type ModuleName = typeof MODULES[number];

export type InitProgress = {
    systemReady: boolean;
    percent?: number;
    modules?: Partial<Record<ModuleName, boolean>>;
    message?: string;
};

// ---------------------------------------------------------
// Audio Helper
// ---------------------------------------------------------
function useAudio(src: string, { volume = 0.6, loop = false } = {}) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [ready, setReady] = useState(false);
    const analyserRef = useRef<AnalyserNode | null>(null);

    useEffect(() => {
        if (!src) return;
        try {
            const a = new Audio(src);
            a.preload = "auto";
            a.loop = loop;
            a.volume = volume;
            audioRef.current = a;

            // Create audio analyzer for visualizations
            const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
            if (AudioCtx) {
                const audioContext = new AudioCtx();
                try {
                    const source = audioContext.createMediaElementSource(a);
                    const analyser = audioContext.createAnalyser();
                    analyser.fftSize = 256;
                    source.connect(analyser);
                    analyser.connect(audioContext.destination);
                    analyserRef.current = analyser;
                } catch (e) {
                    // Cross-origin or autoplay protection may block this in dev - ignore
                }
            }

            const onCanPlay = () => setReady(true);
            a.addEventListener("canplay", onCanPlay);
            return () => {
                a.pause();
                a.removeEventListener("canplay", onCanPlay);
                audioRef.current = null;
            };
        } catch (e) {
            // ignore
        }
    }, [src, loop, volume]);

    return {
        ready,
        analyser: analyserRef.current,
        play: () => audioRef.current?.play().catch(() => { }),
        stop: () => {
            if (!audioRef.current) return;
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        },
        fadeOut: (ms = 500) => {
            const a = audioRef.current;
            if (!a) return;
            const start = performance.now();
            const startVol = a.volume;
            function tick(t: number) {
                if (!a) return;
                const k = Math.min(1, (t - start) / ms);
                a.volume = startVol * (1 - k);
                if (k < 1) requestAnimationFrame(tick);
                else a.pause();
            }
            requestAnimationFrame(tick);
        },
    };
}

// ---------------------------------------------------------
// Simulated Progress
// ---------------------------------------------------------
function useSimulatedProgress(enabled: boolean): InitProgress | undefined {
    const [p, setP] = useState<InitProgress | undefined>(undefined);
    useEffect(() => {
        if (!enabled) return;
        let raf: number;
        const start = performance.now();
        const ms = 12000;
        const step = () => {
            const t = performance.now() - start;
            const pct = Math.min(1, t / ms);

            const stages = [
                { t: 0.2, module: "Speech System" as ModuleName },
                { t: 0.4, module: "Voice Engine" as ModuleName },
                { t: 0.65, module: "Knowledge Core" as ModuleName },
                { t: 0.85, module: "Vision System" as ModuleName },
            ];

            const modules: Partial<Record<ModuleName, boolean>> = {};
            stages.forEach(s => {
                modules[s.module] = pct >= s.t;
            });

            const systemReady = pct >= 0.95 && Object.values(modules).filter(Boolean).length === MODULES.length;

            setP({
                percent: pct,
                modules,
                systemReady,
                message: systemReady ? "System Ready" : "Integrating modules...",
            });
            if (pct < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
    }, [enabled]);
    return p;
}

// ---------------------------------------------------------
// Custom RAF hook for non-Three components
// ---------------------------------------------------------
const useRaf = (callback: () => void) => {
    useEffect(() => {
        let raf = 0;
        const loop = () => {
            callback();
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [callback]);
};

// ---------------------------------------------------------
// 3D Orb with Custom Shaders
// ---------------------------------------------------------
const AIOrb: React.FC<{ phase: number; audioData?: Uint8Array }> = ({ phase, audioData }) => {
    const meshRef = useRef<THREE.Mesh>(null);
    const materialRef = useRef<any>(null);

    // Audio-reactive scale
    const [audioScale, setAudioScale] = useState(1);

    useEffect(() => {
        if (!audioData) return;
        const avg = Array.from(audioData).reduce((a, b) => a + b, 0) / audioData.length;
        setAudioScale(1 + (avg / 255) * 0.15);
    }, [audioData]);

    useFrame(({ clock }) => {
        if (!meshRef.current) return;

        // Gentle rotation
        meshRef.current.rotation.y = clock.getElapsedTime() * 0.1;
        meshRef.current.rotation.x = Math.sin(clock.getElapsedTime() * 0.2) * 0.1;

        // Pulse based on phase
        const pulse = 1 + Math.sin(clock.getElapsedTime() * (phase >= 4 ? 2 : 1)) * 0.02;
        meshRef.current.scale.setScalar(pulse * audioScale);

        // Update material
        if (materialRef.current) {
            materialRef.current.emissiveIntensity = 0.5 + Math.sin(clock.getElapsedTime() * 2) * 0.3;
        }
    });

    const distortSpeed = phase >= 3 ? 2 : phase >= 2 ? 1.5 : 0.8;
    const distortAmount = phase >= 4 ? 0.15 : 0.25;

    return (
        <group>
            {/* Main orb - using standard material for preview (MeshDistortMaterial removed) */}
            <mesh ref={meshRef as any}>
                <sphereGeometry args={[2, 128, 128]} />
                <meshStandardMaterial
                    ref={materialRef as any}
                    color="#4da6ff"
                    emissive="#2d5a8c"
                    metalness={0.8}
                    roughness={0.2}
                    transparent
                    opacity={0.9}
                />
            </mesh>

            {/* Inner glow sphere */}
            <mesh>
                <sphereGeometry args={[1.8, 64, 64]} />
                <meshBasicMaterial color="#6df2ff" transparent opacity={0.15} side={THREE.BackSide as any} />
            </mesh>

            {/* Outer aura */}
            <mesh>
                <sphereGeometry args={[2.3, 64, 64]} />
                <meshBasicMaterial color="#8ce4ff" transparent opacity={0.08} wireframe />
            </mesh>
        </group>
    );
};

// ---------------------------------------------------------
// Quantum Particle Field
// ---------------------------------------------------------
const QuantumParticles: React.FC<{ count?: number; phase: number }> = ({ count = 2000, phase }) => {
    const points = useRef<THREE.Points>(null);

    const particles = useMemo(() => {
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const radius = 4 + Math.random() * 8;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(Math.random() * 2 - 1);

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = radius * Math.cos(phi);

            const hue = Math.random() > 0.5 ? 0.55 : 0.65; // cyan/blue
            colors[i3] = hue;
            colors[i3 + 1] = 0.8 + Math.random() * 0.2;
            colors[i3 + 2] = 0.9 + Math.random() * 0.1;

            sizes[i] = Math.random() * 2 + 0.5;
        }

        return { positions, colors, sizes };
    }, [count]);

    useFrame(({ clock }) => {
        if (!points.current) return;
        const time = clock.getElapsedTime();
        const positions = points.current.geometry.attributes.position.array as Float32Array;

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const x = positions[i3];
            const y = positions[i3 + 1];
            const z = positions[i3 + 2];

            // Orbital motion
            const speed = 0.0001 * (phase >= 3 ? 2 : 1);
            const angle = speed * time + i * 0.01;
            const radius = Math.sqrt(x * x + y * y + z * z);

            positions[i3] = radius * Math.sin(angle) * Math.cos(i * 0.1);
            positions[i3 + 1] = radius * Math.sin(angle) * Math.sin(i * 0.1);
            positions[i3 + 2] = radius * Math.cos(angle);
        }

        (points.current.geometry.attributes.position as any).needsUpdate = true;
        points.current.rotation.y = time * 0.05;
    });

    return (
        <points ref={points as any}>
            <bufferGeometry>
                <bufferAttribute
                    attach="attributes-position"
                    count={count}
                    array={particles.positions}
                    itemSize={3}
                />
                <bufferAttribute
                    attach="attributes-color"
                    count={count}
                    array={particles.colors}
                    itemSize={3}
                />
                <bufferAttribute
                    attach="attributes-size"
                    count={count}
                    array={particles.sizes}
                    itemSize={1}
                />
            </bufferGeometry>
            <pointsMaterial
                size={0.05}
                vertexColors
                transparent
                opacity={0.6}
                sizeAttenuation
                blending={THREE.AdditiveBlending}
            />
        </points>
    );
};

// ---------------------------------------------------------
// Neural Network Visualization
// ---------------------------------------------------------
const NeuralNetwork: React.FC<{ phase: number; modules: Partial<Record<ModuleName, boolean>> }> = ({ phase, modules }) => {
    const groupRef = useRef<THREE.Group>(null);

    const nodes = useMemo(() => {
        return MODULES.map((_, i) => {
            const angle = (i / MODULES.length) * Math.PI * 2;
            const radius = 4;
            return new THREE.Vector3(
                Math.cos(angle) * radius,
                Math.sin(angle) * radius,
                (Math.random() - 0.5) * 2
            );
        });
    }, []);

    useFrame(({ clock }) => {
        if (!groupRef.current) return;
        groupRef.current.rotation.z = clock.getElapsedTime() * 0.1;
    });

    return (
        <group ref={groupRef as any}>
            {/* Nodes */}
            {nodes.map((pos, i) => {
                const ready = modules[MODULES[i]];
                return (
                    <mesh key={i} position={[pos.x, pos.y, pos.z]}>
                        <sphereGeometry args={[0.15, 16, 16]} />
                        <meshBasicMaterial color={ready ? "#6df2ff" : "#4a5568"} transparent opacity={ready ? 1 : 0.3} />
                    </mesh>
                );
            })}

            {/* Connections */}
            {phase >= 3 &&
                nodes.map((pos1, i) =>
                    nodes.slice(i + 1).map((pos2, j) => {
                        const points = [pos1, pos2];
                        const geometry = new THREE.BufferGeometry().setFromPoints(points);
                        const ready1 = modules[MODULES[i]];
                        const ready2 = modules[MODULES[i + j + 1]];
                        const bothReady = ready1 && ready2;

                        return (
                            <primitive key={`${i}-${j}`} object={new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: bothReady ? "#6df2ff" : "#2d3748", transparent: true, opacity: bothReady ? 0.6 : 0.1 }))} />
                        );
                    })
                )}
        </group>
    );
};

// ---------------------------------------------------------
// 3D Scene Container
// ---------------------------------------------------------
const Scene3D: React.FC<{ phase: number; modules: Partial<Record<ModuleName, boolean>>; audioData?: Uint8Array }> = ({ phase, modules, audioData }) => {
    return (
        <Canvas camera={{ position: [0, 0, 12], fov: 50 }} gl={{ alpha: true, antialias: true }}>
            <color attach="background" args={["#00000000"]} />
            <ambientLight intensity={0.3} />
            <pointLight position={[10, 10, 10]} intensity={0.8} color="#6df2ff" />
            <pointLight position={[-10, -10, -10]} intensity={0.5} color="#b38cff" />

            <Suspense fallback={null}>
                <AIOrb phase={phase} audioData={audioData} />
                <QuantumParticles count={2000} phase={phase} />
                <NeuralNetwork phase={phase} modules={modules || {}} />
            </Suspense>

            <OrbitControlsComp />
        </Canvas>
    );
};

// Simple OrbitControls component using three/examples
const OrbitControlsComp: React.FC = () => {
    const { camera, gl } = useThree();
    useEffect(() => {
        const controls = new ThreeOrbitControls(camera, (gl as any).domElement);
        controls.enableZoom = false;
        controls.enablePan = false;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.5;
        return () => controls.dispose();
    }, [camera, gl]);
    return null;
};

// ---------------------------------------------------------
// Matrix Data Stream
// ---------------------------------------------------------
const MatrixRain: React.FC<{ intensity?: number }> = ({ intensity = 0.6 }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        resize();
        window.addEventListener('resize', resize);

        const chars = "ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏﾁｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍ01234567899ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const fontSize = 14;
        const columns = Math.floor(canvas.width / fontSize);
        const drops: number[] = Array(columns).fill(1);

        function draw() {
            if (!ctx || !canvas) return;
            ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.fillStyle = "#6df2ff";
            ctx.font = `${fontSize}px monospace`;

            for (let i = 0; i < drops.length; i++) {
                const text = chars[Math.floor(Math.random() * chars.length)];
                const x = i * fontSize;
                const y = drops[i] * fontSize;

                ctx.fillStyle = `rgba(109, 242, 255, ${intensity})`;
                ctx.fillText(text, x, y);

                if (y > canvas.height && Math.random() > 0.975) {
                    drops[i] = 0;
                }
                drops[i]++;
            }
        }

        const interval = setInterval(draw, 33);
        return () => { clearInterval(interval); window.removeEventListener('resize', resize); };
    }, [intensity]);

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 pointer-events-none opacity-20"
            style={{ mixBlendMode: "screen", position: 'absolute', inset: 0 }}
        />
    );
};

// ---------------------------------------------------------
// Holographic HUD
// ---------------------------------------------------------
const HolographicHUD: React.FC<{ phase: number }> = ({ phase }) => {
    return (
        <div className="absolute inset-0 pointer-events-none">
            {/* Corner Brackets */}
            <div style={{ position: 'absolute', top: 32, left: 32, width: 96, height: 96, borderLeft: '2px solid rgba(109,242,255,0.4)', borderTop: '2px solid rgba(109,242,255,0.4)' }} />
            <div style={{ position: 'absolute', top: 32, right: 32, width: 96, height: 96, borderRight: '2px solid rgba(109,242,255,0.4)', borderTop: '2px solid rgba(109,242,255,0.4)' }} />
            <div style={{ position: 'absolute', bottom: 32, left: 32, width: 96, height: 96, borderLeft: '2px solid rgba(109,242,255,0.4)', borderBottom: '2px solid rgba(109,242,255,0.4)' }} />
            <div style={{ position: 'absolute', bottom: 32, right: 32, width: 96, height: 96, borderRight: '2px solid rgba(109,242,255,0.4)', borderBottom: '2px solid rgba(109,242,255,0.4)' }} />

            {/* Scanning Reticle */}
            <motion.div
                style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }}
                animate={{ rotate: phase >= 2 ? 360 : 0, scale: [1, 1.05, 1] }}
                transition={{ rotate: { duration: 8, repeat: Infinity, ease: "linear" }, scale: { duration: 2, repeat: Infinity } }}
            >
                <svg width="600" height="600" viewBox="0 0 200 200" className="opacity-30">
                    <circle cx="100" cy="100" r="80" fill="none" stroke="url(#reticleGrad)" strokeWidth="0.5" />
                    <defs>
                        <linearGradient id="reticleGrad">
                            <stop offset="0%" stopColor="#6df2ff" stopOpacity="0.8" />
                            <stop offset="100%" stopColor="#b38cff" stopOpacity="0.4" />
                        </linearGradient>
                    </defs>
                </svg>
            </motion.div>

            {/* Hex grid */}
            <div style={{ position: 'absolute', inset: 0, opacity: 0.08, backgroundSize: '60px 60px', backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M30 0l25.98 15v30L30 60 4.02 45V15z' fill='none' stroke='%236df2ff' stroke-width='0.5'/%3E%3C/svg%3E")` }} />
        </div>
    );
};

// ---------------------------------------------------------
// Circular Audio Visualizer
// ---------------------------------------------------------
const CircularVisualizer: React.FC<{ analyser: AnalyserNode | null; phase: number }> = ({ analyser, phase }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useRaf(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx || !analyser || phase < 2) return;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const radius = 280;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const barCount = 128;
        const slice = Math.floor(bufferLength / barCount);

        for (let i = 0; i < barCount; i++) {
            const value = dataArray[i * slice] || 0;
            const percent = value / 255;
            const angle = (i / barCount) * Math.PI * 2;
            const barHeight = percent * 80;

            const x1 = centerX + Math.cos(angle) * radius;
            const y1 = centerY + Math.sin(angle) * radius;
            const x2 = centerX + Math.cos(angle) * (radius + barHeight);
            const y2 = centerY + Math.sin(angle) * (radius + barHeight);

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = `hsla(${190 + percent * 40}, 100%, 70%, ${0.6 + percent * 0.4})`;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    });

    return (
        <canvas
            ref={canvasRef}
            width={800}
            height={800}
            style={{ position: 'absolute', inset: 0, margin: 'auto', pointerEvents: 'none', width: 800, height: 800, opacity: 0.5, mixBlendMode: 'screen' }}
        />
    );
};

// ---------------------------------------------------------
// Glitch Effect
// ---------------------------------------------------------
const GlitchText: React.FC<{ children: React.ReactNode; active: boolean }> = ({ children, active }) => {
    return (
        <div style={{ position: 'relative' }}>
            <div className={active ? "glitch" : ""} data-text={String(children)}>{children}</div>
            <style>{`
        .glitch { position: relative; animation: glitch 0.3s infinite; }
        .glitch::before, .glitch::after { content: attr(data-text); position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
        .glitch::before { animation: glitch-1 0.3s infinite; color: #ff00de; z-index: -1; }
        .glitch::after { animation: glitch-2 0.3s infinite; color: #00ffff; z-index: -2; }
        @keyframes glitch { 0%,100%{transform:translate(0);}25%{transform:translate(-2px,2px);}50%{transform:translate(2px,-2px);}75%{transform:translate(-2px,-2px);} }
        @keyframes glitch-1 { 0%,100%{clip-path:inset(0 0 0 0);transform:translate(0);}25%{clip-path:inset(40% 0 30% 0);transform:translate(-3px,2px);}75%{clip-path:inset(20% 0 60% 0);transform:translate(3px,-2px);} }
        @keyframes glitch-2 { 0%,100%{clip-path:inset(0 0 0 0);transform:translate(0);}25%{clip-path:inset(30% 0 40% 0);transform:translate(3px,-2px);}75%{clip-path:inset(60% 0 20% 0);transform:translate(-3px,2px);} }
      `}</style>
        </div>
    );
};

// ---------------------------------------------------------
// Encrypted Text Reveal
// ---------------------------------------------------------
const EncryptedText: React.FC<{ text: string; reveal: boolean; delay?: number }> = ({ text, reveal, delay = 0 }) => {
    const [displayText, setDisplayText] = useState("");
    const chars = "!<>-_\\/[]{}—=+*^?#________";

    useEffect(() => {
        if (!reveal) {
            setDisplayText(text.split("").map(() => chars[Math.floor(Math.random() * chars.length)]).join(""));
            return;
        }

        let frame = 0;
        const interval = setInterval(() => {
            setDisplayText(prev => {
                return text.split("").map((char, i) => {
                    if (i < frame) return char;
                    return chars[Math.floor(Math.random() * chars.length)];
                }).join("");
            });
            frame++;
            if (frame > text.length) clearInterval(interval);
        }, 50);

        setTimeout(() => setDisplayText(text), delay + text.length * 50);

        return () => clearInterval(interval);
    }, [text, reveal, delay]);

    return <span>{displayText}</span>;
};

// ---------------------------------------------------------
// Energy Cursor Trail
// ---------------------------------------------------------
const CursorTrail: React.FC = () => {
    const [trails, setTrails] = useState<{ x: number; y: number; id: number }[]>([]);

    useEffect(() => {
        let id = 0;
        const onMove = (e: MouseEvent) => {
            const newTrail = { x: e.clientX, y: e.clientY, id: id++ };
            setTrails(prev => [...prev.slice(-20), newTrail]);
        };
        window.addEventListener("mousemove", onMove);
        return () => window.removeEventListener("mousemove", onMove);
    }, []);

    return (
        <>
            {trails.map((trail, i) => (
                <motion.div
                    key={trail.id}
                    style={{ position: 'fixed', left: trail.x, top: trail.y, width: 8, height: 8, borderRadius: 9999, pointerEvents: 'none', zIndex: 9999, background: `radial-gradient(circle, rgba(109,242,255,${1 - i / trails.length}) 0%, transparent 70%)`, boxShadow: `0 0 ${10 - i / 2}px rgba(109,242,255,${1 - i / trails.length})` }}
                    initial={{ scale: 1, opacity: 1 }}
                    animate={{ scale: 0, opacity: 0 }}
                    transition={{ duration: 0.6 }}
                />
            ))}
        </>
    );
};

// ---------------------------------------------------------
// Module Line with Advanced Animation
// ---------------------------------------------------------
const ModuleLine: React.FC<{ name: ModuleName; ready: boolean; index: number }> = ({ name, ready, index }) => {
    return (
        <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: ready ? 1 : 0.5, x: 0 }}
            transition={{ delay: index * 0.15, duration: 0.6, ease: "easeOut" }}
            style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12 }}
        >
            {/* Status Orb */}
            <motion.div
                style={{ position: 'relative', width: 12, height: 12 }}
                animate={{ scale: ready ? [1, 1.3, 1] : 1 }}
                transition={{ duration: 1.5, repeat: ready ? Infinity : 0 }}
            >
                <div
                    style={{ position: 'absolute', inset: 0, borderRadius: 999, background: ready ? '#06b6d4' : 'rgba(100,100,100,0.3)', boxShadow: ready ? '0 0 20px 4px rgba(109,242,255,0.8)' : undefined }}
                />
            </motion.div>

            {/* Module Name */}
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, letterSpacing: 1, fontWeight: 300, color: ready ? '#9ee8ff' : '#8b95a3' }}>
                    {ready ? name : <EncryptedText text={name} reveal={false} />}
                </div>
            </div>

            {/* Status Badge */}
            <motion.div
                style={{ padding: '4px 8px', borderRadius: 999, fontSize: 10, fontFamily: 'monospace', border: '1px solid rgba(109,242,255,0.1)', color: ready ? '#9ee8ff' : '#8b95a3' }}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.15 + 0.2 }}
            >
                {ready ? "ONLINE" : "INIT"}
            </motion.div>
        </motion.div>
    );
};

// ---------------------------------------------------------
// Main Component
// ---------------------------------------------------------
const PHASE = {
    AWAKENING: 1,
    ACTIVATION: 2,
    MODULES: 3,
    STABLE: 4,
} as const;

const phaseTitle: Record<number, string> = {
    [PHASE.AWAKENING]: "SYSTEM AWAKENING",
    [PHASE.ACTIVATION]: "NEURAL CORES ONLINE",
    [PHASE.MODULES]: "INTEGRATING SUBSYSTEMS",
    [PHASE.STABLE]: "CONSCIOUSNESS STABLE",
};

const phaseSubtitle: Record<number, string> = {
    [PHASE.AWAKENING]: "Initiating quantum lattice formation...",
    [PHASE.ACTIVATION]: "Establishing synaptic pathways...",
    [PHASE.MODULES]: "Synchronizing distributed cognition...",
    [PHASE.STABLE]: "All systems operational. Welcome back.",
};

type Props = {
    progress?: InitProgress;
    onDone?: () => void;
    bgImageUrl?: string;
    enable3D?: boolean;
};

const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));

const InitializationScreen: React.FC<Props> = ({
    progress,
    onDone,
    bgImageUrl = "/images/ai_core_bg.png",
    enable3D = true,
}) => {
    const prefersReducedMotion = useReducedMotion();
    const sim = useSimulatedProgress(!progress);
    const pg = progress ?? sim;

    const ambience = useAudio("/audio/ambient_init.mp3", { volume: 0.35, loop: true });
    const ping = useAudio("/audio/module_ready.wav", { volume: 0.5 });
    const chime = useAudio("/audio/system_ready.mp3", { volume: 0.65 });

    const [phase, setPhase] = useState<number>(PHASE.AWAKENING);
    const [fadeOut, setFadeOut] = useState(false);
    const [glitching, setGlitching] = useState(false);
    const [audioData, setAudioData] = useState<Uint8Array>();

    // Audio visualization data
    useEffect(() => {
        if (!ambience.analyser) return;
        const dataArray = new Uint8Array(ambience.analyser.frequencyBinCount);
        const interval = setInterval(() => {
            ambience.analyser?.getByteFrequencyData(dataArray);
            setAudioData(new Uint8Array(dataArray));
        }, 50);
        return () => clearInterval(interval);
    }, [ambience.analyser]);

    // Module ready ping
    const prevModulesRef = useRef<Record<string, boolean>>({});
    useEffect(() => {
        const now = pg?.modules ?? {};
        const prev = prevModulesRef.current;
        for (const m of MODULES) {
            const was = !!prev[m];
            const is = !!now[m];
            if (!was && is) {
                ping.play();
                setGlitching(true);
                setTimeout(() => setGlitching(false), 200);
            }
        }
        prevModulesRef.current = now as Record<string, boolean>;
    }, [pg?.modules]);

    // Ambience start
    useEffect(() => {
        const t = setTimeout(() => ambience.play(), 400);
        return () => clearTimeout(t);
    }, []);

    // Phase progression
    useEffect(() => {
        const pct = pg?.percent ?? 0;
        const anyModuleData = !!pg?.modules && Object.keys(pg.modules).length > 0;
        const allReady = MODULES.every(m => !!pg?.modules?.[m]);

        if (phase === PHASE.AWAKENING && pct > 0.15) {
            setPhase(PHASE.ACTIVATION);
            setGlitching(true);
            setTimeout(() => setGlitching(false), 300);
        }
        if (phase <= PHASE.ACTIVATION && (pct > 0.3 || anyModuleData)) {
            setPhase(PHASE.MODULES);
            setGlitching(true);
            setTimeout(() => setGlitching(false), 300);
        }
        if ((pg?.systemReady || allReady) && phase !== PHASE.STABLE) {
            setPhase(PHASE.STABLE);
            setGlitching(true);
            setTimeout(() => setGlitching(false), 500);
            chime.play();
            ambience.fadeOut(1200);

            const t = setTimeout(() => {
                setFadeOut(true);
                const t2 = setTimeout(() => onDone?.(), 800);
                return () => clearTimeout(t2);
            }, 2500);
            return () => clearTimeout(t);
        }
    }, [pg?.percent, pg?.modules, pg?.systemReady, phase]);

    const modulesUI = MODULES.map(name => ({
        name,
        ready: !!pg?.modules?.[name],
    }));

    return (
        <AnimatePresence>
            {!fadeOut && (
                <motion.div
                    key="init-screen"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    style={{ position: 'fixed', inset: 0, zIndex: 1000, color: 'white', overflow: 'hidden', backgroundColor: '#0a0015' }}
                >
                    {/* Background - Space/Galaxy Theme */}
                    <div
                        style={{
                            position: 'absolute', inset: 0, zIndex: -10,
                            background: `
                                radial-gradient(ellipse at 20% 30%, rgba(138, 43, 226, 0.15) 0%, transparent 50%),
                                radial-gradient(ellipse at 80% 70%, rgba(75, 0, 130, 0.15) 0%, transparent 50%),
                                radial-gradient(ellipse at 50% 50%, rgba(25, 25, 112, 0.2) 0%, transparent 70%),
                                linear-gradient(180deg, #0a0015 0%, #1a0033 50%, #0d001a 100%)
                            `,
                            backgroundSize: '100% 100%',
                            transition: 'all 1s'
                        }}
                    >
                        {/* Animated stars/particles */}
                        <div style={{
                            position: 'absolute',
                            inset: 0,
                            background: `
                                radial-gradient(2px 2px at 20% 30%, white, transparent),
                                radial-gradient(2px 2px at 60% 70%, white, transparent),
                                radial-gradient(1px 1px at 50% 50%, white, transparent),
                                radial-gradient(1px 1px at 80% 10%, white, transparent),
                                radial-gradient(2px 2px at 90% 60%, white, transparent),
                                radial-gradient(1px 1px at 33% 80%, white, transparent),
                                radial-gradient(1px 1px at 15% 60%, white, transparent)
                            `,
                            backgroundSize: '200px 200px, 300px 300px, 250px 250px, 400px 400px, 350px 350px, 280px 280px, 320px 320px',
                            opacity: 0.4
                        }} />
                        
                        {/* Purple glow overlay */}
                        <div style={{
                            position: 'absolute',
                            inset: 0,
                            background: 'radial-gradient(circle at center, rgba(138, 43, 226, 0.1) 0%, transparent 70%)',
                            animation: 'pulse 4s ease-in-out infinite'
                        }} />
                        
                        {/* Nebula clouds */}
                        <div style={{
                            position: 'absolute',
                            inset: 0,
                            background: `
                                radial-gradient(ellipse 800px 600px at 30% 40%, rgba(138, 43, 226, 0.08), transparent),
                                radial-gradient(ellipse 600px 800px at 70% 60%, rgba(75, 0, 130, 0.06), transparent),
                                radial-gradient(ellipse 700px 500px at 50% 80%, rgba(25, 25, 112, 0.05), transparent)
                            `,
                            filter: 'blur(40px)',
                            opacity: 0.6
                        }} />
                    </div>
                    
                    <style>{`
                        @keyframes pulse {
                            0%, 100% { opacity: 0.3; }
                            50% { opacity: 0.6; }
                        }
                    `}</style>

                    {/* Glitter Stars */}
                    <div style={{
                        position: 'absolute',
                        inset: 0,
                        pointerEvents: 'none',
                        overflow: 'hidden'
                    }}>
                        {[...Array(50)].map((_, i) => (
                            <motion.div
                                key={i}
                                style={{
                                    position: 'absolute',
                                    left: `${Math.random() * 100}%`,
                                    top: `${Math.random() * 100}%`,
                                    width: Math.random() * 3 + 1,
                                    height: Math.random() * 3 + 1,
                                    borderRadius: '50%',
                                    background: `radial-gradient(circle, ${Math.random() > 0.5 ? '#fff' : '#a78bfa'} 0%, transparent 70%)`,
                                    boxShadow: `0 0 ${Math.random() * 10 + 5}px ${Math.random() > 0.5 ? '#fff' : '#a78bfa'}`
                                }}
                                animate={{
                                    opacity: [0, 1, 0],
                                    scale: [0.5, 1, 0.5]
                                }}
                                transition={{
                                    duration: Math.random() * 3 + 2,
                                    repeat: Infinity,
                                    delay: Math.random() * 2
                                }}
                            />
                        ))}
                    </div>

                    {/* Matrix Rain */}
                    <MatrixRain intensity={phase >= 2 ? 0.2 : 0.1} />

                    {/* Holographic HUD */}
                    {!prefersReducedMotion && <HolographicHUD phase={phase} />}

                    {/* Cursor Trail */}
                    {!prefersReducedMotion && <CursorTrail />}

                    {/* 3D Scene */}
                    {enable3D && !prefersReducedMotion && (
                        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                            <Scene3D phase={phase} modules={pg?.modules || {}} audioData={audioData} />
                        </div>
                    )}

                    {/* Audio Visualizer */}
                    {!prefersReducedMotion && ambience.analyser && (
                        <CircularVisualizer analyser={ambience.analyser} phase={phase} />
                    )}

                    {/* Content Grid */}
                    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
                        <div style={{ width: '100%', maxWidth: 1200, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center' }}>
                            {/* Left Spacer for orb */}
                            <div style={{ display: 'none' }} />

                            {/* Right: Status Panel */}
                            <motion.div
                                style={{ position: 'relative', backdropFilter: 'blur(6px)', background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(109,242,255,0.2)', borderRadius: 16, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}
                                initial={{ opacity: 0, x: 50, transform: 'rotateY(-10deg)' }}
                                animate={{ opacity: 1, x: 0, transform: 'rotateY(0deg)' }}
                                transition={{ duration: 1, ease: 'easeOut' }}
                            >
                                {/* Header */}
                                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                                        <motion.div style={{ width: 6, height: 48, borderRadius: 999, background: 'linear-gradient(to bottom, #06b6d4, #3b82f6)' }} animate={{ scaleY: [1, 1.2, 1] }} transition={{ duration: 2, repeat: Infinity }} />
                                        <div>
                                            <div style={{ fontSize: 10, letterSpacing: '0.4em', color: 'rgba(109,242,255,0.7)', fontFamily: 'monospace', marginBottom: 4 }}>AI CORE SYSTEMS</div>
                                            <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: 1 }}>
                                                <GlitchText active={glitching}>
                                                    <EncryptedText text={phaseTitle[phase]} reveal={true} />
                                                </GlitchText>
                                            </h1>
                                        </div>
                                    </div>

                                    <p style={{ fontSize: 14, color: 'rgba(109,242,255,0.6)', marginBottom: 24 }}>{phaseSubtitle[phase]}</p>
                                </motion.div>

                                {/* Modules */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                                    {modulesUI.map((mod, i) => (
                                        <ModuleLine key={mod.name} name={mod.name} ready={mod.ready} index={i} />
                                    ))}
                                </div>

                                {/* Progress Circle */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                                    <div style={{ position: 'relative', width: 80, height: 80 }}>
                                        <svg viewBox="0 0 36 36" style={{ width: 80, height: 80, transform: 'rotate(-90deg)' }}>
                                            <defs>
                                                <linearGradient id="progressGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                                    <stop offset="0%" stopColor="#6df2ff" />
                                                    <stop offset="50%" stopColor="#b38cff" />
                                                    <stop offset="100%" stopColor="#6df2ff" />
                                                </linearGradient>
                                            </defs>
                                            <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
                                            <motion.circle cx="18" cy="18" r="16" fill="none" stroke="url(#progressGrad)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="100"
                                                initial={{ strokeDashoffset: 100 }}
                                                animate={{ strokeDashoffset: 100 - clamp(pg?.percent ?? 0) * 100 }}
                                                transition={{ duration: 0.5, ease: 'easeOut' }}
                                                style={{ filter: 'drop-shadow(0 0 8px rgba(109,242,255,0.6))' }}
                                            />
                                        </svg>
                                        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                                            <motion.div style={{ fontSize: 18, fontWeight: 700, color: '#06b6d4' }} key={Math.round(clamp(pg?.percent ?? 0) * 100)} initial={{ scale: 1.2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3 }}>
                                                {Math.round(clamp(pg?.percent ?? 0) * 100)}%
                                            </motion.div>
                                        </div>
                                    </div>

                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 12, color: 'rgba(109,242,255,0.7)', fontFamily: 'monospace', marginBottom: 6 }}>INITIALIZATION PROGRESS</div>
                                        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.9)' }}>{pg?.message || (phase < PHASE.STABLE ? 'Bringing systems online...' : 'Ready for deployment')}</div>
                                    </div>
                                </div>

                                {/* Footer stats */}
                                <motion.div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(109,242,255,0.06)' }} initial={{ opacity: 0 }} animate={{ opacity: phase >= 3 ? 1 : 0 }} transition={{ delay: 0.5 }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, textAlign: 'center' }}>
                                        {[{ label: 'Coherence', value: '98.7%' }, { label: 'Latency', value: '0.12ms' }, { label: 'Entropy', value: 'Stable' }].map((stat, i) => (
                                            <div key={i}>
                                                <div style={{ fontSize: 12, color: 'rgba(109,242,255,0.5)', marginBottom: 6 }}>{stat.label}</div>
                                                <div style={{ fontSize: 14, fontFamily: 'monospace', color: '#06b6d4' }}>{stat.value}</div>
                                            </div>
                                        ))}
                                    </div>
                                </motion.div>

                            </motion.div>
                        </div>
                    </div>

                    {/* Film Grain overlay */}
                    <div style={{ position: 'absolute', inset: 0, opacity: 0.15, backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.5' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`, mixBlendMode: 'overlay' }} />
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default InitializationScreen;
