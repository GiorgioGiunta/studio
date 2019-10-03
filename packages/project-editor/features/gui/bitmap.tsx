import { computed, observable, action } from "mobx";
import React from "react";
import { observer } from "mobx-react";
import styled from "eez-studio-ui/styled-components";

import {
    ClassInfo,
    EezObject,
    registerClass,
    PropertyType,
    asArray,
    NavigationComponent
} from "project-editor/core/object";
import { NavigationStore } from "project-editor/core/store";
import { validators } from "eez-studio-shared/validation";

import { showGenericDialog } from "eez-studio-ui/generic-dialog";

import { ListNavigation } from "project-editor/components/ListNavigation";
import { Splitter } from "eez-studio-ui/splitter";

import { ThemesSideView } from "project-editor/features/gui/theme";

import { ProjectStore } from "project-editor/core/store";
import { RelativeFileInput } from "project-editor/components/RelativeFileInput";
import { PropertiesPanel } from "project-editor/project/ProjectEditor";

let fs = EEZStudio.electron.remote.require("fs");

////////////////////////////////////////////////////////////////////////////////

const BitmapEditorContainer = styled.div`
    flex-grow: 1;
    display: flex;
    justify-content: center; /* align horizontal */
    align-items: center; /* align vertical */
`;

@observer
class BitmapEditor extends React.Component<{ bitmap: Bitmap }> {
    render() {
        const bitmap = this.props.bitmap;

        const style = {
            backgroundColor: "transparent",
            width: "100%"
        };

        return (
            <BitmapEditorContainer>
                <div>
                    <div>
                        <img src={bitmap.image} style={style} />
                    </div>
                    {bitmap.imageElement && (
                        <h4>
                            Dimension: {bitmap.imageElement.width} x {bitmap.imageElement.height}
                        </h4>
                    )}
                </div>
            </BitmapEditorContainer>
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

@observer
export class BitmapsNavigation extends NavigationComponent {
    @computed
    get object() {
        if (NavigationStore.selectedPanel) {
            return NavigationStore.selectedPanel.selectedObject;
        }
        return NavigationStore.selectedObject;
    }

    render() {
        return (
            <Splitter
                type="horizontal"
                persistId={`project-editor/bitmaps`}
                sizes={`240px|100%|400px|240px`}
                childrenOverflow="hidden|hidden|hidden|hidden"
            >
                <ListNavigation id={this.props.id} navigationObject={this.props.navigationObject} />
                {this.object ? <BitmapEditor bitmap={this.object as Bitmap} /> : <div />}
                <PropertiesPanel object={this.object} />
                <ThemesSideView />
            </Splitter>
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

interface IBitmap {
    name: string;
    image: string;
    bpp: number;
}

export class Bitmap extends EezObject implements IBitmap {
    @observable name: string;
    @observable description?: string;
    @observable image: string;
    @observable bpp: number;
    @observable alwaysBuild: boolean;

    static classInfo: ClassInfo = {
        properties: [
            {
                name: "name",
                type: PropertyType.String,
                unique: true
            },
            {
                name: "description",
                type: PropertyType.MultilineText
            },
            {
                name: "image",
                type: PropertyType.Image,
                skipSearch: true,
                embeddedImage: true
            },
            {
                name: "bpp",
                displayName: "Bits per pixel",
                type: PropertyType.Enum,
                enumItems: [{ id: 16 }, { id: 32 }],
                defaultValue: 16
            },
            {
                name: "alwaysBuild",
                type: PropertyType.Boolean
            }
        ],
        newItem: (parent: EezObject) => {
            return showGenericDialog({
                dialogDefinition: {
                    title: "New Bitmap",
                    fields: [
                        {
                            name: "name",
                            type: "string",
                            validators: [
                                validators.required,
                                validators.unique({}, asArray(parent))
                            ]
                        },
                        {
                            name: "imageFilePath",
                            displayName: "Image",
                            type: RelativeFileInput,
                            validators: [validators.required],
                            options: {
                                filters: [
                                    { name: "PNG Image files", extensions: ["png"] },
                                    { name: "All Files", extensions: ["*"] }
                                ]
                            }
                        },
                        {
                            name: "bpp",
                            displayName: "Bits per pixel",
                            type: "enum",
                            enumItems: [16, 32]
                        }
                    ]
                },
                values: {
                    bpp: 32
                }
            }).then(result => {
                return new Promise<IBitmap>((resolve, reject) => {
                    fs.readFile(
                        ProjectStore.getAbsoluteFilePath(result.values.imageFilePath),
                        "base64",
                        (err: any, data: any) => {
                            if (err) {
                                reject(err);
                            } else {
                                resolve({
                                    name: result.values.name,
                                    image: "data:image/png;base64," + data,
                                    bpp: result.values.bpp
                                });
                            }
                        }
                    );
                });
            });
        },
        navigationComponent: BitmapsNavigation,
        navigationComponentId: "bitmaps",
        icon: "image"
    };

    @observable
    private _imageElement: HTMLImageElement | null = null;
    private _imageElementImage: string;

    @computed
    get imageElement() {
        if (!this.image) {
            return null;
        }

        if (this.image !== this._imageElementImage) {
            let imageElement = new Image();
            imageElement.src = this.image;
            imageElement.onload = action(() => {
                this._imageElement = imageElement;
                this._imageElementImage = this.image;
            });
        }

        return this._imageElement;
    }
}

registerClass(Bitmap);

////////////////////////////////////////////////////////////////////////////////

export interface BitmapData {
    width: number;
    height: number;
    bpp: number;
    pixels: number[];
}

export function getData(bitmap: Bitmap): Promise<BitmapData> {
    return new Promise((resolve, reject) => {
        let image = new Image();

        image.src = bitmap.image;

        image.onload = () => {
            let canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;

            let ctx = canvas.getContext("2d");
            if (ctx == null) {
                reject();
                return;
            }

            ctx.clearRect(0, 0, image.width, image.height);

            ctx.drawImage(image, 0, 0);

            let imageData = ctx.getImageData(0, 0, image.width, image.height).data;

            let pixels: number[] = [];
            for (let i = 0; i < 4 * image.width * image.height; i += 4) {
                let r = imageData[i];
                let g = imageData[i + 1];
                let b = imageData[i + 2];

                if (bitmap.bpp === 32) {
                    let a = imageData[i + 3];
                    pixels.push(b);
                    pixels.push(g);
                    pixels.push(r);
                    pixels.push(a);
                } else {
                    // rrrrrggggggbbbbb
                    pixels.push(((g & 28) << 3) | (b >> 3));
                    pixels.push((r & 248) | (g >> 5));
                }
            }

            resolve({
                width: image.width,
                height: image.height,
                bpp: bitmap.bpp,
                pixels: pixels
            });
        };

        image.onerror = () => {
            reject();
        };
    });
}
