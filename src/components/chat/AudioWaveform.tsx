import { useEffect, useRef } from "react";

interface AudioWaveformProps {
  stream: MediaStream | null;
  bars?: number;
  className?: string;
}

/**
 * Live mic waveform. Renders animated bars driven by Web Audio analyser data.
 * Uses semantic primary color via CSS var so it adapts to theme.
 */
export default function AudioWaveform({ stream, bars = 28, className = "" }: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  useEffect(() => {
    if (!stream) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const audioCtx = new AudioCtx();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);

    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;
    sourceRef.current = source;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Read the primary color from CSS vars (HSL components)
    const styles = getComputedStyle(document.documentElement);
    const primaryHsl = styles.getPropertyValue("--primary").trim() || "240 5% 64%";

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      analyser.getByteFrequencyData(dataArray);
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const barCount = bars;
      const gap = 2 * dpr;
      const barWidth = (w - gap * (barCount - 1)) / barCount;
      const step = Math.floor(bufferLength / barCount);

      for (let i = 0; i < barCount; i++) {
        // Average a slice of the spectrum for smoother bars
        let sum = 0;
        for (let j = 0; j < step; j++) sum += dataArray[i * step + j];
        const avg = sum / step / 255; // 0..1
        const barHeight = Math.max(2 * dpr, avg * h * 0.95);
        const x = i * (barWidth + gap);
        const y = (h - barHeight) / 2;
        const alpha = 0.55 + avg * 0.45;
        ctx.fillStyle = `hsl(${primaryHsl} / ${alpha})`;
        const radius = Math.min(barWidth / 2, 3 * dpr);
        // Rounded bar
        ctx.beginPath();
        const r = radius;
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + barWidth - r, y);
        ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + r);
        ctx.lineTo(x + barWidth, y + barHeight - r);
        ctx.quadraticCurveTo(x + barWidth, y + barHeight, x + barWidth - r, y + barHeight);
        ctx.lineTo(x + r, y + barHeight);
        ctx.quadraticCurveTo(x, y + barHeight, x, y + barHeight - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fill();
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      try { source.disconnect(); } catch {}
      try { analyser.disconnect(); } catch {}
      audioCtx.close().catch(() => {});
    };
  }, [stream, bars]);

  return <canvas ref={canvasRef} className={className} />;
}
