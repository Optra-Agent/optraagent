import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TemplateCard } from "../app/agents/TemplateCard";
import { SidebarView } from "../app/Sidebar";
import { Chip, JourneyRail, Panel } from "../app/ui";
import type { getLandingFacts } from "./data";

type Facts = ReturnType<typeof getLandingFacts>;

/**
 * A read-only render of the real Agents screen: the same SidebarView, JourneyRail, TemplateCard, Panel, Chip, Input and
 * Button the app uses, in the signed-out state. Template availability comes from the live catalog. The configure form
 * shows the form's own defaults, never a balance, quote, fill or performance figure. It is inert and hidden from
 * assistive technology; the caption under the hero describes it.
 */
export function AppPreview({ facts }: { facts: Facts }) {
  const featured = facts.paperReadyTemplates[0];
  return (
    <div className="preview-shell" aria-hidden="true" inert>
      <aside className="sidebar"><SidebarView active="/agents" interactive={false} /></aside>
      <div className="shell-main">
        <div className="topbar">
          <div className="topbar-mode"><strong>PAPER</strong><span>Virtual USDG. Option premiums are modeled. Real-money execution is disabled.</span></div>
          <div className="topbar-session"><Button size="sm" tabIndex={-1}>Connect wallet</Button></div>
        </div>
        <div className="preview-page">
          <p className="eyebrow">PAPER ONLY</p>
          <p className="preview-title">Agents</p>
          <JourneyRail step={2} interactive={false} />
          <div className="preview-grid">
            <div className="preview-left">
              <p className="eyebrow">HOUSE AGENTS</p>
              {featured ? <TemplateCard template={featured} interactive={false} headingAs="p" /> : null}
              <div className="preview-minis">
                {facts.previewTemplates.map((template) => <TemplateCard key={template.id} template={template} interactive={false} compact headingAs="p" />)}
              </div>
            </div>
            <Panel className="creator preview-creator">
              <div className="panel-head"><div><p className="eyebrow">STEP 2 · CONFIGURE</p><p className="preview-sub">Protective Put draft</p></div><Chip tone="azure">Paper ready</Chip></div>
              <div className="field"><Label>Underlying</Label><Input readOnly tabIndex={-1} aria-label="Underlying" value="Choose a market" /></div>
              <div className="field"><Label>Virtual reference shares</Label><Input readOnly tabIndex={-1} aria-label="Virtual reference shares" value="10" /></div>
              <div className="field"><Label>Paper capital (USD)</Label><Input readOnly tabIndex={-1} aria-label="Paper capital (USD)" value="100000" /></div>
              <Button size="lg" className="w-full" tabIndex={-1}>Create paper draft</Button>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
