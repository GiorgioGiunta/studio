import {
    observable,
    extendObservable,
    computed,
    action,
    toJS,
    reaction,
    autorun,
    runInAction
} from "mobx";

import { _each, _isArray, _map, _uniqWith } from "eez-studio-shared/algorithm";
import { confirmSave } from "eez-studio-shared/util";

import * as notification from "eez-studio-ui/notification";

import { confirm } from "project-editor/core/util";

import {
    EezObject,
    asArray,
    PropertyInfo,
    PropertyType,
    IEditorState,
    IEditor,
    getProperty,
    isValue,
    isArray,
    isArrayElement,
    getObjectPathAsString,
    objectToString,
    isObjectExists,
    findPropertyByName,
    getObjectFromPath,
    getObjectFromStringPath,
    getObjectFromObjectId,
    isPropertyEnumerable,
    isPartOfNavigation
} from "project-editor/core/object";
import {
    checkClipboard,
    objectToClipboardData,
    copyToClipboard
} from "project-editor/core/clipboard";
import {
    ICommand,
    addObject,
    addObjects,
    insertObject,
    updateObject,
    deleteObject,
    deleteObjects,
    replaceObject,
    replaceObjects,
    insertObjectBefore,
    insertObjectAfter
} from "project-editor/core/commands";
import { loadObject, objectToJS } from "project-editor/core/serialization";
import { TreeObjectAdapter, ITreeObjectAdapter } from "project-editor/core/objectAdapter";
import { findAllReferences, isReferenced } from "project-editor/core/search";
import { OutputSections, OutputSection } from "project-editor/core/output";

import { showGenericDialog, TableField } from "eez-studio-ui/generic-dialog";

import {
    Project,
    save as saveProject,
    load as loadProject,
    getNewProject
} from "project-editor/project/project";
import {
    build as buildProject,
    backgroundCheck,
    buildExtensions
} from "project-editor/project/build";
import { getAllMetrics } from "project-editor/project/metrics";

const { Menu, MenuItem } = EEZStudio.electron.remote;

const ipcRenderer = EEZStudio.electron.ipcRenderer;
const path = EEZStudio.electron.remote.require("path");
const fs = EEZStudio.electron.remote.require("fs");

////////////////////////////////////////////////////////////////////////////////

export interface IPanel {
    selectedObject: EezObject | undefined;
    selectedObjects?: EezObject[];
    cutSelection(): void;
    copySelection(): void;
    pasteSelection(): void;
    deleteSelection(): void;
}

type NavigationItem = EezObject | ITreeObjectAdapter;

export interface INavigationStore {
    selectedPanel?: IPanel;
    selectedObject?: EezObject;
    getNavigationSelectedItem(navigationObject: EezObject): NavigationItem | undefined;
    getNavigationSelectedItemAsObject(navigationObject: EezObject): EezObject | undefined;
    setNavigationSelectedItem(
        navigationObject: EezObject,
        navigationSelectedItem: NavigationItem
    ): void;
    setSelectedPanel(selectedPanel: IPanel | undefined): void;
}

export class SimpleNavigationStoreClass implements INavigationStore {
    @observable selectedItem: NavigationItem | undefined;

    constructor(selectedObject: EezObject | undefined) {
        this.selectedItem = selectedObject;
    }

    get selectedObject(): EezObject | undefined {
        return this.selectedItem as EezObject;
    }

    getNavigationSelectedItem(navigationObject: EezObject) {
        return this.selectedItem;
    }

    getNavigationSelectedItemAsObject(navigationObject: EezObject) {
        return this.selectedItem as EezObject;
    }

    @action
    setNavigationSelectedItem(navigationObject: EezObject, navigationSelectedItem: NavigationItem) {
        this.selectedItem = navigationSelectedItem;
    }

    setSelectedPanel(selectedPanel: IPanel | undefined) {}
}

class NavigationStoreClass implements INavigationStore {
    @observable
    navigationMap = new Map<string, NavigationItem>();

    @observable
    selectedPanel: IPanel | undefined;

    load(map: { [stringPath: string]: string }) {
        let navigationMap = new Map<string, NavigationItem>();

        for (let stringPath in map) {
            let navigationObject = DocumentStore.getObjectFromStringPath(stringPath);
            if (navigationObject) {
                let navigationItemStr = map[stringPath];
                if (navigationItemStr === stringPath) {
                    continue;
                }
                let navigationItem: NavigationItem | undefined;
                if (typeof navigationItemStr == "string") {
                    navigationItem = DocumentStore.getObjectFromStringPath(navigationItemStr);
                } else {
                    let navigationObjectAdapter = new TreeObjectAdapter(navigationObject);
                    setTimeout(() => {
                        navigationObjectAdapter.loadState(navigationItemStr);
                    }, 0);
                    navigationItem = navigationObjectAdapter;
                }

                if (navigationItem) {
                    navigationMap.set(navigationObject._id, navigationItem);
                }
            }
        }

        this.navigationMap = navigationMap;
    }

    @computed
    get toJS() {
        let map: any = {};
        for (var [id, navigationItem] of this.navigationMap) {
            let navigationObject = DocumentStore.getObjectFromObjectId(id);
            if (navigationObject) {
                let navigationObjectPath = getObjectPathAsString(navigationObject);
                if (navigationItem instanceof EezObject) {
                    map[navigationObjectPath] = getObjectPathAsString(navigationItem);
                } else {
                    map[navigationObjectPath] = navigationItem.saveState();
                }
            }
        }
        return map;
    }

    @action
    setSelectedPanel(selectedPanel: IPanel | undefined) {
        this.selectedPanel = selectedPanel;
    }

    @computed
    get selectedObject(): EezObject | undefined {
        let object: EezObject = DocumentStore.document;
        if (!object) {
            return undefined;
        }

        while (true) {
            let child = this.getNavigationSelectedItem(object);
            if (!child) {
                return object;
            }
            if (!(child instanceof EezObject)) {
                return child.selectedObject;
            }
            object = child;
        }
    }

    getSelection(): EezObject[] | undefined {
        // TODO
        return undefined;
    }

    @action
    setSelection(selection: EezObject[] | undefined) {
        if (!selection || selection.length == 0) {
            return;
        }

        let object = selection[0];

        for (let ancestor = object._parent; ancestor; ancestor = ancestor._parent) {
            let navigationItem = this.getNavigationSelectedItem(ancestor);
            if (navigationItem && !(navigationItem instanceof EezObject)) {
                navigationItem.selectObjects(selection);
                return;
            }
        }

        let iterObject = object;
        let parent = iterObject._parent;
        while (iterObject && parent) {
            let grandparent = parent._parent;
            if (!isArray(grandparent)) {
                let navigationItem = this.getNavigationSelectedItem(parent);
                if (navigationItem && !(navigationItem instanceof EezObject)) {
                    navigationItem.selectObjects(selection);
                } else {
                    this.setNavigationSelectedItem(parent, iterObject);
                }
            }

            iterObject = parent;
            parent = iterObject._parent;
        }
    }

    isSelected(object: EezObject) {
        let iterObject = object;
        let parent = iterObject._parent;
        while (iterObject && parent) {
            if (parent._classInfo.navigationComponent) {
                let grandparent = parent._parent;
                if (!isArray(grandparent)) {
                    let navigationItem = this.getNavigationSelectedItem(parent);
                    if (navigationItem && !(navigationItem instanceof EezObject)) {
                        if (navigationItem.selectedObject != object) {
                            return false;
                        }
                    } else {
                        if (navigationItem != iterObject) {
                            return false;
                        }
                    }
                }
            }
            iterObject = parent;
            parent = iterObject._parent;
        }

        return true;
    }

    getNavigationSelectedItem(navigationObject: EezObject): NavigationItem | undefined {
        let item = this.navigationMap.get(navigationObject._id);

        if (item && item instanceof EezObject) {
            // is this maybe deleted object?
            item = DocumentStore.getObjectFromObjectId(item._id);
        }

        if (!item) {
            let defaultNavigationKey = navigationObject._classInfo.defaultNavigationKey;
            if (defaultNavigationKey) {
                item = getProperty(navigationObject, defaultNavigationKey);
            }
        }
        return item;
    }

    getNavigationSelectedItemAsObject(navigationObject: EezObject): EezObject | undefined {
        let navigationItem = this.getNavigationSelectedItem(navigationObject);
        if (!navigationItem) {
            return undefined;
        }
        if (!(navigationItem instanceof EezObject)) {
            console.error("TreeObjectAdapter is not expected");
            return undefined;
        }
        return navigationItem;
    }

    getNavigationSelectedItemAsObjectAdapter(
        navigationObject: EezObject
    ): ITreeObjectAdapter | undefined {
        let navigationItem = this.getNavigationSelectedItem(navigationObject);
        if (navigationItem && navigationItem instanceof EezObject) {
            console.error("TreeObjectAdapter is expected");
            return undefined;
        }
        return navigationItem;
    }

    @action
    setNavigationSelectedItem(navigationObject: EezObject, navigationSelectedItem: NavigationItem) {
        this.navigationMap.set(navigationObject._id, navigationSelectedItem);

        if (!isPartOfNavigation(navigationObject)) {
            return;
        }

        let parent = navigationObject._parent;
        if (parent) {
            this.setNavigationSelectedItem(parent, navigationObject);
        }
    }

    showObject(objectToShow: EezObject) {
        this.setSelection([objectToShow]);
        for (let object: EezObject | undefined = objectToShow; object; object = object._parent) {
            if (object.editorComponent) {
                const editor = EditorsStore.openEditor(object);
                setTimeout(() => {
                    if (editor && editor.state) {
                        editor.state.selectObject(
                            isValue(objectToShow)
                                ? (objectToShow._parent as EezObject)
                                : objectToShow
                        );
                    }
                }, 0);
                break;
            }
        }
    }
}

////////////////////////////////////////////////////////////////////////////////

export class Editor implements IEditor {
    @observable
    object: EezObject;
    @observable
    active: boolean;
    @observable
    permanent: boolean;
    @observable
    state: IEditorState | undefined;

    loading = false;

    @computed
    get id() {
        return this.object._id;
    }

    @computed
    get title() {
        if (isArrayElement(this.object)) {
            return `${this.object._class.name}: ${objectToString(this.object)}`;
        } else {
            return objectToString(this.object);
        }
    }

    @action
    makeActive() {
        EditorsStore.activateEditor(this);
    }

    @action
    makePermanent() {
        this.permanent = true;
    }

    close() {
        EditorsStore.closeEditor(this);
    }
}

class EditorsStoreClass {
    @observable
    editors: Editor[] = [];

    constructor() {
        // open editor when navigation selection has changed
        autorun(() => {
            let object = NavigationStore.selectedObject;
            while (object) {
                let navigationItem = NavigationStore.getNavigationSelectedItem(object);
                while (navigationItem) {
                    if (navigationItem instanceof EezObject) {
                        if (!isArray(navigationItem) && navigationItem.editorComponent) {
                            this.openEditor(navigationItem);
                        }
                        navigationItem = NavigationStore.getNavigationSelectedItem(navigationItem);
                    } else {
                        let object = navigationItem.selectedObject;
                        if (object && !isArray(object) && object.editorComponent) {
                            this.openEditor(object);
                        } else if (navigationItem.object.editorComponent) {
                            this.openEditor(navigationItem.object);
                        }
                        return;
                    }
                }

                object = object._parent;
            }
        });

        // close non-permanent editor if editor object is not selected
        // autorun(() => {
        //     for (let i = 0; i < this.editors.length; i++) {
        //         if (!this.editors[i].permanent) {
        //             if (!NavigationStore.isSelected(this.editors[i].object)) {
        //                 this.closeEditor(this.editors[i]);
        //             }
        //             break;
        //         }
        //     }
        // });

        // close editor if editor object doesn't exists anymore
        autorun(() => {
            this.editors.slice().forEach(editor => {
                if (!isObjectExists(editor.object)) {
                    this.closeEditor(editor);
                }
            });
        });
    }

    load(editors: any[]) {
        if (editors) {
            this.editors = editors
                .map((editor: any) => {
                    let object;
                    if (_isArray(editor.object)) {
                        object = DocumentStore.getObjectFromPath(editor.object);
                    } else {
                        object = DocumentStore.getObjectFromStringPath(editor.object);
                    }
                    if (object) {
                        let newEditor = new Editor();
                        newEditor.object = object;
                        newEditor.active = editor.active;
                        newEditor.permanent = editor.permanent;
                        const createEditorState = object._classInfo.createEditorState;
                        if (createEditorState) {
                            newEditor.state = createEditorState(object);
                            if (editor.state) {
                                newEditor.state.loadState(editor.state);
                            }
                        }
                        return newEditor;
                    }
                    return undefined;
                })
                .filter((editor: Editor | undefined) => !!editor) as Editor[];
        } else {
            this.editors = [];
        }
    }

    @computed
    get toJS() {
        return this.editors.map(editor => ({
            object: getObjectPathAsString(editor.object),
            active: editor.active,
            permanent: editor.permanent,
            state: editor.state && editor.state.saveState()
        }));
    }

    @computed
    get activeEditor() {
        for (let i = 0; i < this.editors.length; i++) {
            let editor = this.editors[i];
            if (editor.active) {
                return editor;
            }
        }
        return undefined;
    }

    @action
    activateEditor(editor: Editor) {
        if (editor.active) {
            return;
        }

        let activeEditor = this.activeEditor;
        if (activeEditor) {
            activeEditor.active = false;
        }

        editor.active = true;
    }

    @action
    openEditor(object: EezObject, openAsPermanentEditor: boolean = false) {
        let nonPermanentEditor: Editor | undefined;

        let editorFound: Editor | undefined;

        for (let i = 0; i < this.editors.length; i++) {
            if (this.editors[i].object == object) {
                this.editors[i].active = true;
                editorFound = this.editors[i];
            } else {
                if (this.editors[i].active) {
                    this.editors[i].active = false;
                }
                if (!openAsPermanentEditor && !this.editors[i].permanent) {
                    nonPermanentEditor = this.editors[i];
                }
            }
        }

        if (editorFound) {
            return editorFound;
        }

        if (!nonPermanentEditor) {
            nonPermanentEditor = new Editor();
            this.editors.push(nonPermanentEditor);
        }
        nonPermanentEditor.permanent = openAsPermanentEditor;
        nonPermanentEditor.object = object;
        nonPermanentEditor.active = true;
        const createEditorState = object._classInfo.createEditorState;
        if (createEditorState) {
            nonPermanentEditor.state = createEditorState(object);
        } else {
            nonPermanentEditor.state = undefined;
        }

        return nonPermanentEditor;
    }

    @action
    openPermanentEditor(object: EezObject) {
        this.openEditor(object, true);
    }

    @action
    makeActiveEditorPermanent() {
        for (let i = 0; i < this.editors.length; i++) {
            if (this.editors[i].active) {
                this.editors[i].permanent = true;
                return;
            }
        }
    }

    @action
    closeEditor(editor: Editor) {
        let index = this.editors.indexOf(editor);
        if (index != -1) {
            this.editors.splice(index, 1);
            if (editor.active) {
                if (index < this.editors.length) {
                    this.activateEditor(this.editors[index]);
                } else if (this.editors.length > 0) {
                    this.activateEditor(this.editors[this.editors.length - 1]);
                }
            }
        }
    }
}

////////////////////////////////////////////////////////////////////////////////

export class ViewOptions {
    @observable
    outputVisible: boolean = true;

    @observable
    debugVisible: boolean = false;

    @action
    load(viewOptions: any) {
        if (viewOptions) {
            this.outputVisible = viewOptions.outputVisible;
            this.debugVisible = viewOptions.debugVisible;
        } else {
            this.outputVisible = true;
            this.debugVisible = false;
        }
    }

    @computed
    get toJS() {
        return toJS(this);
    }
}

////////////////////////////////////////////////////////////////////////////////

class UIStateStoreClass {
    @observable
    viewOptions: ViewOptions = new ViewOptions();

    @observable
    selectedBuildConfiguration: string;

    @observable
    features: any;

    @observable
    objects = new Map<string, any>();

    @observable
    savedState: any;

    @observable
    searchPattern: string;

    @observable
    searchMatchCase: boolean;

    @observable
    searchMatchWholeWord: boolean;

    constructor() {
        autorun(() => {
            this.savedState = this.toJS;
        });

        // react when selected panel or selected message in output window has changed
        reaction(
            () => ({
                message: OutputSectionsStore.activeSection.selectedMessage,
                panel: NavigationStore.selectedPanel
            }),
            arg => {
                if (arg.panel instanceof OutputSection && arg.message && arg.message.object) {
                    NavigationStore.showObject(arg.message.object);
                }
            }
        );
    }

    loadObjects(objects: any) {
        this.objects.clear();
        _each(objects, (value: any, objectPath: any) => {
            this.objects.set(objectPath, value);
        });
    }

    @action
    load(uiState: any) {
        this.viewOptions.load(uiState.viewOptions);
        NavigationStore.load(uiState.navigationMap);
        EditorsStore.load(uiState.editors);
        this.selectedBuildConfiguration = uiState.selectedBuildConfiguration || "Default";
        this.features = observable(uiState.features || {});
        this.loadObjects(uiState.objects);
    }

    @computed
    get featuresJS() {
        return toJS(this.features);
    }

    @computed
    get objectsJS() {
        let map: any = {};
        for (var [objectPath, value] of this.objects) {
            if (DocumentStore.getObjectFromStringPath(objectPath)) {
                map[objectPath] = value;
            }
        }
        return map;
    }

    @computed
    get toJS() {
        return {
            viewOptions: this.viewOptions.toJS,
            navigationMap: NavigationStore.toJS,
            editors: EditorsStore.toJS,
            selectedBuildConfiguration: this.selectedBuildConfiguration,
            features: this.featuresJS,
            objects: this.objectsJS
        };
    }

    @computed
    get isModified() {
        return !!this.savedState;
    }

    @action
    save(): string {
        let result = JSON.stringify(this.savedState, null, 2);
        this.savedState = undefined;
        return result;
    }

    @action
    getFeatureParam<T>(extensionName: string, paramName: string, defaultValue: T): T {
        let extension = this.features[extensionName];
        if (!extension) {
            extension = observable({});
            extendObservable(this.features, {
                [extensionName]: extension
            });
        }
        let paramValue = extension[paramName];
        if (!paramValue) {
            extendObservable(extension, {
                [paramName]: defaultValue
            });
            return defaultValue;
        }
        return paramValue as T;
    }

    @action
    setSelectedBuildConfiguration(selectedBuildConfiguration: string) {
        this.selectedBuildConfiguration = selectedBuildConfiguration;
    }

    getObjectUIState(object: EezObject) {
        return this.objects.get(getObjectPathAsString(object));
    }

    updateObjectUIState(object: EezObject, changes: any) {
        const path = getObjectPathAsString(object);
        let objectUIState = this.objects.get(path);
        if (objectUIState) {
            Object.assign(objectUIState, changes);
        } else {
            this.objects.set(path, changes);
        }
    }
}

////////////////////////////////////////////////////////////////////////////////

interface IUndoItem {
    commands: ICommand[];
    selectionBefore: any;
    selectionAfter: any;
}

export class UndoManagerClass {
    @observable
    undoStack: IUndoItem[] = [];
    @observable
    redoStack: IUndoItem[] = [];
    @observable
    commands: ICommand[] = [];

    private selectionBeforeFirstCommand: any;
    public combineCommands: boolean = false;

    @action
    clear() {
        this.undoStack = [];
        this.redoStack = [];
    }

    @action
    pushToUndoStack() {
        if (this.commands.length > 0) {
            let selectionAfter = NavigationStore.getSelection();
            this.undoStack.push({
                commands: this.commands,
                selectionBefore: this.selectionBeforeFirstCommand,
                selectionAfter: selectionAfter
            });

            this.commands = [];
            this.selectionBeforeFirstCommand = NavigationStore.getSelection();
        }
    }

    @action
    setCombineCommands(value: boolean) {
        this.pushToUndoStack();
        this.combineCommands = value;
    }

    @action
    executeCommand(command: ICommand) {
        if (this.commands.length == 0) {
            this.selectionBeforeFirstCommand = NavigationStore.getSelection();
        } else {
            if (!this.combineCommands) {
                this.pushToUndoStack();
            }
        }

        command.execute();
        this.commands.push(command);

        this.redoStack = [];

        DocumentStore.setModified(true);
    }

    static getCommandsDescription(commands: ICommand[]) {
        return commands[commands.length - 1].description;
    }

    @computed
    get canUndo() {
        return this.undoStack.length > 0 || this.commands.length > 0;
    }

    @computed
    get undoDescription() {
        let commands;
        if (this.commands.length > 0) {
            commands = this.commands;
        } else if (this.undoStack.length > 0) {
            commands = this.undoStack[this.undoStack.length - 1].commands;
        }
        if (commands) {
            return UndoManagerClass.getCommandsDescription(commands);
        }
        return undefined;
    }

    @action
    undo() {
        this.pushToUndoStack();

        let undoItem = this.undoStack.pop();
        if (undoItem) {
            for (let i = undoItem.commands.length - 1; i >= 0; i--) {
                undoItem.commands[i].undo();
            }

            NavigationStore.setSelection(undoItem.selectionBefore);

            this.redoStack.push(undoItem);

            DocumentStore.setModified(true);
        }
    }

    @computed
    get canRedo() {
        return this.redoStack.length > 0;
    }

    @computed
    get redoDescription() {
        let commands;
        if (this.redoStack.length > 0) {
            commands = this.redoStack[this.redoStack.length - 1].commands;
        }
        if (commands) {
            return UndoManagerClass.getCommandsDescription(commands);
        }
        return undefined;
    }

    @action
    redo() {
        let redoItem = this.redoStack.pop();
        if (redoItem) {
            for (let i = 0; i < redoItem.commands.length; i++) {
                redoItem.commands[i].execute();
            }

            NavigationStore.setSelection(redoItem.selectionAfter);

            this.undoStack.push(redoItem);

            DocumentStore.setModified(true);
        }
    }
}

////////////////////////////////////////////////////////////////////////////////

class DocumentStoreClass {
    @observable
    private _document: EezObject | undefined;

    @observable
    modified: boolean = false;

    @computed
    get document(): EezObject {
        return this._document!;
    }

    clipboardDataId: string = "";

    getObjectFromPath(path: string[]) {
        return getObjectFromPath(this.document, path);
    }

    getObjectFromStringPath(objectID: string) {
        return getObjectFromStringPath(this.document, objectID);
    }

    getObjectFromObjectId(objectID: string) {
        return getObjectFromObjectId(this.document, objectID);
    }

    @computed
    get isModified() {
        return this.modified;
    }

    @action
    setModified(modified_: boolean) {
        this.modified = modified_;
    }

    @action
    changeDocument(document?: EezObject, uiState?: EezObject) {
        this._document = document;
        UIStateStore.load(uiState || {});
        UndoManager.clear();
    }

    canSave() {
        return this.modified;
    }

    addObject(parentObject: EezObject, object: any) {
        if (parentObject._parent && parentObject._key) {
            const propertyInfo = findPropertyByName(parentObject._parent, parentObject._key);
            if (propertyInfo && propertyInfo.interceptAddObject) {
                object = propertyInfo.interceptAddObject(parentObject, object);
            }
        }

        return addObject(
            {
                undoManager: UndoManager,
                selectionManager: NavigationStore
            },
            parentObject,
            object
        );
    }

    addObjects(parentObject: EezObject, objects: any[]) {
        return addObjects(
            {
                undoManager: UndoManager,
                selectionManager: NavigationStore
            },
            parentObject,
            objects
        );
    }

    insertObject(parentObject: EezObject, index: number, object: any) {
        return insertObject(
            {
                undoManager: UndoManager,
                selectionManager: NavigationStore
            },
            parentObject,
            index,
            object
        );
    }

    updateObject(object: EezObject, inputValues: any) {
        // make sure that plain JavaScript objects to EezObject's
        let values: any = {};

        let oldValues: any;
        if (object._classInfo.afterUpdateObjectHook) {
            oldValues = {};
        }

        for (let propertyName in inputValues) {
            if (inputValues.hasOwnProperty(propertyName)) {
                if (object._classInfo.afterUpdateObjectHook) {
                    oldValues[propertyName] = getProperty(object, propertyName);
                }

                const resolutionDependableProperty = propertyName.endsWith("_");

                let propertyInfo;
                if (resolutionDependableProperty) {
                    propertyInfo = findPropertyByName(object, propertyName.slice(0, -1));
                } else {
                    propertyInfo = findPropertyByName(object, propertyName);
                }

                if (propertyInfo) {
                    if (propertyInfo.computed !== true) {
                        const value = inputValues[propertyName];
                        if (
                            (propertyInfo.type === PropertyType.Object ||
                                propertyInfo.type === PropertyType.Array) &&
                            value !== undefined &&
                            !(value instanceof EezObject)
                        ) {
                            // convert to EezObject
                            values[propertyName] = loadObject(
                                object,
                                inputValues[propertyName],
                                propertyInfo.typeClass!
                            );
                        } else {
                            // use as is
                            values[propertyName] = value;
                        }
                    } else {
                        console.warn("ignored computed property", propertyName);
                    }
                } else {
                    console.error("ignored unknown property", propertyName);
                }
            }
        }

        updateObject(
            {
                undoManager: UndoManager,
                selectionManager: NavigationStore
            },
            object,
            values
        );

        if (object._classInfo.afterUpdateObjectHook) {
            object._classInfo.afterUpdateObjectHook(object, inputValues, oldValues);
        }
    }

    deleteObject(object: EezObject) {
        return deleteObject(
            {
                undoManager: UndoManager,
                selectionManager: NavigationStore
            },
            object
        );
    }

    deleteObjects(objects: EezObject[]) {
        if (objects.length === 1) {
            this.deleteObject(objects[0]);
        } else {
            deleteObjects(
                {
                    undoManager: UndoManager,
                    selectionManager: NavigationStore
                },
                objects
            );
        }
    }

    replaceObject(object: EezObject, replaceWithObject: EezObject) {
        if (object._parent !== replaceWithObject._parent) {
            console.error("assert failed");
        }

        return replaceObject(
            {
                undoManager: UndoManager,
                selectionManager: NavigationStore
            },
            object,
            replaceWithObject
        );
    }

    replaceObjects(objects: EezObject[], replaceWithObject: EezObject) {
        if (objects[0]._parent !== replaceWithObject._parent) {
            console.error("assert failed");
        }

        return replaceObjects(
            {
                undoManager: UndoManager,
                selectionManager: NavigationStore
            },
            objects,
            replaceWithObject
        );
    }

    insertObjectBefore(object: EezObject, objectToInsert: any) {
        return insertObjectBefore(
            {
                undoManager: UndoManager,
                selectionManager: NavigationStore
            },
            object,
            objectToInsert
        );
    }

    insertObjectAfter(object: EezObject, objectToInsert: any) {
        return insertObjectAfter(
            {
                undoManager: UndoManager,
                selectionManager: NavigationStore
            },
            object,
            objectToInsert
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

export function extendContextMenu(
    context: IContextMenuContext,
    object: EezObject,
    objects: EezObject[],
    menuItems: Electron.MenuItem[]
) {
    return object.extendContextMenu(context, objects, menuItems);
}

export function canAdd(object: EezObject) {
    return (isArrayElement(object) || isArray(object)) && object._classInfo.newItem != undefined;
}

function canDuplicate(object: EezObject) {
    return isArrayElement(object);
}

function isOptional(object: EezObject) {
    let parent = object._parent;
    if (!parent) {
        return false;
    }

    let property: PropertyInfo | undefined = findPropertyByName(parent, object._key!);

    if (property == undefined) {
        return false;
    }

    return property.isOptional;
}

export function canDelete(object: EezObject) {
    return isArrayElement(object) || isOptional(object);
}

export function canCut(object: EezObject) {
    return canCopy(object) && canDelete(object);
}

export function canCopy(object: EezObject) {
    return isArrayElement(object) || isOptional(object);
}

export function canContainChildren(object: EezObject) {
    for (const propertyInfo of object._classInfo.properties) {
        if (
            isPropertyEnumerable(object, propertyInfo) &&
            (propertyInfo.type === PropertyType.Array || propertyInfo.type === PropertyType.Object)
        ) {
            return true;
        }
    }

    return false;
}

export function canPaste(object: EezObject) {
    try {
        return checkClipboard(object);
    } catch (e) {
        return undefined;
    }
}

////////////////////////////////////////////////////////////////////////////////

export async function addItem(object: EezObject) {
    const parent = isArray(object) ? object : object._parent;
    if (!parent) {
        return null;
    }

    const parentClassInfo = parent._classInfo;
    if (!parentClassInfo.newItem) {
        return null;
    }

    let newObjectProperties;
    try {
        newObjectProperties = await parentClassInfo.newItem(parent);
    } catch (err) {
        if (err !== undefined) {
            notification.error(`Adding ${parent._class.name} failed: ${err}!`);
        }
        return null;
    }

    if (!newObjectProperties) {
        console.log(`Canceled adding ${parent._class.name}`);
        return null;
    }

    return DocumentStore.addObject(parent, newObjectProperties);
}

export function pasteItem(object: EezObject) {
    try {
        let c = checkClipboard(object);
        if (c) {
            if (typeof c.pastePlace === "string") {
                DocumentStore.updateObject(object, {
                    [c.pastePlace]: c.serializedData.object
                });
            } else {
                if (c.serializedData.object) {
                    if (
                        isArray(c.pastePlace as EezObject) &&
                        object._parent === (c.pastePlace as EezObject)
                    ) {
                        return DocumentStore.insertObject(
                            c.pastePlace as EezObject,
                            asArray(c.pastePlace as EezObject).indexOf(object) + 1,
                            objectToJS(c.serializedData.object)
                        );
                    } else {
                        return DocumentStore.addObject(
                            c.pastePlace as EezObject,
                            objectToJS(c.serializedData.object)
                        );
                    }
                } else if (c.serializedData.objects) {
                    return DocumentStore.addObjects(
                        c.pastePlace as EezObject,
                        objectToJS(c.serializedData.objects)
                    );
                }
            }
        }
    } catch (e) {
        console.error(e);
    }
    return undefined;
}

export function deleteItem(object: EezObject) {
    deleteItems([object]);
}

export function cutItem(object: EezObject) {
    let clipboardText = objectToClipboardData(object);

    deleteItems([object], () => {
        copyToClipboard(clipboardText);
    });
}

export function copyItem(object: EezObject) {
    copyToClipboard(objectToClipboardData(object));
}

function duplicateItem(object: EezObject) {
    let parent = object._parent as EezObject;
    return DocumentStore.addObject(parent, toJS(object));
}

export interface IContextMenuContext {
    selectObject(object: EezObject): void;
    selectObjects(objects: EezObject[]): void;
}

export function createContextMenu(context: IContextMenuContext, object: EezObject) {
    let menuItems: Electron.MenuItem[] = [];

    if (canAdd(object)) {
        menuItems.push(
            new MenuItem({
                label: "Add",
                click: async () => {
                    const aNewObject = await addItem(object);
                    if (aNewObject) {
                        context.selectObject(aNewObject);
                    }
                }
            })
        );
    }

    if (canDuplicate(object)) {
        menuItems.push(
            new MenuItem({
                label: "Duplicate",
                click: () => {
                    const aNewObject = duplicateItem(object);
                    if (aNewObject) {
                        context.selectObject(aNewObject);
                    }
                }
            })
        );
    }

    if (isArrayElement(object)) {
        if (menuItems.length > 0) {
            menuItems.push(
                new MenuItem({
                    type: "separator"
                })
            );
        }

        menuItems.push(
            new MenuItem({
                label: "Find All References",
                click: () => {
                    findAllReferences(object);
                }
            })
        );
    }

    let clipboardMenuItems: Electron.MenuItem[] = [];

    if (canCut(object)) {
        clipboardMenuItems.push(
            new MenuItem({
                label: "Cut",
                click: () => {
                    cutItem(object);
                }
            })
        );
    }

    if (canCopy(object)) {
        clipboardMenuItems.push(
            new MenuItem({
                label: "Copy",
                click: () => {
                    copyItem(object);
                }
            })
        );
    }

    if (canPaste(object)) {
        clipboardMenuItems.push(
            new MenuItem({
                label: "Paste",
                click: () => {
                    const aNewObject = pasteItem(object);
                    if (aNewObject) {
                        if (Array.isArray(aNewObject)) {
                            context.selectObjects(aNewObject);
                        } else {
                            context.selectObject(aNewObject);
                        }
                    }
                }
            })
        );
    }

    if (clipboardMenuItems.length > 0) {
        if (menuItems.length > 0) {
            menuItems.push(
                new MenuItem({
                    type: "separator"
                })
            );
        }
        menuItems = menuItems.concat(clipboardMenuItems);
    }

    if (canDelete(object)) {
        if (menuItems.length > 0) {
            menuItems.push(
                new MenuItem({
                    type: "separator"
                })
            );
        }

        menuItems.push(
            new MenuItem({
                label: "Delete",
                click: () => {
                    deleteItems([object]);
                }
            })
        );
    }

    extendContextMenu(context, object, [object], menuItems);

    if (menuItems.length > 0) {
        const menu = new Menu();
        menuItems.forEach(menuItem => menu.append(menuItem));
        return menu;
    }

    return undefined;
}

export function showContextMenu(context: IContextMenuContext, object: EezObject) {
    const menu = createContextMenu(context, object);

    if (menu) {
        menu.popup();
    }
}

////////////////////////////////////////////////////////////////////////////////

export function deleteItems(objects: EezObject[], callback?: () => void) {
    function doDelete() {
        DocumentStore.deleteObjects(objects);
        if (callback) {
            callback();
        }
    }

    if (objects.length === 1) {
        if (isReferenced(objects[0])) {
            confirm(
                "Are you sure you want to delete this item?",
                "It is used in other parts.",
                doDelete
            );
        } else {
            doDelete();
        }
    } else {
        let isAnyItemReferenced = false;

        for (let i = 0; i < objects.length; i++) {
            if (isReferenced(objects[i])) {
                isAnyItemReferenced = true;
                break;
            }
        }

        if (isAnyItemReferenced) {
            confirm(
                "Are you sure you want to delete this items?",
                "Some of them are used in other parts.",
                doDelete
            );
        } else {
            doDelete();
        }
    }
}

////////////////////////////////////////////////////////////////////////////////

function getUIStateFilePath(projectFilePath: string) {
    return projectFilePath + "-ui-state";
}

////////////////////////////////////////////////////////////////////////////////

class ProjectStoreClass {
    @observable
    filePath: string | undefined;

    @observable
    backgroundCheckEnabled = true;

    constructor() {
        autorun(() => {
            this.updateProjectWindowState();
        });

        autorun(() => {
            if (this.filePath) {
                this.updateMruFilePath();
            }
        });

        autorun(() => {
            // check the project in the background
            if (this.project && this.backgroundCheckEnabled) {
                backgroundCheck();
            }
        });
    }

    updateProjectWindowState() {
        let title = "";

        if (this.project) {
            if (DocumentStore.modified) {
                title += "\u25CF ";
            }

            if (this.filePath) {
                title += path.basename(this.filePath) + " - ";
            } else {
                title += "untitled - ";
            }
        }

        title += EEZStudio.title;

        if (title != document.title) {
            document.title = title;
        }

        EEZStudio.electron.ipcRenderer.send("windowSetState", {
            modified: DocumentStore.modified,
            projectFilePath: this.filePath,
            undo: (UndoManager && UndoManager.canUndo && UndoManager.undoDescription) || null,
            redo: (UndoManager && UndoManager.canRedo && UndoManager.redoDescription) || null
        });
    }

    get project() {
        return DocumentStore.document as Project;
    }

    updateMruFilePath() {
        ipcRenderer.send("setMruFilePath", this.filePath);
    }

    getFilePathRelativeToProjectPath(absoluteFilePath: string) {
        return path.relative(path.dirname(this.filePath), absoluteFilePath);
    }

    getAbsoluteFilePath(relativeFilePath: string) {
        return this.filePath
            ? path.resolve(
                  path.dirname(this.filePath),
                  relativeFilePath.replace(/(\\|\/)/g, path.sep)
              )
            : relativeFilePath;
    }

    getFolderPathRelativeToProjectPath(absoluteFolderPath: string) {
        let folder = path.relative(path.dirname(this.filePath), absoluteFolderPath);
        if (folder == "") {
            folder = ".";
        }
        return folder;
    }

    @computed
    get selectedBuildConfiguration() {
        let configuration =
            this.project &&
            this.project.settings.build.configurations.find(
                configuration => configuration.name == UIStateStore.selectedBuildConfiguration
            );
        if (!configuration) {
            if (this.project.settings.build.configurations.length > 0) {
                configuration = asArray(this.project.settings.build.configurations)[0];
            }
        }
        return configuration;
    }

    changeProject(projectFilePath: string | undefined, project?: Project, uiState?: Project) {
        if (project) {
            project.callExtendObservableForAllOptionalProjectFeatures();
        }

        action(() => {
            this.filePath = projectFilePath;
        })();

        DocumentStore.changeDocument(project, uiState);
    }

    doSave(callback: (() => void) | undefined) {
        if (this.filePath) {
            saveProject(this.filePath)
                .then(() => {
                    DocumentStore.setModified(false);

                    if (callback) {
                        callback();
                    }
                })
                .catch(error => console.error("Save", error));
        }
    }

    @action
    savedAsFilePath(filePath: string, callback: (() => void) | undefined) {
        if (filePath) {
            this.filePath = filePath;
            this.doSave(() => {
                this.saveUIState();
                if (callback) {
                    callback();
                }
            });
        }
    }

    async saveToFile(saveAs: boolean, callback: (() => void) | undefined) {
        if (this.project) {
            if (!this.filePath || saveAs) {
                const result = await EEZStudio.electron.remote.dialog.showSaveDialog(
                    EEZStudio.electron.remote.getCurrentWindow(),
                    {
                        filters: [
                            { name: "EEZ Project", extensions: ["eez-project"] },
                            { name: "All Files", extensions: ["*"] }
                        ]
                    }
                );
                if (result.filePath) {
                    this.savedAsFilePath(result.filePath, callback);
                }
            } else {
                this.doSave(callback);
            }
        }
    }

    newProject() {
        this.changeProject(undefined, getNewProject());
    }

    loadUIState(projectFilePath: string) {
        return new Promise<any>((resolve, reject) => {
            fs.readFile(getUIStateFilePath(projectFilePath), "utf8", (err: any, data: string) => {
                if (err) {
                    resolve({});
                } else {
                    resolve(JSON.parse(data));
                }
            });
        });
    }

    saveUIState() {
        if (this.filePath && UIStateStore.isModified) {
            fs.writeFile(
                getUIStateFilePath(this.filePath),
                UIStateStore.save(),
                "utf8",
                (err: any) => {
                    if (err) {
                        console.error(err);
                    } else {
                        console.log("UI state saved");
                    }
                }
            );
        }
    }

    openFile(filePath: string) {
        loadProject(filePath)
            .then(project => {
                this.loadUIState(filePath)
                    .then(uiState => {
                        this.changeProject(filePath, project, uiState);
                    })
                    .catch(error => console.error(error));
            })
            .catch(error => console.error(error));
    }

    open(sender: any, filePath: any) {
        if (!this.project || (!this.filePath && !DocumentStore.modified)) {
            this.openFile(filePath);
        }
    }

    saveModified(callback: any) {
        this.saveUIState();

        if (this.project && DocumentStore.modified) {
            confirmSave({
                saveCallback: () => {
                    this.saveToFile(false, callback);
                },

                dontSaveCallback: () => {
                    callback();
                },

                cancelCallback: () => {}
            });
        } else {
            callback();
        }
    }

    save() {
        this.saveToFile(false, undefined);
    }

    saveAs() {
        this.saveToFile(true, undefined);
    }

    check() {
        buildProject({ onlyCheck: true });
    }

    build() {
        buildProject({ onlyCheck: false });
    }

    buildExtensions() {
        buildExtensions();
    }

    closeWindow() {
        if (this.project) {
            this.saveModified(() => {
                this.changeProject(undefined);
                EEZStudio.electron.ipcRenderer.send("readyToClose");
            });
        } else {
            EEZStudio.electron.ipcRenderer.send("readyToClose");
        }
    }

    noProject() {
        this.changeProject(undefined);
    }

    showMetrics() {
        const ID = "eez-project-editor-project-metrics";
        if (!document.getElementById(ID)) {
            showGenericDialog({
                dialogDefinition: {
                    id: ID,
                    title: "Project Metrics",
                    fields: [
                        {
                            name: "metrics",
                            fullLine: true,
                            type: TableField
                        }
                    ]
                },
                values: {
                    metrics: getAllMetrics()
                },
                showOkButton: false
            }).catch(() => {});
        }
    }

    @computed
    get masterProjectEnabled() {
        return !!this.project.settings.general.masterProject;
    }

    masterProjectFilePath: string;
    @observable _masterPoject: Project | undefined;

    @computed
    get masterProject() {
        const masterProjectFilePath = this.project.settings.general.masterProject;
        if (masterProjectFilePath != this.masterProjectFilePath) {
            this.masterProjectFilePath = masterProjectFilePath;

            (async () => {
                const project = await loadProject(
                    ProjectStore.getAbsoluteFilePath(masterProjectFilePath)
                );
                runInAction(() => {
                    ProjectStore._masterPoject = project;
                });
            })();
        }

        return this._masterPoject;
    }
}

////////////////////////////////////////////////////////////////////////////////

export function init() {
    EEZStudio.electron.ipcRenderer.on("newProject", () => ProjectStore.newProject());

    EEZStudio.electron.ipcRenderer.on("open", (sender: any, filePath: any) =>
        ProjectStore.open(sender, filePath)
    );

    EEZStudio.electron.ipcRenderer.on("save", () => ProjectStore.save());
    EEZStudio.electron.ipcRenderer.on("saveAs", () => ProjectStore.saveAs());

    EEZStudio.electron.ipcRenderer.on("check", () => ProjectStore.check());
    EEZStudio.electron.ipcRenderer.on("build", () => ProjectStore.build());
    EEZStudio.electron.ipcRenderer.on("build-extensions", () => ProjectStore.buildExtensions());

    EEZStudio.electron.ipcRenderer.on("undo", () => UndoManager.undo());
    EEZStudio.electron.ipcRenderer.on("redo", () => UndoManager.redo());

    EEZStudio.electron.ipcRenderer.on(
        "cut",
        () => NavigationStore.selectedPanel && NavigationStore.selectedPanel.cutSelection()
    );
    EEZStudio.electron.ipcRenderer.on(
        "copy",
        () => NavigationStore.selectedPanel && NavigationStore.selectedPanel.copySelection()
    );
    EEZStudio.electron.ipcRenderer.on(
        "paste",
        () => NavigationStore.selectedPanel && NavigationStore.selectedPanel.pasteSelection()
    );
    EEZStudio.electron.ipcRenderer.on(
        "delete",
        () => NavigationStore.selectedPanel && NavigationStore.selectedPanel.deleteSelection()
    );

    // EEZStudio.electron.ipcRenderer.on('goBack', () => ProjectStore.selection.selectionGoBack());
    // EEZStudio.electron.ipcRenderer.on('goForward', () => ProjectStore.selection.selectionGoForward());

    EEZStudio.electron.ipcRenderer.on(
        "toggleOutput",
        action(
            () => (UIStateStore.viewOptions.outputVisible = !UIStateStore.viewOptions.outputVisible)
        )
    );
    EEZStudio.electron.ipcRenderer.on(
        "toggleDebug",
        action(
            () => (UIStateStore.viewOptions.debugVisible = !UIStateStore.viewOptions.debugVisible)
        )
    );

    EEZStudio.electron.ipcRenderer.on("showProjectMetrics", () => ProjectStore.showMetrics());

    if (window.location.search == "?mru") {
        let mruFilePath = ipcRenderer.sendSync("getMruFilePath");
        if (mruFilePath) {
            ProjectStore.openFile(mruFilePath);
        } else {
            ProjectStore.newProject();
        }
    } else if (window.location.search.startsWith("?open=")) {
        let ProjectStorePath = decodeURIComponent(
            window.location.search.substring("?open=".length)
        );
        ProjectStore.openFile(ProjectStorePath);
    } else if (window.location.search.startsWith("?new")) {
        ProjectStore.newProject();
    } else {
        ProjectStore.noProject();
    }
}

////////////////////////////////////////////////////////////////////////////////

export const DocumentStore = new DocumentStoreClass();
export const NavigationStore = new NavigationStoreClass();
export const EditorsStore = new EditorsStoreClass();
export const OutputSectionsStore = new OutputSections();
export const UIStateStore = new UIStateStoreClass();
export const UndoManager = new UndoManagerClass();
export const ProjectStore = new ProjectStoreClass();

////////////////////////////////////////////////////////////////////////////////

DocumentStore.clipboardDataId = "text/eez-studio-project-editor-data";
