import Image from "next/image";

/**
 * The official Optra mark, `/logo.png`, shown as shipped: no recolor, no redraw. The artwork is 1312 by 1199 with a transparent edge,
 * so it keeps its own aspect ratio and sits on Midnight Ink without a plate behind it.
 */
export function BrandMark({ className, priority = false }: { className?: string; priority?: boolean }) {
  return <Image className={className ? `brand-mark ${className}` : "brand-mark"} src="/logo.png" alt="" width={1312} height={1199} sizes="40px" priority={priority} />;
}
