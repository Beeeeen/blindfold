"""Measures how much each candidate voice actually varies its delivery.

    python scripts/voice-analyse.py voice/lab/*-dry.mp3

Warmth is subjective, but the thing people are usually reacting to when they
call a synthesised read "flat" is objective: the pitch barely moves. This tracks
fundamental frequency by autocorrelation and reports how wide the intonation
range is, alongside how much the loudness breathes across the line.

Higher pitch spread means a more melodic read. It is a proxy, not a verdict --
but it beats choosing from a marketing adjective.
"""
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfiltfilt

SR = 16000
FRAME = 1024
HOP = 256
F0_MIN, F0_MAX = 60, 350


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le",
         "-ac", "1", "-ar", str(SR), "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def f0_track(x: np.ndarray) -> tuple[np.ndarray, float]:
    """Autocorrelation pitch track. Returns voiced F0 values and voiced fraction."""
    sos = butter(4, [F0_MIN / (SR / 2), 1000 / (SR / 2)], btype="band", output="sos")
    x = sosfiltfilt(sos, x)

    lo, hi = SR // F0_MAX, SR // F0_MIN
    f0s, voiced = [], 0
    frames = 0
    for start in range(0, len(x) - FRAME, HOP):
        frame = x[start:start + FRAME]
        energy = np.sqrt(np.mean(frame ** 2))
        frames += 1
        if energy < 0.01:          # silence between words
            continue
        frame = frame - frame.mean()
        corr = np.correlate(frame, frame, mode="full")[FRAME - 1:]
        if corr[0] <= 0:
            continue
        corr = corr / corr[0]
        window = corr[lo:hi]
        if window.size == 0:
            continue
        peak = int(np.argmax(window)) + lo
        # A weak peak means the frame was not really periodic -- unvoiced.
        if corr[peak] < 0.35:
            continue
        f0s.append(SR / peak)
        voiced += 1
    return np.array(f0s), voiced / max(frames, 1)


def rms_envelope(x: np.ndarray) -> np.ndarray:
    n = len(x) // HOP
    env = np.array([np.sqrt(np.mean(x[i * HOP:(i + 1) * HOP] ** 2)) for i in range(n)])
    return env[env > 1e-4]


print(f"{'file':<22} {'median F0':>10} {'spread':>9} {'range':>13} {'voiced':>8} {'loudness var':>13}")
print("-" * 82)
rows = []
for arg in sys.argv[1:]:
    p = Path(arg)
    if not p.exists():
        continue
    x = decode(p)
    f0, voiced = f0_track(x)
    if f0.size < 10:
        print(f"{p.stem:<22} {'no pitch found':>10}")
        continue
    # Semitone spread is the perceptually meaningful unit for intonation.
    semis = 12 * np.log2(f0 / np.median(f0))
    spread = float(np.std(semis))
    lo, hi = np.percentile(f0, [10, 90])
    env = rms_envelope(x)
    loud_var = float(np.std(20 * np.log10(env + 1e-9)))
    rows.append((p.stem, spread))
    print(f"{p.stem:<22} {np.median(f0):>9.0f}Hz {spread:>8.2f}st {lo:>5.0f}-{hi:<5.0f}Hz "
          f"{voiced:>7.0%} {loud_var:>11.1f}dB")

if rows:
    best = max(rows, key=lambda r: r[1])
    print(f"\nwidest intonation: {best[0]} at {best[1]:.2f} semitones")
