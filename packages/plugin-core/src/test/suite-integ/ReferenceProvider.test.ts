import { NotePropsV2, NoteUtilsV2 } from "@dendronhq/common-all";
import { NOTE_PRESETS_V4 } from "@dendronhq/common-test-utils";
import { afterEach, beforeEach } from "mocha";
import * as vscode from "vscode";
import ReferenceProvider from "../../features/ReferenceProvider";
import { HistoryService } from "../../services/HistoryService";
import { VSCodeUtils } from "../../utils";
import { DendronWorkspace } from "../../workspace";
import { TIMEOUT } from "../testUtils";
import { expect } from "../testUtilsv2";
import { runLegacyMultiWorkspaceTest } from "../testUtilsV3";

async function provide(editor: vscode.TextEditor) {
  const doc = editor?.document as vscode.TextDocument;
  const referenceProvider = new ReferenceProvider();
  const links = await referenceProvider.provideReferences(
    doc,
    new vscode.Position(7, 2)
  );
  return links;
}

suite("DocumentLinkProvider", function () {
  let ctx: vscode.ExtensionContext;
  this.timeout(TIMEOUT);

  beforeEach(function () {
    ctx = VSCodeUtils.getOrCreateMockContext();
    DendronWorkspace.getOrCreate(ctx);
  });

  afterEach(function () {
    HistoryService.instance().clearSubscriptions();
  });

  test("basic", (done) => {
    let noteWithTarget1: NotePropsV2;
    let noteWithTarget2: NotePropsV2;
    runLegacyMultiWorkspaceTest({
      ctx,
      preSetupHook: async ({ wsRoot, vaults }) => {
        noteWithTarget1 = await NOTE_PRESETS_V4.NOTE_WITH_TARGET.create({
          fname: "alpha",
          vault: vaults[0],
          wsRoot,
        });
        noteWithTarget2 = await NOTE_PRESETS_V4.NOTE_WITH_TARGET.create({
          fname: "beta",
          vault: vaults[0],
          wsRoot,
        });
      },
      onInit: async ({}) => {
        const editor = await VSCodeUtils.openNote(noteWithTarget1);
        const links = await provide(editor);
        expect(links.map((l) => l.uri.fsPath)).toEqual(
          [noteWithTarget1, noteWithTarget2].map((note) =>
            NoteUtilsV2.getPathV4({ note, wsRoot: DendronWorkspace.wsRoot() })
          )
        );
        done();
      },
    });
  });

  test("with multiple vaults", (done) => {
    let noteWithTarget1: NotePropsV2;
    let noteWithTarget2: NotePropsV2;
    runLegacyMultiWorkspaceTest({
      ctx,
      preSetupHook: async ({ wsRoot, vaults }) => {
        noteWithTarget1 = await NOTE_PRESETS_V4.NOTE_WITH_TARGET.create({
          fname: "alpha",
          vault: vaults[0],
          wsRoot,
        });
        noteWithTarget2 = await NOTE_PRESETS_V4.NOTE_WITH_TARGET.create({
          fname: "beta",
          vault: vaults[1],
          wsRoot,
        });
      },
      onInit: async ({}) => {
        const editor = await VSCodeUtils.openNote(noteWithTarget1);
        const links = await provide(editor);
        expect(links.map((l) => l.uri.fsPath)).toEqual(
          [noteWithTarget1, noteWithTarget2].map((note) =>
            NoteUtilsV2.getPathV4({ note, wsRoot: DendronWorkspace.wsRoot() })
          )
        );
        done();
      },
    });
  });

  test("with anchor", (done) => {
    let noteWithLink: NotePropsV2;

    runLegacyMultiWorkspaceTest({
      ctx,
      preSetupHook: async ({ wsRoot, vaults }) => {
        await NOTE_PRESETS_V4.NOTE_WITH_ANCHOR_TARGET.create({
          vault: vaults[0],
          wsRoot,
        });
        noteWithLink = await NOTE_PRESETS_V4.NOTE_WITH_ANCHOR_LINK.create({
          vault: vaults[0],
          wsRoot,
        });
      },
      onInit: async ({}) => {
        const editor = await VSCodeUtils.openNote(noteWithLink);
        const links = await provide(editor);
        expect(links.map((l) => l.uri.fsPath)).toEqual(
          [noteWithLink].map((note) =>
            NoteUtilsV2.getPathV4({ note, wsRoot: DendronWorkspace.wsRoot() })
          )
        );
        done();
      },
    });
  });

  test("with alias", (done) => {
    let noteWithLink: NotePropsV2;

    runLegacyMultiWorkspaceTest({
      ctx,
      preSetupHook: async ({ wsRoot, vaults }) => {
        await NOTE_PRESETS_V4.NOTE_WITH_TARGET.create({
          vault: vaults[0],
          wsRoot,
        });
        noteWithLink = await NOTE_PRESETS_V4.NOTE_WITH_ALIAS_LINK.create({
          vault: vaults[0],

          wsRoot,
        });
      },
      onInit: async ({}) => {
        const editor = await VSCodeUtils.openNote(noteWithLink);
        const links = await provide(editor);
        expect(links.map((l) => l.uri.fsPath)).toEqual(
          [noteWithLink].map((note) =>
            NoteUtilsV2.getPathV4({ note, wsRoot: DendronWorkspace.wsRoot() })
          )
        );
        done();
      },
    });
  });
});
