import Image from "next/image";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The official Optra mark, `/logo.png`, shown as shipped: no recolor, no redraw. The artwork is 1312 by 1199 with a transparent edge,
 * so it keeps its own aspect ratio and sits on Midnight Ink without a plate behind it.
 */
export function BrandMark({ className, priority = false }: { className?: string; priority?: boolean }) {
  return <Image className={className ? `brand-mark ${className}` : "brand-mark"} src="/logo.png" alt="" width={1312} height={1199} sizes="40px" priority={priority} />;
}

export function XBrandIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 1200 1227" fill="none">
      <path fill="currentColor" d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z" />
    </svg>
  );
}

export function XSocialLink({ className }: { className?: string }) {
  return (
    <a
      aria-label="Follow OPTRA on X"
      className={cn(buttonVariants({ variant: "outline", size: "icon" }), "size-11 rounded-full", className)}
      href="https://x.com/optraagent"
      rel="noopener noreferrer"
      target="_blank"
    >
      <XBrandIcon />
    </a>
  );
}
