#!/bin/bash
set -e

pnpm exec sui-shim call register-as \
  --isd-as-id 1 \
  --set-active

pnpm exec sui-shim call register-seller --set-active

pnpm exec sui-shim call create-interface \
  --interface-id 1 \
  --save

pnpm exec sui-shim call create-listing \
  --interface-type 0 \
  --bandwidth 100 \
  --start-time 1000 \
  --exp-time 2000 \
  --time-granularity 1 \
  --min-bandwidth 1 \
  --price 1

pnpm exec sui-shim call create-listing \
  --interface-type 1 \
  --bandwidth 100 \
  --start-time 1000 \
  --exp-time 2000 \
  --time-granularity 1 \
  --min-bandwidth 1 \
  --price 1