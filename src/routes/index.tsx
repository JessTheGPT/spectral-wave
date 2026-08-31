import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Moon, Sun } from "lucide-react";
import { SiriWave } from "@/lib/siri-wave/engine";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Siri Glow — WebGL spectral wave driven by your voice" },
      {
        name: "description",
        content:
          "The Siri ribbon of light rebuilt in raw WebGL2: one sine wave drawn four times in spectral colours, phase-split into a rainbow, driven live by your microphone.",
      },
      { property: "og:title", content: "Siri Glow — WebGL spectral wave" },
      {
        property: "og:description",
        content:
          "A microphone-reactive ribbon of light: four phase-shifted spectral copies of one sine wave, composited like a prism.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const hostRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<SiriWave | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [dark, setDark] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const wave = new SiriWave(host);
    waveRef.current = wave;
    if (!wave.ok) {
      setFailed(true);
      return () => wave.destroy();
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      wave.renderStill();
    } else {
      wave.start();
    }

    const onVis = () => {
      if (reduced) return;
      if (document.hidden) wave.stop();
      else wave.start();
    };
    document.addEventListener("visibilitychange", onVis);

    const io = new IntersectionObserver(
      ([entry]) => {
        if (reduced) return;
        if (entry?.isIntersecting) wave.start();
        else wave.stop();
      },
      { threshold: 0.05 },
    );
    io.observe(host);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      io.disconnect();
      wave.destroy();
      waveRef.current = null;
    };
  }, []);

  const toggleMic = async () => {
    const wave = waveRef.current;
    if (!wave) return;
    if (wave.micLive) {
      wave.disableMic();
      setMicOn(false);
    } else {
      const ok = await wave.enableMic();
      setMicOn(ok);
    }
  };

  const toggleDark = () => {
    setDark((d) => {
      waveRef.current?.setDark(!d);
      return !d;
    });
  };

  return (
    <main
      className={`relative h-dvh w-full overflow-hidden ${dark ? "bg-black" : "bg-background"}`}
      style={{ ["--bg-surface" as string]: dark ? "#000000" : "#ffffff" }}
    >
      <div ref={hostRef} className="absolute inset-0" aria-hidden="true" />

      {failed && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          WebGL2 is not available in this browser.
        </p>
      )}

      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-5 sm:p-8">
        <div>
          <h1
            className={`text-sm font-medium tracking-[0.22em] uppercase ${
              dark ? "text-white/70" : "text-foreground/70"
            }`}
          >
            Siri Glow
          </h1>
          <p className={`mt-1 text-xs ${dark ? "text-white/40" : "text-muted-foreground"}`}>
            One wave, four spectra, your voice.
          </p>
        </div>
        <button
          onClick={toggleDark}
          aria-label={dark ? "Switch to light background" : "Switch to dark background"}
          className={`pointer-events-auto rounded-full border p-2.5 backdrop-blur transition-colors ${
            dark
              ? "border-white/15 text-white/80 hover:bg-white/10"
              : "border-border text-foreground/70 hover:bg-accent"
          }`}
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </header>

      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-8">
        <button
          onClick={toggleMic}
          aria-label={micOn ? "Stop microphone" : "Start microphone"}
          className={`pointer-events-auto flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-medium backdrop-blur transition-colors ${
            dark
              ? "border-white/15 text-white hover:bg-white/10"
              : "border-border text-foreground hover:bg-accent"
          }`}
        >
          {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          {micOn ? "Listening — speak" : "Enable microphone"}
        </button>
        <p className={`text-xs ${dark ? "text-white/35" : "text-muted-foreground"}`}>
          {micOn
            ? "Vowels bloom the wave, sibilants fringe the colours. Nothing is recorded."
            : "Simulated signal until you enable the mic. Audio never leaves your device."}
        </p>
      </div>
    </main>
  );
}
