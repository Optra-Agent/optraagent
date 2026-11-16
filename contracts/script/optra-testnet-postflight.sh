#!/usr/bin/env bash
set -euo pipefail

rpc_url="${1:-${ROBINHOOD_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}}"
phase="${2:?usage: optra-testnet-postflight.sh [rpc-url] <phase-a|phase-b> <hook> <underlying> <quote> <pool-id> <operator>}"
hook="${3:?missing hook address}"
underlying="${4:?missing underlying address}"
quote="${5:?missing quote address}"
expected_pool_id="${6:?missing expected pool ID}"
operator="${7:?missing deployer/operator address}"

manager="0x8366a39cc670b4001a1121b8f6a443a643e40951"
expected_manager_sha256="6eb21c69298b064e37fcf8089a941ae096fe08c0f179b2d399567aef1b10585b"

if [[ "$phase" != "phase-a" && "$phase" != "phase-b" ]]; then
  printf 'invalid phase: %s (expected phase-a or phase-b)\n' "$phase" >&2
  exit 1
fi

chain_id="$(cast chain-id --rpc-url "$rpc_url")"
if [[ "$chain_id" != "46630" ]]; then
  printf 'refusing non-Robinhood-Testnet chain ID: %s\n' "$chain_id" >&2
  exit 1
fi

manager_code="$(cast code "$manager" --rpc-url "$rpc_url")"
manager_sha256="$(printf '%s' "${manager_code#0x}" | python3 -c 'import hashlib,sys; print(hashlib.sha256(bytes.fromhex(sys.stdin.read())).hexdigest())')"
if [[ "$manager_sha256" != "$expected_manager_sha256" ]]; then
  printf 'PoolManager runtime hash mismatch: %s\n' "$manager_sha256" >&2
  exit 1
fi

for contract in "$hook" "$underlying" "$quote"; do
  code="$(cast code "$contract" --rpc-url "$rpc_url")"
  if [[ "$code" == "0x" || -z "$code" ]]; then
    printf 'expected contract has no code: %s\n' "$contract" >&2
    exit 1
  fi
done

read_value() {
  cast call "$hook" "$1" --rpc-url "$rpc_url"
}

normalize_address() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

actual_manager="$(read_value 'poolManager()(address)')"
actual_underlying="$(read_value 'underlyingToken()(address)')"
actual_quote="$(read_value 'quoteToken()(address)')"
actual_creator="$(read_value 'poolCreator()(address)')"
actual_admin="$(read_value 'admin()(address)')"
actual_keeper="$(read_value 'keeper()(address)')"
actual_pool_id="$(read_value 'configuredPoolId()(bytes32)')"
pool_bound="$(read_value 'poolBound()(bool)')"
entry_paused="$(read_value 'entryPaused()(bool)')"
policy_published="$(read_value 'policyPublished()(bool)')"
policy_fresh="$(read_value 'isPolicyFresh()(bool)')"
max_policy_age="$(read_value 'maxPolicyAge()(uint64)')"

[[ "$(normalize_address "$actual_manager")" == "$(normalize_address "$manager")" ]] || { printf '%s\n' "hook manager mismatch" >&2; exit 1; }
[[ "$(normalize_address "$actual_underlying")" == "$(normalize_address "$underlying")" ]] || { printf '%s\n' "hook underlying mismatch" >&2; exit 1; }
[[ "$(normalize_address "$actual_quote")" == "$(normalize_address "$quote")" ]] || { printf '%s\n' "hook quote mismatch" >&2; exit 1; }
[[ "$(normalize_address "$actual_creator")" == "$(normalize_address "$operator")" ]] || { printf '%s\n' "pool creator mismatch" >&2; exit 1; }
[[ "$(normalize_address "$actual_admin")" == "$(normalize_address "$operator")" ]] || { printf '%s\n' "hook admin mismatch" >&2; exit 1; }
[[ "$(normalize_address "$actual_keeper")" == "$(normalize_address "$operator")" ]] || { printf '%s\n' "hook keeper mismatch" >&2; exit 1; }
[[ "$(normalize_address "$actual_pool_id")" == "$(normalize_address "$expected_pool_id")" ]] || { printf '%s\n' "pool ID mismatch" >&2; exit 1; }
[[ "$pool_bound" == "true" ]] || { printf '%s\n' "hook pool not bound" >&2; exit 1; }
[[ "$entry_paused" == "true" ]] || { printf '%s\n' "hook is not paused" >&2; exit 1; }
[[ "$max_policy_age" == "300" ]] || { printf 'unexpected maxPolicyAge: %s\n' "$max_policy_age" >&2; exit 1; }

if [[ "$phase" == "phase-a" ]]; then
  [[ "$policy_published" == "false" && "$policy_fresh" == "false" ]] || {
    printf '%s\n' "Phase A must have no published policy" >&2
    exit 1
  }
else
  [[ "$policy_published" == "true" && "$policy_fresh" == "true" ]] || {
    printf '%s\n' "Phase B policy must be published and fresh" >&2
    exit 1
  }
fi

printf 'read-only %s postflight passed on chain %s\n' "$phase" "$chain_id"
printf 'PoolManager %s runtime SHA-256 %s\n' "$manager" "$manager_sha256"
printf 'hook %s bound to pool %s; paused=%s policyPublished=%s policyFresh=%s maxAge=%s\n' \
  "$hook" "$actual_pool_id" "$entry_paused" "$policy_published" "$policy_fresh" "$max_policy_age"
