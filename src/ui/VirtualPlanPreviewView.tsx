/**
 * P2-K.3a – Virtual planning preview UI (IST / SOLL).
 * Presentation only: no scan, no H/I/J-A, no user filesystem mutation, no draft overwrite.
 */

import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import type { ScanResult } from "../model";
import {
  ROW_HEIGHT,
  TREE_INDENT_PX,
  computeTreeWindow,
  defaultExpandedIds,
  deriveVisibleRows,
} from "./treeRows";
import { DEFAULT_TREE_SORT } from "./treeSort";
import { parseVirtualPlan, type DraftLoadResult, type VirtualPlan } from "./virtualPlan";
import type { VirtualPlanDraftListEntry } from "./virtualPlanApi";
import {
  looksLikeTechnicalFeatureKey,
  reviewFeatureLabel,
  reviewReasonLabel,
  type SollNodeProjection,
  type VirtualSollPreview,
} from "./virtualPlanPreview";
import type { VirtualReorgProposal } from "./virtualPlanSuggestions";
import type { VirtualProposalUsefulnessAssessment } from "./virtualPlanProposalUsefulness";
import {
  assessVirtualPlanApproval,
  type VirtualPlanApprovalAssessment,
} from "./virtualPlanApproval";
import { revalidateVirtualPlan, type VirtualPlanRevalidation } from "./virtualPlanRevalidation";
import { VirtualPlanEditorPanel } from "./VirtualPlanEditorPanel";
import { VirtualPlanPreferencesPanel } from "./VirtualPlanPreferencesPanel";
import { VirtualPlanDryRunPanel } from "./VirtualPlanDryRunPanel";
import { VirtualPlanJournalPanel } from "./VirtualPlanJournalPanel";

export type PlanCompareMode = "ist" | "soll" | "split";
type PlanningMainView = "editor" | "compare" | "review";

export interface VirtualPlanPreviewViewProps {
  preview: VirtualSollPreview | null;
  scanResult: ScanResult | null;
  draftLoad: DraftLoadResult | null;
  loadingDraft: boolean;
  editablePlan: VirtualPlan | null;
  planSaving: boolean;
  planSaveMessage: string | null;
  historicalPlanEntries: VirtualPlanDraftListEntry[];
  historicalPlansLoading: boolean;
  onSelectProposal: (proposal: VirtualReorgProposal) => void;
  onPlanChange: (plan: VirtualPlan) => void;
  onSavePlan: () => void;
  onApprovePlan: () => void;
  onRecheckHistoricalPlans: () => void;
}

function suggestionLabel(kind: SollNodeProjection["suggestionKind"]): string {
  if (kind === "structureHint") {
    return "Hinweis";
  }
  if (kind === "reviewCase") {
    return "Prüffall";
  }
  return "Unverändert";
}

function shortenPath(path: string, max = 64): string {
  if (path.length <= max) {
    return path;
  }
  const keep = Math.max(12, Math.floor((max - 1) / 2));
  return `${path.slice(0, keep)}…${path.slice(-keep)}`;
}

function VirtualTreePane(props: {
  title: string;
  showBadges: boolean;
  scanResult: ScanResult;
  projectionById: Map<string, SollNodeProjection>;
  expandedIds: ReadonlySet<string>;
  onToggleExpand: (nodeId: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(280);

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) {
      return;
    }
    const update = () => {
      const next = element.clientHeight;
      if (next > 0) {
        setViewportHeight(next);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const rows = useMemo(
    () => deriveVisibleRows(props.scanResult.root, props.expandedIds, DEFAULT_TREE_SORT),
    [props.scanResult, props.expandedIds],
  );
  const viewportContentHeight = Math.min(Math.max(rows.length * ROW_HEIGHT + 2, ROW_HEIGHT + 2), 420);

  const window = computeTreeWindow(rows.length, scrollTop, viewportHeight);
  const slice = rows.slice(window.start, window.end);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  };

  return (
    <section className="plan-tree-pane" aria-label={props.title}>
      <h3 className="plan-tree-pane-title">{props.title}</h3>
      <div
        className="plan-tree-viewport"
        ref={viewportRef}
        style={{ height: `${viewportContentHeight}px` }}
        onScroll={onScroll}
        role="tree"
        aria-label={props.title}
      >
        <div className="plan-tree-spacer" style={{ height: rows.length * ROW_HEIGHT }}>
          {slice.map((row, index) => {
            const top = (window.start + index) * ROW_HEIGHT;
            const projection = props.projectionById.get(row.id);
            const expanded = props.expandedIds.has(row.id);
            return (
              <div
                key={row.id}
                className="plan-tree-row"
                role="treeitem"
                aria-expanded={row.expandable ? expanded : undefined}
                style={{
                  top,
                  height: ROW_HEIGHT,
                  paddingLeft: 8 + row.depth * TREE_INDENT_PX,
                }}
                title={row.node.path}
              >
                {row.expandable ? (
                  <button
                    type="button"
                    className="plan-tree-twist"
                    aria-label={expanded ? "Ordner zuklappen" : "Ordner aufklappen"}
                    onClick={() => {
                      props.onToggleExpand(row.id);
                    }}
                  >
                    {expanded ? "▾" : "▸"}
                  </button>
                ) : (
                  <span className="plan-tree-twist-spacer" aria-hidden="true" />
                )}
                <span className={`plan-kind plan-kind-${row.node.kind}`} aria-hidden="true">
                  {row.directory ? "Ord" : "Dat"}
                </span>
                <span className="plan-tree-name">{row.node.name}</span>
                {props.showBadges ? (
                  <span
                    className={`plan-badge plan-badge-${projection?.suggestionKind ?? "unchanged"}`}
                  >
                    {suggestionLabel(projection?.suggestionKind ?? "unchanged")}
                  </span>
                ) : null}
                {projection?.incompleteListing ? (
                  <span className="plan-badge plan-badge-incomplete">Listing unvollständig</span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <p className="plan-tree-meta muted">
        {rows.length} sichtbare Einträge · {props.scanResult.stats.directoryCount} Ordner ·{" "}
        {props.scanResult.stats.fileCount} Dateien
      </p>
    </section>
  );
}

export function VirtualPlanPreviewView({
  preview,
  scanResult,
  draftLoad,
  loadingDraft,
  editablePlan,
  planSaving,
  planSaveMessage,
  historicalPlanEntries,
  historicalPlansLoading,
  onSelectProposal,
  onPlanChange,
  onSavePlan,
  onApprovePlan,
  onRecheckHistoricalPlans,
}: VirtualPlanPreviewViewProps) {
  const [mode, setMode] = useState<PlanCompareMode>("split");
  const [mainView, setMainView] = useState<PlanningMainView>("editor");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [proposalsOpen, setProposalsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewedHistoricalPlanId, setViewedHistoricalPlanId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (scanResult === null) {
      setExpandedIds(new Set());
      return;
    }
    setExpandedIds(defaultExpandedIds(scanResult.root.id));
  }, [scanResult]);

  useEffect(() => {
    if (editablePlan !== null) {
      setMainView("editor");
    }
  }, [editablePlan]);

  const projectionById = useMemo(() => {
    const map = new Map<string, SollNodeProjection>();
    if (preview !== null) {
      for (const node of preview.nodes) {
        map.set(node.nodeId, node);
      }
    }
    return map;
  }, [preview]);

  const usefulnessByProposalId = useMemo(
    () =>
      new Map(
        (preview?.proposalUsefulness ?? []).map((assessment) => [
          assessment.proposalId,
          assessment,
        ]),
      ),
    [preview],
  );
  const selectedProposal = useMemo(() => {
    const proposalId = editablePlan?.virtualFolders?.[0]?.sourceProposalId;
    return proposalId === undefined ? undefined : preview?.proposals.find((proposal) => proposal.id === proposalId);
  }, [editablePlan, preview]);
  const approval: VirtualPlanApprovalAssessment | null = useMemo(() => {
    if (editablePlan === null || scanResult === null || preview === null) {
      return null;
    }
    return assessVirtualPlanApproval({
      plan: editablePlan,
      scanResult,
      binding: preview.binding,
      draftLoad,
    });
  }, [editablePlan, scanResult, preview, draftLoad]);
  const currentPlanRevalidation = useMemo(
    () => editablePlan === null || scanResult === null ? null : revalidateVirtualPlan({
      plan: editablePlan, blocked: false, scanResult, currentBinding: preview?.binding ?? editablePlan.binding,
    }),
    [editablePlan, preview, scanResult],
  );
  const historicalPlans = useMemo(() => {
    if (scanResult === null || preview === null) {
      return [];
    }
    const currentPlanId = `vp_${preview.binding.snapshotFingerprint}`;
    return historicalPlanEntries
      .filter((entry) => entry.planId !== currentPlanId)
      .map((entry) => {
        const parsed = entry.draftJson === null ? { kind: "blocked" as const } : parseVirtualPlan(entry.draftJson);
        const plan = parsed.kind === "valid" ? parsed.plan : null;
        const revalidation: VirtualPlanRevalidation = revalidateVirtualPlan({
          plan,
          blocked: entry.blocked || parsed.kind === "blocked",
          scanResult,
          currentBinding: preview.binding,
        });
        return { entry, plan, revalidation };
      })
      .filter(({ plan }) => plan?.binding.normalizedRootPath === preview.binding.normalizedRootPath);
  }, [historicalPlanEntries, preview, scanResult]);

  const draftNote = useMemo(() => {
    if (loadingDraft) {
      return "Entwurf wird geladen …";
    }
    if (draftLoad === null) {
      return null;
    }
    if (draftLoad.kind === "missing") {
      return "Kein gespeicherter Entwurf für diesen Snapshot.";
    }
    if (draftLoad.kind === "blocked") {
      return "Vorhandener Entwurf ist nicht lesbar und wird nicht überschrieben.";
    }
    if (preview?.flags.draftStale) {
      return "Gespeicherter Entwurf gehört zu einem anderen Snapshot und wird nicht automatisch übernommen.";
    }
    return `Gespeicherter Entwurf vorhanden (Revision ${draftLoad.plan.revision}) — keine automatische Überschreibung.`;
  }, [draftLoad, loadingDraft, preview]);

  const toggleExpand = (nodeId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  if (preview === null || scanResult === null) {
    return (
      <section className="plan-view" aria-label="Planung">
        <header className="plan-view-header">
          <h2>Virtuelle Planung</h2>
          <p className="plan-lede">
            Für die virtuelle SOLL-Ansicht wird ein erfolgreich eingelesener Bestand benötigt.
          </p>
        </header>
      </section>
    );
  }

  return (
    <section className="plan-view" aria-label="Planung">
      <header className="plan-view-header">
        <h2>Virtuelle Planung</h2>
        <p className="plan-lede">
          SOLL entspricht dem IST, solange keine ausdrücklich zulässige virtuelle Änderung vorliegt.
          In dieser Stufe keine automatischen Verschiebungen, Umbenennungen oder Löschungen.
        </p>
        <div className="plan-flags" role="status">
          {preview.flags.incomplete ? (
            <span className="plan-flag">
              Datengrundlage eingeschränkt (Filter, Tiefenlimit, Warnungen oder unvollständige
              Listings)
            </span>
          ) : null}
          {preview.flags.identityLimited ? (
            <span className="plan-flag">
              Dateien können derzeit nur innerhalb dieses Scanvorgangs eindeutig zugeordnet werden
            </span>
          ) : null}
          {preview.flags.draftStale ? <span className="plan-flag">Entwurf veraltet</span> : null}
          {preview.flags.draftBlocked ? <span className="plan-flag">Entwurf gesperrt</span> : null}
        </div>
        {draftNote !== null ? <p className="plan-draft-note muted">{draftNote}</p> : null}
        <div className="insight-view-switcher plan-main-switcher" role="group" aria-label="Planungsansicht">
          <button
            type="button"
            className="insight-view-tab"
            aria-pressed={mainView === "editor"}
            onClick={() => {
              setMainView("editor");
            }}
          >
            Vorschlag bearbeiten
          </button>
          <button
            type="button"
            className="insight-view-tab"
            aria-pressed={mainView === "compare"}
            onClick={() => {
              setMainView("compare");
            }}
          >
            IST / SOLL vergleichen
          </button>
          <button
            type="button"
            className="insight-view-tab"
            aria-pressed={mainView === "review"}
            onClick={() => {
              setMainView("review");
            }}
          >
            Hinweise und Prüffälle
          </button>
        </div>
      </header>

      {mainView === "compare" ? (
        <>
          <div className="insight-view-switcher plan-mode-switcher" role="group" aria-label="IST oder SOLL">
            <button
              type="button"
              className="insight-view-tab"
              aria-pressed={mode === "ist"}
              onClick={() => {
                setMode("ist");
              }}
            >
              IST
            </button>
            <button
              type="button"
              className="insight-view-tab"
              aria-pressed={mode === "soll"}
              onClick={() => {
                setMode("soll");
              }}
            >
              SOLL
            </button>
            <button
              type="button"
              className="insight-view-tab"
              aria-pressed={mode === "split"}
              onClick={() => {
                setMode("split");
              }}
            >
              Nebeneinander
            </button>
          </div>
      <div className={mode === "split" ? "plan-workspace plan-workspace-split" : "plan-workspace"}>
        {mode === "ist" || mode === "split" ? (
          <VirtualTreePane
            title="IST (eingelesen)"
            showBadges={false}
            scanResult={scanResult}
            projectionById={projectionById}
            expandedIds={expandedIds}
            onToggleExpand={toggleExpand}
          />
        ) : null}
        {mode === "soll" || mode === "split" ? (
          <VirtualTreePane
            title="SOLL (virtuell, derzeit unverändert)"
            showBadges
            scanResult={scanResult}
            projectionById={projectionById}
            expandedIds={expandedIds}
            onToggleExpand={toggleExpand}
          />
        ) : null}
      </div>
        </>
      ) : null}

      {mainView === "editor" && editablePlan === null ? (
        <div className="plan-proposals">
        <button
          type="button"
          className="plan-details-toggle"
          aria-expanded={proposalsOpen}
          onClick={() => {
            setProposalsOpen((open) => !open);
          }}
        >
          {proposalsOpen ? "▾" : "▸"} Virtuelle Vorschläge ({preview.proposals.length})
        </button>
        {proposalsOpen ? (
          <div className="plan-proposals-body">
            <p className="plan-proposals-lede muted">
              Begründbare virtuelle Neuorganisationsvorschläge. Noch nicht übernommen — keine
              Übernahme in dieser Stufe.
            </p>
            {preview.proposals.length === 0 ? (
              <p className="muted">Keine begründbaren virtuellen Vorschläge für diesen Scan.</p>
            ) : (
              <ul className="plan-case-list">
                {preview.proposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    usefulness={usefulnessByProposalId.get(proposal.id)}
                    onSelect={onSelectProposal}
                  />
                ))}
              </ul>
            )}
          </div>
        ) : null}
        </div>
      ) : null}

      {mainView === "editor" && editablePlan !== null ? (
        <>
          <VirtualPlanEditorPanel
            plan={editablePlan}
            saving={planSaving}
            saveMessage={planSaveMessage}
            proposalTitle={selectedProposal?.title ?? "Ausgewählter virtueller Vorschlag"}
            usefulnessLabel={
              selectedProposal === undefined
                ? null
                : usefulnessByProposalId.get(selectedProposal.id)?.categoryLabel ?? null
            }
            approval={approval}
            onPlanChange={onPlanChange}
            onSave={onSavePlan}
            onApprove={onApprovePlan}
          />
          <VirtualPlanPreferencesPanel
            plan={editablePlan}
            revalidationCurrent={currentPlanRevalidation?.kind === "current"}
          />
          <VirtualPlanDryRunPanel
            plan={editablePlan}
            scanResult={scanResult}
            binding={preview.binding}
            current={currentPlanRevalidation?.kind === "current"}
          />
          <VirtualPlanJournalPanel
            plan={editablePlan}
            scanResult={scanResult}
            binding={preview.binding}
            current={currentPlanRevalidation?.kind === "current"}
          />
        </>
      ) : null}

      {mainView === "editor" ? (
        <details
          className="plan-history"
          open={historyOpen}
          onToggle={(event) => {
            setHistoryOpen((event.currentTarget as HTMLDetailsElement).open);
          }}
        >
          <summary>
            Frühere virtuelle Pläne ({historicalPlans.length})
          </summary>
          <div className="plan-history-actions">
            <button type="button" onClick={onRecheckHistoricalPlans} disabled={historicalPlansLoading}>
              {historicalPlansLoading ? "Prüft …" : "Erneut prüfen"}
            </button>
            <span className="muted">Die Prüfung ändert keinen gespeicherten Plan.</span>
          </div>
          {historicalPlans.length === 0 ? (
            <p className="muted">Keine früheren Pläne für andere Snapshots dieser Scanwurzel gefunden.</p>
          ) : (
            <div className="plan-history-list">
              {historicalPlans.map(({ entry, plan, revalidation }) => (
                <article className="plan-history-item" key={entry.planId}>
                  <div>
                    <strong>{plan?.status === "virtuallyApproved" ? "Historisch virtuell bestätigt" : "Historischer Entwurf"}</strong>
                    <span className={`plan-history-status plan-history-${revalidation.kind}`}>{revalidation.label}</span>
                  </div>
                  <p className="muted">
                    Wurzel: {plan?.binding.normalizedRootPath ?? "nicht lesbar"}
                    {entry.modifiedAtMs === null
                      ? ""
                      : ` · Geändert: ${new Date(entry.modifiedAtMs).toLocaleString("de-DE")}`}
                  </p>
                  {revalidation.reasons.length > 0 ? (
                    <p className="muted">{revalidation.reasons.join(" ")}</p>
                  ) : null}
                  <button type="button" onClick={() => setViewedHistoricalPlanId(entry.planId)}>
                    Früheren Plan ansehen
                  </button>
                  {viewedHistoricalPlanId === entry.planId ? (
                    <div className="plan-history-readonly">
                      <p>
                        Nur lesend: Revision {plan?.revision ?? "unbekannt"} · {plan?.items.length ?? 0} beobachtete
                        Objekte · {plan?.decisions.length ?? 0} Entscheidungen
                      </p>
                      <p className="muted">
                        Die ursprüngliche Scanbindung wird nicht auf den aktuellen Scan umgebunden.
                      </p>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </details>
      ) : null}

      {mainView === "review" ? <div className="plan-details">
        <button
          type="button"
          className="plan-details-toggle"
          aria-expanded={detailsOpen}
          onClick={() => {
            setDetailsOpen((open) => !open);
          }}
        >
          {detailsOpen ? "▾" : "▸"} Hinweise und Prüffälle (
          {preview.hints.length + preview.reviewCases.length})
        </button>
        {detailsOpen ? (
          <div className="plan-details-body">
            <section className="plan-hints" aria-label="Strukturhinweise">
              <h3>Strukturhinweise ({preview.hints.length})</h3>
              {preview.hints.length === 0 ? (
                <p className="muted">Keine Strukturhinweise aus den vorhandenen Erkenntnissen.</p>
              ) : (
                <ul className="plan-case-list">
                  {preview.hints.map((hint) => {
                    const location = projectionById.get(hint.locationNodeId);
                    return (
                      <li key={hint.id} className="plan-case-item">
                        <strong>{hint.title}</strong>
                        {location !== undefined ? (
                          <p className="plan-location muted" title={location.relativePath}>
                            Ort: {shortenPath(location.relativePath === "." ? location.displayName : location.relativePath)}
                          </p>
                        ) : null}
                        <p>{hint.rationale}</p>
                        {hint.evidenceBasis.length > 0 ? (
                          <p className="muted">{hint.evidenceBasis}</p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="plan-cases" aria-label="Offene Prüffälle">
              <h3>Offene Prüffälle ({preview.reviewCases.length})</h3>
              {preview.reviewCases.length === 0 ? (
                <p className="muted">
                  Keine objektspezifischen Prüffälle. Allgemeine Einschränkungen stehen oben als
                  Statushinweis.
                </p>
              ) : (
                <ul className="plan-case-list">
                  {preview.reviewCases.map((reviewCase) => {
                    const location =
                      reviewCase.locationNodeId !== undefined
                        ? projectionById.get(reviewCase.locationNodeId)
                        : undefined;
                    const featureLabels = reviewCase.features.map(reviewFeatureLabel);
                    return (
                      <li key={reviewCase.id} className="plan-case-item">
                        <div className="plan-case-heading">
                          <strong>{reviewReasonLabel(reviewCase.reason)}</strong>
                        </div>
                        {location !== undefined ? (
                          <p className="plan-location muted" title={location.relativePath}>
                            Betrifft:{" "}
                            {shortenPath(
                              location.relativePath === "."
                                ? location.displayName
                                : location.relativePath,
                            )}
                          </p>
                        ) : null}
                        <p>{reviewCase.rationale}</p>
                        <p className="muted">Merkmale: {featureLabels.join(" · ")}</p>
                        <details className="plan-tech-details">
                          <summary>Technische Details</summary>
                          <p className="muted">
                            Interne Kennung: {reviewCase.id}
                            {reviewCase.sourceInsightIds.length > 0
                              ? ` · Erkenntnis-IDs: ${reviewCase.sourceInsightIds.join(", ")}`
                              : ""}
                            {reviewCase.features.some(looksLikeTechnicalFeatureKey)
                              ? ` · Rohmerkmale: ${reviewCase.features.join(", ")}`
                              : ""}
                          </p>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </div> : null}
    </section>
  );
}

function ProposalCard({
  proposal,
  usefulness,
  onSelect,
}: {
  proposal: VirtualReorgProposal;
  usefulness: VirtualProposalUsefulnessAssessment | undefined;
  onSelect: (proposal: VirtualReorgProposal) => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(true);
  const c = proposal.completeness;

  return (
    <li className="plan-case-item plan-proposal-item">
      <div className="plan-case-heading">
        <strong>{proposal.title}</strong>
        <span className="plan-proposal-badge">{proposal.categoryLabel}</span>
        <span className="plan-proposal-status">Noch nicht übernommen</span>
      </div>
      <p className="plan-proposal-action muted">{proposal.actionLabel}</p>
      <button
        type="button"
        className="plan-proposal-select"
        onClick={() => {
          onSelect(proposal);
        }}
      >
        Als bearbeitbaren Entwurf auswählen
      </button>
      <p className="plan-location muted" title={proposal.sourceFolderDisplayPath}>
        Ausgangsordner: {shortenPath(proposal.sourceFolderDisplayPath)}
      </p>
      <p className="plan-proposal-counts">
        Bestand: {c.sourceObjectCount} · virtuell anders eingeordnet: {c.regroupedObjectCount} ·
        bleibt unverändert: {c.unchangedObjectCount}
        {c.complete ? "" : " · Vorschau nicht vollständig belegbar"}
      </p>
      {usefulness !== undefined ? (
        <details className="plan-proposal-usefulness">
          <summary>
            Organisatorischer Nutzen:{" "}
            <span className={`plan-usefulness-label plan-usefulness-${usefulness.category}`}>
              {usefulness.categoryLabel}
            </span>
          </summary>
          <p>{usefulness.expectedBenefit}</p>
          {usefulness.expectedDrawbacks.length > 0 ? (
            <>
              <p className="plan-proposal-usefulness-heading">Mögliche Nachteile</p>
              <ul>
                {usefulness.expectedDrawbacks.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="plan-proposal-usefulness-heading">Beobachtete Merkmale</p>
          <ul>
            {usefulness.observedFeatures.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {usefulness.uncertainties.length > 0 ? (
            <>
              <p className="plan-proposal-usefulness-heading">Verbleibende Unsicherheiten</p>
              <ul>
                {usefulness.uncertainties.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}
          {usefulness.overlapsWithProposalIds.length > 0 ? (
            <p className="muted">
              Alternative Vorschläge überlappen; keine automatische Auswahl oder Priorisierung.
            </p>
          ) : null}
          <p className="muted">
            Diese Einschätzung ist keine Freigabe. Die bestehende Struktur kann beibehalten
            werden.
          </p>
        </details>
      ) : null}
      <p>{proposal.rationale}</p>
      {proposal.observedFeatures.length > 0 ? (
        <p className="muted">Erkannt: {proposal.observedFeatures.join(" · ")}</p>
      ) : null}
      <div className="plan-proposal-target" aria-label="Virtuelle Zielstruktur">
        <button
          type="button"
          className="plan-proposal-target-toggle"
          aria-expanded={previewOpen}
          onClick={() => {
            setPreviewOpen((open) => !open);
          }}
        >
          {previewOpen ? "▾" : "▸"} Vollständige Zielvorschau des betroffenen Bereichs
        </button>
        {previewOpen ? (
          <pre className="plan-proposal-preview">{proposal.virtualTarget.lines.join("\n")}</pre>
        ) : null}
      </div>
      {proposal.uncertainties.length > 0 ? (
        <details className="plan-proposal-uncertainties">
          <summary>Unsicherheiten ({proposal.uncertainties.length})</summary>
          <ul>
            {proposal.uncertainties.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {proposal.overlapsWithProposalIds.length > 0 ? (
        <p className="plan-proposal-overlap muted">
          Überlappt mit anderen Vorschlägen — nicht unabhängig kombinierbar.
        </p>
      ) : null}
      <details className="plan-tech-details">
        <summary>Technische Details</summary>
        <p className="muted">
          Vorschlags-ID: {proposal.id} · Aktion: {proposal.actionKind}
          {proposal.sourceInsightIds.length > 0
            ? ` · Erkenntnis-IDs: ${proposal.sourceInsightIds.join(", ")}`
            : ""}
          {proposal.overlapsWithProposalIds.length > 0
            ? ` · Überlappungen: ${proposal.overlapsWithProposalIds.join(", ")}`
            : ""}
        </p>
      </details>
    </li>
  );
}
