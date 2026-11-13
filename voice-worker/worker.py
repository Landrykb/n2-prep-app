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
MAX_TEXT_CHARS = 1200

# Event-driven rest (2026-11-13, Landry's rule: "if I'm not
# using it, it should not be doing anything"). The lanes do NOT
# poll. Each sleeps on its own wake event until either
#   (a) the doorbell rings — the functions that enqueue jobs
#       (reader-bot, tts-vm) insert a row on the content-free
#       worker_wake table and this worker hears the INSERT
#       over one outbound Realtime websocket (migration
#       00029), or
#   (b) a slow backstop timer fires, so a missed poke can only
#       ever cost latency, never a stranded job.
# History: fixed polls (1.5s/10s) burned 622k Supabase function
# invocations in a billing period (two worker copies running);
# a long-poll step (~2/minute) still spent ~115k/month at
# idle. At rest this design costs the backstops only: ~14k
# invocations a month, and the poke makes them almost never
# fire. Idle pickup latency after a poke: ~1s.
BACKSTOP_TTS_SECONDS = 300
BACKSTOP_PASSAGE_SECONDS = 1800

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


def synthesize_tts_audio(text, job_id, cast):
    """One button line in its cast, returned as AAC in an MP4
    container (.m4a). The MP3 edge-tts produces is valid, but
    Landry's WebKit refused to play it in every delivery shape
    (blob AND https URL — NotSupportedError, 2026-11-08), while
    AAC/m4a is Apple's own format. The transcode mirrors the
    passage lane's ffmpeg step: AAC-LC, 44.1 kHz, mono, 48k."""
    voice, pitch = CASTS.get(cast, CASTS["female"])
    mp3_path = os.path.join(TMP_DIR, "tts-" + job_id + ".mp3")
    m4a_path = os.path.join(TMP_DIR, "tts-" + job_id + ".m4a")
    asyncio.run(synthesize_mp3_cast(text, mp3_path, voice, pitch))
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", mp3_path,
             "-c:a", "aac", "-b:a", "48k", "-ar", "44100", "-ac", "1",
             m4a_path],
            check=True, timeout=60,
        )
        with open(m4a_path, "rb") as f:
            data = f.read()
    finally:
        for path in (mp3_path, m4a_path):
            try:
                os.unlink(path)
            except OSError:
                pass
    if not data:
        raise RuntimeError("empty audio from synthesis")
    return data


# One wake event per lane; the poke handler sets both (a poke
# means "something was enqueued" — each lane simply re-checks
# its own queue; the wrong lane's extra claim is one call).
WAKE_TTS = threading.Event()
WAKE_PASSAGE = threading.Event()


def start_wake_listener(cfg):
    """Doorbell listener: ONE outbound Realtime websocket to
    Supabase, subscribed to INSERTs on the content-free
    worker_wake table (migration 00029). The functions that
    enqueue jobs ring it from inside their own invocation; a
    ring sets both lane events (each lane re-checks its own
    queue; the wrong lane's empty claim costs one call, and
    only on real enqueues). Outbound-only by design: an
    earlier inbound HTTP listener on port 8791 never received
    a single poke — Oracle's security list admits only SSH
    to this VM, which the 2026-11-13 tts-vm proof showed
    (504, job untouched). Reconnects forever with backoff;
    if Realtime is down the backstop timers still bound every
    wait, so a dead doorbell costs latency, never a job.
    """
    queue_url = cfg.get("VOICE_QUEUE_URL", "")
    anon = cfg.get("SUPABASE_ANON_KEY", "")
    if not queue_url or not anon:
        log("wake listener disabled (missing queue URL or anon key); backstops only")
        return
    host = queue_url.split("://", 1)[1].split("/", 1)[0]

    async def run():
        import websockets

        url = "wss://%s/realtime/v1/websocket?apikey=%s&vsn=1.0.0" % (host, anon)
        backoff = 5
        ref_counter = [0]

        def next_ref():
            ref_counter[0] += 1
            return str(ref_counter[0])

        while True:
            try:
                async with websockets.connect(url, ping_interval=None) as ws:
                    join = {
                        "topic": "realtime:public:worker_wake",
                        "event": "phx_join",
                        "payload": {
                            "config": {
                                "broadcast": {"ack": False, "self": False},
                                "presence": {"key": ""},
                                "postgres_changes": [
                                    {"event": "INSERT", "schema": "public", "table": "worker_wake"}
                                ],
                            },
                            "access_token": anon,
                        },
                        "ref": next_ref(),
                    }
                    await ws.send(json.dumps(join))
                    log("wake listener connected; doorbell join sent")
                    backoff = 5
                    last_hb = 0.0
                    while True:
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=10)
                        except asyncio.TimeoutError:
                            raw = None
                        now = time.time()
                        if now - last_hb >= 25:
                            last_hb = now
                            await ws.send(json.dumps({
                                "topic": "phoenix",
                                "event": "heartbeat",
                                "payload": {},
                                "ref": next_ref(),
                            }))
                        if raw is None:
                            continue
                        try:
                            msg = json.loads(raw)
                        except ValueError:
                            continue
                        if msg.get("event") == "postgres_changes":
                            WAKE_TTS.set()
                            WAKE_PASSAGE.set()
                        elif (
                            msg.get("event") == "phx_reply"
                            and (msg.get("payload") or {}).get("status") == "ok"
                            and str(msg.get("topic", "")).startswith("realtime:")
                        ):
                            log("wake listener subscribed to worker_wake")
            except Exception as e:
                log("wake listener dropped: %s; reconnecting in %ds" % (repr(e)[:120], backoff))
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)

    thread = threading.Thread(target=lambda: asyncio.run(run()), daemon=True)
    thread.start()


def tts_loop(cfg):
    """Fast lane: claim kind='tts' jobs and hand AAC/m4a bytes back.

    Runs in a daemon thread beside the passage loop; shares the
    one worker secret and door. A failure here never touches the
    passage lane.
    """
    url = cfg.get("VOICE_QUEUE_URL", "")
    secret = cfg.get("VOICE_WORKER_SECRET", "")
    log("tts lane started (event-driven, backstop %ds)" % BACKSTOP_TTS_SECONDS)
    while True:
        try:
            res = post_json(url, secret, {"action": "tts-claim"}, timeout=30)
            job = res.get("job") if isinstance(res, dict) else None
            if not job:
                WAKE_TTS.wait(timeout=BACKSTOP_TTS_SECONDS)
                WAKE_TTS.clear()
                continue
            job_id = str(job["id"])
            text = str(job.get("text", ""))[:MAX_TEXT_CHARS]
            cast = str(job.get("cast", "female"))
            t0 = time.time()
            try:
                audio = synthesize_tts_audio(text, job_id, cast)
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
            WAKE_TTS.wait(timeout=15)
            WAKE_TTS.clear()
        except Exception as e:
            log("tts poll error: %s; backing off" % repr(e)[:160])
            WAKE_TTS.wait(timeout=15)
            WAKE_TTS.clear()


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
    start_wake_listener(cfg)
    lane = threading.Thread(target=tts_loop, args=(cfg,), daemon=True)
    lane.start()
    while True:
        try:
            res = post_json(url, secret, {"action": "claim"}, timeout=30)
            job = res.get("job") if isinstance(res, dict) else None
            if not job:
                WAKE_PASSAGE.wait(timeout=BACKSTOP_PASSAGE_SECONDS)
                WAKE_PASSAGE.clear()
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
            WAKE_PASSAGE.wait(timeout=30)
            WAKE_PASSAGE.clear()
        except Exception as e:  # network down, DNS, etc — keep polling
            log("poll error: %s; backing off" % repr(e)[:160])
            WAKE_PASSAGE.wait(timeout=30)
            WAKE_PASSAGE.clear()


if __name__ == "__main__":
    sys.exit(main())
