/** Read-only: decode a real mainnet keeper transaction and list FastPriceFeed's implementation selectors. */
import { createPublicClient, decodeFunctionData, http, parseAbi } from "viem";
import { robinhoodMainnet } from "../lib/chain/robinhood";

const client = createPublicClient({ chain: robinhoodMainnet, transport: http() });
const abi = parseAbi(["function setPricesAndRiskPremiumsWithBitsAndExecute(address,uint256[],uint256[],uint256[],uint256[],uint256,uint256,uint256)"]);
const tx = await client.getTransaction({ hash: process.argv[2] as `0x${string}` });
const d = decodeFunctionData({ abi, data: tx.input });
const args = d.args as readonly unknown[];
console.log("block", tx.blockNumber, "from", tx.from, "to", tx.to);
console.log("positionManager", args[0]);
for (let i = 1; i <= 4; i++) {
  const arr = args[i] as bigint[];
  console.log(`array${i} length ${arr.length}:`, arr.map((x) => "0x" + x.toString(16)).join(", ").slice(0, 400));
}
console.log("uint5 (timestamp?)", args[5], "uint6", args[6], "uint7", args[7]);
const block = await client.getBlock({ blockNumber: tx.blockNumber! });
console.log("block timestamp", block.timestamp);
