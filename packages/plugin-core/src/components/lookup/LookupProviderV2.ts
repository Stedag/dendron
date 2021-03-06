import {
  DendronError,
  DEngineClientV2,
  DNodePropsDictV2,
  DNodePropsQuickInputV2,
  DNodePropsV2,
  DNodeUtilsV2,
  DVault,
  getStage,
  NotePropsV2,
  NoteUtilsV2,
  SchemaModulePropsV2,
  SchemaUtilsV2,
} from "@dendronhq/common-all";
import _, { DebouncedFunc } from "lodash";
import { CancellationToken, Uri, window } from "vscode";
import { Logger } from "../../logger";
import { HistoryService } from "../../services/HistoryService";
import { EngineFlavor, EngineOpts } from "../../types";
import { getDurationMilliseconds, profile } from "../../utils/system";
import { DendronWorkspace } from "../../workspace";
import { LookupControllerV2 } from "./LookupControllerV2";
import { DendronQuickPickerV2 } from "./types";
import {
  createNoActiveItem,
  node2Uri,
  PickerUtilsV2,
  showDocAndHidePicker,
} from "./utils";

type OnDidAcceptReturn = Promise<
  | {
      uris: Uri[];
      node: NotePropsV2 | SchemaModulePropsV2 | undefined;
      resp?: any;
    }
  | undefined
>;
type OnDidAcceptNewNodeReturn = Promise<{
  uri: Uri;
  node: NotePropsV2 | SchemaModulePropsV2;
  resp?: any | undefined;
}>;

export class LookupProviderV2 {
  public opts: EngineOpts;
  protected onDidChangeValueDebounced?: DebouncedFunc<
    InstanceType<typeof LookupProviderV2>["onUpdatePickerItem"]
  >;

  constructor(opts: EngineOpts) {
    this.opts = opts;
  }

  createDefaultItems = ({ picker }: { picker: DendronQuickPickerV2 }) => {
    if (_.find(picker.buttons, { type: "multiSelect" })?.pressed) {
      return [];
    } else {
      return [createNoActiveItem(PickerUtilsV2.getVaultForOpenEditor())];
    }
  };

  async _onAcceptNewNote({
    picker,
    selectedItem,
  }: {
    picker: DendronQuickPickerV2;
    selectedItem: DNodePropsQuickInputV2;
  }): OnDidAcceptNewNodeReturn {
    const ctx = "onAcceptNewNode";
    const fname = PickerUtilsV2.getValue(picker);
    Logger.info({ ctx, msg: "createNewPick", value: fname });
    let nodeNew: DNodePropsV2;
    let foundStub = false;
    const ws = DendronWorkspace.instance();
    const engine = ws.getEngine();
    if (selectedItem?.stub) {
      Logger.info({ ctx, msg: "create stub" });
      nodeNew = engine.notes[selectedItem.id];
      nodeNew.stub = false;
      foundStub = true;
    } else if (selectedItem?.schemaStub) {
      Logger.info({ ctx, msg: "create schema stub" });
      selectedItem.schemaStub = false;
      nodeNew = selectedItem;
    } else {
      const vault = PickerUtilsV2.getOrPromptVaultForOpenEditor();
      Logger.info({ ctx, msg: "create normal node" });
      nodeNew = NoteUtilsV2.create({ fname, vault });
      const result = SchemaUtilsV2.matchPath({
        notePath: fname,
        schemaModDict: engine.schemas,
      });
      if (result) {
        NoteUtilsV2.addSchema({
          note: nodeNew,
          schemaModule: result.schemaModule,
          schema: result.schema,
        });
      }
      Logger.info({ ctx, msg: "post:maybeAddSchema", schema: result });
    }
    const maybeSchema = SchemaUtilsV2.getSchemaFromNote({
      note: nodeNew,
      engine,
    });
    const maybeTemplate =
      maybeSchema?.schemas[nodeNew.schema?.schemaId as string].data.template;
    if (maybeSchema && maybeTemplate) {
      SchemaUtilsV2.applyTemplate({
        template: maybeTemplate,
        note: nodeNew,
        engine,
      });
    }
    const uri = node2Uri(nodeNew);
    const historyService = HistoryService.instance();
    historyService.add({ source: "engine", action: "create", uri });

    Logger.info({ ctx, msg: "pre:checkNoteExist", uri });
    // TODO: check for overwriting schema
    let noteExists = NoteUtilsV2.getNoteByFname(nodeNew.fname, engine.notes);
    if (
      noteExists &&
      !foundStub &&
      !selectedItem?.schemaStub &&
      nodeNew.vault.fsPath === noteExists.vault.fsPath
    ) {
      Logger.error({ ctx, msg: "action will overwrite existing note" });
      throw Error("action will overwrite existing note");
    }
    if (picker.onCreate) {
      Logger.info({ ctx, msg: "pre:pickerOnCreate", uri });
      await picker.onCreate(nodeNew);
    }
    Logger.info({ ctx, msg: "pre:engine.write", uri });
    const resp = await engine.writeNote(nodeNew, {
      newNode: true,
    });
    Logger.info({ ctx, msg: "engine.write", profile });
    return { uri, node: nodeNew, resp };
  }

  async _onAcceptNewSchema({
    picker,
    vault,
  }: {
    picker: DendronQuickPickerV2;
    vault: DVault;
  }): OnDidAcceptNewNodeReturn {
    const ctx = "onAcceptNewSchema";
    const fname = PickerUtilsV2.getValue(picker);
    Logger.info({ ctx, msg: "createNewPick", value: fname });
    let smodNew: SchemaModulePropsV2;
    const ws = DendronWorkspace.instance();
    const engine = ws.getEngine();
    Logger.info({ ctx, msg: "create normal node" });
    smodNew = SchemaUtilsV2.createModuleProps({ fname, vault });
    const uri = Uri.file(SchemaUtilsV2.getPath({ root: vault.fsPath, fname }));
    const historyService = HistoryService.instance();
    historyService.add({ source: "engine", action: "create", uri });
    const resp = await engine.writeSchema(smodNew);
    Logger.info({ ctx, msg: "engine.write", profile });
    return { uri, node: smodNew, resp };
  }

  async onAcceptNewNode({
    picker,
    opts,
    selectedItem,
  }: {
    picker: DendronQuickPickerV2;
    opts: EngineOpts;
    selectedItem: DNodePropsQuickInputV2;
  }): OnDidAcceptNewNodeReturn {
    const ctx = "onAcceptNewNode";
    Logger.info({ ctx });
    let vault: DVault = PickerUtilsV2.getVaultForOpenEditor();

    if (opts.flavor === "schema") {
      return this._onAcceptNewSchema({ picker, vault });
    } else {
      return this._onAcceptNewNote({ picker, selectedItem });
    }
  }
  onDidAccept({
    picker,
    opts,
    lc,
  }: {
    picker: DendronQuickPickerV2;
    opts: EngineOpts;
    lc: LookupControllerV2;
  }) {
    if (this.onDidChangeValueDebounced?.cancel) {
      this.onDidChangeValueDebounced.cancel();
    }
    lc.cancelToken.cancel();
    if (picker.canSelectMany) {
      return this.onDidAcceptForMulti(picker, opts);
    } else {
      return this.onDidAcceptForSingle(picker, opts);
    }
  }

  async onDidAcceptForSingle(
    picker: DendronQuickPickerV2,
    opts: EngineOpts
  ): OnDidAcceptReturn {
    const ctx = "onDidAcceptSingle";
    const value = PickerUtilsV2.getValue(picker);
    const selectedItems = PickerUtilsV2.getSelection(picker);
    const selectedItem = selectedItems[0];
    Logger.info({
      ctx,
      msg: "enter",
      value,
      opts,
      selectedItems: selectedItems.map((ent) => NoteUtilsV2.toLogObj(ent)),
      activeItems: picker.activeItems.map((ent) => NoteUtilsV2.toLogObj(ent)),
    });
    const resp = this.validate(picker.value, opts.flavor);
    const ws = DendronWorkspace.instance();
    let uri: Uri;
    let newNode: NotePropsV2 | SchemaModulePropsV2 | undefined;
    if (resp) {
      window.showErrorMessage(resp);
      return;
    }
    if (selectedItem) {
      if (PickerUtilsV2.isCreateNewNotePickForSingle(selectedItem)) {
        ({ uri, node: newNode } = await this.onAcceptNewNode({
          picker,
          opts,
          selectedItem,
        }));
      } else {
        uri = node2Uri(selectedItem);
        if (opts.flavor === "schema") {
          const smod = DendronWorkspace.instance().getEngine().schemas[
            selectedItem.id
          ];
          uri = Uri.file(
            SchemaUtilsV2.getPath({
              root: smod.vault.fsPath,
              fname: smod.fname,
            })
          );
        }
      }
      await showDocAndHidePicker([uri], picker);
      return { uris: [uri], node: newNode };
    } else {
      // item from pressing enter
      if (opts.flavor === "note") {
        try {
          const maybeNote = NoteUtilsV2.getNoteByFname(
            value,
            ws.getEngine().notes
          );
          if (maybeNote) {
            uri = node2Uri(maybeNote);
            await showDocAndHidePicker([uri], picker);
            return { uris: [uri], node: undefined };
          }
        } catch (err) {
          window.showErrorMessage("multiple notes found. please select one");
          return;
        }
      }
      return;
    }
  }

  async onDidAcceptForMulti(
    picker: DendronQuickPickerV2,
    opts: EngineOpts
  ): OnDidAcceptReturn {
    const ctx = "onDidAccept";
    const value = PickerUtilsV2.getValue(picker);
    Logger.info({ ctx, msg: "enter", value, opts });
    let selectedItems = PickerUtilsV2.getSelection(picker);
    const resp = this.validate(picker.value, opts.flavor);
    const ws = DendronWorkspace.instance();
    let uris: Uri[];
    if (resp) {
      window.showErrorMessage(resp);
      return;
    }

    // check if we get note by quickpick value instead of selection
    const activeItem = picker.activeItems[0];
    const maybeNoteFname = activeItem ? activeItem.fname : value;
    const maybeNote = NoteUtilsV2.getNoteByFname(
      maybeNoteFname,
      ws.getEngine().notes
    );
    if (_.isEmpty(selectedItems) && opts.flavor === "note") {
      if (maybeNote) {
        if (maybeNote.stub) {
          selectedItems = [...picker.activeItems];
        } else {
          uris = [node2Uri(maybeNote)];
          await showDocAndHidePicker(uris, picker);
          return;
        }
      } else {
        selectedItems = [];
      }
    }

    // get note by selection
    const isCreateNew =
      _.some(selectedItems.map(PickerUtilsV2.isCreateNewNotePick)) ||
      _.isEmpty(selectedItems);
    if (isCreateNew && selectedItems.length > 1) {
      window.showErrorMessage(`cannot create new note when multi-select is on`);
      return;
    }
    if (isCreateNew) {
      const newNode = await this.onAcceptNewNode({
        picker,
        opts,
        selectedItem: selectedItems[0],
      });
      uris = [newNode.uri];
    } else {
      if (opts.flavor === "schema") {
        const smods = selectedItems.map(
          (item) => DendronWorkspace.instance().getEngine().schemas[item.id]
        );
        uris = smods.map((smod) =>
          Uri.file(
            SchemaUtilsV2.getPath({
              root: DendronWorkspace.rootWorkspaceFolder()?.uri
                .fsPath as string,
              fname: smod.fname,
            })
          )
        );
      } else {
        uris = selectedItems.map((item) => node2Uri(item));
      }
    }
    await showDocAndHidePicker(uris, picker);
    return;
  }

  onUpdatePickerItem = async (
    picker: DendronQuickPickerV2,
    opts: EngineOpts & { force?: boolean },
    source: string,
    token: CancellationToken
    // | "updatePickerBehavior:journal"
    // | "updatePickerBehavior:scratch"
    // | "updatePickerBehavior:normal"
    // | "onValueChange"
    // | "manual"
  ) => {
    // ~~~ setup variables
    const start = process.hrtime();
    const ctx = "updatePickerItems";
    picker.busy = true;
    let pickerValue = picker.value;
    // if we just started, show all results of current parent
    if (picker.justActivated) {
      const lastDotIndex = pickerValue.lastIndexOf(".");
      if (lastDotIndex < 0) {
        pickerValue = "";
      } else {
        pickerValue = pickerValue.slice(0, lastDotIndex + 1);
      }
    }
    const querystring = PickerUtilsV2.slashToDot(pickerValue);
    const queryOrig = PickerUtilsV2.slashToDot(picker.value);
    const depth = queryOrig.split(".").length;
    const ws = DendronWorkspace.instance();
    let profile: number;
    const queryEndsWithDot = queryOrig.endsWith(".");
    const engine = ws.getEngine();
    Logger.info({ ctx, msg: "enter", queryOrig, source });

    // ~~~ update results
    try {
      if (querystring === "") {
        Logger.debug({ ctx, msg: "empty qs" });
        picker.items = this.showRootResults(opts.flavor, engine);
        return;
      }

      // current items
      const items: DNodePropsQuickInputV2[] = [...picker.items];

      let updatedItems = PickerUtilsV2.filterCreateNewItem(items);
      updatedItems = this.createDefaultItems({ picker }).concat(updatedItems);

      Logger.debug({
        ctx,
        pickerValue,
        items: updatedItems.map((ent) => _.pick(ent, ["id", "title"])),
        msg: "qs",
      });

      // first query, show all results
      // subsequent query, only show next level children
      if (
        queryEndsWithDot ||
        queryOrig.split(".").length < 2 ||
        picker.justActivated ||
        opts?.force
      ) {
        Logger.info({ ctx, msg: "first query" });
        let nodes: DNodePropsV2[];
        if (token.isCancellationRequested) {
          return;
        }
        if (opts.flavor === "note") {
          const resp = await engine.queryNotes({ qs: querystring });
          nodes = resp.data;
          Logger.info({ ctx, msg: "post:queryNotes" });
        } else {
          const resp = await engine.querySchema(querystring);
          nodes = resp.data.map((ent) => SchemaUtilsV2.getModuleRoot(ent));
        }
        // overwrite results
        updatedItems = this.createDefaultItems({ picker }).concat(
          nodes.map((ent) =>
            DNodeUtilsV2.enhancePropForQuickInput({
              props: ent,
              schemas: engine.schemas,
              vaults: DendronWorkspace.instance().vaults,
            })
          )
        );
        profile = getDurationMilliseconds(start);
        Logger.info({ ctx, msg: "engine.query", profile });
      }

      if (token.isCancellationRequested) {
        return;
      }
      // check if single item query, vscode doesn't surface single letter queries
      if (picker.activeItems.length === 0 && querystring.length === 1) {
        picker.items = updatedItems;
        picker.activeItems = picker.items;
        return;
      }

      // don't use query string since this can change
      const perfectMatch =
        opts.flavor === "note"
          ? _.find(updatedItems, { fname: queryOrig })
          : _.find(updatedItems, { id: queryOrig });
      // NOTE: we modify this later so need to track this here
      const noUpdatedItems = updatedItems.length === 0;

      // add schema suggestions
      if (opts.flavor === "note" && queryEndsWithDot) {
        const results = SchemaUtilsV2.matchPath({
          notePath: _.trimEnd(queryOrig, "."),
          schemaModDict: engine.schemas,
        });
        // since namespace matches everything, we don't do queries on that
        if (results && !results.namespace) {
          const { schema, schemaModule } = results;
          const dirName = DNodeUtilsV2.dirName(queryOrig);
          const candidates = schema.children
            .map((ent) => {
              const mschema = schemaModule.schemas[ent];
              if (
                SchemaUtilsV2.hasSimplePattern(mschema, {
                  isNotNamespace: true,
                })
              ) {
                const pattern = SchemaUtilsV2.getPattern(mschema, {
                  isNotNamespace: true,
                });
                const fname = [dirName, pattern].join(".");
                return NoteUtilsV2.fromSchema({
                  schemaModule,
                  schemaId: ent,
                  fname,
                  vault: PickerUtilsV2.getVaultForOpenEditor(),
                });
              }
              return;
            })
            .filter(Boolean) as NotePropsV2[];
          const candidatesToAdd = _.differenceBy(
            candidates,
            updatedItems,
            (ent) => ent.fname
          );
          updatedItems = updatedItems.concat(
            candidatesToAdd.map((ent) => {
              return DNodeUtilsV2.enhancePropForQuickInput({
                props: ent,
                schemas: engine.schemas,
                vaults: DendronWorkspace.instance().vaults,
              });
            })
          );
        }
      }
      if (token.isCancellationRequested) {
        return;
      }
      // check if new item, return if that's the case
      if (
        noUpdatedItems ||
        (picker.activeItems.length === 0 && !perfectMatch && !queryEndsWithDot)
      ) {
        Logger.debug({ ctx, msg: "no matches" });
        picker.items = updatedItems;
        return;
      }
      if (picker.showDirectChildrenOnly) {
        updatedItems = PickerUtilsV2.filterByDepth(updatedItems, depth);
      }

      if (perfectMatch) {
        Logger.debug({ ctx, msg: "active = qs" });
        picker.activeItems = [perfectMatch];
        // TODO: this defaults to current vault if no note is open
        const openedVault = PickerUtilsV2.getVaultForOpenEditor();
        if (perfectMatch.vault.fsPath === openedVault.fsPath) {
          picker.items = PickerUtilsV2.filterCreateNewItem(updatedItems);
        }
      } else if (queryEndsWithDot) {
        // don't show noActiveItem for dot queries
        Logger.debug({ ctx, msg: "active != qs, end with ." });
        picker.items = PickerUtilsV2.filterCreateNewItem(updatedItems);
      } else {
        // regular result
        Logger.debug({ ctx, msg: "active != qs" });
        picker.items = updatedItems;
      }
    } catch (err) {
      window.showErrorMessage(err);
      throw Error(err);
    } finally {
      profile = getDurationMilliseconds(start);
      picker.busy = false;
      picker.justActivated = false;
      Logger.info({
        ctx,
        msg: "exit",
        queryOrig,
        source,
        profile,
        cancelled: token.isCancellationRequested,
      });
      return picker;
    }
  };

  provide({
    picker,
    lc,
  }: {
    picker: DendronQuickPickerV2;
    lc: LookupControllerV2;
  }) {
    const { opts } = this;
    const _this = this;
    picker.onDidAccept(() => {
      const ctx = "LookupProvider:onAccept";
      // NOTE: unfortunate hack
      if (getStage() === "test") {
        return;
      }
      this.onDidAccept({ picker, opts, lc }).catch((err) => {
        Logger.error({
          ctx,
          err: new DendronError({
            friendly:
              "something went wrong. please submit a bug report to https://github.com/dendronhq/dendron/issues/new?assignees=&labels=&template=bug_report.md&title= with the output of `Dendron: Open Log`",
            payload: err,
          }),
        });
      });
    });

    // create debounced update method
    this.onDidChangeValueDebounced = _.debounce(
      _.bind(this.onUpdatePickerItem, _this),
      60,
      { leading: true, maxWait: 120 }
    ) as DebouncedFunc<typeof _this.onUpdatePickerItem>;

    // picker.onDidChangeSelection(() => {
    //   Logger.info({ctx: "onDidChangeSelection", picker: PickerUtilsV2.dumpPicker(picker)})
    // });
    // picker.onDidChangeActive(()=> {
    //   Logger.info({ctx: "onDidChangeActive", picker: PickerUtilsV2.dumpPicker(picker)})
    // })

    picker.onDidChangeValue(() => {
      if (_.isUndefined(this.onDidChangeValueDebounced)) {
        throw new DendronError({ msg: "onAccept already called" });
      }

      this.onDidChangeValueDebounced(
        picker,
        opts,
        "onValueChange",
        lc.createCancelSource().token
      );
    });
  }

  showRootResults(
    flavor: EngineFlavor,
    engine: DEngineClientV2
  ): DNodePropsQuickInputV2[] {
    let nodeDict: DNodePropsDictV2;
    let nodes: DNodePropsV2[];
    if (flavor === "note") {
      nodeDict = engine.notes;
      const roots = NoteUtilsV2.getRoots(nodeDict);
      const childrenOfRoot = roots.flatMap((ent) => ent.children);
      nodes = _.map(childrenOfRoot, (ent) => nodeDict[ent]).concat(roots);
    } else {
      nodeDict = _.mapValues(engine.schemas, (ent) => ent.root);
      nodes = _.map(_.values(engine.schemas), (ent: SchemaModulePropsV2) => {
        return SchemaUtilsV2.getModuleRoot(ent);
      });
    }
    return nodes.map((ent) => {
      return DNodeUtilsV2.enhancePropForQuickInput({
        props: ent,
        schemas: engine.schemas,
        vaults: DendronWorkspace.instance().vaults,
      });
    });
  }

  validate(value: string, flavor: EngineFlavor): string | undefined {
    if (flavor === "schema") {
      if (value.split(".").length > 1) {
        return "schemas can only be one level deep";
      }
    }
    return;
  }
}
