#!/usr/bin/env bash
set -euo pipefail

readonly CHAIN_ID_REQUIRED=4663
readonly POOL_MANAGER=0x8366a39CC670B4001A1121B8F6A443A643e40951
readonly CREATE2_FACTORY=0x4e59b44847b379578588920cA78FbF26c0B4956C
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
mode="${1:-}"
output_path="${2:-}"

if [[ "$mode" != "--estimate" && "$mode" != "--freeze" && "$mode" != "--prepare" && "$mode" != "--broadcast" && "$mode" != "--verify" ]]; then
  printf '%s\n' 'Usage: optra-mainnet-deploy.sh --estimate <report.json> | --freeze <candidate.json> | --prepare <approval-packet.json> | --verify <approval-packet.json> | --broadcast <approval-packet.json>' >&2
  exit 2
fi
if [[ -z "$output_path" ]]; then
  printf '%s\n' 'BLOCKED: provide a new output path; existing files are never overwritten.' >&2
  exit 2
fi
if [[ "$mode" != "--broadcast" && "$mode" != "--verify" && -e "$output_path" ]]; then
  printf 'BLOCKED: refusing to overwrite existing file: %s\n' "$output_path" >&2
  exit 2
fi
output_path="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$output_path")"

rpc_url="${OPTRA_MAINNET_RPC_URL:-}"
if [[ -z "$rpc_url" ]]; then
  printf '%s\n' 'BLOCKED: set OPTRA_MAINNET_RPC_URL explicitly; this script never sources .env.' >&2
  exit 2
fi
rpc_host="$(python3 -c 'from urllib.parse import urlparse; import sys; print(urlparse(sys.argv[1]).hostname or "invalid-host")' "$rpc_url")"
[[ "$rpc_host" != "invalid-host" ]] || { printf '%s\n' 'BLOCKED: OPTRA_MAINNET_RPC_URL is not a valid URL.' >&2; exit 2; }
if [[ "$mode" == "--estimate" || "$mode" == "--freeze" ]]; then
  "$SCRIPT_DIR/optra-mainnet-preflight.sh" --estimate
else
  "$SCRIPT_DIR/optra-mainnet-preflight.sh" --strict
fi

rpc() {
  local output
  if ! output="$(cast "$@" --rpc-url "$rpc_url" 2>&1)"; then
    printf '%s\n' "$output" | python3 -c 'import re,sys; print(re.sub(r"https?://[^\s\"'"'"']+", "<redacted-rpc-url>", sys.stdin.read()), end="")' >&2
    return 1
  fi
  printf '%s' "$output"
}

to_decimal() {
  python3 - "$1" <<'PY'
import sys
value = sys.argv[1]
print(int(value, 16) if value.lower().startswith("0x") else int(value, 10))
PY
}

unwrap_rpc_result() {
  python3 -c 'import json,sys; x=json.loads(sys.argv[1]); print(x if isinstance(x,str) else json.dumps(x,separators=(",",":")))' "$1"
}

approval_packet_fields() {
  python3 - "$1" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    outer = json.load(f)
packet = outer["packet"]
tx = packet["transaction"]
fields = [
    str(packet["chainId"]), tx["from"], tx["to"], tx["data"], str(tx["nonce"]),
    str(tx["gasLimit"]), str(tx["maxFeePerGasWei"]), str(tx["maxPriorityFeePerGasWei"]),
    packet["deployment"]["predictedHookAddress"], outer["approvalSha256"],
    packet["build"]["sourceCommit"], packet["build"]["sourceSha256"], packet["build"]["foundryConfigSha256"],
    packet["deployment"]["create2Salt"], packet["deployment"]["initCodeHash"],
    packet["deployment"]["constructorArgumentsHex"], packet["configuration"]["poolManager"],
    packet["build"].get("contractsTreeSha", ""),
]
print("\t".join(fields))
PY
}

if [[ "$mode" == "--broadcast" || "$mode" == "--verify" ]]; then
  [[ -f "$output_path" ]] || { printf 'BLOCKED: approval packet does not exist: %s\n' "$output_path" >&2; exit 2; }
  approval_ref="${OPTRA_MAINNET_FINAL_APPROVAL_REF:-}"
  approved_hash="${OPTRA_MAINNET_APPROVED_PACKET_SHA256:-}"
  account="${OPTRA_MAINNET_SIGNER_ACCOUNT:-}"
  [[ "$mode" == "--verify" || ( -n "$approval_ref" && -n "$approved_hash" && -n "$account" ) ]] || {
    printf '%s\n' 'BLOCKED: --broadcast requires OPTRA_MAINNET_FINAL_APPROVAL_REF, OPTRA_MAINNET_APPROVED_PACKET_SHA256, and OPTRA_MAINNET_SIGNER_ACCOUNT.' >&2
    exit 2
  }
  packet_fields="$(approval_packet_fields "$output_path")"
  IFS=$'\t' read -r packet_chain packet_from packet_to packet_data packet_nonce packet_gas packet_max_fee packet_priority packet_hook packet_hash packet_source_commit packet_source_sha packet_foundry_sha packet_salt packet_init_hash packet_constructor_args packet_manager packet_contracts_tree <<< "$packet_fields"
  if [[ "$mode" == "--verify" ]]; then
    # Read-only rehearsal of every broadcast check. It is not an approval and never signs or sends.
    approval_ref="${approval_ref:-verify-only-record}"
    approved_hash="${approved_hash:-$packet_hash}"
  fi
  actual_hash="$(python3 - "$output_path" <<'PY'
import hashlib, json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    outer = json.load(f)
canonical = json.dumps(outer["packet"], sort_keys=True, separators=(",", ":")).encode()
print(hashlib.sha256(canonical).hexdigest())
PY
)"
  packet_hash_lower="$(printf '%s' "$packet_hash" | tr '[:upper:]' '[:lower:]')"
  approved_hash_lower="$(printf '%s' "$approved_hash" | tr '[:upper:]' '[:lower:]')"
  [[ "$actual_hash" == "$packet_hash_lower" && "$packet_hash_lower" == "$approved_hash_lower" ]] || {
    printf '%s\n' 'BLOCKED: the packet hash does not match the recorded explicit owner approval.' >&2
    exit 2
  }
  approval_ref_lower="$(printf '%s' "$approval_ref" | tr '[:upper:]' '[:lower:]')"
  [[ "$approval_ref_lower" != *pending* && "$approval_ref_lower" != *none* && "$approval_ref_lower" != *n/a* ]] || {
    printf '%s\n' 'BLOCKED: final approval reference is not a concrete record.' >&2
    exit 2
  }
  [[ "$packet_chain" == "$CHAIN_ID_REQUIRED" && "$packet_to" == "$CREATE2_FACTORY" ]] || {
    printf '%s\n' 'BLOCKED: packet chain or CREATE2 destination is not the pinned Mainnet configuration.' >&2
    exit 2
  }
  current_source_sha="$(python3 - "$CONTRACTS_DIR/src/OptraGuardHook.sol" <<'PY'
import hashlib, pathlib, sys
print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())
PY
)"
  current_foundry_sha="$(python3 - "$CONTRACTS_DIR/foundry.toml" <<'PY'
import hashlib, pathlib, sys
print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())
PY
)"
  # The packet binds the exact contracts/ tree (source, tests, scripts, Foundry settings), not the whole repository
  # commit, so unrelated commits do not invalidate an approved packet while any contracts/ change does.
  current_contracts_tree="$(git -C "$CONTRACTS_DIR" rev-parse 'HEAD:./')"
  [[ -z "$(git -C "$CONTRACTS_DIR" status --porcelain --untracked-files=no -- .)" ]] || {
    printf '%s\n' 'BLOCKED: contracts/ has uncommitted changes; commit them and prepare a new packet.' >&2
    exit 2
  }
  [[ -n "$packet_contracts_tree" && "$packet_contracts_tree" == "$current_contracts_tree" && "$packet_source_sha" == "$current_source_sha" && "$packet_foundry_sha" == "$current_foundry_sha" ]] || {
    printf '%s\n' 'BLOCKED: contracts/ tree, hook source or Foundry settings changed after packet preparation; prepare and review a new packet.' >&2
    exit 2
  }
  python3 - "$output_path" "$OPTRA_MAINNET_DEPLOYER" "$OPTRA_MAINNET_ADMIN_SAFE" "$OPTRA_MAINNET_KEEPER" "$OPTRA_MAINNET_POOL_CREATOR" "$OPTRA_MAINNET_UNDERLYING" "$OPTRA_MAINNET_QUOTE" "$OPTRA_MAINNET_INITIAL_SQRT_PRICE_X96" "$OPTRA_MAINNET_POOL_FEE" "$OPTRA_MAINNET_TICK_SPACING" "$OPTRA_MAINNET_MAX_POLICY_AGE" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f: outer = json.load(f)
config = outer["packet"]["configuration"]
def integer(s): return int(s, 16) if s.lower().startswith("0x") else int(s, 10)
expected = [
    ("transaction.from", sys.argv[2].lower()),
    ("adminSafe", sys.argv[3].lower()),
    ("keeper", sys.argv[4].lower()),
    ("poolCreator", sys.argv[5].lower()),
    ("underlying", sys.argv[6].lower()),
    ("quote", sys.argv[7].lower()),
]
for key, value in expected:
    actual = outer["packet"]["transaction"]["from"].lower() if key == "transaction.from" else config[key].lower()
    if actual != value: raise SystemExit(f"BLOCKED: current environment differs from approved packet field {key}")
for key, value in [("initialSqrtPriceX96",sys.argv[8]),("poolFee",sys.argv[9]),("tickSpacing",sys.argv[10]),("maxPolicyAgeSeconds",sys.argv[11])]:
    if integer(str(config[key])) != integer(value): raise SystemExit(f"BLOCKED: current environment differs from approved packet field {key}")
PY
  [[ "$(printf '%s' "$packet_manager" | tr '[:upper:]' '[:lower:]')" == "$(printf '%s' "$POOL_MANAGER" | tr '[:upper:]' '[:lower:]')" ]] || {
    printf '%s\n' 'BLOCKED: packet PoolManager differs from the source-pinned Mainnet address.' >&2
    exit 2
  }
  python3 - "$output_path" "$OPTRA_MAINNET_GAS_LIMIT" "$OPTRA_MAINNET_MAX_FEE_PER_GAS_WEI" "$OPTRA_MAINNET_MAX_PRIORITY_FEE_PER_GAS_WEI" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f: outer = json.load(f)
tx = outer["packet"]["transaction"]
def integer(s): return int(str(s), 16) if str(s).lower().startswith("0x") else int(str(s), 10)
for key, value in [("gasLimit", sys.argv[2]), ("maxFeePerGasWei", sys.argv[3]), ("maxPriorityFeePerGasWei", sys.argv[4])]:
    if integer(tx[key]) != integer(value): raise SystemExit(f"BLOCKED: current environment differs from approved packet field {key}")
PY
  (
    cd "$CONTRACTS_DIR"
    forge build --sizes
  )
  current_creation_bytecode="$(cd "$CONTRACTS_DIR" && forge inspect 'src/OptraGuardHook.sol:OptraGuardHook' bytecode | tr -d '[:space:]')"
  current_constructor_args="$(cast abi-encode 'constructor(address,address,address,address,address,address,uint64)' "$POOL_MANAGER" "$(printf '%s' "$OPTRA_MAINNET_UNDERLYING" | tr '[:upper:]' '[:lower:]')" "$(printf '%s' "$OPTRA_MAINNET_QUOTE" | tr '[:upper:]' '[:lower:]')" "$(printf '%s' "$OPTRA_MAINNET_POOL_CREATOR" | tr '[:upper:]' '[:lower:]')" "$(printf '%s' "$OPTRA_MAINNET_ADMIN_SAFE" | tr '[:upper:]' '[:lower:]')" "$(printf '%s' "$OPTRA_MAINNET_KEEPER" | tr '[:upper:]' '[:lower:]')" "$(to_decimal "$OPTRA_MAINNET_MAX_POLICY_AGE")")"
  [[ "$(printf '%s' "$current_constructor_args" | tr '[:upper:]' '[:lower:]')" == "$(printf '%s' "$packet_constructor_args" | tr '[:upper:]' '[:lower:]')" ]] || {
    printf '%s\n' 'BLOCKED: current constructor arguments differ from the approved packet.' >&2
    exit 2
  }
  current_init_code="$(python3 - "$current_creation_bytecode" "$current_constructor_args" <<'PY'
import sys
creation, args = sys.argv[1:]
print(creation + args[2:])
PY
)"
  current_init_hash="$(cast keccak "$current_init_code")"
  [[ "$(printf '%s' "$current_init_hash" | tr '[:upper:]' '[:lower:]')" == "$(printf '%s' "$packet_init_hash" | tr '[:upper:]' '[:lower:]')" ]] || {
    printf '%s\n' 'BLOCKED: current compiled init-code hash differs from the approved packet.' >&2
    exit 2
  }
  current_create2_output="$(cast create2 --deployer "$CREATE2_FACTORY" --init-code-hash "$current_init_hash" --salt "$packet_salt")"
  current_hook="$(printf '%s' "$current_create2_output" | python3 -c 'import sys; print(sys.stdin.read().strip().split()[0])')"
  [[ "$(printf '%s' "$current_hook" | tr '[:upper:]' '[:lower:]')" == "$(printf '%s' "$packet_hook" | tr '[:upper:]' '[:lower:]')" ]] || {
    printf '%s\n' 'BLOCKED: CREATE2 address derived from the approved salt differs from the packet.' >&2
    exit 2
  }
  python3 - "$packet_data" "$packet_salt" "$current_init_code" <<'PY'
import sys
data, salt, init_code = sys.argv[1:]
if data.lower() != ("0x" + salt[2:] + init_code[2:]).lower():
    raise SystemExit("BLOCKED: transaction calldata differs from approved CREATE2 salt + current init code")
PY
  if [[ "$mode" == "--broadcast" ]]; then
    signer="$(cast wallet address --account "$account")"
    signer_lower="$(printf '%s' "$signer" | tr '[:upper:]' '[:lower:]')"
    from_lower="$(printf '%s' "$packet_from" | tr '[:upper:]' '[:lower:]')"
    [[ "$signer_lower" == "$from_lower" ]] || { printf '%s\n' 'BLOCKED: selected keystore address differs from the approved packet signer.' >&2; exit 2; }
  fi
  current_chain="$(rpc chain-id)"
  current_nonce="$(rpc nonce "$packet_from")"
  [[ "$current_chain" == "$packet_chain" && "$current_nonce" == "$packet_nonce" ]] || {
    printf 'BLOCKED: chain/nonce changed since approval (chain=%s nonce=%s). Prepare and review a new exact packet.\n' "$current_chain" "$current_nonce" >&2
    exit 2
  }
  signer_balance="$(rpc balance "$packet_from")"
  python3 - "$signer_balance" "$packet_gas" "$packet_max_fee" <<'PY'
import sys
balance, gas_limit, max_fee = map(int, sys.argv[1:])
required = gas_limit * max_fee
if balance < required:
    raise SystemExit(f"BLOCKED: signer balance {balance} wei is below the approved max-cost bound {required} wei")
print(f"PASS: signer balance covers approved maximum transaction cost ({required} wei)")
PY
  if [[ "$mode" == "--verify" ]]; then
    printf 'PASS: packet %s satisfies every broadcast check. Nothing was signed or sent.\n' "$packet_hash"
    exit 0
  fi
  printf 'Broadcasting only approved packet %s via the local Foundry keystore.\n' "$packet_hash"
  rpc send "$packet_to" --account "$account" --chain "$packet_chain" --nonce "$packet_nonce" --gas-limit "$packet_gas" --gas-price "$packet_max_fee" --priority-gas-price "$packet_priority" --data "$packet_data" --async
  exit 0
fi

if [[ "$mode" == "--prepare" ]]; then
  if [[ -z "${OPTRA_MAINNET_FINAL_APPROVAL_REF:-}" ]]; then
    printf '%s\n' 'NOTE: the approval-packet hash must receive a separate, explicit owner approval before --broadcast.'
  fi
fi

current_chain="$(rpc chain-id)"
[[ "$current_chain" == "$CHAIN_ID_REQUIRED" ]] || { printf 'FAIL: chain ID is %s, expected %s.\n' "$current_chain" "$CHAIN_ID_REQUIRED" >&2; exit 1; }
deployer="$(printf '%s' "$OPTRA_MAINNET_DEPLOYER" | tr '[:upper:]' '[:lower:]')"
admin="$(printf '%s' "$OPTRA_MAINNET_ADMIN_SAFE" | tr '[:upper:]' '[:lower:]')"
keeper="$(printf '%s' "$OPTRA_MAINNET_KEEPER" | tr '[:upper:]' '[:lower:]')"
underlying="$(printf '%s' "$OPTRA_MAINNET_UNDERLYING" | tr '[:upper:]' '[:lower:]')"
quote="$(printf '%s' "$OPTRA_MAINNET_QUOTE" | tr '[:upper:]' '[:lower:]')"
creator="$(printf '%s' "$OPTRA_MAINNET_POOL_CREATOR" | tr '[:upper:]' '[:lower:]')"
pool_fee="$(to_decimal "$OPTRA_MAINNET_POOL_FEE")"
tick_spacing="$(to_decimal "$OPTRA_MAINNET_TICK_SPACING")"
initial_sqrt_price="$(to_decimal "$OPTRA_MAINNET_INITIAL_SQRT_PRICE_X96")"
max_policy_age="$(to_decimal "$OPTRA_MAINNET_MAX_POLICY_AGE")"

(
  cd "$CONTRACTS_DIR"
  forge build --sizes
)
creation_bytecode="$(cd "$CONTRACTS_DIR" && forge inspect 'src/OptraGuardHook.sol:OptraGuardHook' bytecode | tr -d '[:space:]')"
[[ "$creation_bytecode" =~ ^0x[0-9a-fA-F]+$ ]] || { printf '%s\n' 'FAIL: unable to read compiled OptraGuardHook creation bytecode.' >&2; exit 1; }
block_number="$(rpc block-number)"
source_commit="$(git -C "$CONTRACTS_DIR" rev-parse HEAD)"
contracts_tree="$(git -C "$CONTRACTS_DIR" rev-parse 'HEAD:./')"
if [[ "$mode" == "--prepare" ]]; then
  [[ -z "$(git -C "$CONTRACTS_DIR" status --porcelain --untracked-files=no -- .)" ]] || { printf '%s\n' 'BLOCKED: contracts/ has uncommitted changes; commit them before preparing a packet.' >&2; exit 2; }
  export OPTRA_CONTRACTS_TREE_SHA="$contracts_tree"
  if [[ -n "${OPTRA_MAINNET_RISK_ACCEPTANCE_REF:-}" ]]; then
    # The strict preflight already validated the acceptance document; waived gates are recorded, never invented.
    for waived_name in OPTRA_MAINNET_ASSET_APPROVAL_REF OPTRA_MAINNET_JURISDICTION_APPROVAL_REF OPTRA_MAINNET_KEEPER_RUNBOOK_REF OPTRA_MAINNET_AUDIT_REPORT_REF; do
      [[ -n "${!waived_name:-}" ]] || export "$waived_name=WAIVED by owner deployment-only risk acceptance ${OPTRA_MAINNET_RISK_ACCEPTANCE_REF}"
    done
    [[ -n "${OPTRA_MAINNET_AUDIT_REPORT_SHA256:-}" ]] || export OPTRA_MAINNET_AUDIT_REPORT_SHA256=waived
  fi
fi
source_sha256="$(python3 - "$CONTRACTS_DIR/src/OptraGuardHook.sol" <<'PY'
import hashlib, pathlib, sys
print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())
PY
)"
foundry_config_sha256="$(python3 - "$CONTRACTS_DIR/foundry.toml" <<'PY'
import hashlib, pathlib, sys
print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())
PY
)"
constructor_args="$(cast abi-encode 'constructor(address,address,address,address,address,address,uint64)' "$POOL_MANAGER" "$underlying" "$quote" "$creator" "$admin" "$keeper" "$max_policy_age")"
init_code="$(python3 - "$creation_bytecode" "$constructor_args" <<'PY'
import sys
creation, args = sys.argv[1:]
print(creation + args[2:])
PY
)"
init_code_hash="$(cast keccak "$init_code")"

# OPTRA_MAINNET_CREATE2_SALT pins a previously frozen salt so every later run derives the same address.
if [[ -n "${OPTRA_MAINNET_CREATE2_SALT:-}" ]]; then
  [[ "$OPTRA_MAINNET_CREATE2_SALT" =~ ^0x[0-9a-fA-F]{64}$ ]] || { printf '%s\n' 'FAIL: OPTRA_MAINNET_CREATE2_SALT must be a 32-byte hex value.' >&2; exit 1; }
  salt_output="$(cast create2 --deployer "$CREATE2_FACTORY" --init-code-hash "$init_code_hash" --salt "$OPTRA_MAINNET_CREATE2_SALT" </dev/null)"
else
  salt_output="$(cast create2 --deployer "$CREATE2_FACTORY" --init-code-hash "$init_code_hash" --ends-with 2080 </dev/null)"
fi
read -r predicted_hook salt < <(python3 - "$salt_output" <<'PY'
import re, sys
text = sys.argv[1]
addresses = re.findall(r"\b0x[0-9a-fA-F]{40}\b", text)
salts = re.findall(r"\b0x[0-9a-fA-F]{64}\b", text)
if not addresses or not salts:
    raise SystemExit("could not parse CREATE2 address/salt from cast output")
print(addresses[-1], salts[-1])
PY
)
python3 - "$predicted_hook" <<'PY'
import sys
address = int(sys.argv[1], 16)
if address & 0x3fff != 0x2080:
    print("FAIL: CREATE2 address does not encode the hook's required beforeInitialize + beforeSwap flags.", file=sys.stderr)
    raise SystemExit(1)
PY
factory_data="0x${salt#0x}${init_code#0x}"
tx_object="{\"from\":\"$deployer\",\"to\":\"$CREATE2_FACTORY\",\"value\":\"0x0\",\"data\":\"$factory_data\"}"
call_raw="$(rpc rpc eth_call "$tx_object" latest)"
call_result="$(unwrap_rpc_result "$call_raw")"
call_address="0x$(printf '%s' "$call_result" | python3 -c 'import sys; s=sys.stdin.read().strip(); print(s[-40:])')"
[[ "$(printf '%s' "$call_address" | tr '[:upper:]' '[:lower:]')" == "$(printf '%s' "$predicted_hook" | tr '[:upper:]' '[:lower:]')" ]] || {
  printf '%s\n' 'FAIL: read-only CREATE2 factory eth_call returned a different hook address.' >&2
  exit 1
}
estimate_raw="$(rpc rpc eth_estimateGas "$tx_object" latest)"
estimated_gas_hex="$(unwrap_rpc_result "$estimate_raw")"
estimated_gas="$(python3 - "$estimated_gas_hex" <<'PY'
import sys
print(int(sys.argv[1], 0))
PY
)"
nonce="$(rpc nonce "$deployer")"

if [[ "$mode" == "--prepare" ]]; then
  gas_limit="$(python3 - "$OPTRA_MAINNET_GAS_LIMIT" <<'PY'
import sys
value = sys.argv[1]
print(int(value, 16) if value.lower().startswith("0x") else int(value, 10))
PY
)"
  (( estimated_gas <= gas_limit )) || { printf 'FAIL: estimated gas %s exceeds approved transaction limit %s.\n' "$estimated_gas" "$gas_limit" >&2; exit 1; }
  max_fee="$(python3 - "$OPTRA_MAINNET_MAX_FEE_PER_GAS_WEI" <<'PY'
import sys
value = sys.argv[1]
print(int(value, 16) if value.lower().startswith("0x") else int(value, 10))
PY
)"
  priority_fee="$(python3 - "$OPTRA_MAINNET_MAX_PRIORITY_FEE_PER_GAS_WEI" <<'PY'
import sys
value = sys.argv[1]
print(int(value, 16) if value.lower().startswith("0x") else int(value, 10))
PY
)"
  umask 077
  mkdir -p "$(dirname "$output_path")"
  python3 - "$output_path" "$CHAIN_ID_REQUIRED" "$deployer" "$CREATE2_FACTORY" "$factory_data" "$nonce" "$gas_limit" "$max_fee" "$priority_fee" "$estimated_gas" "$predicted_hook" "$salt" "$init_code_hash" "$constructor_args" "$admin" "$keeper" "$underlying" "$quote" "$creator" "$initial_sqrt_price" "$pool_fee" "$tick_spacing" "$max_policy_age" "$OPTRA_MAINNET_AUDIT_REPORT_SHA256" "$OPTRA_MAINNET_REAL_ASSET_FORK_SIMULATION_SHA256" "$OPTRA_MAINNET_GAS_REPORT_SHA256" "$block_number" "$source_commit" "$source_sha256" "$foundry_config_sha256" "$rpc_host" <<'PY'
import hashlib, json, os, sys, tempfile
(
    path, chain_id, sender, factory, data, nonce, gas_limit, max_fee, priority_fee,
    estimate, hook, salt, init_hash, constructor_args, admin, keeper, underlying,
    quote, creator, sqrt_price, fee, spacing, policy_age, audit_sha, fork_sha, gas_sha,
    block, source_commit, source_sha, foundry_sha, rpc_host,
) = sys.argv[1:]
packet = {
    "format": "optra-mainnet-p4-approval-packet-v1",
    "chainId": int(chain_id),
    "scope": "one CREATE2 deployment transaction only; no pool initialization, liquidity provisioning, policy publication, router action, or options execution",
    "transaction": {
        "from": sender,
        "to": factory,
        "valueWei": "0",
        "data": data,
        "nonce": int(nonce),
        "gasLimit": int(gas_limit),
        "maxFeePerGasWei": int(max_fee),
        "maxPriorityFeePerGasWei": int(priority_fee),
        "estimatedGas": int(estimate),
    },
    "deployment": {
        "contract": "OptraGuardHook",
        "predictedHookAddress": hook,
        "create2Salt": salt,
        "initCodeHash": init_hash,
        "constructorArgumentsHex": constructor_args,
    },
    "configuration": {
        "poolManager": "0x8366a39CC670B4001A1121B8F6A443A643e40951",
        "underlying": underlying,
        "quote": quote,
        "poolCreator": creator,
        "adminSafe": admin,
        "keeper": keeper,
        "initialSqrtPriceX96": str(sqrt_price),
        "poolFee": int(fee),
        "tickSpacing": int(spacing),
        "maxPolicyAgeSeconds": int(policy_age),
    },
    "evidenceSha256": {
        "independentAudit": audit_sha.lower(),
        "realAssetForkSimulation": fork_sha.lower(),
        "gasReport": gas_sha.lower(),
    },
    "evidenceReferences": {
        "independentAudit": os.environ["OPTRA_MAINNET_AUDIT_REPORT_REF"],
        "realAssetForkSimulation": os.environ["OPTRA_MAINNET_REAL_ASSET_FORK_SIMULATION_REF"],
        "gasReport": os.environ["OPTRA_MAINNET_GAS_REPORT_REF"],
        "providerApproval": os.environ["OPTRA_MAINNET_PROVIDER_APPROVAL_REF"],
        "pmApproval": os.environ["OPTRA_MAINNET_PM_APPROVAL_REF"],
        "assetApproval": os.environ["OPTRA_MAINNET_ASSET_APPROVAL_REF"],
        "jurisdictionApproval": os.environ["OPTRA_MAINNET_JURISDICTION_APPROVAL_REF"],
        "poolRouteApproval": os.environ["OPTRA_MAINNET_POOL_ROUTE_APPROVAL_REF"],
        "keeperRunbook": os.environ["OPTRA_MAINNET_KEEPER_RUNBOOK_REF"],
    },
    "build": {
        "sourceCommit": source_commit,
        "contractsTreeSha": os.environ["OPTRA_CONTRACTS_TREE_SHA"],
        "sourceSha256": source_sha,
        "foundryConfigSha256": foundry_sha,
    },
    "riskAcceptance": (
        {
            "kind": "deployment-only",
            "reference": os.environ["OPTRA_MAINNET_RISK_ACCEPTANCE_REF"],
            "documentSha256": os.environ["OPTRA_MAINNET_RISK_ACCEPTANCE_SHA256"].lower(),
            "waivedGates": ["OPTRA_MAINNET_ASSET_APPROVAL_REF", "OPTRA_MAINNET_JURISDICTION_APPROVAL_REF", "OPTRA_MAINNET_KEEPER_RUNBOOK_REF", "OPTRA_MAINNET_AUDIT_REPORT_REF", "OPTRA_MAINNET_AUDIT_REPORT_SHA256"],
            "effectiveOnlyOnApprovalOfThisPacketHash": True,
        }
        if os.environ.get("OPTRA_MAINNET_RISK_ACCEPTANCE_REF") else None
    ),
    "createdAtBlock": int(block),
    "rpcHost": rpc_host,
}
canonical = json.dumps(packet, sort_keys=True, separators=(",", ":")).encode()
outer = {"packet": packet, "approvalSha256": hashlib.sha256(canonical).hexdigest()}
parent = os.path.dirname(os.path.abspath(path))
os.makedirs(parent, exist_ok=True)
fd, temporary = tempfile.mkstemp(prefix=".optra-packet-", dir=parent, text=True)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(outer, f, indent=2)
        f.write("\n")
    os.chmod(temporary, 0o600)
    os.link(temporary, path)
    os.unlink(temporary)
except Exception:
    try: os.unlink(temporary)
    except FileNotFoundError: pass
    raise
print(f"approvalSha256={outer['approvalSha256']}")
print(f"predictedHookAddress={hook}")
print(f"estimatedGas={estimate}")
print(f"packet={os.path.abspath(path)}")
PY
  exit 0
fi

if [[ "$mode" == "--freeze" ]]; then
  for name in OPTRA_MAINNET_GAS_LIMIT OPTRA_MAINNET_MAX_FEE_PER_GAS_WEI OPTRA_MAINNET_MAX_PRIORITY_FEE_PER_GAS_WEI; do
    [[ -n "${!name:-}" ]] || { printf 'BLOCKED: --freeze requires %s.\n' "$name" >&2; exit 2; }
  done
  missing_gate_output="$("$SCRIPT_DIR/optra-mainnet-preflight.sh" --strict 2>&1 || true)"
  missing_evidence="$(printf '%s\n' "$missing_gate_output" | sed -n 's/^  - \(OPTRA_MAINNET_[A-Za-z0-9_=]*\)$/\1/p')"
  deployer_balance="$(rpc balance "$deployer")"
  umask 077
  mkdir -p "$(dirname "$output_path")"
  python3 - "$output_path" "$CHAIN_ID_REQUIRED" "$deployer" "$CREATE2_FACTORY" "$factory_data" "$nonce" "$OPTRA_MAINNET_GAS_LIMIT" "$OPTRA_MAINNET_MAX_FEE_PER_GAS_WEI" "$OPTRA_MAINNET_MAX_PRIORITY_FEE_PER_GAS_WEI" "$estimated_gas" "$predicted_hook" "$salt" "$init_code_hash" "$constructor_args" "$admin" "$keeper" "$underlying" "$quote" "$creator" "$initial_sqrt_price" "$pool_fee" "$tick_spacing" "$max_policy_age" "$block_number" "$source_commit" "$source_sha256" "$foundry_config_sha256" "$rpc_host" "$deployer_balance" "$missing_evidence" <<'PY'
import hashlib, json, os, sys, tempfile
(
    path, chain_id, sender, factory, data, nonce, gas_limit, max_fee, priority_fee,
    estimate, hook, salt, init_hash, constructor_args, admin, keeper, underlying,
    quote, creator, sqrt_price, fee, spacing, policy_age, block, source_commit,
    source_sha, foundry_sha, rpc_host, balance, missing,
) = sys.argv[1:]
def integer(value): return int(value, 16) if value.lower().startswith("0x") else int(value, 10)
gas_limit, max_fee, priority_fee, estimate, balance = map(integer, (gas_limit, max_fee, priority_fee, estimate, balance))
if estimate > gas_limit: raise SystemExit("FAIL: estimated gas exceeds the frozen gas limit")
ceiling = gas_limit * max_fee
if balance < ceiling: raise SystemExit("FAIL: deployer balance is below the frozen fee ceiling")
candidate = {
    "format": "optra-mainnet-p4-frozen-candidate-v1",
    "approvalEligible": False,
    "notice": "Frozen engineering candidate. It is NOT an approval packet: owner evidence is missing, so optra-mainnet-deploy.sh --broadcast refuses it. Nothing was signed or sent.",
    "chainId": int(chain_id),
    "scope": "one CREATE2 deployment transaction only; no pool initialization, liquidity provisioning, policy publication, router action, or options execution",
    "transaction": {
        "from": sender, "to": factory, "valueWei": "0", "data": data,
        "calldataSha256": hashlib.sha256(bytes.fromhex(data[2:])).hexdigest(),
        "nonce": int(nonce), "gasLimit": gas_limit, "maxFeePerGasWei": max_fee,
        "maxPriorityFeePerGasWei": priority_fee, "estimatedGas": estimate,
        "feeCeilingWei": ceiling, "expectedCostAtEstimateWei": estimate * max_fee,
        "deployerBalanceWeiAtFreeze": balance,
    },
    "deployment": {
        "contract": "OptraGuardHook", "predictedHookAddress": hook, "create2Salt": salt,
        "initCodeHash": init_hash, "constructorArgumentsHex": constructor_args,
    },
    "configuration": {
        "poolManager": "0x8366a39CC670B4001A1121B8F6A443A643e40951", "underlying": underlying,
        "quote": quote, "poolCreator": creator, "adminSafe": admin, "keeper": keeper,
        "initialSqrtPriceX96": str(sqrt_price), "poolFee": int(fee), "tickSpacing": int(spacing),
        "maxPolicyAgeSeconds": int(policy_age),
    },
    "build": {"sourceCommit": source_commit, "sourceSha256": source_sha, "foundryConfigSha256": foundry_sha},
    "evidenceReferences": {name: os.environ[name] for name in sorted(os.environ) if name.startswith("OPTRA_MAINNET_") and (name.endswith("_REF") or name.endswith("_SHA256"))},
    "missingEvidence": [line for line in missing.splitlines() if line],
    "createdAtBlock": int(block), "rpcHost": rpc_host,
}
canonical = json.dumps(candidate, sort_keys=True, separators=(",", ":")).encode()
outer = {"candidate": candidate, "candidateSha256": hashlib.sha256(canonical).hexdigest()}
parent = os.path.dirname(os.path.abspath(path))
os.makedirs(parent, exist_ok=True)
fd, temporary = tempfile.mkstemp(prefix=".optra-candidate-", dir=parent, text=True)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(outer, f, indent=2); f.write("\n")
    os.chmod(temporary, 0o600)
    os.link(temporary, path)
    os.unlink(temporary)
except Exception:
    try: os.unlink(temporary)
    except FileNotFoundError: pass
    raise
print(f"candidateSha256={outer['candidateSha256']}")
print(f"calldataSha256={candidate['transaction']['calldataSha256']}")
print(f"predictedHookAddress={hook}")
print(f"feeCeilingWei={ceiling}")
print(f"missingEvidenceCount={len(candidate['missingEvidence'])}")
print(f"candidate={os.path.abspath(path)}")
PY
  exit 0
fi

# --estimate writes evidence only; it does not create a broadcast packet or send a transaction.
umask 077
mkdir -p "$(dirname "$output_path")"
python3 - "$output_path" "$CHAIN_ID_REQUIRED" "$block_number" "$deployer" "$CREATE2_FACTORY" "$factory_data" "$estimated_gas" "$predicted_hook" "$salt" "$init_code_hash" "$constructor_args" "$admin" "$keeper" "$underlying" "$quote" "$creator" "$initial_sqrt_price" "$pool_fee" "$tick_spacing" "$max_policy_age" "$source_commit" "$source_sha256" "$foundry_config_sha256" "$rpc_host" <<'PY'
import hashlib, json, os, sys, tempfile
(
    path, chain_id, block, sender, factory, data, estimate, hook, salt, init_hash,
    constructor_args, admin, keeper, underlying, quote, creator, sqrt_price, fee,
    spacing, policy_age, source_commit, source_sha, foundry_sha, rpc_host,
) = sys.argv[1:]
report = {
    "format": "optra-mainnet-p4-read-only-gas-report-v1",
    "chainId": int(chain_id),
    "block": int(block),
    "readOnly": True,
    "noTransactionSent": True,
    "rpcHost": rpc_host,
    "scope": "constructor and CREATE2 factory eth_call/eth_estimateGas only; excludes Safe pool initialization, liquidity, policy publication, route swaps, and chain-specific data fees not reported by eth_estimateGas",
    "transactionCandidate": {"from": sender, "to": factory, "valueWei": "0", "data": data},
    "build": {"sourceCommit": source_commit, "sourceSha256": source_sha, "foundryConfigSha256": foundry_sha},
    "estimatedGas": int(estimate),
    "predictedHookAddressNotDeployed": hook,
    "create2Salt": salt,
    "initCodeHash": init_hash,
    "constructorArgumentsHex": constructor_args,
    "configuration": {
        "poolManager": "0x8366a39CC670B4001A1121B8F6A443A643e40951",
        "underlying": underlying,
        "quote": quote,
        "poolCreator": creator,
        "adminSafe": admin,
        "keeper": keeper,
        "initialSqrtPriceX96": str(sqrt_price),
        "poolFee": int(fee),
        "tickSpacing": int(spacing),
        "maxPolicyAgeSeconds": int(policy_age),
    },
}
parent = os.path.dirname(os.path.abspath(path))
os.makedirs(parent, exist_ok=True)
fd, temporary = tempfile.mkstemp(prefix=".optra-gas-report-", dir=parent, text=True)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    os.chmod(temporary, 0o600)
    os.link(temporary, path)
    os.unlink(temporary)
except Exception:
    try: os.unlink(temporary)
    except FileNotFoundError: pass
    raise
print(f"estimatedGas={estimate}")
print(f"predictedHookAddressNotDeployed={hook}")
print(f"report={os.path.abspath(path)}")
print(f"reportSha256={hashlib.sha256(open(path, 'rb').read()).hexdigest()}")
PY