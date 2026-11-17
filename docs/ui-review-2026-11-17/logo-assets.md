# Market logo assets: provenance and release status

Status: **not cleared for release.** The files exist in the working tree only. Nothing has been staged or committed.

## What is there

- `public/img/stocks/{SYMBOL}.png`, 190 files, 904 KB in total, each 100 by 100 pixels.
- `components/app/market/logo-symbols.ts` lists the symbols that have a file. `AssetLogo` uses a verified server logo first, then this local file, then initials. No request goes to any other host at runtime.

## Where they came from

- Downloaded in this session from `assets.parqet.com`, a third-party logo service.
- Robinhood's own logo registry was not used: the backend deliberately sends no logos (every registry entry resolves to the same image).

## What is not verified

- No license or terms were checked for redistributing these files inside the product repository or serving them from the product origin.
- The marks are trademarks of their owners. Use inside a market list to identify an instrument is common practice, but that is a legal judgement for the release owner, not a technical fact.
- Nothing in the UI claims partnership with, or endorsement by, any of these companies.

## Quality and duplicates (checked)

- All 190 files decode as PNG and are visible at 28 to 44 pixels in the list.
- Five groups share one image because the tickers share an issuer, not because a download failed:
  - iShares: EWT, EWY, INDA, SGOV, SHY, SLV, SOXX
  - SPDR: GLD, SPY, XLK
  - Vanguard: BND, VTI
  - Invesco: QQQ, SPMO
  - VanEck: GDX, SMH
- Thirteen symbols have no file and keep their initials: AUR, COHR, CRCL, FIG, GLXY, INFQ, MRVL, NAVN, P, SKHY, SOFI, WYFI, XNDU.

## Before a public release

1. Decide whether to keep these, replace them with a licensed set, or serve them from an allow-listed CDN with the right to use them.
2. If the set changes, regenerate `logo-symbols.ts` from the files that are actually present.
3. Stage only the files that were cleared. Do not stage the folder wholesale.
