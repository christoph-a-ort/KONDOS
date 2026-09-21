import { useState, type ReactNode } from "react";
import type { InventoryAnalysis } from "./inventoryAnalysis";
import type { InventoryStructureContext } from "./inventoryStructureContext";
import {
  DEFAULT_SECTION_OPEN,
  FILE_TYPE_TOTAL_LABEL,
  SECTION_BUSY_FOLDERS,
  SECTION_EMPTY_FOLDERS,
  SECTION_FILE_TYPES,
  SECTION_REPEATED_FILES,
  SECTION_REPEATED_FOLDERS,
  SECTION_SINGLE_FILE_FOLDERS,
  SECTION_YEAR_STRUCTURES,
  YEAR_FOLDERS_PRESENT_LABEL,
  YEAR_MISSING_LABEL,
  YEAR_RUNS_LABEL,
  YEAR_SPAN_LABEL,
  buildInventoryOverviewView,
  sectionSummary,
  type InventoryOverviewRow,
  type InventoryOverviewYearGroup,
} from "./inventoryOverview";

interface InventoryOverviewPanelProps {
  analysis: InventoryAnalysis | null;
  structure?: InventoryStructureContext | null;
  rootPath?: string | null;
}

export function InventoryOverviewPanel({
  analysis,
  structure = null,
  rootPath = null,
}: InventoryOverviewPanelProps) {
  const view = buildInventoryOverviewView(analysis, rootPath ?? "", structure);

  return (
    <details
      className="inventory-overview"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <summary>{view.title}</summary>
      {view.available ? (
        <div className="inventory-overview-body">
          <dl className="inventory-overview-stats">
            <dt>Ordner</dt>
            <dd>{view.directoryCountLabel}</dd>
            <dt>davon Unterordner</dt>
            <dd>{view.subdirectoryCountLabel}</dd>
            <dt>Dateien</dt>
            <dd>{view.fileCountLabel}</dd>
            <dt>Bekannte Gesamtgröße</dt>
            <dd>{view.knownSizeLabel}</dd>
            <dt>Dateien ohne bekannte Größe</dt>
            <dd>{view.filesWithoutKnownSizeLabel}</dd>
            <dt>Größte vorkommende Tiefe</dt>
            <dd>{view.maxObservedDepthLabel}</dd>
          </dl>
          {view.depthLimitedNote !== null ? (
            <p className="muted inventory-overview-note">{view.depthLimitedNote}</p>
          ) : null}

          <OverviewSection
            title={sectionSummary(SECTION_FILE_TYPES, view.fileTypeCount)}
            defaultOpen={DEFAULT_SECTION_OPEN.fileTypes}
          >
            {view.fileTypesEmpty !== null ? (
              <p className="muted">{view.fileTypesEmpty}</p>
            ) : (
              <div className="inventory-overview-scroll">
                <table className="inventory-overview-table">
                  <thead>
                    <tr>
                      <th>Dateityp</th>
                      <th>Dateien</th>
                      <th>Bekannte Größe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.fileTypes.map((row) => (
                      <tr key={row.label}>
                        <td>{row.label}</td>
                        <td>{row.fileCountLabel}</td>
                        <td>{row.knownSizeLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>{FILE_TYPE_TOTAL_LABEL}</th>
                      <td>{view.fileTypeTotalCountLabel}</td>
                      <td>{view.fileTypeTotalSizeLabel}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </OverviewSection>

          <OverviewSection
            title={sectionSummary(SECTION_BUSY_FOLDERS, view.busyFolderCount)}
            defaultOpen={DEFAULT_SECTION_OPEN.busyFolders}
          >
            <OverviewList rows={view.busyFolders} empty={view.busyFoldersEmpty} showCount />
          </OverviewSection>

          <OverviewSection
            title={sectionSummary(SECTION_EMPTY_FOLDERS, view.emptyFolderCount)}
            defaultOpen={DEFAULT_SECTION_OPEN.emptyFolders}
          >
            <OverviewList rows={view.emptyFolders} empty={view.emptyFoldersEmpty} />
          </OverviewSection>

          {view.unconfirmedCount > 0 ? (
            <OverviewSection
              title={sectionSummary(view.unconfirmedTitle, view.unconfirmedCount)}
              defaultOpen={DEFAULT_SECTION_OPEN.unconfirmed}
            >
              <p className="muted">{view.unconfirmedHint}</p>
              <OverviewList rows={view.unconfirmedFolders} empty={null} />
            </OverviewSection>
          ) : null}

          <OverviewSection
            title={sectionSummary(SECTION_SINGLE_FILE_FOLDERS, view.singleFileCount)}
            defaultOpen={DEFAULT_SECTION_OPEN.singleFile}
          >
            {view.singleFileEmpty !== null ? (
              <p className="muted">{view.singleFileEmpty}</p>
            ) : (
              <OverviewList rows={view.singleFileFolders} empty={null} />
            )}
          </OverviewSection>

          <OverviewSection
            title={sectionSummary(SECTION_REPEATED_FOLDERS, view.repeatedFolderCount)}
            defaultOpen={DEFAULT_SECTION_OPEN.repeatedFolders}
          >
            {view.repeatedFoldersEmpty !== null ? (
              <p className="muted">{view.repeatedFoldersEmpty}</p>
            ) : (
              <div className="inventory-overview-groups">
                {view.repeatedFolders.map((group) => (
                  <details key={group.name} className="inventory-overview-nested">
                    <summary>{group.summary}</summary>
                    <ul className="inventory-overview-paths">
                      {group.paths.map((path, index) => (
                        <li key={path} title={group.pathLabels[index]}>
                          {group.pathLabels[index]}
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            )}
          </OverviewSection>

          <OverviewSection
            title={sectionSummary(SECTION_REPEATED_FILES, view.repeatedFileCount)}
            defaultOpen={DEFAULT_SECTION_OPEN.repeatedFiles}
          >
            <p className="muted">{view.repeatedFilesHint}</p>
            {view.repeatedFilesEmpty !== null ? (
              <p className="muted">{view.repeatedFilesEmpty}</p>
            ) : (
              <div className="inventory-overview-groups">
                {view.repeatedFiles.map((group) => (
                  <details key={group.name} className="inventory-overview-nested">
                    <summary>{group.summary}</summary>
                    <ul className="inventory-overview-paths">
                      {group.paths.map((path, index) => (
                        <li key={path} title={group.pathLabels[index]}>
                          {group.pathLabels[index]}
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            )}
          </OverviewSection>

          <OverviewSection
            title={sectionSummary(SECTION_YEAR_STRUCTURES, view.yearGroupCount)}
            defaultOpen={DEFAULT_SECTION_OPEN.yearStructures}
          >
            {view.yearGroupsEmpty !== null ? (
              <p className="muted">{view.yearGroupsEmpty}</p>
            ) : (
              <ul className="inventory-overview-year-groups">
                {view.yearGroups.map((group) => (
                  <YearGroupCard key={group.parentPath} group={group} />
                ))}
              </ul>
            )}
          </OverviewSection>
        </div>
      ) : (
        <p className="muted inventory-overview-empty">{view.noScanMessage}</p>
      )}
    </details>
  );
}

function OverviewSection({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="inventory-overview-section"
      open={open}
      data-default-open={defaultOpen ? "true" : "false"}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{title}</summary>
      <div className="inventory-overview-section-body">{children}</div>
    </details>
  );
}

function YearGroupCard({ group }: { group: InventoryOverviewYearGroup }) {
  return (
    <li className="inventory-overview-year-group">
      <span className="inventory-overview-name">{group.parentName}</span>
      <span className="inventory-overview-path" title={group.parentPathLabel}>
        {group.parentPathLabel}
      </span>
      <dl className="inventory-overview-year-facts">
        <dt>{YEAR_FOLDERS_PRESENT_LABEL}</dt>
        <dd>{group.yearsLabel}</dd>
        <dt>{YEAR_SPAN_LABEL}</dt>
        <dd>{group.spanLabel}</dd>
        {group.missingYearsLabel !== null ? (
          <>
            <dt>{YEAR_MISSING_LABEL}</dt>
            <dd>{group.missingYearsLabel}</dd>
          </>
        ) : null}
        {group.consecutiveRunsLabel !== null ? (
          <>
            <dt>{YEAR_RUNS_LABEL}</dt>
            <dd>{group.consecutiveRunsLabel}</dd>
          </>
        ) : null}
      </dl>
    </li>
  );
}

function OverviewList({
  rows,
  empty,
  showCount = false,
}: {
  rows: InventoryOverviewRow[];
  empty: string | null;
  showCount?: boolean;
}) {
  if (empty !== null) {
    return <p className="muted">{empty}</p>;
  }
  return (
    <ul className="inventory-overview-list">
      {rows.map((row) => (
        <li key={row.path}>
          <span className="inventory-overview-name">
            {row.name}
            {showCount ? <span className="inventory-overview-count">{row.countLabel}</span> : null}
          </span>
          <span className="inventory-overview-path" title={row.pathLabel}>
            {row.pathLabel}
          </span>
        </li>
      ))}
    </ul>
  );
}
