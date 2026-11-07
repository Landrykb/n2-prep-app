#!/usr/bin/env python3
"""Yonde Voice Worker — runs on Landry's BleepxNotes VM (user orion).

Why this exists: Microsoft's Edge TTS endpoint refuses synthesis from
Supabase's datacenter egress (proven 2026-11-06, three 502s), but answers
fine from this VM. Passages are cached assets — each one is synthesized
ONCE and then reused forever via Telegram file_id — so a tiny polling
worker here covers the whole Reader.

Loop: claim the oldest pending job from the `voice-queue` Supabase edge
function -> synthesize with edge-tts (ja-JP-NanamiNeural) -> convert to
ogg/opus with ffmpeg -> hand the bytes back (`complete`). The function
stores the audio, and reader-bot sends it and caches the file_id.

The worker holds ONE single-purpose secret (VOICE_WORKER_SECRET) that
only talks to the voice-queue function. No database keys, no bot token.

Config: ~/voice-worker/worker.env (VOICE_QUEUE_URL, VOICE_WORKER_SECRET)
Log:    ~/voice-worker/worker.log
"""

import asyncio
import base64
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request
import urllib.error

HOME = os.path.expanduser("~/voice-worker")
ENV_PATH = os.path.join(HOME, "worker.env")
LOG_PATH = os.path.join(HOME, "worker.log")
TMP_DIR = os.path.join(HOME, "tmp")
VOICE = "ja-JP-NanamiNeural"
POLL_SECONDS = 10
MAX_TEXT_CHARS = 1200

# The synchronous tts lane (Doc 17 addendum 5, 2026-11-08): the
# app's play buttons ask the `tts-vm` function for one line; the
# function enqueues a kind='tts' job and waits, so this lane
# polls FAST (1.5 s) in its own thread and returns MP3 (the web
# plays it everywhere — the passage lane's ogg/opus conversion
# is a Telegram requirement, not a web one). Casts mirror
# src/lib/voiceCast.js in the app: the free Edge route has two
# Japanese neural voices; girl/boy are pitch lifts.
TTS_POLL_SECONDS = 1.5
CASTS = {
    "female": ("ja-JP-NanamiNeural", "+0Hz"),
    "male": ("ja-JP-KeitaNeural", "+0Hz"),
    "girl": ("ja-JP-NanamiNeural", "+35Hz"),
    "boy": ("ja-JP-KeitaNeural", "+25Hz"),
}


def log(msg):
    line = "%s %s" % (time.strftime("%Y-%m-%dT%H:%M:%S%z"), msg)
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass
    print(line, flush=True)


def load_env():
    cfg = {}
    with open(ENV_PATH, encoding="utf-8") as f:
        for raw in f:
            raw = raw.strip()
            if raw and not raw.startswith("#") and "=" in raw:
                k, v = raw.split("=", 1)
                cfg[k.strip()] = v.strip()
    return cfg


def post_json(url, secret, payload, timeout=60):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-worker-secret": secret,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


async def synthesize_mp3(text, out_path):
    import edge_tts  # from the venv

    communicate = edge_tts.Communicate(text, VOICE)
    await communicate.save(out_path)


async def synthesize_mp3_cast(text, out_path, voice, pitch):
    import edge_tts  # from the venv

    communicate = edge_tts.Communicate(text, voice, pitch=pitch)
    await communicate.save(out_path)


def synthesize_tts_mp3(text, job_id, cast):
    voice, pitch = CASTS.get(cast, CASTS["female"])
    mp3_path = os.path.join(TMP_DIR, "tts-" + job_id + ".mp3")
    asyncio.run(synthesize_mp3_cast(text, mp3_path, voice, pitch))
    with open(mp3_path, "rb") as f:
        data = f.read()
    try:
        os.unlink(mp3_path)
    except OSError:
        pass
    if not data:
        raise RuntimeError("empty audio from synthesis")
    return data


def tts_loop(cfg):
    """Fast lane: claim kind='tts' jobs and hand MP3 bytes back.

    Runs in a daemon thread beside the passage loop; shares the
    one worker secret and door. A failure here never touches the
    passage lane.
    """
    url = cfg.get("VOICE_QUEUE_URL", "")
    secret = cfg.get("VOICE_WORKER_SECRET", "")
    log("tts lane started (poll %.1fs)" % TTS_POLL_SECONDS)
    while True:
        try:
            res = post_json(url, secret, {"action": "tts-claim"}, timeout=30)
            job = res.get("job") if isinstance(res, dict) else None
            if not job:
                time.sleep(TTS_POLL_SECONDS)
                continue
            job_id = str(job["id"])
            text = str(job.get("text", ""))[:MAX_TEXT_CHARS]
            cast = str(job.get("cast", "female"))
            t0 = time.time()
            try:
                audio = synthesize_tts_mp3(text, job_id, cast)
                post_json(
                    url, secret,
                    {
                        "action": "tts-complete",
                        "jobId": job_id,
                        "audioBase64": base64.b64encode(audio).decode("ascii"),
                    },
                    timeout=120,
                )
                log("tts job %s done (%d bytes, %.1fs, cast=%s)"
                    % (job_id, len(audio), time.time() - t0, cast))
            except Exception as e:
                log("tts job %s failed: %s" % (job_id, repr(e)[:200]))
                try:
                    post_json(url, secret,
                              {"action": "fail", "jobId": job_id,
                               "error": repr(e)[:200]}, timeout=30)
                except Exception:
                    pass
        except urllib.error.HTTPError as e:
            log("tts queue HTTP %s; backing off" % e.code)
            time.sleep(15)
        except Exception as e:
            log("tts poll error: %s; backing off" % repr(e)[:160])
            time.sleep(15)


def synthesize_ogg(text, job_id):
    mp3_path = os.path.join(TMP_DIR, job_id + ".mp3")
    ogg_path = os.path.join(TMP_DIR, job_id + ".ogg")
    asyncio.run(synthesize_mp3(text, mp3_path))
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error", "-i", mp3_path,
            "-c:a", "libopus", "-b:a", "32k", ogg_path,
        ],
        check=True, timeout=120,
    )
    with open(ogg_path, "rb") as f:
        data = f.read()
    for p in (mp3_path, ogg_path):
        try:
            os.unlink(p)
        except OSError:
            pass
    if not data:
        raise RuntimeError("empty audio after conversion")
    return data


def main():
    os.makedirs(TMP_DIR, exist_ok=True)
    cfg = load_env()
    url = cfg.get("VOICE_QUEUE_URL", "")
    secret = cfg.get("VOICE_WORKER_SECRET", "")
    if not url or not secret:
        log("FATAL: worker.env missing VOICE_QUEUE_URL or VOICE_WORKER_SECRET")
        return 1
    log("voice worker started (voice=%s)" % VOICE)
    lane = threading.Thread(target=tts_loop, args=(cfg,), daemon=True)
    lane.start()
    while True:
        try:
            res = post_json(url, secret, {"action": "claim"}, timeout=30)
            job = res.get("job") if isinstance(res, dict) else None
            if not job:
                time.sleep(POLL_SECONDS)
                continue
            job_id = str(job["id"])
            text = str(job.get("text", ""))[:MAX_TEXT_CHARS]
            log("claimed job %s (%d chars)" % (job_id, len(text)))
            t0 = time.time()
            try:
                audio = synthesize_ogg(text, job_id)
                post_json(
                    url, secret,
                    {
                        "action": "complete",
                        "jobId": job_id,
                        "audioBase64": base64.b64encode(audio).decode("ascii"),
                    },
                    timeout=120,
                )
                log("completed job %s (%d bytes, %.1fs)"
                    % (job_id, len(audio), time.time() - t0))
            except Exception as e:  # synthesis or upload failed
                log("job %s failed: %s" % (job_id, repr(e)[:200]))
                try:
                    post_json(url, secret,
                              {"action": "fail", "jobId": job_id,
                               "error": repr(e)[:200]}, timeout=30)
                except Exception:
                    pass
        except urllib.error.HTTPError as e:
            log("queue HTTP %s; backing off" % e.code)
            time.sleep(30)
        except Exception as e:  # network down, DNS, etc — keep polling
            log("poll error: %s; backing off" % repr(e)[:160])
            time.sleep(30)


if __name__ == "__main__":
    sys.exit(main())
