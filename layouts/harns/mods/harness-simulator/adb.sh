#!/bin/sh
# harns: points adb at this session's Simulator, then runs this machine's own adb.
#
# Installed by harns's Simulator panel as ~/.local/bin/adb on machines whose sessions have an
# emulator. Each session's emulator (on the computer showing harns) reaches this machine's adb
# server through an SSH tunnel as 127.0.0.1:<port>; ~/.config/harness/devices lists, per herdr
# terminal, which one is its own:
#
#   <terminal id> <serial>     an agent or sub-agent terminal, and its session's emulator
#
# In a terminal listed there (HC_TERMINAL_ID), adb defaults to that emulator (ANDROID_SERIAL),
# and `adb devices` leaves out the other sessions' emulators; phones and anything else still
# show. Anywhere else, adb runs exactly as it would without this script.

self_dir=$(cd "$(dirname "$0")" && pwd)
real=
old_ifs=$IFS; IFS=:
for dir in $PATH; do
  [ "$dir" = "$self_dir" ] && continue
  if [ -x "$dir/adb" ]; then real="$dir/adb"; break; fi
done
IFS=$old_ifs
for dir in "$ANDROID_HOME" "$ANDROID_SDK_ROOT" "$HOME/Android/Sdk"; do
  [ -z "$real" ] && [ -n "$dir" ] && [ -x "$dir/platform-tools/adb" ] && real="$dir/platform-tools/adb"
done
if [ -z "$real" ]; then echo "adb: not found (harns's ~/.local/bin/adb runs the real one)" >&2; exit 127; fi

map="$HOME/.config/harness/devices"
mine=
if [ -n "$HC_TERMINAL_ID" ] && [ -f "$map" ]; then
  mine=$(awk -v t="$HC_TERMINAL_ID" '$1 == t { print $2; exit }' "$map")
fi
if [ -z "$ANDROID_SERIAL" ] && [ -n "$mine" ]; then
  ANDROID_SERIAL=$mine
  export ANDROID_SERIAL
elif [ -z "$ANDROID_SERIAL" ] && [ -n "$HC_TERMINAL_ID" ] && [ -s "$map" ]; then
  # A session without its own emulator never lands on another session's: with only one
  # device connected, adb would pick it unasked. One other device (a phone) is the default;
  # with none, the target is a name no device has, so adb says so instead.
  others=$("$real" devices 2>/dev/null | awk -v map="$map" '
    BEGIN { while ((getline line < map) > 0) { split(line, f, " "); if (f[2] != "") harns[f[2]] = 1 } }
    NR > 1 && $2 == "device" && !($1 in harns) { print $1 }')
  count=$(printf '%s\n' "$others" | grep -c .)
  if [ "$count" -eq 1 ]; then ANDROID_SERIAL=$others; export ANDROID_SERIAL
  elif [ "$count" -eq 0 ]; then ANDROID_SERIAL=no-harns-simulator-for-this-session; export ANDROID_SERIAL; fi
fi

if [ "$1" = devices ] && [ -n "$HC_TERMINAL_ID" ] && [ -f "$map" ]; then
  out=$("$real" "$@"); status=$?
  printf '%s\n' "$out" | awk -v mine="$mine" -v map="$map" '
    BEGIN { while ((getline line < map) > 0) { split(line, f, " "); if (f[2] != "") harns[f[2]] = 1 } }
    NR == 1 { print; next }
    ($1 in harns) && $1 != mine { next }
    { print }
    END { if (mine == "") print "# No harns Simulator for this session yet: start one from the Simulator panel in harns." > "/dev/stderr" }'
  exit $status
fi
exec "$real" "$@"
