#!/usr/bin/env python3
"""Render the TV announcer voice packs into web/public/audio/voices/<pack>/<clip>.m4a.

Each pack is a full set of the same announcements (same meaning, a little persona flavor), made from
a text-to-speech voice and then shaped into a character with simple DSP (numpy/scipy):

  british   British agent: suave en-GB announcer (default: clearest in a noisy garage)
  hype      Arcade hype: big energetic arena / arcade MC
  ship      Ship computer: calm, low, measured spaceship AI with a soft reverb
  8bit      8-bit computer: retro robot voice (sample-rate crush, bit crush, ring mod)
  newsreel  Retro newsreel: 1950s radio host (band-limited, warm, a touch of crackle)

Engines (picked per run):
  macOS `say` (default, no account): uses the best installed voice from each pack's preference list.
    Better voices are free: System Settings → Accessibility → Spoken Content → System voice →
    Manage Voices… → download e.g. "Daniel (Enhanced)", "Serena (Premium)", "Evan (Enhanced)",
    "Zoe (Premium)", "Nathan (Enhanced)", then run this again: the script picks them up.
  OpenAI TTS (optional, best quality, needs a paid API key): set OPENAI_API_KEY in your shell
    (never commit it), then `python3 scripts/make-voices.py --engine openai`. Uses gpt-4o-mini-tts
    with a per-pack voice and style instructions, then the same character processing.

Usage:
  /Users/mattgarr/ai-lab/.venv/bin/python scripts/make-voices.py            # all packs, say
  ... scripts/make-voices.py --pack ship --engine openai                     # one pack
  ... scripts/make-voices.py --list-voices                                   # what `say` has

Needs numpy + scipy, and macOS `afconvert` (built in) for the AAC .m4a files Chrome plays.
Writes web/public/audio/voices/manifest.json (pack names, voice used, clip durations in ms).
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, urllib.request
import numpy as np
from scipy import signal
from scipy.io import wavfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'web', 'public', 'audio', 'voices')
SR = 24000  # output sample rate (speech; keeps the files small)

# Clip ids the TV uses (web/src/lib/audio/voice.js). start* = minutes before the start, end* = before the end.
CLIPS = ['start5', 'start4', 'start3', 'start2', 'start1', 'on',
         'end15', 'end10', 'end5', 'end4', 'end3', 'end2', 'end1', 'timesup',
         'awards', 'freeplay', 'check']

# What each pack says: web/src/lib/audio/clockLines.json (2-3 ways per clip; the first is the offline clip).
LINES = {pack: {clip: v[0] for clip, v in clips.items()}
         for pack, clips in json.load(open(os.path.join(ROOT, 'web', 'src', 'lib', 'audio', 'clockLines.json'))).items() if pack != '_'}

# Pack settings. say_voices: preference order (first installed wins). rate: words per minute.
PACKS = {
    'british': dict(name='British agent', say_voices=['Daniel (Enhanced)', 'Daniel (Premium)', 'Oliver (Enhanced)', 'Arthur (Enhanced)', 'Daniel'],
                    rate=178, oa_voice='ballad', oa_style='A suave, sophisticated British male announcer with a refined English accent, '
                    'confident and smooth, a dashing secret-agent / space-mission briefing feel. Crisp and clear, not slow.'),
    'hype': dict(name='Arcade hype', say_voices=['Evan (Enhanced)', 'Nathan (Enhanced)', 'Tom (Enhanced)', 'Alex', 'Reed (English (US))', 'Fred'],
                 rate=192, oa_voice='ash', oa_style='A huge, energetic arena / arcade MC hyping up a crowd. Loud, punchy, excited, '
                 'big smile in the voice, short and clear.'),
    'ship': dict(name='Ship computer', say_voices=['Zoe (Premium)', 'Ava (Premium)', 'Samantha (Enhanced)', 'Samantha'],
                 rate=150, oa_voice='sage', oa_style='A calm, soft-spoken, slightly eerie spaceship computer. Slow, low, measured and '
                 'gentle, perfectly even, polite and unhurried. An original voice, not any film character.'),
    '8bit': dict(name='8-bit computer', say_voices=['Fred', 'Ralph', 'Zarvox'],
                 rate=150, oa_voice='echo', oa_style='A flat, monotone robotic computer voice, evenly spaced words.'),
    'newsreel': dict(name='Retro newsreel', say_voices=['Daniel (Enhanced)', 'Eddy (English (US))', 'Rocko (English (US))', 'Fred'],
                     rate=192, oa_voice='verse', oa_style='A 1950s radio newsreel / game-show host: fast, bright, theatrical, '
                     'mid-Atlantic accent, very enthusiastic.'),
    'dj': dict(name='Fun-center DJ', say_voices=['Evan (Enhanced)', 'Nathan (Enhanced)', 'Alex', 'Fred'],
               rate=190, oa_voice='ash', oa_style='A corny, cheerful roller-rink DJ on the mic: big grin, stretched-out words, dad-joke energy.'),
    # 80s / 90s party voices (Gemini only; the say/openai settings are rough stand-ins).
    'wedding': dict(name='Wedding DJ', say_voices=['Evan (Enhanced)', 'Alex', 'Fred'], rate=185, oa_voice='ash', oa_style='A cheesy 1980s wedding DJ.'),
    'drivetime': dict(name='Drive-time radio', say_voices=['Evan (Enhanced)', 'Alex', 'Fred'], rate=195, oa_voice='verse', oa_style='A fast 1990s radio host.'),
    'countdown': dict(name='Countdown host', say_voices=['Daniel', 'Alex', 'Fred'], rate=170, oa_voice='ballad', oa_style='A smooth, warm top-40 countdown host.'),
    'aerobics': dict(name='Aerobics instructor', say_voices=['Samantha', 'Fred'], rate=190, oa_voice='coral', oa_style='A peppy 1980s aerobics instructor.'),
    'rumble': dict(name='Arena announcer', say_voices=['Ralph', 'Fred'], rate=170, oa_voice='onyx', oa_style='A booming arena announcer.'),
}
DEFAULT_PACK = 'british'


# ---------- engines ----------
def say_voices():
    out = subprocess.run(['say', '-v', '?'], capture_output=True, text=True).stdout
    names = []
    for l in out.splitlines():
        m = re.match(r'^(.*?)\s+[a-z]{2,3}_[A-Za-z0-9]+\s+#', l)
        if m:
            names.append(m.group(1).strip())
    return names


def pick_say_voice(prefs, installed):
    for v in prefs:
        if v in installed:
            return v
    return prefs[-1]


def tts_say(text, voice, rate, path):
    subprocess.run(['say', '-v', voice, '-r', str(rate), '--data-format=LEI16@22050', '-o', path, text], check=True)


def tts_gemini(text, pack, path):
    # The same AI voices the TV uses live: the `tts` edge function (host passcode from HOST_PASSCODE.txt,
    # never printed). The line is cached in storage, so the TV gets it instantly too.
    pw = open(os.path.join(ROOT, 'HOST_PASSCODE.txt')).read().splitlines()[2].strip()
    body = json.dumps({'pass': pw, 'pack': pack, 'text': text}).encode()
    req = urllib.request.Request('https://llmggdjxiffkwnjuogxf.supabase.co/functions/v1/tts', data=body, headers={
        'Content-Type': 'application/json', 'apikey': 'sb_publishable_7oGSOVFpRFVnJ5SeRcjYsQ_a6EQyojv'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                url = json.load(r)['url']
            with urllib.request.urlopen(url, timeout=60) as r, open(path, 'wb') as f:
                f.write(r.read())
            return
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                raise
            print(f'  retry {pack}: {e}')


def tts_openai(text, pack, path):
    key = os.environ.get('OPENAI_API_KEY')
    if not key:
        sys.exit('Set OPENAI_API_KEY in your shell first (never commit it).')
    body = json.dumps({'model': 'gpt-4o-mini-tts', 'voice': PACKS[pack]['oa_voice'], 'input': text,
                       'instructions': PACKS[pack]['oa_style'], 'response_format': 'wav'}).encode()
    req = urllib.request.Request('https://api.openai.com/v1/audio/speech', data=body,
                                 headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r, open(path, 'wb') as f:
        f.write(r.read())


# ---------- DSP ----------
def load(path):
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        sr, x = wavfile.read(path)
    x = x.astype(np.float64)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if np.abs(x).max() > 2:
        x /= 32768.0
    return sr, x


def resample(x, sr_from, sr_to):
    from math import gcd
    g = gcd(int(sr_from), int(sr_to))
    return signal.resample_poly(x, sr_to // g, sr_from // g)


def speed(x, factor):
    """Tape-style speed change: factor < 1 = slower and lower."""
    n = int(len(x) / factor)
    return signal.resample(x, n) if n > 0 else x


def band(x, sr, lo=None, hi=None, order=4):
    if lo and hi:
        sos = signal.butter(order, [lo, hi], 'bandpass', fs=sr, output='sos')
    elif lo:
        sos = signal.butter(order, lo, 'highpass', fs=sr, output='sos')
    else:
        sos = signal.butter(order, hi, 'lowpass', fs=sr, output='sos')
    return signal.sosfilt(sos, x)


def peak_eq(x, sr, f0, gain_db, q=1.0):
    a = 10 ** (gain_db / 40)
    w = 2 * np.pi * f0 / sr
    al = np.sin(w) / (2 * q)
    b = [1 + al * a, -2 * np.cos(w), 1 - al * a]
    aa = [1 + al / a, -2 * np.cos(w), 1 - al / a]
    return signal.lfilter(np.array(b) / aa[0], np.array(aa) / aa[0], x)


def compress(x, sr, thresh_db=-20, ratio=4, attack=0.005, release=0.08, makeup_db=0):
    env = np.abs(x)
    a_a, a_r = np.exp(-1 / (sr * attack)), np.exp(-1 / (sr * release))
    e = np.zeros_like(env)
    prev = 0.0
    for i, v in enumerate(env):  # fine for a few seconds of audio
        prev = (a_a if v > prev else a_r) * prev + (1 - (a_a if v > prev else a_r)) * v
        e[i] = prev
    db = 20 * np.log10(np.maximum(e, 1e-6))
    over = np.maximum(0, db - thresh_db)
    gain = 10 ** ((-over * (1 - 1 / ratio) + makeup_db) / 20)
    return x * gain


def reverb(x, sr, seconds=1.2, mix=0.2, predelay=0.02, damp=4000, seed=1):
    rng = np.random.default_rng(seed)
    n = int(sr * seconds)
    ir = rng.standard_normal(n) * np.exp(-6.9 * np.arange(n) / n)
    ir = band(ir, sr, hi=damp, order=2)
    ir = np.concatenate([np.zeros(int(sr * predelay)), ir])
    ir /= np.sqrt(np.sum(ir ** 2))
    wet = signal.fftconvolve(x, ir)[: len(x) + len(ir)]
    dry = np.concatenate([x, np.zeros(len(wet) - len(x))])
    return dry * (1 - mix) + wet * mix * 0.9


def echo(x, sr, delay=0.11, fb=0.25, taps=3):
    d = int(sr * delay)
    y = np.concatenate([x, np.zeros(d * taps)])
    for k in range(1, taps + 1):
        y[d * k: d * k + len(x)] += x * (fb ** k)
    return y


def bitcrush(x, sr, hold_sr=7000, bits=6, mix=0.75):
    step = max(1, int(round(sr / hold_sr)))
    held = np.repeat(x[::step], step)[: len(x)]
    q = 2 ** (bits - 1)
    crushed = np.round(held * q) / q
    return x * (1 - mix) + crushed * mix


def ringmod(x, sr, freq=55, mix=0.35):
    t = np.arange(len(x)) / sr
    return x * (1 - mix) + x * np.sin(2 * np.pi * freq * t) * mix


def chorus(x, sr, ms=12, depth=3, rate=0.6, mix=0.25):
    t = np.arange(len(x))
    dl = (ms + depth * np.sin(2 * np.pi * rate * t / sr)) * sr / 1000
    idx = np.clip(t - dl, 0, len(x) - 1)
    return x * (1 - mix) + np.interp(idx, t, x) * mix


def crackle(x, sr, amount=0.006, seed=2):
    rng = np.random.default_rng(seed)
    hiss = band(rng.standard_normal(len(x)), sr, 1500, 6000, 2) * amount * 0.4
    pops = (rng.random(len(x)) > 0.9994) * rng.standard_normal(len(x)) * amount * 6
    return x + hiss + pops


def saturate(x, drive=2.0):
    return np.tanh(x * drive) / np.tanh(drive)


def trim(x, sr, thresh=0.01, pad=0.04):
    idx = np.where(np.abs(x) > thresh)[0]
    if not len(idx):
        return x
    a = max(0, idx[0] - int(sr * pad))
    b = min(len(x), idx[-1] + int(sr * pad * 3))
    return x[a:b]


def finish(x, sr, target_rms_db=-17, peak_db=-1.0):
    x = x - np.mean(x)
    loud = np.abs(x) > 0.02 * np.abs(x).max()
    rms = np.sqrt(np.mean(x[loud] ** 2)) if loud.any() else 1e-3
    x = x * (10 ** (target_rms_db / 20) / rms)
    pk = np.abs(x).max()
    lim = 10 ** (peak_db / 20)
    if pk > lim:  # soft limit the rare peaks rather than lowering everything
        x = np.where(np.abs(x) > lim * 0.8, np.sign(x) * (lim * 0.8 + (lim * 0.2) * np.tanh((np.abs(x) - lim * 0.8) / (lim * 0.2))), x)
    f = int(sr * 0.01)
    x[:f] *= np.linspace(0, 1, f)
    x[-f * 3:] *= np.linspace(1, 0, f * 3)
    return np.clip(x, -1, 1)


def character(pack, x, sr):
    if pack == 'british':
        x = band(x, sr, lo=90)
        x = peak_eq(x, sr, 3000, 3, 0.9)       # presence: cuts through a noisy room
        x = peak_eq(x, sr, 220, 1.5, 0.8)      # a little warmth
        x = compress(x, sr, -22, 3, makeup_db=4)
        x = reverb(x, sr, 0.5, 0.08)
    elif pack == 'hype':
        x = speed(x, 1.03)
        x = band(x, sr, lo=110)
        x = peak_eq(x, sr, 2600, 4, 0.8)
        x = compress(x, sr, -26, 6, attack=0.002, makeup_db=8)
        x = saturate(x * 1.4, 1.6)
        x = echo(x, sr, 0.12, 0.22, 2)
        x = reverb(x, sr, 1.6, 0.18, damp=6000)
    elif pack == 'ship':
        x = speed(x, 0.9)                       # slower and lower, measured
        x = band(x, sr, lo=70, hi=7000)
        x = peak_eq(x, sr, 180, 2.5, 0.7)
        x = chorus(x, sr, 14, 2, 0.25, 0.18)    # a faint synthetic shimmer
        x = compress(x, sr, -24, 3, makeup_db=4)
        x = reverb(x, sr, 2.2, 0.26, predelay=0.04, damp=3500)
    elif pack == '8bit':
        x = band(x, sr, lo=150)
        x = bitcrush(x, sr, 9000, 7, 0.55)
        x = ringmod(x, sr, 60, 0.18)
        x = band(x, sr, hi=5500)
        x = compress(x, sr, -24, 4, makeup_db=5)
    elif pack == 'newsreel':
        x = band(x, sr, 320, 3600, 3)          # old radio / PA
        x = peak_eq(x, sr, 1200, 3, 1.2)
        x = saturate(x * 1.6, 1.8)
        x = compress(x, sr, -22, 4, makeup_db=4)
        x = crackle(x, sr)
        x = reverb(x, sr, 0.9, 0.12, damp=3000)
    return x


def encode(x, sr, dst):
    with tempfile.TemporaryDirectory() as d:
        wav = os.path.join(d, 'x.wav')
        wavfile.write(wav, sr, (x * 32767).astype(np.int16))
        subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '64000', '-q', '127', wav, dst], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pack', action='append', help='only these packs (repeatable)')
    ap.add_argument('--engine', default='gemini', choices=['gemini', 'say', 'openai'])
    ap.add_argument('--list-voices', action='store_true')
    a = ap.parse_args()
    installed = say_voices()
    if a.list_voices:
        print('\n'.join(installed))
        return
    if not shutil.which('afconvert'):
        sys.exit('afconvert (macOS) is needed to write .m4a files.')
    packs = a.pack or list(PACKS)
    mpath = os.path.join(OUT, 'manifest.json')
    manifest = json.load(open(mpath)) if os.path.exists(mpath) else {'default': DEFAULT_PACK, 'clips': CLIPS, 'packs': {}}
    manifest['default'], manifest['clips'] = DEFAULT_PACK, CLIPS
    for pack in packs:
        cfg = PACKS[pack]
        voice = {'openai': f"openai:{cfg['oa_voice']}", 'gemini': 'gemini:designed'}.get(a.engine) or pick_say_voice(cfg['say_voices'], installed)
        os.makedirs(os.path.join(OUT, pack), exist_ok=True)
        durs = {}

        def one(clip):
            text = LINES[pack][clip]
            with tempfile.TemporaryDirectory() as d:
                raw = os.path.join(d, 'raw.wav')
                if a.engine == 'gemini':
                    tts_gemini(text, pack, raw)
                elif a.engine == 'openai':
                    tts_openai(text, pack, raw)
                else:
                    tts_say(text, voice, cfg['rate'], raw)
                sr, x = load(raw)
            x = resample(x, sr, SR)
            x = trim(x, SR)
            # Gemini clips stay dry: the TV adds each pack's character live (voice.js), same as its AI lines.
            x = finish(x if a.engine == 'gemini' else character(pack, x, SR), SR)
            dst = os.path.join(OUT, pack, f'{clip}.m4a')
            encode(x, SR, dst)
            return clip, int(len(x) / SR * 1000)

        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(6) as ex:
            durs = dict(ex.map(one, CLIPS))
        manifest['packs'][pack] = {'name': cfg['name'], 'voice': voice, 'engine': a.engine, 'ms': durs,
                                   'lines': LINES[pack]}
        print(f'{pack:9s} {cfg["name"]:16s} voice={voice:24s} clips={len(durs)} longest={max(durs.values())} ms')
    manifest['packs'] = {k: manifest['packs'][k] for k in PACKS if k in manifest['packs']}
    with open(mpath, 'w') as f:
        json.dump(manifest, f, indent=1)
    print('Wrote', mpath)


if __name__ == '__main__':
    main()
