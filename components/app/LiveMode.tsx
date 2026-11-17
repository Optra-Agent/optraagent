"use client";

import Link from "next/link";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LIVE_REQUIREMENTS } from "./live-requirements";

/** The Live half of the mode switch. It is a real button that explains Live; it never starts anything. */
export function LiveModeButton() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="topbar-chip topbar-live" aria-haspopup="dialog" title="Live trading is planned and not enabled">
          Live<span className="topbar-live-tag">Planned</span>
        </button>
      </DialogTrigger>
      <DialogContent className="live-dialog">
        <DialogHeader>
          <DialogTitle>Live trading is not enabled</DialogTitle>
          <DialogDescription>Optra runs on paper today. Live is a separate execution mode with real wallet capital. It needs the pieces below before it can place a real order.</DialogDescription>
        </DialogHeader>
        <ul className="live-needs">
          {LIVE_REQUIREMENTS.map((item) => (
            <li key={item.title}><b>{item.title}</b><span>{item.note}</span></li>
          ))}
        </ul>
        <p className="live-note">Nothing in this app can submit a real-money transaction. Paper mode keeps working as it does now.</p>
        <DialogFooter>
          <Link className={cn(buttonVariants({ variant: "outline" }))} href="/verify">See the claims on Verify</Link>
          <DialogClose className={cn(buttonVariants())}>Stay on Paper</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
