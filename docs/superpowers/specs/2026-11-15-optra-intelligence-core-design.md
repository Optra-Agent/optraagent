# OPTRA Intelligence Core Design

## Intent

Replace Forge's rejected isometric board with one large, original visual object that explains the actual Protective Put paper recipe as the visitor moves through the existing pinned story. The design takes Gyevo's use of a single focal visualization and a staged narrative as high-level composition cues. It does not use its globe, assets, colors, or branding.

## Product behavior

The Intelligence Core has five scroll-linked states:

1. **Agent Core:** a compact, asymmetric particle nucleus identifies the Protective Put agent.
2. **Strategy Formation:** the nucleus unfolds into Gate → Strike → Size → Pulse → Expiry.
3. **Hook Evaluation:** the real 36-hook catalog fans into stage clusters; 15 implemented hooks are active Azure nodes and 21 catalog-only hooks remain dim and inactive.
4. **Risk Protection:** five actual Breaker hooks form an Ember guard around the five-stage entry path.
5. **Decision and Evidence:** the path converges on a paper-decision node and an explicitly illustrative Tape representation. No fake result, balance, order, or recorded event is shown.

The same stable set of points changes 3D positions between the five states. The visible object is an open, folded decision path rather than a globe. Five accessible state controls use `PinnedStory.go`; ordinary scroll remains reversible and never hijacks the page. The existing four Forge workflow actions and validator stay intact.

## Implementation choices

- Use a deterministic procedural topology based on `ForgeDemoData`, not invented trading inputs.
- Use Canvas 2D with perspective projection and direct `requestAnimationFrame` drawing. Canvas 2D is already a non-WebGL renderer, so no WebGL or animation dependency is needed.
- Add a server-rendered inline SVG frame underneath the canvas. Keep it visible until the first successful canvas draw and when Canvas 2D is unavailable. Reserve the full visualization's aspect ratio in CSS to prevent layout shift.
- Extend `PinnedStory` to expose its normalized scroll progress through a mutable ref, so the visual can interpolate each frame without setting React state per frame. Keep discrete step callbacks for the existing copy, controls, and fallback layout.
- Start subtle ambient motion when visible, stop rendering while offscreen, cap device pixel ratio, and snap to the active state with no autonomous motion when reduced motion or Save-Data is active.
- Keep the current Premium Neutral Dark palette, Azure for supported/active logic, and Ember for risk protection. Use existing typography and component conventions.

## Constraints and anti-goals

- Do not add packages, a second pinned-story engine, or WebGL.
- Do not change recipe validation, APIs, paper execution, or backend assumptions.
- Do not add fake Tape records or imply that a paper tick occurred.
- Do not clone Gyevo's globe or import its visual assets.
- Preserve the landing's server/client boundary: construct serializable catalog topology in the server section and keep browser APIs inside the small interactive visualization component.

## Acceptance

- Five screenshots from a real Chromium page show five distinct object topologies; unit tests prove endpoint and intermediate positions differ.
- Scroll progresses and reverses the same topology smoothly; state controls are keyboard and touch accessible.
- 390px, 820px, and 1440px layouts have no horizontal overflow.
- Reduced-motion, Save-Data, no-Canvas, offscreen, and no-JavaScript fallbacks remain legible.
- The marketing demo makes no trade-related write requests, and Forge validation behavior is unchanged.
