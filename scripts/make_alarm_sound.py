"""Generates assets/sounds/moby_alarm.wav, the critical-alert tone (src/lib/notifications.ts).

Original and synthetic: three rising sweeps, twice. Deliberately not the broadcast
Emergency Alert System tone (853 + 960 Hz), which must not be imitated.
Run: python3 scripts/make_alarm_sound.py
"""
import math
import struct
import wave
from pathlib import Path

RATE = 44_100
SWEEP_S, GAP_S, PAUSE_S = 0.32, 0.08, 0.35
LOW_HZ, HIGH_HZ = 700.0, 1400.0
FADE_S = 0.01


def sweep() -> list[float]:
    n = int(SWEEP_S * RATE)
    out, phase = [], 0.0
    for i in range(n):
        t = i / n
        phase += 2 * math.pi * (LOW_HZ + (HIGH_HZ - LOW_HZ) * t) / RATE
        # A touch of the 2nd and 3rd harmonic so it cuts through on small phone speakers.
        s = math.sin(phase) + 0.35 * math.sin(2 * phase) + 0.15 * math.sin(3 * phase)
        fade = min(1.0, i / (FADE_S * RATE), (n - i) / (FADE_S * RATE))
        out.append(s / 1.5 * fade)
    return out


def silence(seconds: float) -> list[float]:
    return [0.0] * int(seconds * RATE)


def main() -> None:
    burst = (sweep() + silence(GAP_S)) * 3
    samples = burst + silence(PAUSE_S) + burst
    path = Path(__file__).resolve().parent.parent / "assets" / "sounds" / "moby_alarm.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1.0, min(1.0, s)) * 0.9 * 32767)) for s in samples))
    print(f"wrote {path} ({len(samples) / RATE:.1f}s)")


if __name__ == "__main__":
    main()
