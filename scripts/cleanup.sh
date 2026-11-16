#!/usr/bin/env bash
# Removes technical trash from the repo working tree and git index. Safe to run repeatedly.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
find . -maxdepth 1 -name "*.whl" -type f -delete                                  # Python wheels in the root
find . -name "__pycache__" -type d -not -path "./node_modules/*" -prune -exec rm -rf {} +   # bytecode caches
rm -rf .bolt                                                                       # raw development prompts
git rm -r -q --cached --ignore-unmatch .bolt '*.whl' '**/__pycache__' || true     # stop tracking them
git status --short
