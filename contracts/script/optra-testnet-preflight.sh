#!/usr/bin/env bash
set -euo pipefail

rpc_url="${1:-${ROBINHOOD_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}}"
underlying="${2:?usage: optra-testnet-preflight.sh [rpc-url] <underlying-token> <quote-token>}"
quote="${3:?usage: optra-testnet-preflight.sh [rpc-url] <underlying-token> <quote-token>}"
manager="0x8366a39cc670b4001a1121b8f6a443a643e40951"
expected_manager_sha256="6eb21c69298b064e37fcf8089a941ae096fe08c0f179b2d399567aef1b10585b"

underlying_lower="$(printf '%s' "$underlying" | tr '[:upper:]' '[:lower:]')"
quote_lower="$(printf '%s' "$quote" | tr '[:upper:]' '[:lower:]')"
if [[ "$underlying_lower" == "$quote_lower" ]]; then
  printf '%s\n' "underlying and quote token must differ" >&2
  exit 1
fi

chain_id="$(cast chain-id --rpc-url "$rpc_url")"
if [[ "$chain_id" != "46630" ]]; then
  printf 'refusing non-Robinhood-Testnet chain ID: %s\n' "$chain_id" >&2
  exit 1
fi

manager_code="$(cast code "$manager" --rpc-url "$rpc_url")"
if [[ "$manager_code" == "0x" || -z "$manager_code" ]]; then
  printf '%s\n' "PoolManager has no deployed code" >&2
  exit 1
fi
manager_sha256="$(printf '%s' "$manager_code" | python3 -c 'import hashlib,sys; code=sys.stdin.read(); code=code[2:] if code.startswith("0x") else code; print(hashlib.sha256(bytes.fromhex(code)).hexdigest())')"
if [[ "$manager_sha256" != "$expected_manager_sha256" ]]; then
  printf 'PoolManager bytecode hash mismatch: %s\n' "$manager_sha256" >&2
  exit 1
fi

for token in "$underlying" "$quote"; do
  code="$(cast code "$token" --rpc-url "$rpc_url")"
  if [[ "$code" == "0x" || -z "$code" ]]; then
    printf 'token has no deployed code: %s\n' "$token" >&2
    exit 1
  fi
done

printf 'read-only preflight passed on chain %s\n' "$chain_id"
printf 'PoolManager %s runtime SHA-256 %s\n' "$manager" "$manager_sha256"
printf 'underlying and quote token addresses contain code; asset approval is outside this check\n'
