#!/usr/bin/env bash
set -euo pipefail

readonly CHAIN_ID_REQUIRED=4663
readonly POOL_MANAGER=0x8366a39CC670B4001A1121B8F6A443A643e40951
readonly CREATE2_FACTORY=0x4e59b44847b379578588920cA78FbF26c0B4956C
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $# -ne 2 ]]; then
  printf '%s\n' 'Usage: optra-mainnet-postflight.sh <approved-packet.json> <transaction-hash>' >&2
  exit 2
fi
packet_path="$1"
tx_hash="$2"
rpc_url="${OPTRA_MAINNET_RPC_URL:-}"
approved_hash="${OPTRA_MAINNET_APPROVED_PACKET_SHA256:-}"
if [[ -z "$rpc_url" || -z "$approved_hash" ]]; then
  printf '%s\n' 'BLOCKED: set OPTRA_MAINNET_RPC_URL and OPTRA_MAINNET_APPROVED_PACKET_SHA256; no .env is sourced.' >&2
  exit 2
fi
[[ -f "$packet_path" ]] || { printf 'FAIL: packet not found: %s\n' "$packet_path" >&2; exit 1; }
[[ "$tx_hash" =~ ^0x[0-9a-fA-F]{64}$ ]] || { printf '%s\n' 'FAIL: transaction hash must be a 32-byte hex value.' >&2; exit 1; }

rpc() { cast "$@" --rpc-url "$rpc_url"; }

packet_json="$(python3 - "$packet_path" "$approved_hash" <<'PY'
import hashlib, json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    outer = json.load(f)
packet = outer.get("packet")
if not isinstance(packet, dict):
    raise SystemExit("packet wrapper missing packet object")
actual = hashlib.sha256(json.dumps(packet, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
if actual != outer.get("approvalSha256"):
    raise SystemExit("packet approvalSha256 mismatch")
if actual.lower() != sys.argv[2].lower():
    raise SystemExit("packet hash differs from approved hash")
print(json.dumps(packet, separators=(",", ":")))
PY
)"

packet_field() {
  python3 - "$packet_json" "$1" <<'PY'
import json, sys
packet = json.loads(sys.argv[1])
value = packet
for part in sys.argv[2].split("."):
    value = value[part]
print(value if isinstance(value, (str, int, float, bool)) or value is None else json.dumps(value, separators=(",", ":")))
PY
}

packet_chain="$(packet_field chainId)"
packet_from="$(packet_field transaction.from)"
packet_to="$(packet_field transaction.to)"
packet_data="$(packet_field transaction.data)"
packet_value="$(packet_field transaction.valueWei)"
packet_nonce="$(packet_field transaction.nonce)"
packet_gas_limit="$(packet_field transaction.gasLimit)"
hook="$(packet_field deployment.predictedHookAddress)"
expected_pool_manager="$(packet_field configuration.poolManager)"
expected_underlying="$(packet_field configuration.underlying)"
expected_quote="$(packet_field configuration.quote)"
expected_creator="$(packet_field configuration.poolCreator)"
expected_admin="$(packet_field configuration.adminSafe)"
expected_keeper="$(packet_field configuration.keeper)"
expected_policy_age="$(packet_field configuration.maxPolicyAgeSeconds)"
[[ "$packet_chain" == "$CHAIN_ID_REQUIRED" && "$packet_to" == "$CREATE2_FACTORY" && "$packet_value" == 0 ]] || {
  printf '%s\n' 'FAIL: approved packet is not the pinned one-transaction Mainnet CREATE2 deployment.' >&2
  exit 1
}

chain_id="$(rpc chain-id)"
[[ "$chain_id" == "$CHAIN_ID_REQUIRED" ]] || { printf 'FAIL: RPC chain ID %s != %s.\n' "$chain_id" "$CHAIN_ID_REQUIRED" >&2; exit 1; }
receipt_raw="$(rpc receipt "$tx_hash" --json)"
tx_raw="$(rpc tx "$tx_hash" --json)"
python3 - "$receipt_raw" "$tx_raw" "$tx_hash" "$packet_from" "$packet_to" "$packet_data" "$packet_nonce" "$packet_gas_limit" <<'PY'
import json, sys

def unwrap(raw):
    value = json.loads(raw)
    if isinstance(value, dict) and "data" in value and ("success" in value or "schema_version" in value):
        value = value["data"]
    return value

def number(value):
    if isinstance(value, int): return value
    text = str(value)
    return int(text, 16) if text.lower().startswith("0x") else int(text, 10)

receipt, tx = unwrap(sys.argv[1]), unwrap(sys.argv[2])
expected_hash, sender, destination, data, nonce, gas_limit = sys.argv[3:]
status = receipt.get("status")
if status is None or number(status) != 1:
    raise SystemExit(f"FAIL: receipt status is not success: {status!r}")
if str(receipt.get("transactionHash", "")).lower() != expected_hash.lower():
    raise SystemExit("FAIL: receipt transaction hash mismatch")
if str(tx.get("from", "")).lower() != sender.lower() or str(tx.get("to", "")).lower() != destination.lower():
    raise SystemExit("FAIL: transaction sender or destination differs from approved packet")
actual_data = tx.get("input", tx.get("data", ""))
if str(actual_data).lower() != data.lower():
    raise SystemExit("FAIL: transaction calldata differs from approved packet")
if number(tx.get("nonce")) != int(nonce):
    raise SystemExit("FAIL: transaction nonce differs from approved packet")
if number(tx.get("value", 0)) != 0:
    raise SystemExit("FAIL: deployment transaction transferred nonzero value")
if number(receipt.get("gasUsed", 0)) > int(gas_limit):
    raise SystemExit("FAIL: receipt gasUsed exceeds the approved gas limit")
print(f"PASS: receipt status=1 tx={expected_hash} gasUsed={number(receipt.get('gasUsed', 0))}")
print(f"PASS: sender={sender} destination={destination} nonce={nonce} calldata/value match approved packet")
PY

code="$(rpc code "$hook")"
[[ "$code" != '0x' && -n "$code" ]] || { printf 'FAIL: predicted hook %s has no runtime code.\n' "$hook" >&2; exit 1; }
code_metrics="$(python3 - "$code" <<'PY'
import hashlib, sys
raw = bytes.fromhex(sys.argv[1][2:])
print(f"{len(raw)}\t{hashlib.sha256(raw).hexdigest()}")
PY
)"
IFS=$'\t' read -r code_size code_sha256 <<< "$code_metrics"
code_keccak="$(cast keccak "$code")"
(( code_size <= 24576 )) || { printf 'FAIL: deployed runtime is over EIP-170 size limit (%s bytes).\n' "$code_size" >&2; exit 1; }
if [[ -n "${OPTRA_MAINNET_EXPECTED_HOOK_RUNTIME_SHA256:-}" && "$(printf '%s' "$OPTRA_MAINNET_EXPECTED_HOOK_RUNTIME_SHA256" | tr '[:upper:]' '[:lower:]')" != "$code_sha256" ]]; then
  printf '%s\n' 'FAIL: runtime SHA-256 differs from OPTRA_MAINNET_EXPECTED_HOOK_RUNTIME_SHA256.' >&2
  exit 1
fi

read_getter() { rpc call "$hook" "$1"; }
assert_address() {
  local label="$1" expected="$2" signature="$3" actual
  actual="$(read_getter "$signature")"
  [[ "$(printf '%s' "$actual" | tr '[:upper:]' '[:lower:]')" == "$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')" ]] || {
    printf 'FAIL: %s getter mismatch (got %s).\n' "$label" "$actual" >&2
    exit 1
  }
  printf 'PASS: %s=%s\n' "$label" "$actual"
}
assert_address poolManager "$expected_pool_manager" 'poolManager()(address)'
assert_address underlyingToken "$expected_underlying" 'underlyingToken()(address)'
assert_address quoteToken "$expected_quote" 'quoteToken()(address)'
assert_address poolCreator "$expected_creator" 'poolCreator()(address)'
assert_address admin "$expected_admin" 'admin()(address)'
assert_address keeper "$expected_keeper" 'keeper()(address)'
actual_age="$(read_getter 'maxPolicyAge()(uint64)')"
[[ "$actual_age" == "$expected_policy_age" ]] || { printf 'FAIL: maxPolicyAge=%s expected=%s.\n' "$actual_age" "$expected_policy_age" >&2; exit 1; }
pool_bound="$(read_getter 'poolBound()(bool)')"
paused="$(read_getter 'entryPaused()(bool)')"
policy_published="$(read_getter 'policyPublished()(bool)')"
policy_fresh="$(read_getter 'isPolicyFresh()(bool)')"
[[ "$pool_bound" == false && "$paused" == true && "$policy_published" == false && "$policy_fresh" == false ]] || {
  printf 'FAIL: new deployment must remain unbound, entry-paused, and without published/fresh policy (bound=%s paused=%s published=%s fresh=%s).\n' "$pool_bound" "$paused" "$policy_published" "$policy_fresh" >&2
  exit 1
}

printf 'PASS: deployed hook %s runtimeSize=%s runtimeSha256=%s runtimeKeccak=%s\n' "$hook" "$code_size" "$code_sha256" "$code_keccak"
printf '%s\n' 'PASS: deploy-only postflight complete. No pool initialization, liquidity, keeper policy, or options execution was verified or performed.'