#!/usr/bin/env bash
set -euo pipefail

readonly CHAIN_ID_REQUIRED=4663
readonly CONTRACT_PATH=src/OptraGuardHook.sol:OptraGuardHook
readonly CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -ne 3 || "$1" != "--prepare" ]]; then
  printf '%s\n' 'Usage: optra-mainnet-verify-source.sh --prepare <deployed-hook-address> <new-output-directory>' >&2
  exit 2
fi
hook="$2"
out_dir="$3"
out_dir="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$out_dir")"
rpc_url="${OPTRA_MAINNET_RPC_URL:-}"
if [[ -z "$rpc_url" ]]; then
  printf '%s\n' 'BLOCKED: set OPTRA_MAINNET_RPC_URL explicitly; this script never sources .env.' >&2
  exit 2
fi
[[ "$hook" =~ ^0x[0-9a-fA-F]{40}$ ]] || { printf '%s\n' 'FAIL: hook address must be 20-byte hex.' >&2; exit 1; }
[[ ! -e "$out_dir" ]] || { printf 'BLOCKED: refusing to overwrite existing output directory: %s\n' "$out_dir" >&2; exit 2; }

chain_id="$(cast chain-id --rpc-url "$rpc_url")"
[[ "$chain_id" == "$CHAIN_ID_REQUIRED" ]] || { printf 'FAIL: chain ID %s != %s.\n' "$chain_id" "$CHAIN_ID_REQUIRED" >&2; exit 1; }
code="$(cast code "$hook" --rpc-url "$rpc_url")"
[[ "$code" != '0x' && -n "$code" ]] || { printf 'FAIL: no deployed runtime code at %s.\n' "$hook" >&2; exit 1; }
code_metrics="$(python3 - "$code" <<'PY'
import hashlib, sys
raw = bytes.fromhex(sys.argv[1][2:])
print(f"{len(raw)}\t{hashlib.sha256(raw).hexdigest()}")
PY
)"
IFS=$'\t' read -r code_size code_sha256 <<< "$code_metrics"
(( code_size <= 24576 )) || { printf 'FAIL: runtime exceeds EIP-170 (%s bytes).\n' "$code_size" >&2; exit 1; }

get() { cast call "$hook" "$1" --rpc-url "$rpc_url"; }
pool_manager="$(get 'poolManager()(address)')"
underlying="$(get 'underlyingToken()(address)')"
quote="$(get 'quoteToken()(address)')"
pool_creator="$(get 'poolCreator()(address)')"
admin="$(get 'admin()(address)')"
keeper="$(get 'keeper()(address)')"
max_age="$(get 'maxPolicyAge()(uint64)')"
constructor_args="$(cast abi-encode 'constructor(address,address,address,address,address,address,uint64)' "$pool_manager" "$underlying" "$quote" "$pool_creator" "$admin" "$keeper" "$max_age")"

(
  cd "$CONTRACTS_DIR"
  forge build --sizes
  mkdir -p "$out_dir"
  forge verify-contract 0x0000000000000000000000000000000000000001 "$CONTRACT_PATH" --show-standard-json-input > "$out_dir/OptraGuardHook.standard-input.json"
)
artifact="$CONTRACTS_DIR/out/OptraGuardHook.sol/OptraGuardHook.json"
[[ -s "$artifact" && -s "$out_dir/OptraGuardHook.standard-input.json" ]] || { printf '%s\n' 'FAIL: expected Foundry artifact or standard-json input is empty.' >&2; exit 1; }
compiler_version="$(python3 - "$artifact" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    artifact = json.load(f)
metadata = artifact.get("metadata")
if isinstance(metadata, str): metadata = json.loads(metadata)
version = metadata.get("compiler", {}).get("version") if isinstance(metadata, dict) else None
if not version:
    raise SystemExit("compiler version missing from artifact metadata")
print("v" + version.removeprefix("v"))
PY
)"

umask 077
python3 - "$out_dir" "$hook" "$pool_manager" "$underlying" "$quote" "$pool_creator" "$admin" "$keeper" "$max_age" "$constructor_args" "$compiler_version" "$code_size" "$code_sha256" "$CONTRACTS_DIR" <<'PY'
import hashlib, json, os, pathlib, sys
(out_dir, hook, manager, underlying, quote, creator, admin, keeper, max_age, args, compiler, size, runtime_sha, contracts_dir) = sys.argv[1:]
out = pathlib.Path(out_dir)
(out / "OptraGuardHook.constructor-args.hex").write_text(args.removeprefix("0x") + "\n", encoding="utf-8")
standard = out / "OptraGuardHook.standard-input.json"
metadata = {
    "chainId": 4663,
    "contractAddress": hook,
    "contract": "src/OptraGuardHook.sol:OptraGuardHook",
    "compilerVersion": compiler,
    "constructorArgumentsFile": "OptraGuardHook.constructor-args.hex (without 0x)",
    "constructorArgumentsHex": args,
    "runtimeSizeBytes": int(size),
    "runtimeSha256": runtime_sha,
    "configurationReadBack": {
        "poolManager": manager,
        "underlyingToken": underlying,
        "quoteToken": quote,
        "poolCreator": creator,
        "admin": admin,
        "keeper": keeper,
        "maxPolicyAgeSeconds": int(max_age),
    },
    "sourceInputSha256": hashlib.sha256(standard.read_bytes()).hexdigest(),
    "verification": "Prepared locally only. No source was submitted. Confirm exact match on Sourcify and Robinhood Blockscout after owner-authorized deployment.",
    "explorerVerificationPage": f"https://robinhoodchain.blockscout.com/address/{hook}?tab=contract",
    "settingsSource": str(pathlib.Path(contracts_dir) / "foundry.toml"),
}
(out / "OptraGuardHook.verification-manifest.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
print(f"standardInput={standard}")
print(f"constructorArgs={out / 'OptraGuardHook.constructor-args.hex'}")
print(f"manifest={out / 'OptraGuardHook.verification-manifest.json'}")
print(f"compilerVersion={compiler}")
print(f"sourceInputSha256={metadata['sourceInputSha256']}")
PY
printf '%s\n' 'PASS: source-verification input prepared from local Foundry settings and deployed getter readbacks.'
printf '%s\n' 'No verification request was submitted; manually verify exact match on Sourcify and Robinhood Blockscout.'