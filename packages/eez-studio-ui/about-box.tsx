import React, { ReactNode } from "react";
import { observable, computed, runInAction } from "mobx";
import { observer } from "mobx-react";

import { formatDateTimeLong, compareVersions } from "eez-studio-shared/util";
import { showDialog, Dialog } from "eez-studio-ui/dialog";
import { styled } from "eez-studio-ui/styled-components";
import { Loader } from "eez-studio-ui/loader";

const STUDIO_RELEASES_URL = "https://api.github.com/repos/eez-open/studio/releases";
const STUDIO_SPECIFIC_RELEASE_URL = "https://github.com/eez-open/studio/releases/tag/";

const GET_LATEST_VERSION_MIN_DURATION = 1000;

function openLink(url: string) {
    const { shell } = require("electron");
    shell.openExternal(url);
}

async function getLatestVersion() {
    const startTime = new Date().getTime();
    return new Promise<string>((resolve, reject) => {
        let req = new XMLHttpRequest();
        req.responseType = "json";
        req.open("GET", STUDIO_RELEASES_URL);

        req.addEventListener("load", async () => {
            if (Array.isArray(req.response)) {
                let latestReleaseVersion: string | undefined = undefined;
                for (const release of req.response) {
                    if (typeof release.tag_name == "string") {
                        if (
                            release.tag_name !== "nightly-build" &&
                            (!latestReleaseVersion ||
                                compareVersions(release.tag_name, latestReleaseVersion) > 1)
                        ) {
                            latestReleaseVersion = release.tag_name;
                        }
                    }
                }

                if (latestReleaseVersion) {
                    const endTime = new Date().getTime();
                    const duration = endTime - startTime;
                    if (duration >= GET_LATEST_VERSION_MIN_DURATION) {
                        resolve(latestReleaseVersion);
                    } else {
                        setTimeout(() => resolve(latestReleaseVersion), 1000 - duration);
                    }
                } else {
                    reject();
                }
            }
        });

        req.addEventListener("error", error => {
            console.error(error);
            reject();
        });

        req.send();
    });
}

const Container = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;

    .EezStudio_Logo {
        margin-bottom: 10px;
    }

    .EezStudio_AppName {
        margin-bottom: 10px;
    }

    .EezStudio_BuildDate {
        font-size: 80%;
        margin-bottom: 10px;
    }

    .EezStudio_VersionInfo {
        display: flex;
        margin-bottom: 5px;

        > span {
            margin-left: 10px;
        }
    }

    .EezStudio_CheckForUpdate {
        margin-bottom: 10px;
    }
`;

@observer
class AboutBox extends React.Component {
    packageJSON: {
        version: string;
        homepage: string;
        repository: string;
    };

    @observable checkingForUpdates: boolean;
    @observable latestVersion: string;

    constructor(props: any) {
        super(props);

        this.packageJSON = require("../../package.json");
    }

    checkForUpdates = async (event: React.MouseEvent) => {
        event.preventDefault();

        if (this.checkingForUpdates) {
            return;
        }

        runInAction(() => {
            this.checkingForUpdates = true;
        });

        const latestVersion = await getLatestVersion();

        runInAction(() => {
            this.checkingForUpdates = false;
            this.latestVersion = latestVersion;
        });
    };

    @computed
    get versionInfo() {
        let versionInfo: ReactNode;

        if (this.checkingForUpdates) {
            versionInfo = (
                <>
                    <Loader size={20} />
                    <span>Checking for updates...</span>
                </>
            );
        } else {
            if (this.latestVersion) {
                if (compareVersions(this.latestVersion, this.packageJSON.version) > 0) {
                    versionInfo = (
                        <>
                            There is a newer version {this.latestVersion} (
                            <a
                                href="#"
                                onClick={event => {
                                    event.preventDefault();
                                    openLink(STUDIO_SPECIFIC_RELEASE_URL + this.latestVersion);
                                }}
                            >
                                download
                            </a>
                            )
                        </>
                    );
                } else {
                    versionInfo = "You have the latest version";
                }
            } else {
                versionInfo = "";
            }
        }

        return <div className="EezStudio_VersionInfo">{versionInfo}</div>;
    }

    render() {
        var fs = require("fs");
        var stats = fs.statSync(process.execPath);
        var mtime = new Date(stats.mtime);
        var buildDate = mtime.toString();

        return (
            <Dialog cancelButtonText="Close">
                <Container>
                    <div className="EezStudio_Logo">
                        <img
                            src="../eez-studio-ui/_images/eez_logo.png"
                            width={48}
                            height={48}
                        ></img>
                    </div>

                    <h5 className="EezStudio_AppName">EEZ Studio</h5>

                    <div className="EezStudio_Version">
                        Version {this.packageJSON.version} (
                        <a
                            href="#"
                            onClick={event => {
                                event.preventDefault();
                                openLink(STUDIO_SPECIFIC_RELEASE_URL + this.packageJSON.version);
                            }}
                        >
                            release notes
                        </a>
                        )
                    </div>

                    <div className="EezStudio_BuildDate">
                        Build date {formatDateTimeLong(new Date(buildDate))}
                    </div>

                    {this.versionInfo}

                    <button
                        className="EezStudio_CheckForUpdate btn btn-sm btn-light"
                        onClick={this.checkForUpdates}
                        disabled={this.checkingForUpdates}
                    >
                        Check for Updates
                    </button>

                    <div className="EezStudio_Links">
                        <a
                            href="#"
                            onClick={event => {
                                event.preventDefault();
                                openLink(this.packageJSON.homepage);
                            }}
                        >
                            Home
                        </a>
                        {" | "}
                        <a
                            href="#"
                            onClick={event => {
                                event.preventDefault();
                                openLink(this.packageJSON.repository);
                            }}
                        >
                            GitHub
                        </a>
                    </div>
                </Container>
            </Dialog>
        );
    }
}

export function showAboutBox() {
    showDialog(<AboutBox />);
}
