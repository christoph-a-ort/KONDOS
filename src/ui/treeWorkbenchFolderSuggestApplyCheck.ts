import { isDirectory, type DirectoryNode, type FileNode, type FsNode } from "../model";
import {
  FOLDER_SUGGEST_ALREADY_HERE,
  FOLDER_SUGGEST_YEAR_UNKNOWN,
  planFolderSuggestions,
} from "./treeWorkbenchFolderSuggest";
import {
  FOLDER_SUGGEST_CREATE_AND_MOVE,
  FOLDER_SUGGEST_MKDIR_FAILED,
  FOLDER_SUGGEST_MOVE,
  FOLDER_SUGGEST_MOVE_AFTER_CREATE_FAILED,
  FOLDER_SUGGEST_PICK_TARGET,
  folderSuggestApplyFromResults,
  folderSuggestCanExecute,
  folderSuggestDestCollision,
  folderSuggestExecutePlan,
  folderSuggestNeedsTargetChoice,
  workbenchMoveRequestForFolderPlan,
} from "./treeWorkbenchFolderSuggestApply";
import type { CreateFolderResult, MoveFileResult } from "./virtualPlanExecutionApi";
import type { DocumentTextView } from "./treeWorkbenchNameSuggest";

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(label);
  }
}

function file(path: string, name: string): FileNode {
  return { id: path, name, path, depth: 1, kind: "file", sizeBytes: 8, modifiedAtMs: 100 };
}

function dir(path: string, name: string, children: FsNode[] = []): DirectoryNode {
  return { id: path, name, path, depth: 0, kind: "directory", listing: "read", children };
}

function view(text: string, name: string): DocumentTextView {
  return {
    scanId: 1,
    path: `C:/Dotty-Test/Strom+Gas/${name}`,
    name,
    format: "pdf",
    status: "searchable",
    text,
    source: "cache",
  };
}

function praxisTree(): DirectoryNode {
  const hamm = "C:/Dotty-Test/Strom+Gas/SW Hamm_Strom";
  return dir("C:/Dotty-Test/Strom+Gas", "Strom+Gas", [
    dir(hamm, "SW Hamm_Strom", [
      dir(`${hamm}/2020`, "2020", [file(`${hamm}/2020/2020.pdf`, "2020.pdf")]),
      dir(`${hamm}/2021`, "2021", [file(`${hamm}/2021/2021.pdf`, "2021.pdf")]),
      file(`${hamm}/2022-07-14_Verbrauchsabrechnung.pdf`, "2022-07-14_Verbrauchsabrechnung.pdf"),
    ]),
    dir("C:/Dotty-Test/Strom+Gas/Vattenfall_Strom", "Vattenfall_Strom", [
      dir("C:/Dotty-Test/Strom+Gas/Vattenfall_Strom/2020", "2020"),
      dir("C:/Dotty-Test/Strom+Gas/Vattenfall_Strom/2021", "2021"),
    ]),
  ]);
}

function findFile(node: FsNode, path: string): FileNode {
  if (!isDirectory(node)) {
    if (node.path === path && node.kind === "file") {
      return node;
    }
    throw new Error(`missing file ${path}`);
  }
  for (const child of node.children) {
    try {
      return findFile(child, path);
    } catch {
      /* continue */
    }
  }
  throw new Error(`missing file ${path}`);
}

function dated(name: string): DocumentTextView {
  return view("Stadtwerke Hamm\nRechnungsdatum: 14.07.2022\nStromrechnung\nVerbrauchsabrechnung", name);
}

function mkdirResult(outcome: CreateFolderResult["outcome"], created: boolean, message: string): CreateFolderResult {
  return {
    outcome,
    targetPath: "C:/Dotty-Test/Strom+Gas/SW Hamm_Strom/2022",
    message,
    created,
    halted: outcome === "created" || outcome === "exists" ? false : true,
    bindingStatus: "",
    journalJson: null,
    reminder: "r",
  };
}

function moveResult(outcome: MoveFileResult["outcome"], moved: boolean, message: string): MoveFileResult {
  return {
    outcome,
    sourcePath: "C:/Dotty-Test/Strom+Gas/SW Hamm_Strom/2022-07-14_Verbrauchsabrechnung.pdf",
    targetPath: "C:/Dotty-Test/Strom+Gas/SW Hamm_Strom/2022/2022-07-14_Verbrauchsabrechnung.pdf",
    message,
    moved,
    halted: !moved,
    bindingStatus: "",
    journalJson: null,
    reminder: "r",
  };
}

export function runTreeWorkbenchFolderSuggestApplyCheck(): void {
  const root = praxisTree();
  const hamm = "C:/Dotty-Test/Strom+Gas/SW Hamm_Strom";
  const source = findFile(root, `${hamm}/2022-07-14_Verbrauchsabrechnung.pdf`);
  const hammDir = root.children.find((child) => isDirectory(child) && child.path === hamm);
  assert(hammDir !== undefined && isDirectory(hammDir), "vendor folder");

  const created = planFolderSuggestions({
    scanRoot: hammDir!.path,
    root: hammDir as DirectoryNode,
    source,
    view: dated(source.name),
  });
  assert(created.status === "newFolder", "A: missing 2022 is a new-folder suggestion");
  const createPlan = folderSuggestExecutePlan({
    outcome: created,
    source,
    scanRoot: hammDir!.path,
    selectedFolderPath: null,
  });
  assert(createPlan.ok, "A: a new folder can be executed");
  if (createPlan.ok) {
    assert(createPlan.plan.kind === "createAndMove", "A: kind is create and move");
    assert(createPlan.plan.label === FOLDER_SUGGEST_CREATE_AND_MOVE, "A: button label");
    assert(createPlan.plan.folderPath === `${hamm}/2022`, "A: folder path is SW Hamm_Strom\\2022");
    assert(
      createPlan.plan.fileTargetPath === `${hamm}/2022/2022-07-14_Verbrauchsabrechnung.pdf`,
      "A: the file name stays unchanged",
    );
    assert(createPlan.plan.createFolder, "A: mkdir is required");
    const request = workbenchMoveRequestForFolderPlan(hammDir!.path, source, createPlan.plan);
    assert(request.fileName === source.name, "A: MOVE keeps the original file name");
    const applied = folderSuggestApplyFromResults(
      mkdirResult("created", true, "ok"),
      moveResult("moved", true, "ok"),
      createPlan.plan,
      source.name,
    );
    assert(applied.ok && applied.moved && applied.created, "A: successful mkdir+MOVE is reported");
  }

  const with2022 = praxisTree();
  const hammWith = with2022.children.find((child) => isDirectory(child) && child.path === hamm);
  assert(hammWith !== undefined && isDirectory(hammWith), "B fixture");
  (hammWith as DirectoryNode).children.push(dir(`${hamm}/2022`, "2022"));
  const existing = planFolderSuggestions({
    scanRoot: (hammWith as DirectoryNode).path,
    root: hammWith as DirectoryNode,
    source: findFile(with2022, source.path),
    view: dated(source.name),
  });
  assert(existing.status === "suggestions", "B: existing 2022 is recommended");
  const movePlan = folderSuggestExecutePlan({
    outcome: existing,
    source: findFile(with2022, source.path),
    scanRoot: (hammWith as DirectoryNode).path,
    selectedFolderPath: `${hamm}/2022`,
  });
  assert(movePlan.ok && movePlan.plan.kind === "move", "B: an existing folder uses MOVE only");
  assert(movePlan.ok && movePlan.plan.label === FOLDER_SUGGEST_MOVE, "B: button is Datei verschieben");
  assert(movePlan.ok && !movePlan.plan.createFolder, "B: no mkdir");

  const placedTree = praxisTree();
  const hammPlaced = placedTree.children.find((child) => isDirectory(child) && child.path === hamm);
  (hammPlaced as DirectoryNode).children.push(
    dir(`${hamm}/2022`, "2022", [file(`${hamm}/2022/2022-07-14_Verbrauchsabrechnung.pdf`, "2022-07-14_Verbrauchsabrechnung.pdf")]),
  );
  const alreadySource = findFile(placedTree, `${hamm}/2022/2022-07-14_Verbrauchsabrechnung.pdf`);
  const already = planFolderSuggestions({
    scanRoot: (hammPlaced as DirectoryNode).path,
    root: hammPlaced as DirectoryNode,
    source: alreadySource,
    view: dated(alreadySource.name),
  });
  assert(already.status === "alreadyHere", "C: already filed");
  assert(already.reason === FOLDER_SUGGEST_ALREADY_HERE, "C: already-here sentence");
  const noAction = folderSuggestExecutePlan({
    outcome: already,
    source: alreadySource,
    scanRoot: (hammPlaced as DirectoryNode).path,
    selectedFolderPath: null,
  });
  assert(!noAction.ok && noAction.reason === null, "C: no execute action when already here");
  assert(!folderSuggestCanExecute(already), "C: execute is disabled");

  const unknown = planFolderSuggestions({
    scanRoot: hammDir!.path,
    root: hammDir as DirectoryNode,
    source,
    view: view("Stadtwerke Hamm\nStromrechnung", source.name),
  });
  assert(unknown.status === "yearUnknown", "D: unconfirmed year");
  const blockedYear = folderSuggestExecutePlan({
    outcome: unknown,
    source,
    scanRoot: hammDir!.path,
    selectedFolderPath: null,
  });
  assert(!blockedYear.ok && blockedYear.reason === FOLDER_SUGGEST_YEAR_UNKNOWN, "D: no year execute without confirmation");

  assert(existing.status === "suggestions", "E fixture is suggestions");
  const multi = {
    status: "suggestions" as const,
    reason: null,
    cues: existing.cues,
    suggestions: [
      { path: `${hamm}/2022`, name: "2022", score: 80, alreadyHere: false, summary: "a", reasons: ["a"] },
      { path: `${hamm}/2021`, name: "2021", score: 50, alreadyHere: false, summary: "b", reasons: ["b"] },
    ],
  };
  assert(folderSuggestNeedsTargetChoice(multi), "E: several targets require a choice");
  const unset = folderSuggestExecutePlan({
    outcome: multi,
    source: findFile(with2022, source.path),
    scanRoot: (hammWith as DirectoryNode).path,
    selectedFolderPath: null,
  });
  assert(!unset.ok && unset.reason === FOLDER_SUGGEST_PICK_TARGET, "E: no execute until a folder is chosen");
  const chosen = folderSuggestExecutePlan({
    outcome: multi,
    source: findFile(with2022, source.path),
    scanRoot: (hammWith as DirectoryNode).path,
    selectedFolderPath: `${hamm}/2022`,
  });
  assert(chosen.ok && chosen.plan.folderPath === `${hamm}/2022`, "E: the chosen folder is used");

  const collisionTree = praxisTree();
  const hammCol = collisionTree.children.find((child) => isDirectory(child) && child.path === hamm);
  (hammCol as DirectoryNode).children.push(
    dir(`${hamm}/2022`, "2022", [file(`${hamm}/2022/2022-07-14_Verbrauchsabrechnung.pdf`, "2022-07-14_Verbrauchsabrechnung.pdf")]),
  );
  assert(
    folderSuggestDestCollision(collisionTree, `${hamm}/2022/2022-07-14_Verbrauchsabrechnung.pdf`),
    "F: a file with the same name in the target is detected",
  );
  assert(!folderSuggestDestCollision(collisionTree, `${hamm}/2022/other.pdf`), "F: a free name is not a collision");

  assert(createPlan.ok, "G/H/I require the create-and-move plan");
  if (createPlan.ok) {
    const mkdirFail = folderSuggestApplyFromResults(
      mkdirResult("failed", false, "Die Ordneranlage ist fehlgeschlagen."),
      null,
      createPlan.plan,
      source.name,
    );
    assert(!mkdirFail.ok && !mkdirFail.created, "G: mkdir failure does not MOVE");
    assert(!mkdirFail.ok && mkdirFail.reason.includes(FOLDER_SUGGEST_MKDIR_FAILED), "G: mkdir failure message");

    const partial = folderSuggestApplyFromResults(
      mkdirResult("created", true, "ok"),
      moveResult("blocked", false, "Das Ziel ist bereits belegt. Vorhandene Dateien werden nicht überschrieben."),
      createPlan.plan,
      source.name,
    );
    assert(!partial.ok && partial.created && !partial.moved, "H: mkdir success and MOVE failure is a partial state");
    assert(!partial.ok && partial.reason.includes(FOLDER_SUGGEST_MOVE_AFTER_CREATE_FAILED), "H: the partial message is shown");
    const existsThenMove = folderSuggestApplyFromResults(
      mkdirResult("exists", false, "Der Zielordner existiert bereits."),
      moveResult("moved", true, "ok"),
      createPlan.plan,
      source.name,
    );
    assert(existsThenMove.ok && !existsThenMove.created && existsThenMove.moved, "I: an already created folder is reused for MOVE");
  }

  assert(created.status === "newFolder", "J fixture is a new-folder suggestion");
  const invalid = folderSuggestExecutePlan({
    outcome: {
      status: "newFolder",
      reason: created.status === "newFolder" ? created.reason : FOLDER_SUGGEST_CREATE_AND_MOVE,
      cues: created.cues,
      suggestions: created.suggestions,
      newFolder: {
        parentPath: hamm,
        parentName: "SW Hamm_Strom",
        folderName: "CON",
        path: `${hamm}/CON`,
        pattern: "year",
        reasons: ["x"],
        summary: "x",
      },
    },
    source,
    scanRoot: hammDir!.path,
    selectedFolderPath: null,
  });
  assert(!invalid.ok, "J: reserved folder names are rejected before execution");

  assert(folderSuggestCanExecute(created), "execute stays available while the dialog waits");
  assert(FOLDER_SUGGEST_MOVE === "Datei verschieben", "move label");
  assert(FOLDER_SUGGEST_CREATE_AND_MOVE === "Ordner anlegen und Datei verschieben", "create-and-move label");
}
