#!/bin/bash
# start_server.sh — run this to start the OR-Tools optimization server

cd "$(dirname "$0")"

if ! python3 -c "import ortools" 2>/dev/null; then
  echo "Installing OR-Tools..."
  pip install ortools
fi

python3 optimizer_server.py
