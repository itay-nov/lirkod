#!/usr/bin/env bash
set -e

echo "Starting Colima..."
colima start

echo "Starting Supabase (up to 6 attempts)..."
for attempt in 1 2 3 4 5 6; do
  if supabase start; then
    echo "Supabase started successfully."
    exit 0
  fi
  if [ "$attempt" -lt 6 ]; then
    echo "Attempt $attempt failed, retrying in 5s..."
    sleep 5
  fi
done

echo "Error: supabase start failed after 6 attempts." >&2
exit 1
