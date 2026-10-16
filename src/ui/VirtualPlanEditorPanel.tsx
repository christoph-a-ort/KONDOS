/**
 * P2-K.4b/c compact virtual-plan editor. Presentation + explicit user actions only.
 */

import { useState } from "react";
import type { VirtualPlan } from "./virtualPlan";
import type { VirtualPlanApprovalAssessment } from "./virtualPlanApproval";
import {
  assignFileToVirtualFolder,
  excludeFileFromVirtualPlan,
  listVirtualPlanFolders,
  projectVirtualPlan,
  renameVirtualPlanFolder,
  resetVirtualPlanToSelection,
  undoLastVirtualPlanEdit,
  type VirtualPlanEditResult,
} from "./virtualPlanEditor";

export interface VirtualPlanEditorPanelProps {
  plan: VirtualPlan | null;
  saving: boolean;
  saveMessage: string | null;
  proposalTitle: string;
  usefulnessLabel: string | null;
  approval: VirtualPlanApprovalAssessment | null;
  onPlanChange: (plan: VirtualPlan) => void;
  onSave: () => void;
  onApprove: () => void;
}

export function VirtualPlanEditorPanel({
  plan,
  saving,
  saveMessage,
  proposalTitle,
  usefulnessLabel,
  approval,
  onPlanChange,
  onSave,
  onApprove,
}: VirtualPlanEditorPanelProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [renameValues, setRenameValues] = useState<Record<string, string>>({});
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [fullPlanOpen, setFullPlanOpen] = useState(false);

  if (plan === null) {
    return null;
  }

  const folders = listVirtualPlanFolders(plan);
  const editableFiles = plan.items.filter((item) => item.observed.kind === "file");
  const rows = projectVirtualPlan(plan);
  const isApproved = plan.status === "virtuallyApproved";

  const apply = (result: VirtualPlanEditResult, successMessage: string) => {
    if (isApproved) {
      setNotice("Ein virtuell bestätigter Plan ist nicht stillschweigend bearbeitbar.");
      return;
    }
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    onPlanChange(result.plan);
    // Values typed into folder-name inputs are only a local edit buffer.  Once
    // the plan changes (including Undo), render the canonical folder names.
    setRenameValues({});
    setEditingFolderId(null);
    setNotice(successMessage);
  };

  return (
    <section className="plan-editor" aria-label="Bearbeitbarer virtueller Entwurf">
      <div className="plan-editor-heading">
        <div>
          <h3>Bearbeitbarer virtueller Entwurf</h3>
          <p className="plan-editor-summary">
            {proposalTitle} · {editableFiles.length} Dateien · {folders.length} virtuelle Zielordner
            {usefulnessLabel !== null ? ` · Nutzen: ${usefulnessLabel}` : ""}
          </p>
          <p className="muted">
            Ausschließlich virtuell. Änderungen lösen keine Dateioperation aus und benötigen vor
            dem Speichern eine ausdrückliche Aktion.
          </p>
        </div>
        <span className="plan-proposal-status">
          {isApproved ? "Virtuell bestätigt" : "Entwurf"}, Revision {plan.revision}
        </span>
      </div>

      {approval !== null ? (
        <div className={`plan-approval-summary ${isApproved || approval.eligible ? "is-eligible" : "is-blocked"}`}>
          <strong>
            {isApproved
              ? "Virtuell bestätigt"
              : approval.eligible
                ? "Freigabefähig"
                : "Virtuelle Bestätigung gesperrt"}
          </strong>
          <span>
            {approval.projectedObjectCount}/{approval.observedObjectCount} beobachtete Objekte im SOLL
            {approval.openCaseCount > 0 ? ` · ${approval.openCaseCount} offene Prüffälle` : ""}
          </span>
          {!isApproved && approval.blockers.length > 0 ? (
            <ul>
              {approval.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          ) : null}
          {!isApproved ? (
            <span className="muted">
              Eine Bestätigung ändert ausschließlich den virtuellen Planstatus. Sie führt keine
              Datei- oder Ordneroperation aus.
            </span>
          ) : null}
        </div>
      ) : null}

      {folders.length === 0 ? (
        <p className="muted">Der geladene Entwurf enthält keine bearbeitbaren virtuellen Zielordner.</p>
      ) : (
        <details className="plan-editor-section plan-editor-target-folders" open>
          <summary>Virtuelle Zielordner ({folders.length})</summary>
          <div className="plan-editor-folder-list">
            {folders.map((folder) => (
              <div className="plan-editor-folder" key={folder.id}>
                {editingFolderId === folder.id ? (
                  <>
                    <input
                      aria-label={`Virtuellen Zielordner ${folder.name} umbenennen`}
                      autoFocus
                      value={renameValues[folder.id] ?? folder.name}
                      onChange={(event) => {
                        setRenameValues((current) => ({
                          ...current,
                          [folder.id]: event.target.value,
                        }));
                      }}
                    />
                    <div className="plan-editor-folder-actions">
                      <button
                        type="button"
                        onClick={() => {
                          apply(
                            renameVirtualPlanFolder(
                              plan,
                              folder.id,
                              renameValues[folder.id] ?? folder.name,
                            ),
                            "Virtueller Zielordner umbenannt.",
                          );
                        }}
                      >
                        Übernehmen
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRenameValues((current) => {
                            const next = { ...current };
                            delete next[folder.id];
                            return next;
                          });
                          setEditingFolderId(null);
                        }}
                      >
                        Abbrechen
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="plan-editor-folder-name" title={folder.name}>
                      {folder.name}
                    </span>
                    <button
                      type="button"
                      disabled={isApproved}
                      onClick={() => setEditingFolderId(folder.id)}
                    >
                      Umbenennen
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      <details className="plan-editor-section plan-editor-file-section" open>
        <summary>Datei-Zuordnung ({editableFiles.length})</summary>
        <div className="plan-editor-file-list">
          <div className="plan-editor-file-header" aria-hidden="true">
            <span>Dateiname</span>
            <span>Virtueller Zielordner</span>
          </div>
          {editableFiles.map((item) => (
            <div className="plan-editor-file" key={item.id}>
              <span title={item.observed.relativePath}>{item.observed.relativePath}</span>
              <select
                disabled={isApproved}
                value={
                  folders.find(
                    (folder) =>
                      `${folder.parentVirtualPath === "." ? "" : `${folder.parentVirtualPath}/`}${folder.name}` ===
                      item.virtualTargetPath,
                  )?.id ?? "unchanged"
                }
                onChange={(event) => {
                  if (event.target.value === "unchanged") {
                    apply(excludeFileFromVirtualPlan(plan, item.id), "Datei bleibt virtuell unverändert.");
                  } else {
                    apply(
                      assignFileToVirtualFolder(plan, item.id, event.target.value),
                      "Virtuelle Datei-Zuordnung geändert.",
                    );
                  }
                }}
              >
                <option value="unchanged">Bleibt unverändert</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </details>

      <div className="plan-editor-actions">
        <div className="plan-editor-secondary-actions">
          <button
            type="button"
            onClick={() => {
              apply(undoLastVirtualPlanEdit(plan), "Letzte virtuelle Bearbeitung rückgängig gemacht.");
            }}
            disabled={isApproved || plan.decisions.length === 0}
          >
            Rückgängig
          </button>
          <button
            type="button"
            onClick={() => {
              if (isApproved) {
                setNotice("Ein virtuell bestätigter Plan ist nicht stillschweigend bearbeitbar.");
                return;
              }
              apply(
                resetVirtualPlanToSelection(plan),
                "Lokale Bearbeitungen auf den ausgewählten Vorschlag zurückgesetzt.",
              );
            }}
          >
            Zurücksetzen
          </button>
        </div>
        <div className="plan-editor-primary-actions">
          {!isApproved && approval !== null && !approval.eligible ? (
            <span className="plan-editor-approval-blockers" role="status">
              {approval.blockers.join(" · ")}
            </span>
          ) : null}
          <button type="button" onClick={onSave} disabled={saving || isApproved}>
            {saving ? "Speichert …" : "Entwurf speichern"}
          </button>
          <button
            type="button"
            className="plan-editor-approve"
            onClick={onApprove}
            disabled={saving || isApproved || approval === null || !approval.eligible}
          >
            Virtuellen Plan bestätigen
          </button>
        </div>
      </div>
      {notice !== null ? <p className="plan-editor-notice muted">{notice}</p> : null}
      {saveMessage !== null ? <p className="plan-editor-notice" role="status">{saveMessage}</p> : null}

      <details
        className="plan-editor-projection"
        open={fullPlanOpen}
        onToggle={(event) => {
          setFullPlanOpen((event.currentTarget as HTMLDetailsElement).open);
        }}
      >
        <summary>Vollständiger virtueller SOLL-Zustand ({rows.length} beobachtete Objekte)</summary>
        <div className="plan-editor-projection-list">
          {rows.map((row) => (
            <div key={row.itemId} className="plan-editor-projection-row">
              <span>{row.sourceRelativePath}</span>
              <span aria-hidden="true">→</span>
              <span>{row.virtualPath}</span>
              <span className="muted">{row.status === "excluded" ? "unverändert" : row.status}</span>
            </div>
          ))}
        </div>
      </details>
      <p className="muted">
        Keine Freigabe und keine Ausführung in dieser Stufe. Die bestehende Struktur bleibt eine
        gültige Alternative.
      </p>
    </section>
  );
}
