#!/usr/bin/env bash
set -euo pipefail

readonly CHAIN_ID_REQUIRED=4663
readonly POOL_MANAGER=0x8366a39CC670B4001A1121B8F6A443A643e40951
readonly POOL_MANAGER_SIZE=24009
readonly POOL_MANAGER_SHA256=6eb21c69298b064e37fcf8089a941ae096fe08c0f179b2d399567aef1b10585b
readonly CREATE2_FACTORY=0x4e59b44847b379578588920cA78FbF26c0B4956C
readonly CREATE2_FACTORY_SIZE=69
readonly CREATE2_FACTORY_SHA256=e0af82ad2e5188285db8ba0b2ae054d13f0fd4fe325c48c7f2dace48454404b9
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mode="${1:---strict}"
if [[ "$mode" != "--strict" && "$mode" != "--estimate" ]]; then
  printf '%s\n' 'Usage: optra-mainnet-preflight.sh [--strict|--estimate]' >&2
  exit 2
fi

rpc_url="${OPTRA_MAINNET_RPC_URL:-}"
if [[ -z "$rpc_url" ]]; then
  printf '%s\n' 'BLOCKED: set OPTRA_MAINNET_RPC_URL explicitly; this script never sources .env.' >&2
  exit 2
fi

rpc_host="$(python3 -c 'from urllib.parse import urlparse; import sys; print(urlparse(sys.argv[1]).hostname or "invalid-host")' "$rpc_url")"
if [[ "$rpc_host" == "invalid-host" ]]; then
  printf '%s\n' 'BLOCKED: OPTRA_MAINNET_RPC_URL is not a valid URL.' >&2
  exit 2
fi

rpc() {
  local output
  if ! output="$(cast "$@" --rpc-url "$rpc_url" 2>&1)"; then
    printf '%s\n' "$output" | python3 -c 'import re,sys; print(re.sub(r"https?://[^\s\"'"'"']+", "<redacted-rpc-url>", sys.stdin.read()), end="")' >&2
    return 1
  fi
  printf '%s' "$output"
}

lowercase() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

require_address() {
  local name="$1" value="${!1:-}"
  local normalized
  normalized="$(lowercase "$value")"
  if [[ ! "$value" =~ ^0x[0-9a-fA-F]{40}$ ]] || [[ "$normalized" == 0x0000000000000000000000000000000000000000 ]]; then
    printf 'FAIL: %s must be a nonzero 20-byte EVM address.\n' "$name" >&2
    return 1
  fi
}

verify_runtime() {
  local label="$1" address="$2" expected_size="$3" expected_sha256="$4"
  local code size sha256 keccak
  code="$(rpc code "$address")"
  if [[ "$code" == '0x' || -z "$code" ]]; then
    printf 'FAIL: %s has no runtime code at %s.\n' "$label" "$address" >&2
    return 1
  fi
  size="$(python3 -c 'import sys; print((len(sys.argv[1])-2)//2)' "$code")"
  sha256="$(python3 -c 'import hashlib,sys; print(hashlib.sha256(bytes.fromhex(sys.argv[1][2:])).hexdigest())' "$code")"
  keccak="$(cast keccak "$code")"
  if [[ "$size" != "$expected_size" || "$sha256" != "$expected_sha256" ]]; then
    printf 'FAIL: %s runtime identity mismatch (size=%s sha256=%s).\n' "$label" "$size" "$sha256" >&2
    return 1
  fi
  printf 'PASS: %s %s size=%s sha256=%s keccak=%s\n' "$label" "$address" "$size" "$sha256" "$keccak"
}

printf 'Robinhood Chain Mainnet read-only preflight · RPC host %s\n' "$rpc_host"
chain_id="$(rpc chain-id)"
if [[ "$chain_id" != "$CHAIN_ID_REQUIRED" ]]; then
  printf 'FAIL: RPC returned chain ID %s; expected %s.\n' "$chain_id" "$CHAIN_ID_REQUIRED" >&2
  exit 1
fi
printf 'PASS: chain ID %s\n' "$chain_id"
verify_runtime 'Uniswap v4 PoolManager' "$POOL_MANAGER" "$POOL_MANAGER_SIZE" "$POOL_MANAGER_SHA256"
verify_runtime 'CREATE2 singleton factory' "$CREATE2_FACTORY" "$CREATE2_FACTORY_SIZE" "$CREATE2_FACTORY_SHA256"

# A router is not a constructor parameter of this hook. If the owner selects one
# for the operational route, pin its address and runtime identity explicitly.
if [[ -n "${OPTRA_MAINNET_SWAP_ROUTER:-}" ]]; then
  if [[ -z "${OPTRA_MAINNET_SWAP_ROUTER_SIZE:-}" || ! "${OPTRA_MAINNET_SWAP_ROUTER_SHA256:-}" =~ ^[0-9a-fA-F]{64}$ ]]; then
    printf '%s\n' 'FAIL: selected swap router requires OPTRA_MAINNET_SWAP_ROUTER_SIZE and a 64-hex OPTRA_MAINNET_SWAP_ROUTER_SHA256.' >&2
    exit 1
  fi
  require_address OPTRA_MAINNET_SWAP_ROUTER
  verify_runtime 'Owner-selected swap router' "$OPTRA_MAINNET_SWAP_ROUTER" "$OPTRA_MAINNET_SWAP_ROUTER_SIZE" "$(lowercase "$OPTRA_MAINNET_SWAP_ROUTER_SHA256")"
fi

pending=()
config_complete=1
required_config=(
  OPTRA_MAINNET_DEPLOYER
  OPTRA_MAINNET_ADMIN_SAFE
  OPTRA_MAINNET_KEEPER
  OPTRA_MAINNET_POOL_CREATOR
  OPTRA_MAINNET_UNDERLYING
  OPTRA_MAINNET_QUOTE
  OPTRA_MAINNET_POOL_FEE
  OPTRA_MAINNET_TICK_SPACING
  OPTRA_MAINNET_INITIAL_SQRT_PRICE_X96
  OPTRA_MAINNET_MAX_POLICY_AGE
)
if [[ "$mode" == "--strict" ]]; then
  if [[ "${OPTRA_MAINNET_I_UNDERSTAND_MAINNET:-}" != "yes" ]]; then
    pending+=("OPTRA_MAINNET_I_UNDERSTAND_MAINNET=yes")
  fi
  required_config+=(
    OPTRA_MAINNET_GAS_LIMIT
    OPTRA_MAINNET_GAS_LIMIT_CEILING
    OPTRA_MAINNET_MAX_FEE_PER_GAS_WEI
    OPTRA_MAINNET_MAX_PRIORITY_FEE_PER_GAS_WEI
    OPTRA_MAINNET_TOTAL_FEE_CEILING_WEI
  )
fi
for name in "${required_config[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    pending+=("$name")
    config_complete=0
  fi
done

if [[ "$mode" == "--strict" ]]; then
  required_refs=(
    OPTRA_MAINNET_PROVIDER_APPROVAL_REF
    OPTRA_MAINNET_PM_APPROVAL_REF
    OPTRA_MAINNET_ASSET_APPROVAL_REF
    OPTRA_MAINNET_JURISDICTION_APPROVAL_REF
    OPTRA_MAINNET_POOL_ROUTE_APPROVAL_REF
    OPTRA_MAINNET_KEEPER_RUNBOOK_REF
    OPTRA_MAINNET_REAL_ASSET_FORK_SIMULATION_REF
    OPTRA_MAINNET_GAS_REPORT_REF
    OPTRA_MAINNET_AUDIT_REPORT_REF
  )
  for name in "${required_refs[@]}"; do
    value="${!name:-}"
    normalized="$(lowercase "$value")"
    if [[ -z "$value" || "$normalized" == *pending* || "$normalized" == *unaudited* || "$normalized" == *internal-only* || "$normalized" == none || "$normalized" == n/a ]]; then
      pending+=("$name")
    fi
  done
  for name in OPTRA_MAINNET_AUDIT_REPORT_SHA256 OPTRA_MAINNET_REAL_ASSET_FORK_SIMULATION_SHA256 OPTRA_MAINNET_GAS_REPORT_SHA256; do
    value="${!name:-}"
    if [[ ! "$value" =~ ^[0-9a-fA-F]{64}$ ]]; then pending+=("$name"); fi
  done
fi

if ((config_complete)); then
  for name in OPTRA_MAINNET_DEPLOYER OPTRA_MAINNET_ADMIN_SAFE OPTRA_MAINNET_KEEPER OPTRA_MAINNET_POOL_CREATOR OPTRA_MAINNET_UNDERLYING OPTRA_MAINNET_QUOTE; do
    require_address "$name"
  done
  deployer="$(lowercase "$OPTRA_MAINNET_DEPLOYER")"
  admin="$(lowercase "$OPTRA_MAINNET_ADMIN_SAFE")"
  keeper="$(lowercase "$OPTRA_MAINNET_KEEPER")"
  creator="$(lowercase "$OPTRA_MAINNET_POOL_CREATOR")"
  underlying="$(lowercase "$OPTRA_MAINNET_UNDERLYING")"
  quote="$(lowercase "$OPTRA_MAINNET_QUOTE")"
  [[ "$underlying" != "$quote" ]] || { printf '%s\n' 'FAIL: underlying and quote must differ.' >&2; exit 1; }
  [[ "$deployer" != "$admin" && "$deployer" != "$keeper" ]] || {
    printf '%s\n' 'FAIL: deployer must be distinct from Safe/admin and keeper.' >&2; exit 1;
  }
  [[ "$keeper" != "$admin" ]] || { printf '%s\n' 'FAIL: keeper must be distinct from Safe/admin.' >&2; exit 1; }

  python3 - "$OPTRA_MAINNET_POOL_FEE" "$OPTRA_MAINNET_TICK_SPACING" "$OPTRA_MAINNET_INITIAL_SQRT_PRICE_X96" "$OPTRA_MAINNET_MAX_POLICY_AGE" <<'PY'
import sys

def number(value):
    return int(value, 16) if value.lower().startswith("0x") else int(value, 10)

fee, spacing, sqrt_price, age = map(number, sys.argv[1:])
minimum_sqrt_price = 4295128739
maximum_sqrt_price = 1461446703485210103287273052203988822378723970342
checks = [
    (0 <= fee <= 1_000_000, "pool fee must be static and in [0, 1000000]"),
    (1 <= spacing <= 32767, "tick spacing must be in [1, 32767]"),
    (minimum_sqrt_price < sqrt_price < maximum_sqrt_price, "initial sqrt price is outside TickMath bounds"),
    (1 <= age <= 900, "max policy age must be in [1, 900] seconds"),
]
for ok, message in checks:
    if not ok:
        print(f"FAIL: {message}", file=sys.stderr)
        raise SystemExit(1)
PY

  if [[ "$mode" == "--strict" ]]; then
    python3 - "$OPTRA_MAINNET_GAS_LIMIT" "$OPTRA_MAINNET_GAS_LIMIT_CEILING" "$OPTRA_MAINNET_MAX_FEE_PER_GAS_WEI" "$OPTRA_MAINNET_MAX_PRIORITY_FEE_PER_GAS_WEI" "$OPTRA_MAINNET_TOTAL_FEE_CEILING_WEI" <<'PY'
import sys

def number(value):
    return int(value, 16) if value.lower().startswith("0x") else int(value, 10)

gas_limit, gas_ceiling, max_fee, priority_fee, total_fee = map(number, sys.argv[1:])
checks = [
    (gas_limit > 0 and gas_limit <= gas_ceiling, "gas limit must be positive and within the approved gas-unit ceiling"),
    (max_fee > 0 and 0 <= priority_fee <= max_fee, "gas fee values are invalid"),
    (total_fee > 0 and gas_limit * max_fee <= total_fee, "gas limit × max fee exceeds the approved execution-fee ceiling"),
]
for ok, message in checks:
    if not ok:
        print(f"FAIL: {message}", file=sys.stderr)
        raise SystemExit(1)
PY
  fi

  for token_name in OPTRA_MAINNET_UNDERLYING OPTRA_MAINNET_QUOTE; do
    token="${!token_name}"
    code="$(rpc code "$token")"
    [[ "$code" != '0x' && -n "$code" ]] || { printf 'FAIL: %s has no runtime code.\n' "$token_name" >&2; exit 1; }
    decimals="$(rpc call "$token" 'decimals()(uint8)')"
    python3 - "$decimals" "$token_name" <<'PY'
import re, sys
match = re.search(r"\d+", sys.argv[1])
if not match or not 0 <= int(match.group()) <= 36:
    print(f"FAIL: {sys.argv[2]} does not return a supported ERC-20 decimals value.", file=sys.stderr)
    raise SystemExit(1)
print(f"PASS: {sys.argv[2]} ERC-20 code and decimals={int(match.group())}")
PY
  done

  safe_code="$(rpc code "$OPTRA_MAINNET_ADMIN_SAFE")"
  [[ "$safe_code" != '0x' && -n "$safe_code" ]] || { printf '%s\n' 'FAIL: Safe/admin has no runtime code.' >&2; exit 1; }
  creator_code="$(rpc code "$OPTRA_MAINNET_POOL_CREATOR")"
  [[ "$creator_code" != '0x' && -n "$creator_code" ]] || { printf '%s\n' 'FAIL: pool creator has no runtime code.' >&2; exit 1; }
  owners="$(rpc call "$OPTRA_MAINNET_ADMIN_SAFE" 'getOwners()(address[])')"
  threshold="$(rpc call "$OPTRA_MAINNET_ADMIN_SAFE" 'getThreshold()(uint256)')"
  python3 - "$owners" "$threshold" <<'PY'
import re, sys
owners = [x.lower() for x in re.findall(r"0x[0-9a-fA-F]{40}", sys.argv[1])]
threshold_match = re.search(r"\d+", sys.argv[2])
if not threshold_match:
    print("FAIL: Safe threshold readback was not an integer.", file=sys.stderr)
    raise SystemExit(1)
threshold = int(threshold_match.group())
if len(owners) < 3 or len(set(owners)) != len(owners) or not 2 <= threshold <= len(owners):
    print("FAIL: Safe must have at least three unique owners and threshold >= 2 and <= owner count.", file=sys.stderr)
    raise SystemExit(1)
print(f"PASS: Safe owners={len(owners)} threshold={threshold}")
PY

  deployer_code="$(rpc code "$OPTRA_MAINNET_DEPLOYER")"
  [[ "$deployer_code" == '0x' || -z "$deployer_code" ]] || { printf '%s\n' 'FAIL: deployer is a contract; use the designated EOA signer.' >&2; exit 1; }
  printf '%s\n' 'PASS: selected addresses and pool parameters satisfy the deployment preflight guards.'
fi

if ((${#pending[@]} > 0)); then
  if [[ "$mode" == "--estimate" ]]; then
    printf '%s\n' 'BLOCKED: candidate estimate requires these owner-selected parameter values:'
  else
    printf '%s\n' 'BLOCKED: strict pre-broadcast gate is missing these owner decisions/evidence:'
  fi
  printf '  - %s\n' "${pending[@]}"
  exit 2
fi

if [[ "$mode" == "--estimate" ]]; then
  printf '%s\n' 'PASS: read-only parameter preflight; this mode measures a candidate but does not approve or broadcast it.'
else
  printf '%s\n' 'PASS: all pre-broadcast engineering and external-evidence gates are present. This script is read-only.'
fi