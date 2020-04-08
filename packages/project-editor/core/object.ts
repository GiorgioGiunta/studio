import React from "react";
import { observable } from "mobx";

import { _uniqWith } from "eez-studio-shared/algorithm";
import { humanize } from "eez-studio-shared/string";

import { loadObject, objectToJson } from "project-editor/core/serialization";
import { IContextMenuContext, INavigationStore } from "project-editor/core/store";
import { DragAndDropManagerClass } from "project-editor/core/dd";

////////////////////////////////////////////////////////////////////////////////

export interface EnumItem {
    id: string | number;
    label?: string;
}

export enum PropertyType {
    String,
    StringArray,
    MultilineText,
    JSON,
    Cpp,
    Number,
    NumberArray,
    Array,
    Object,
    Enum,
    Image,
    Color,
    ThemedColor,
    RelativeFolder,
    RelativeFile,
    ObjectReference,
    ConfigurationReference,
    Boolean,
    GUID,
    Any
}

export enum MessageType {
    INFO,
    ERROR,
    WARNING
}

export interface IMessage {
    type: MessageType;
    text: string;
    object?: EezObject;
}

export interface IPropertyGridGroupDefinition {
    id: string;
    title: string;
    position?: number;

    menu?: (
        object: EezObject
    ) =>
        | {
              label: string;
              click: () => void;
          }[]
        | undefined;
}

export const generalGroup: IPropertyGridGroupDefinition = {
    id: "general",
    title: "General",
    position: 0
};

export const geometryGroup: IPropertyGridGroupDefinition = {
    id: "geometry",
    title: "Position and size",
    position: 1
};

export const dataGroup: IPropertyGridGroupDefinition = {
    id: "data",
    title: "Data and actions",
    position: 2
};

export const actionsGroup = dataGroup;

export const styleGroup: IPropertyGridGroupDefinition = {
    id: "style",
    title: "Style",
    position: 3
};

export const specificGroup: IPropertyGridGroupDefinition = {
    id: "specific",
    title: "Specific",
    position: 4
};

export interface PropertyProps {
    propertyInfo: PropertyInfo;
    objects: EezObject[];
    updateObject: (propertyValues: Object) => void;
}

export interface IOnSelectParams {
    textInputSelection?: {
        start: number | null;
        end: number | null;
    };
}

export interface PropertyInfo {
    name: string;
    type: PropertyType;

    // optional properties
    displayName?: string;
    enumItems?: EnumItem[];
    typeClass?: EezClass;
    referencedObjectCollectionPath?: string[];
    matchObjectReference?: (object: EezObject, path: (string | number)[], value: string) => boolean;
    replaceObjectReference?: (value: string) => string;
    computed?: boolean;
    onSelect?: (
        object: EezObject,
        propertyInfo: PropertyInfo,
        params?: IOnSelectParams
    ) => Promise<any>;
    onSelectTitle?: string;
    hideInPropertyGrid?: boolean | ((object: EezObject, propertyInfo: PropertyInfo) => boolean);
    readOnlyInPropertyGrid?: boolean;
    propertyGridGroup?: IPropertyGridGroupDefinition;
    propertyGridComponent?: typeof React.Component;
    propertyGridCollapsable?: boolean;
    propertyGridCollapsableDefaultPropertyName?: string;
    propertyGridCollapsableEnabled?: () => boolean;
    enumerable?: boolean | ((object: EezObject, propertyInfo: PropertyInfo) => boolean);
    showOnlyChildrenInTree?: boolean;
    isOptional?: boolean;
    defaultValue?: any;
    inheritable?: boolean;
    propertyMenu?: (props: PropertyProps) => Electron.MenuItem[];
    unique?: boolean;
    skipSearch?: boolean;
    childLabel?: (childObject: EezObject, childLabel: string) => string;
    check?: (object: EezObject) => IMessage[];
    interceptAddObject?: (parentObject: EezObject, object: EezObject) => EezObject;
    downloadFileName?: (object: EezObject, propertyInfo: PropertyInfo) => string;
    embeddedImage?: boolean;
    partOfNavigation?: boolean;
    fileFilters?: any;
}

export interface NavigationComponentProps {
    id: string;
    navigationObject: EezObject;
    navigationStore?: INavigationStore;
    dragAndDropManager?: DragAndDropManagerClass;
    onDoubleClickItem?: (item: EezObject) => void;
}

export class NavigationComponent extends React.Component<NavigationComponentProps, {}> {}

export interface IEditorState {
    loadState(state: any): void;
    saveState(): any;
    selectObject(object: EezObject): void;
}

export interface IEditor {
    object: EezObject;
    state: IEditorState | undefined;
}

export interface EditorComponentProps {
    editor: IEditor;
}

export class EditorComponent extends React.Component<EditorComponentProps, {}> {}

export type InheritedValue =
    | {
          value: any;
          source: EezObject;
      }
    | undefined;

export interface ClassInfo {
    properties: PropertyInfo[];

    _arrayAndObjectProperties?: PropertyInfo[];

    // optional properties
    getClass?: (jsObject: any, aClass: EezClass) => any;
    label?: (object: EezObject) => string;
    listLabel?: (object: EezObject) => JSX.Element | string;

    parentClassInfo?: ClassInfo;

    showInNavigation?: boolean;
    hideInProperties?: boolean;
    isPropertyMenuSupported?: boolean;
    navigationComponent?: typeof NavigationComponent | null;
    navigationComponentId?: string;
    defaultNavigationKey?: string;

    editorComponent?: typeof EditorComponent;
    isEditorSupported?: (object: EezObject) => boolean;

    createEditorState?: (object: EezObject) => IEditorState;
    newItem?: (object: EezObject) => Promise<any>;
    findItemByName?: (name: string) => EezObject | undefined;
    getInheritedValue?: (object: EezObject, propertyName: string) => InheritedValue;
    defaultValue?: any;
    findPastePlaceInside?: (
        object: EezObject,
        classInfo: ClassInfo,
        isSingleObject: boolean
    ) => EezObject | PropertyInfo | undefined;
    icon?: string;

    propertyGridTableComponent?: any;

    beforeLoadHook?(object: EezObject, jsObject: any): void;

    updateObjectValueHook?: (
        object: EezObject,
        propertyName: string,
        value: any
    ) =>
        | {
              oldValue: any;
              newValue: any;
          }
        | undefined;

    afterUpdateObjectHook?: (object: EezObject, changedProperties: any, oldValues: any) => void;

    creatableFromPalette?: boolean;
}

export function makeDerivedClassInfo(
    baseClassInfo: ClassInfo,
    derivedClassInfoProperties: Partial<ClassInfo>
): ClassInfo {
    if (derivedClassInfoProperties.properties) {
        const b = baseClassInfo.properties; // base class properties
        const d = derivedClassInfoProperties.properties; // derived class properties
        const r = []; // resulting properties

        // put base and overriden properties into resulting properties array
        for (let i = 0; i < b.length; ++i) {
            let j;
            for (j = 0; j < d.length; ++j) {
                if (b[i].name === d[j].name) {
                    break;
                }
            }
            r.push(j < d.length ? d[j] /* overriden */ : b[i] /* base */);
        }

        // put derived (not overriden) properties into resulting array
        for (let i = 0; i < d.length; ++i) {
            let j;
            for (j = 0; j < r.length; ++j) {
                if (d[i].name === r[j].name) {
                    break;
                }
            }
            if (j === r.length) {
                r.push(d[i]);
            }
        }

        derivedClassInfoProperties.properties = r;
    }

    const baseBeforeLoadHook = baseClassInfo.beforeLoadHook;
    const derivedBeforeLoadHook = derivedClassInfoProperties.beforeLoadHook;
    if (baseBeforeLoadHook && derivedBeforeLoadHook) {
        derivedClassInfoProperties.beforeLoadHook = (object: EezObject, jsObject: any) => {
            baseBeforeLoadHook(object, jsObject);
            derivedBeforeLoadHook(object, jsObject);
        };
    }

    const derivedClassInfo = Object.assign({}, baseClassInfo, derivedClassInfoProperties);
    derivedClassInfo.parentClassInfo = baseClassInfo;
    return derivedClassInfo;
}

////////////////////////////////////////////////////////////////////////////////

export class EezObject {
    _id: string;
    _key?: string;
    _parent?: EezObject;
    _lastChildId?: number;
    @observable _modificationTime?: number;
    _propertyInfo?: PropertyInfo;

    static classInfo: ClassInfo;

    extendContextMenu(
        context: IContextMenuContext,
        objects: EezObject[],
        menuItems: Electron.MenuItem[]
    ): void {}
}

export class EezArrayObject<T> extends EezObject {
    @observable _array: T[] = [];

    get length() {
        return this._array.length;
    }

    indexOf(value: T) {
        return this._array.indexOf(value);
    }

    forEach(callback: (value: T, index: number, array: T[]) => void) {
        this._array.forEach(callback);
    }

    map<U>(callback: (value: T, index: number, array: T[]) => U): U[] {
        return this._array.map(callback);
    }

    find(callback: (value: T, index: number, array: T[]) => boolean) {
        return this._array.find(callback);
    }

    filter(callback: (value: T, index: number, array: T[]) => boolean): T[] {
        return this._array.filter(callback);
    }

    slice(start?: number | undefined, end?: number | undefined): T[] {
        return this._array.slice(start, end);
    }
}

////////////////////////////////////////////////////////////////////////////////

export type EezClass = typeof EezObject;

let classes = new Map<string, EezClass>();

export function registerClass(aClass: EezClass) {
    classes.set(aClass.name, aClass);
}

////////////////////////////////////////////////////////////////////////////////

export class EezValueObject extends EezObject {
    public propertyInfo: PropertyInfo;
    public value: any;

    static create(object: EezObject, propertyInfo: PropertyInfo, value: any) {
        const valueObject = new EezValueObject();

        setId(valueObject, getId(object) + "." + propertyInfo.name);
        setKey(valueObject, propertyInfo.name);
        setParent(valueObject, object);

        valueObject.propertyInfo = propertyInfo;
        valueObject.value = value;

        return valueObject;
    }

    static classInfo: ClassInfo = {
        label: (object: EezValueObject) => {
            return object.value && object.value.toString();
        },
        properties: []
    };
}

registerClass(EezValueObject);

////////////////////////////////////////////////////////////////////////////////

export function findClass(className: string) {
    return classes.get(className);
}

export function getClassesDerivedFrom(parentClass: EezClass) {
    const derivedClasses = [];
    for (const aClass of classes.values()) {
        if (isProperSubclassOf(aClass.classInfo, parentClass.classInfo)) {
            derivedClasses.push(aClass);
        }
    }
    return derivedClasses;
}

export function isSubclassOf(classInfo: ClassInfo | undefined, baseClassInfo: ClassInfo) {
    while (classInfo) {
        if (classInfo === baseClassInfo) {
            return true;
        }
        classInfo = classInfo.parentClassInfo;
    }
    return false;
}

export function isProperSubclassOf(classInfo: ClassInfo | undefined, baseClassInfo: ClassInfo) {
    if (classInfo) {
        while (true) {
            classInfo = classInfo.parentClassInfo;
            if (!classInfo) {
                return false;
            }
            if (classInfo === baseClassInfo) {
                return true;
            }
        }
    }
    return false;
}

export function isObjectInstanceOf(object: EezObject, baseClassInfo: ClassInfo) {
    return isSubclassOf(getClassInfo(object), baseClassInfo);
}

export function isValue(object: EezObject | undefined) {
    return !!object && object instanceof EezValueObject;
}

export function isObject(object: EezObject | undefined) {
    return !!object && !isValue(object) && !isArray(object);
}

export function isArray(object: EezObject | undefined): object is EezArrayObject<EezObject> {
    return !!object && !isValue(object) && object instanceof EezArrayObject;
}

export function asArray<T = EezObject>(object: EezObject | EezArrayObject<T>) {
    return object && ((object as EezArrayObject<T>)._array as T[]);
}

export function getChildren(parent: EezObject): EezObject[] {
    if (isArray(parent)) {
        return asArray(parent);
    } else {
        let properties = getClassInfo(parent).properties.filter(
            propertyInfo =>
                (propertyInfo.type === PropertyType.Object ||
                    propertyInfo.type === PropertyType.Array) &&
                isPropertyEnumerable(parent, propertyInfo) &&
                getProperty(parent, propertyInfo.name)
        );

        if (
            properties.length == 1 &&
            properties[0].type === PropertyType.Array &&
            !(properties[0].showOnlyChildrenInTree === false)
        ) {
            return asArray(getProperty(parent, properties[0].name));
        }

        return properties.map(propertyInfo => getProperty(parent, propertyInfo.name));
    }
}

export function getClass(object: EezObject) {
    if (object instanceof EezArrayObject) {
        return object._propertyInfo!.typeClass!;
    } else {
        return object.constructor as EezClass;
    }
}

export function getClassInfo(object: EezObject): ClassInfo {
    return getClass(object).classInfo;
}

export function getId(object: EezObject) {
    return object._id;
}

export function setId(object: EezObject, id: string) {
    object._id = id;
}

export function getParent(object: EezObject): EezObject {
    return object._parent!;
}

export function setParent(object: EezObject, childObject: EezObject) {
    object._parent = childObject;
}

export function getKey(object: EezObject): string {
    return object._key!;
}

export function setKey(object: EezObject, key: string) {
    object._key = key;
}

export function getModificationTime(object: EezObject): number {
    return object._modificationTime!;
}

export function setModificationTime(object: EezObject, modificationTime: number) {
    object._modificationTime = modificationTime;
}

export function getPropertyInfo(object: EezObject): PropertyInfo {
    return object._propertyInfo!;
}

export function setPropertyInfo(object: EezObject, propertyInfo: PropertyInfo) {
    object._propertyInfo = propertyInfo;
}

export function getNextChildId(object: EezObject) {
    if (object._lastChildId === undefined) {
        object._lastChildId = 1;
    } else {
        object._lastChildId++;
    }
    return object._lastChildId;
}

export function getEditorComponent(object: EezObject): typeof EditorComponent | undefined {
    const isEditorSupported = getClassInfo(object).isEditorSupported;
    if (isEditorSupported && !isEditorSupported(object)) {
        return undefined;
    }
    return getClassInfo(object).editorComponent;
}

export function getLabel(object: EezObject): string {
    const label = getClassInfo(object).label;
    if (label) {
        return label(object);
    }

    let name = (object as any).name;
    if (name) {
        return name;
    }

    return getId(object);
}

export function isAncestor(object: EezObject, ancestor: EezObject): boolean {
    if (object == undefined || ancestor == undefined) {
        return false;
    }

    if (object == ancestor) {
        return true;
    }

    let parent = getParent(object);
    return !!parent && isAncestor(parent, ancestor);
}

export function isProperAncestor(object: EezObject, ancestor: EezObject) {
    if (object == undefined || object == ancestor) {
        return false;
    }

    let parent = getParent(object);
    return !!parent && isAncestor(parent, ancestor);
}

function uniqueTop(objects: EezObject[]): EezObject[] {
    return _uniqWith(objects, (a: EezObject, b: EezObject) => isAncestor(a, b) || isAncestor(b, a));
}

function getParents(objects: EezObject[]): EezObject[] {
    return uniqueTop(
        objects.map(object => getParent(object)).filter(object => !!object) as EezObject[]
    );
}

export function reduceUntilCommonParent(objects: EezObject[]): EezObject[] {
    let uniqueTopObjects = uniqueTop(objects);

    let parents = getParents(uniqueTopObjects);

    if (parents.length == 1) {
        return uniqueTopObjects;
    }

    if (parents.length > 1) {
        return reduceUntilCommonParent(parents);
    }

    return [];
}

export function isArrayElement(object: EezObject) {
    return getParent(object) instanceof EezArrayObject;
}

export function findPropertyByName(objectOrClassInfo: EezObject | ClassInfo, propertyName: string) {
    const classInfo =
        objectOrClassInfo instanceof EezObject
            ? getClassInfo(objectOrClassInfo)
            : objectOrClassInfo;
    return classInfo.properties.find(propertyInfo => propertyInfo.name == propertyName);
}

export function findPropertyByChildObject(object: EezObject, childObject: EezObject) {
    return getClassInfo(object).properties.find(
        propertyInfo => getProperty(object, propertyInfo.name) === childObject
    );
}

export function getInheritedValue(object: EezObject, propertyName: string) {
    const getInheritedValue = getClassInfo(object).getInheritedValue;
    if (getInheritedValue) {
        return getInheritedValue(object, propertyName);
    }
    return undefined;
}

export function isPropertyHidden(object: EezObject, propertyInfo: PropertyInfo) {
    if (propertyInfo.hideInPropertyGrid === undefined) {
        return false;
    }

    if (typeof propertyInfo.hideInPropertyGrid === "boolean") {
        return propertyInfo.hideInPropertyGrid;
    }

    return propertyInfo.hideInPropertyGrid(object, propertyInfo);
}

export function isPropertyEnumerable(object: EezObject, propertyInfo: PropertyInfo) {
    if (propertyInfo.enumerable === undefined) {
        return true;
    }

    if (typeof propertyInfo.enumerable === "boolean") {
        return propertyInfo.enumerable;
    }

    return propertyInfo.enumerable(object, propertyInfo);
}

export function getProperty(object: EezObject, name: string) {
    return (object as any)[name];
}

export function getPropertyAsString(object: EezObject, propertyInfo: PropertyInfo) {
    let value = getProperty(object, propertyInfo.name);
    if (typeof value === "number") {
        return value.toString();
    }
    if (typeof value === "string") {
        return value;
    }
    if (value instanceof EezArrayObject) {
        return asArray(value as EezArrayObject<EezObject>)
            .map(object => getLabel(object))
            .join(", ");
    }
    if (value instanceof EezObject) {
        return objectToString(value);
    }
    return "";
}

export function humanizePropertyName(object: EezObject, propertyName: string) {
    const property = findPropertyByName(object, propertyName);
    if (property && property.displayName) {
        return property.displayName;
    }
    return humanize(propertyName);
}

export function objectToString(object: EezObject) {
    let label: string;

    if (isValue(object)) {
        label = getProperty(getParent(object), getKey(object));
    } else if (isArray(object)) {
        let propertyInfo = findPropertyByName(getParent(object), getKey(object));
        label = (propertyInfo && propertyInfo.displayName) || humanize(getKey(object));
    } else {
        label = getLabel(object);
    }

    if (
        object &&
        getParent(object) &&
        getParent(object) instanceof EezArrayObject &&
        getParent(getParent(object)) &&
        getKey(getParent(object))
    ) {
        let propertyInfo = findPropertyByName(
            getParent(getParent(object)),
            getKey(getParent(object))
        );
        if (propertyInfo && propertyInfo.childLabel) {
            label = propertyInfo.childLabel(object, label);
        }
    }

    return label;
}

export function getChildOfObject(
    object: EezObject,
    key: PropertyInfo | string | number
): EezObject | undefined {
    let propertyInfo: PropertyInfo | undefined;

    if (isArray(object)) {
        let elementIndex: number | undefined = undefined;

        if (typeof key == "string") {
            elementIndex = parseInt(key);
        } else if (typeof key == "number") {
            elementIndex = key;
        }

        const array = asArray(object);

        if (elementIndex !== undefined && elementIndex >= 0 && elementIndex < array.length) {
            return array[elementIndex];
        } else {
            console.error("invalid array index");
        }
    } else {
        if (typeof key == "string") {
            propertyInfo = findPropertyByName(object, key);
        } else if (typeof key == "number") {
            console.error("invalid key type");
        } else {
            propertyInfo = key;
        }
    }

    if (propertyInfo) {
        let childObjectOrValue = getProperty(object, propertyInfo.name);
        if (propertyInfo.typeClass) {
            return childObjectOrValue;
        } else {
            return EezValueObject.create(object, propertyInfo, childObjectOrValue);
        }
    }

    return undefined;
}

export function getAncestorOfType(object: EezObject, classInfo: ClassInfo): EezObject | undefined {
    if (object) {
        if (isObjectInstanceOf(object, classInfo)) {
            return object;
        }
        return getParent(object) && getAncestorOfType(getParent(object), classInfo);
    }
    return undefined;
}

export function getObjectPath(object: EezObject): (string | number)[] {
    let parent = getParent(object);
    if (parent) {
        if (isArray(parent)) {
            return getObjectPath(parent).concat(parent.indexOf(object as EezObject));
        } else {
            return getObjectPath(parent).concat(getKey(object));
        }
    }
    return [];
}

export function getObjectPropertyAsObject(object: EezObject, propertyInfo: PropertyInfo) {
    return getChildOfObject(object, propertyInfo) as EezValueObject;
}

export function getRootObject(object: EezObject) {
    while (getParent(object)) {
        object = getParent(object);
    }
    return object;
}

// Get object ancestors as array,
// from the root object up to the given object (including given object)
export function getAncestors(
    object: EezObject,
    ancestor?: EezObject,
    showSingleArrayChild?: boolean
): EezObject[] {
    if (!ancestor) {
        return getAncestors(object, getRootObject(object));
    }

    if (isValue(object)) {
        object = getParent(object);
    }

    if (isArray(ancestor)) {
        let possibleAncestor = ancestor.find(
            possibleAncestor =>
                object == possibleAncestor ||
                getId(object).startsWith(getId(possibleAncestor) + ".")
        );
        if (possibleAncestor) {
            if (possibleAncestor == object) {
                if (showSingleArrayChild) {
                    return [ancestor, object];
                } else {
                    return [object];
                }
            } else {
                if (showSingleArrayChild) {
                    return [ancestor as EezObject].concat(getAncestors(object, possibleAncestor));
                } else {
                    return getAncestors(object, possibleAncestor);
                }
            }
        }
    } else {
        let numObjectOrArrayProperties = 0;
        for (const propertyInfo of getClassInfo(ancestor).properties) {
            if (
                propertyInfo.type === PropertyType.Object ||
                propertyInfo.type === PropertyType.Array
            ) {
                numObjectOrArrayProperties++;
            }
        }

        if (numObjectOrArrayProperties > 0) {
            for (const propertyInfo of getClassInfo(ancestor).properties) {
                if (
                    propertyInfo.type === PropertyType.Object ||
                    propertyInfo.type === PropertyType.Array
                ) {
                    let possibleAncestor: EezObject = (ancestor as any)[propertyInfo.name];

                    if (possibleAncestor === object) {
                        return [ancestor];
                    }

                    if (
                        possibleAncestor &&
                        getId(object).startsWith(getId(possibleAncestor) + ".")
                    ) {
                        return [ancestor].concat(
                            getAncestors(object, possibleAncestor, numObjectOrArrayProperties > 1)
                        );
                    }
                }
            }
        }
    }
    return [];
}

export function getHumanReadableObjectPath(object: EezObject) {
    let ancestors = getAncestors(object);
    return ancestors
        .slice(1)
        .map(object => objectToString(object))
        .join(" / ");
}

export function getObjectPathAsString(object: EezObject) {
    return "/" + getObjectPath(object).join("/");
}

export function isObjectExists(object: EezObject) {
    let parent = getParent(object);
    if (parent) {
        if (isArray(parent)) {
            if (parent.indexOf(object) === -1) {
                return false;
            }
        } else {
            const key = getKey(object);
            if (key && (parent as any)[key] !== object) {
                return false;
            }
        }
    }
    return true;
}

export function getObjectFromPath(rootObject: EezObject, path: string[]) {
    let object = rootObject;

    for (let i = 0; i < path.length && object; i++) {
        object = getChildOfObject(object, path[i]) as EezObject;
    }

    return object;
}

export function getObjectFromStringPath(rootObject: EezObject, stringPath: string) {
    if (stringPath == "/") {
        return rootObject;
    }
    return getObjectFromPath(rootObject, stringPath.split("/").slice(1));
}

export function getObjectFromObjectId(
    rootObject: EezObject,
    objectID: string
): EezObject | undefined {
    function getDescendantObjectFromId(object: EezObject, id: string): EezObject | undefined {
        if (getId(object) == id) {
            return object;
        }

        if (isArray(object)) {
            let childObject = object.find(
                child => id == getId(child) || id.startsWith(getId(child) + ".")
            );
            if (childObject) {
                if (getId(childObject) == id) {
                    return childObject;
                }
                return getDescendantObjectFromId(childObject, id);
            }
        } else {
            for (const propertyInfo of getClassInfo(object).properties) {
                if (
                    propertyInfo.type === PropertyType.Object ||
                    propertyInfo.type === PropertyType.Array
                ) {
                    let childObject = getChildOfObject(object, propertyInfo);
                    if (childObject) {
                        if (getId(childObject) == id) {
                            return childObject;
                        }
                        if (id.startsWith(getId(childObject) + ".")) {
                            return getDescendantObjectFromId(childObject, id);
                        }
                    }
                }
            }
        }

        return undefined;
    }

    return getDescendantObjectFromId(rootObject, objectID as string);
}

export function cloneObject(parent: EezObject | undefined, obj: EezObject) {
    return loadObject(parent, objectToJson(obj), getClass(obj));
}

export function isShowOnlyChildrenInTree(object: EezObject) {
    if (!getParent(object) || !getKey(object)) {
        return true;
    }

    const propertyInfo = findPropertyByName(getParent(object), getKey(object));
    if (!propertyInfo) {
        return true;
    }

    return !(propertyInfo.showOnlyChildrenInTree === false);
}

export function areAllChildrenOfTheSameParent(objects: EezObject[]) {
    for (let i = 1; i < objects.length; i++) {
        if (getParent(objects[i]) !== getParent(objects[0])) {
            return false;
        }
    }
    return true;
}

export function isPartOfNavigation(object: EezObject) {
    if (getParent(object)) {
        let propertyInfo = findPropertyByChildObject(getParent(object), object);
        if (propertyInfo && propertyInfo.partOfNavigation === false) {
            return false;
        }
    }
    return true;
}

export function getArrayAndObjectProperties(object: EezObject) {
    if (!getClassInfo(object)._arrayAndObjectProperties) {
        getClassInfo(object)._arrayAndObjectProperties = getClassInfo(object).properties.filter(
            propertyInfo =>
                (propertyInfo.type === PropertyType.Array ||
                    propertyInfo.type === PropertyType.Object) &&
                getProperty(object, propertyInfo.name)
        );
    }
    return getClassInfo(object)._arrayAndObjectProperties!;
}

export interface PropertyValueSourceInfo {
    source: "" | "default" | "modified" | "inherited";
    inheritedFrom?: EezObject;
}

export function getCommonProperties(objects: EezObject[]) {
    let properties = getClassInfo(objects[0]).properties;

    properties = properties.filter(
        propertyInfo =>
            !objects.find(object => isArray(object) || isPropertyHidden(object, propertyInfo))
    );

    if (objects.length > 1) {
        // some property types are not supported in multi-objects property grid
        properties = properties.filter(
            propertyInfo =>
                propertyInfo.type !== PropertyType.Array &&
                !(propertyInfo.type === PropertyType.String && propertyInfo.unique === true)
        );

        // show only common properties
        properties = properties.filter(
            propertyInfo =>
                !objects.find(
                    object => !getClassInfo(object).properties.find(pi => pi === propertyInfo)
                )
        );
    }

    return properties;
}

export function getPropertySourceInfo(props: PropertyProps): PropertyValueSourceInfo {
    function getSourceInfo(object: EezObject, propertyInfo: PropertyInfo): PropertyValueSourceInfo {
        if (props.propertyInfo.propertyMenu) {
            return {
                source: ""
            };
        }

        let value = (object as any)[propertyInfo.name];

        if (propertyInfo.inheritable) {
            if (value === undefined) {
                let inheritedValue = getInheritedValue(object, propertyInfo.name);
                if (inheritedValue) {
                    return {
                        source: "inherited",
                        inheritedFrom: inheritedValue.source
                    };
                }
            }
        }

        if (value !== undefined) {
            return {
                source: "modified"
            };
        }

        return {
            source: "default"
        };
    }

    const sourceInfoArray = props.objects.map(object => getSourceInfo(object, props.propertyInfo));

    for (let i = 1; i < sourceInfoArray.length; i++) {
        if (sourceInfoArray[i].source !== sourceInfoArray[0].source) {
            return {
                source: "modified"
            };
        }
    }

    return sourceInfoArray[0];
}

export function isAnyPropertyModified(props: PropertyProps) {
    const properties = getCommonProperties(props.objects);
    for (let propertyInfo of properties) {
        const sourceInfo = getPropertySourceInfo({ ...props, propertyInfo });
        if (sourceInfo.source === "modified") {
            return true;
        }
    }
    return false;
}
