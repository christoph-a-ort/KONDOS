import { useState } from "react";
import type { ScanResult } from "../model";
import type { SnapshotBinding, VirtualPlan } from "./virtualPlan";
import { buildVirtualPlanDryRun, type VirtualDryRunReport } from "./virtualPlanDryRun";

function operationLabel(kind: VirtualDryRunReport["operations"][number]["kind"]): string {
  if (kind === "createVirtualFolder") return "Zielordner anlegen";
  if (kind === "moveFile") return "Datei verschieben";
  return "Datei umbenennen";
}

export function VirtualPlanDryRunPanel({ plan, scanResult, binding, current }: { plan: VirtualPlan | null; scanResult: ScanResult; binding: SnapshotBinding; current: boolean }) {
  const [report, setReport] = useState<VirtualDryRunReport | null>(null);
  const available = plan?.status === "virtuallyApproved" && current;
  return <details className="plan-dry-run">
    <summary>Ausführung simulieren (Dry-Run)</summary>
    <p className="muted">Dies ist ausschließlich eine Simulation. Es werden keine Dateien oder Ordner verändert.</p>
    <button type="button" disabled={!available} onClick={() => plan !== null && setReport(buildVirtualPlanDryRun({ plan, scanResult, binding, current }))}>Dry-Run prüfen</button>
    {!available ? <p className="muted">Nur ein aktueller virtuell bestätigter Plan kann simuliert werden.</p> : null}
    {report !== null ? <div className={`plan-dry-run-report is-${report.status}`}>
      <strong>{report.status === "blocked" ? "Blockiert" : "Eingeschränkt – nur statisch geprüft"}</strong>
      <p>{report.folderCount} virtuelle Zielordner · {report.fileOperationCount} Dateioperationen · {report.unchangedFileCount} unveränderte Dateien · {report.blockedOperationCount} Blockierungen</p>
      <p className="muted">Vor Ausführung erneut prüfen: Die tatsächlichen Datei- und Ordnerzustände müssen unmittelbar vor einer späteren Ausführung erneut überprüft werden.</p>
      {report.openRequirements.map((item) => <p className="muted" key={item}>{item}</p>)}
      {report.warnings.map((item) => <p className="muted" key={item}>{item}</p>)}
      <details><summary>Virtuelle Operationsliste ({report.operations.length})</summary>
        <div className="plan-dry-run-operations">
          {report.operations.map((operation, index) => operation.kind === "createVirtualFolder"
            ? <div className="plan-dry-run-operation" key={operation.id}>
              <strong>[{index + 1}] Zielordner anlegen</strong>
              <span className="plan-dry-run-path" title={operation.targetPath}>{operation.targetPath}</span>
              <span className="muted">Vor Ausführung erneut prüfen</span>
            </div>
            : <div className="plan-dry-run-operation" key={operation.id}>
              <strong>[{index + 1}] {operationLabel(operation.kind)}</strong>
              <span className="plan-dry-run-path" title={operation.sourcePath}>Von: {operation.sourcePath}</span>
              <span className="plan-dry-run-path" title={operation.targetPath}>Nach: {operation.targetPath}</span>
              <span className="muted">Vor Ausführung erneut prüfen</span>
            </div>)}
        </div>
      </details>
    </div> : null}
  </details>;
}
