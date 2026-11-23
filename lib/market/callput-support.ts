import { CALLPUT_ROBINHOOD_UNDERLYINGS } from "../venue/callput-robinhood-write";

/** A market has real, tradable CallPut instruments only when CallPut lists its symbol as an underlying. Availability of individual strikes is still checked live. */
export function callPutUnderlyingFor(symbol: string): keyof typeof CALLPUT_ROBINHOOD_UNDERLYINGS | null {
  const ticker = symbol.trim().toUpperCase();
  return Object.hasOwn(CALLPUT_ROBINHOOD_UNDERLYINGS, ticker) ? (ticker as keyof typeof CALLPUT_ROBINHOOD_UNDERLYINGS) : null;
}
