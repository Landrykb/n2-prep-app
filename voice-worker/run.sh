#!/bin/bash
# Yonde Voice Worker supervisor: keeps worker.py alive. Started by the
# user crontab (@reboot + a */5 watchdog); no sudo, no systemd needed.
cd "$HOME/voice-worker" || exit 1
while true; do
  ./venv/bin/python worker.py >> worker.log 2>&1
  sleep 5
done
