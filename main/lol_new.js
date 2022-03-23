const { ipcMain, shell, app, screen } = require('electron');
const {isNMP} = require("../renderer/utils/nmp");
const {exec} = require("child_process");
const {default: axios} = require("axios");
const WebSocket = require("ws");
const lolConstants = require("./constants/game/leagueoflegends");
const _ = require('lodash');
const {v4} = require("uuid");
const {sendGA4Event} = require("../assets/js/ga4");
const championsMetaData = require("../assets/data/meta/champions.json");

let rustProcess = () => {};
if (process.platform === "win32") {
    rustProcess = require("rust-process").checkProcess;
}

let IOVhook = null;
if (!isNMP) {
    IOVhook = require("node-ovhook");
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
if (!String.prototype.format) {
    String.prototype.format = function() {
        let args = arguments;
        return this.replace(/{(\d+)}/g, function(match, number) {
            return typeof args[number] != 'undefined'
                ? args[number]
                : match
                ;
        });
    };
}

let idToKey = (id) => {
    return _.find(championsMetaData.data, {id: id}).key;
};

let keyToId = (key) => {
    return _.find(championsMetaData.data, {key: key}).id;
}

let spellKeyToId = {
    SummonerBoost: 1,
    SummonerBarrier: 21,
    SummonerDot: 14,
    SummonerExhaust: 3,
    SummonerFlash: 4,
    SummonerHaste: 6,
    SummonerHeal: 7,
    SummonerMana: 13,
    SummonerPoroRecall: 30,
    SummonerPoroThrow: 31,
    SummonerSmite: 11,
    SummonerSnowURFSnowball_Mark: 39,
    SummonerSnowball: 32,
    SummonerTeleport: 12,
}

class LoL {
    constructor(application) {
        this.app = application;
        this.config = {
            port: 0,
            token: "",
            httpsURL: "",
            wssURL: "",
            opggRegion: "www",
            isRuneOn: true,
            isItemBuildOn: true,
            isSpellOn: true,
            isAutoAcceptOn: false,
            spellLocation: "d",
            isOverlayOn: false,
            region: null
        }
        this.game = {
            summoner: null,
            queueId: 0,
            championId: 0,
            perkPages: null,
            itemSets: null,
            spellSets: null,
            isPlaying: false,
            phase: ""
        }
        this.api = {
            combos: null
        }
        this.isGameRunning = false;
        this.detectGameProcessInterval = null;
        this.ws = null;
    }

    init() {
        // 설정 값 가져오기
        if (this.app.window) {
            this.app.window.getLocalStorage("autorune")
                .then((result) => {
                    this.config.isRuneOn = !(result === "false" || result === false);
                })
            this.app.window.getLocalStorage("autoitem")
                .then((result) => {
                    this.config.isItemBuildOn = !(result === "false" || result === false);
                })
            this.app.window.getLocalStorage("autoaccept")
                .then((result) => {
                    this.config.isAutoAcceptOn = !(result === "false" || result === false);
                })
            this.app.window.getLocalStorage("isSpell")
                .then((result) => {
                    this.config.isSpellOn = !(result === "false" || result === false);
                })
            this.app.window.getLocalStorage("spell")
                .then((result) => {
                    this.config.spellLocation = result === "d" ? "d" : "f";
                })
            this.app.window.getLocalStorage("isOverlay2")
                .then((result) => {
                    this.config.isOverlayOn = (result === "true" || result === true);
                })
        }

        this.ipc();
        this.detectGameProcess();

        this.callAPI("GET", "s3", `/combo_test.json?timestamp=${new Date().getTime()}`).then((data) => {
            this.broadcastIPC("combos", data.data);
            this.api.combos = data.data;
        });
    }

    detectGameProcess() {
        this.detectGameProcessInterval = setInterval(async () => {
            this.checkProcess();
            if (this.config.httpsURL) {
                let regionResponse = await this.callAPI("GET", "lol", lolConstants.LOL_REGION_LOCALE)
                    .catch((_) => {return null;});
                if (!regionResponse) return;
                this.config.region = regionResponse.data;
                if (lolConstants.GARENAS.includes(this.config.region.region)) {
                    this.broadcastIPC("is-garena", true);
                }
                this.config.opggRegion = lolConstants.OPGG_RIOT_REGION_MAP[this.config.region.region];
                if (this.config.region.region === "KR") {
                    ipcMain.emit("ads", "off", "off");
                } else {
                    ipcMain.emit("ads", "on", "on");
                }

                let summonerResponse = await this.callAPI("GET", "lol", lolConstants.LOL_CURRENT_SUMMONER)
                    .catch((_) => {return null;});
                if (!summonerResponse) return;
                this.game.summoner = summonerResponse.data;
                this.broadcastIPC("set-region", lolConstants.RIOT_REGION_MAP[this.config.region.region]);
                this.broadcastIPC("set-availability", lolConstants.SERVICE_AVAILABLE[this.config.region.region]);
                this.broadcastIPC("logged-in", this.game.summoner, true);
                if (isNMP) {
                    this.app.window.setTitle("OPGG_Logged_in");
                }
                this.app.window.show();

                let summonerRankResponse = await this.callAPI("GET", "lol", `${lolConstants.LOL_RANKED_STATS}/${this.game.summoner.puuid}`)
                    .catch((_) => {return null});
                if (!summonerRankResponse) return;
                sendGA4Event("login_lol", {
                    login_lol: true,
                    summoner_name: this.game.summoner.displayName,
                    summoner_rank: summonerRankResponse.data.highestRankedEntry.tier,
                    server: this.config.region.region,
                    summoner_level: this.game.summoner.summonerLevel,
                    number_of_monitors: screen.getAllDisplays().length,
                    screen_resolution: `${screen.getPrimaryDisplay().size.width}*${screen.getPrimaryDisplay().size.height}`
                }, {
                    login_lol: true,
                    summoner_name: this.game.summoner.displayName,
                    summoner_rank: summonerRankResponse.data.highestRankedEntry.tier,
                    server: this.config.region.region,
                    summoner_level: this.game.summoner.summonerLevel,
                    number_of_monitors: screen.getAllDisplays().length,
                    screen_resolution: `${screen.getPrimaryDisplay().size.width}*${screen.getPrimaryDisplay().size.height}`
                });

                setTimeout(() => {
                    this.initDesktopApp();
                }, 1000);
                // console.log(this.config, this.game);
                this.websocket();
                clearInterval(this.detectGameProcessInterval);
                this.detectGameProcessInterval = null;
                ipcMain.emit("guest");
            }
        }, 3000);
    }

    websocket() {
        if (this.ws === null || (this.ws !== null && this.ws.readyState === WebSocket.OPEN)) {
            this.ws = new WebSocket(this.config.wssURL, {
                headers: {
                    Authorization: `Basic ${Buffer.from(`riot:${this.config.token}`).toString('base64')}`
                },
                rejectUnauthorized: false
            });

            this.ws.on("open", () => {
                this.ws.send(JSON.stringify([5, 'OnJsonApiEvent']));
            });

            this.ws.on("message", (content) => {
                try {
                    const json = JSON.parse(content)
                    let data = json.slice(2)[0].data;
                    let uri = json.slice(2)[0].uri;
                    // console.log(uri);

                    switch (uri) {
                        case lolConstants.LOL_GAMEFLOW_SESSION:
                            this.game.queueId = data.gameData.queue.id;
                            this.gameFlowChanged(data);
                            break;

                        case lolConstants.LOL_CHAMPSELECT_SESSION:
                            this.champSelectionSession(data);
                            break;

                        case "/lol-matchmaking/v1/ready-check":
                            console.log(data)
                            if (data.state === "InProgress") {
                                if (this.config.isAutoAcceptOn){
                                    this.acceptMatch();
                                }
                            }
                            break;

                        case lolConstants.LOL_PRESHUTDOWN_BEGIN:
                            this.ws.close();
                            break;
                    }
                } catch {
                }
            });

            this.ws.on("error", (err) => {
                console.log(err);
            });

            this.ws.on("close", () => {
                console.log("close");
                this.ws.close();
                this.ws = null;
                this.broadcastIPC("logged-in", null, true);
                if (isNMP) {
                    this.app.window.setTitle("OP.GG for Desktop");
                }
                this.detectGameProcess();
            });
        }
    }

    // Edited By BlacK201
    async initDesktopApp() {
        // 인게임정보
        let gameFlow = await this.callAPI("GET", "lol", lolConstants.LOL_GAMEFLOW_SESSION).catch((_) => {return null;});
        if (gameFlow) {
            this.game.queueId = gameFlow.data.gameData.queue.id;
            this.gameFlowChanged(gameFlow.data);
        }

        // 멀티서치, 챔피언분석
        // 为实现强制刷新 判断游戏类型 使用不同的地址取得数据
        let championSelect = null;
        if (this.game.queueId === -1){
            championSelect = await this.callAPI("GET", "lol", lolConstants.LOL_CHAMPSELECT_LEGACY_SESSION).catch((_) => {return null;});
        } else {
            championSelect = await this.callAPI("GET", "lol", lolConstants.LOL_TEAM_BUILDER_SESSION).catch((_) => {return null;});
        }
        console.log(championSelect.data)
        if (championSelect) {
            this.champSelectionSession(championSelect.data);
        }
    }

    async acceptMatch() {
        await this.callAPI("POST", "lol", "/lol-lobby-team-builder/v1/ready-check/accept").catch((_) => {console.log(_)});
    }

    checkProcess() {
        let platform = process.platform;
        let cmd = platform === 'win32' ? 'tasklist' : (platform === 'darwin' ? 'ps -ax | grep LeagueClientUx' : (platform === 'linux' ? 'ps -A' : ''));
        if (cmd === '') return;

        try {
            if (platform === "darwin") {
                this.execShellCommand(cmd).then((stdout) => {
                    this.config.port = stdout.split("--app-port=")[1].split(" ")[0];
                    this.config.token = stdout.split("--remoting-auth-token=")[1].split(" ")[0];
                    this.config.httpsURL = `https://riot:${this.config.token}@127.0.0.1:${this.config.port}`;
                    this.config.wssURL = `wss://riot:${this.config.token}@127.0.0.1:${this.config.port}`;
                    this.isGameRunning = true;
                });
            } else if (platform === "win32") {
                if (isNMP) {
                    let result = require("rust-process").checkPCBangProcess();
                    if (result === "FOUND") {
                        app.exit(1000);
                    }
                }

                let stdout = rustProcess();
                if (stdout.indexOf('--app-port=') !== -1) {
                    this.config.port = stdout.split('--app-port=')[1].split('"')[0];
                    this.config.token = stdout.split('--remoting-auth-token=')[1].split('"')[0];
                    this.config.httpsURL = `https://riot:${this.config.token}@127.0.0.1:${this.config.port}`;
                    this.config.wssURL = `wss://127.0.0.1:${this.config.port}`;
                    this.isGameRunning = true;
                } else {
                    // if League Client is running on admin
                    if (stdout === "") {
                        this.broadcastIPC("admin");
                    }
                }
            }
        } catch {
        }
    };

    execShellCommand(cmd) {
        return new Promise((resolve, reject) => {
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    console.warn(error);
                }
                resolve(stdout ? stdout : stderr);
            });
        });
    }

    broadcastIPC(event, data, toMiniRemote = false) {
        if (this.app.window !== null) {
            this.app.window.sendToRenderer(event, data);
        }

        if (this.app.overlayWindow !== null) {
            this.app.overlayWindow.sendToRenderer(event, data);
        }

        if (toMiniRemote && this.app.remoteWindow !== null) {
            this.app.remoteWindow.sendToRenderer(event, data);
        }
    };

    callAPI(method, game, url, data = null, options = {}) {
        let self = this;
        return new Promise(function (resolve, reject) {
            let uri = "";
            if (game === "lol") {
                uri = self.config.httpsURL;
            } else if (game === "opgg") {
                uri = `https://${self.config.opggRegion}.op.gg`;
            } else if (game === "opggkr") {
                uri = `https://www.op.gg`;
            } else if (game === "s3") {
                uri = lolConstants.OPGG_DESKTOP_APP_S3;
            } else if (game === "s3-980ti") {
                uri = lolConstants.OPGG_980TI_S3;
            } else if (game === "liveclientdata") {
                uri = `https://127.0.0.1:2999/liveclientdata`;
            } else if (game === "lfg") {
                uri = "http://13.125.58.3";
            } else if (game === "data") {
                uri = "https://7xm409rj2j.execute-api.ap-northeast-2.amazonaws.com";
            } else if (game === "data2") {
                uri = "https://m9km92rbn4.execute-api.ap-northeast-2.amazonaws.com/";
            } else if (game === "lol-api-champion") {
                uri = "https://lol-api-champion.op.gg";
            } else if (game === "lol-api-summoner") {
                uri = "https://lol-api-summoner.op.gg"
            }

            let axiosOptions = {
                method: method,
                url: `${uri}${url}`,
                data: data,
                timeout: 10000,
                headers: {
                    "User-Agent": "OP.GG Desktop App"
                }
            };

            Object.keys(options).forEach((key) => {
                axiosOptions[key] = options[key];
            });

            axios(axiosOptions)
                .then(function (response) {
                    resolve(response);
                }).catch(function (error) {
                reject(error);
            }).finally(function () {
            });
        });
    };

    gameFlowChanged(data) {
        switch (data.phase) {
            case "ChampSelect":
                if (this.game.phase === data.phase) break;
                this.broadcastIPC("is-lol-game-live", true);
                this.broadcastIPC("lol-current-game-queue", this.game.queueId);
                break;
            case "Lobby":
                if (this.game.phase === data.phase) break;
                if (!isNMP) {
                    try {
                        if (data.map.gameMode === "TFT") {
                            this.broadcastIPC("switch-tft");
                        }
                    } catch (_) {}
                }
                this.broadcastIPC("is-lol-game-live", false);
                this.game.isPlaying = false;
                break;
            case "Matchmaking":
                if (this.game.phase === data.phase) break;
                break;
            case "PreEndOfGame":
                if (this.game.phase === data.phase) break;
                break;
            case "InProgress":
                if (this.game.phase === data.phase) break;

                if (data.gameClient.serverIp !== "") {
                    sendGA4Event("play_game", {
                        queueId: this.game.queueId,
                        gameId: data.gameData.gameId
                    });
                } else {
                    sendGA4Event("spectate_game", {
                        queueId: this.game.queueId
                    });
                }
                if (!lolConstants.TFT_QUEUE_IDS.includes(this.game.queueId)) {
                    let tmpName = "";
                    if (data.gameClient.serverIp !== "") {
                        tmpName = this.game.summoner.displayName;
                    } else {
                        tmpName = data.gameData.playerChampionSelections[0].summonerInternalName;
                        this.broadcastIPC("lol-current-game-queue", -9998);
                    }

                    let ingameInterval = setInterval(async () => {
                        let liveClientData = await this.callAPI("GET", "liveclientdata", "/allgamedata").catch((_) => {
                            return null;
                        });
                        if (!liveClientData) return;
                        clearInterval(ingameInterval);
                        ingameInterval = null;

                        this.getIngameData(tmpName);
                    }, 1000);

                    // overlay
                    if (!isNMP && this.app.overlayWindow && process.platform === "win32" &&
                        IOVhook && this.config.isOverlayOn) {
                        let isInjected = false;
                        if (!isInjected) {
                            let tmpInterval = setInterval(() => {
                                for (let i = 0; i < IOVhook.getTopWindows().length; i++) {
                                    const p = IOVhook.getTopWindows()[i];
                                    if (p.title === "League of Legends (TM) Client") {
                                        isInjected = true;
                                        clearInterval(tmpInterval);
                                        IOVhook.injectProcess(p);
                                    }
                                }
                            }, 3000);
                        }
                    }
                }
                break;
            case "EndOfGame":
                if (this.game.phase === data.phase) break;
                if (this.game.queueId === 400 || this.game.queueId === 420 || this.game.queueId === 430 || this.game.queueId === 440 || this.game.queueId === 450 || this.game.queueId === -1) {
                    let apiName = "data";
                    if (this.game.queueId === 450) {
                        apiName = "data2";
                    }
                    let intervalEOG = setInterval(() => {
                        this.callAPI("GET", "lol", lolConstants.LOL_EOG_STATS_BLOCK).then((data) => {
                            sendGA4Event("play_game_end", {
                                queueId: this.game.queueId,
                                gameId: data.data.gameId,
                                gameLength: data.data.gameLength
                            });
                            this.broadcastIPC("eog", data.data);
                            this.callAPI("POST", apiName, "/opscore", data.data).then((response) => {
                                response.data.winningTeam = data.data.teams[0].isWinningTeam ? 100 : 200;
                                this.broadcastIPC("opscore", response.data);
                            });
                            clearInterval(intervalEOG);
                        }).catch((err) => {
                            console.log(err);
                        });
                    }, 1000);
                }
                this.game.isPlaying = false;
                break;
            case null:
            default:
                this.game.phase = "";
                this.game.isPlaying = false;
                this.broadcastIPC("is-lol-game-live", false);
                this.broadcastIPC("lol-current-game-queue", -9999);
        }

        this.game.phase = data.phase;
    }

    async champSelectionSession(data) {
        if (!this.game.isPlaying) {
            this.game.isPlaying = true;

            let promises = [];
            let summoners = [];
            if (this.config.region.region !== "TENCENT") {
                data.myTeam.forEach((summoner) => {
                    promises.push(
                        this.callAPI("GET", "lol", `${lolConstants.LOL_GET_SUMMONER}/${summoner.summonerId}`).then((response) => {
                            summoners.push(response.data.displayName);
                        })
                    );
                });
                Promise.all(promises).then(() => {
                    this.callAPI("GET", "lol-api-summoner", `/api/${lolConstants.RIOT_REGION_MAP[this.config.region.region]}/summoners?name=${encodeURI(summoners.join(","))}`)
                        .then(async (res) => {
                            if (res.status === 200) {
                                if (res.data) {
                                    let summonerIds = [];
                                    res.data.data.map((summoner) => {
                                        summonerIds.push(summoner.summoner_id);
                                    });

                                    let tmpSummoners = [];
                                    if (summonerIds.length > 0) {
                                        for (let i = 0; i < summonerIds.length; i++) {
                                            let tmp = await this.callAPI("GET", "lol-api-summoner", `/api/${lolConstants.RIOT_REGION_MAP[this.config.region.region]}/summoners/${summonerIds[i]}/summary`)
                                                .catch(() => {return null;});
                                            if (tmp) {
                                                tmpSummoners.push(tmp.data.data);
                                            }
                                        }
                                        this.broadcastIPC("multisearch", tmpSummoners);
                                    }
                                }
                            }
                        });
                })
            }
        }

        let localPlayerCellId = data.localPlayerCellId;
        let me = _.find(data.myTeam, {cellId: localPlayerCellId});
        let hasChange = false;

        if (me) {
            if (me.championId !== 0 && me.championId !== this.game.championId) {
                hasChange = true;
                this.game.championId = me.championId;
            } else if (me.championPickIntent !== 0 && me.championPickIntent !== this.game.championId) {
                hasChange = true;
                this.game.championId = me.championPickIntent;
            }
        }

        if (hasChange) {
            let selectedRegion = await this.app.window.getLocalStorage("selected-region") ?? "kr";
            let tierFilter = await this.app.window.getLocalStorage("tier-filter") ?? "platinum_plus";
            let versionFilter = await this.app.window.getLocalStorage("version-filter") ?? "";
            // Edited By BlacK201
            // 因为韩服数据不足
            // 当模式为无限乱斗（900）时 使用北美服务器数据
            if (this.game.queueId === 900) {
                selectedRegion = "na";
            }
            this.getChampionData("", this.game.championId, this.game.queueId, true, selectedRegion, tierFilter, -1, versionFilter);
        }

        let enemyPickedChampions = [];
        data.theirTeam.forEach((enemy) => {
            if (enemy.championId !== 0) {
                enemyPickedChampions.push({
                    "id": enemy.championId,
                    "key": idToKey(enemy.championId)
                });
            }
        });
        if (enemyPickedChampions.length > 0) {
            this.broadcastIPC("enemyPicked", enemyPickedChampions);
        }
    }

    async getChampionData(position, championId = 0, queueId = 420,
                    isLive = true, region = "kr", tier = "platinum_plus",
                    targetChampion = -1, version = "") {
        this.game.perkPages = {
            "top": [],
            "jungle": [],
            "mid": [],
            "adc": [],
            "support": [],
            "urf": [],
            "aram": []
        };
        this.game.itemSets = {
            "top": {},
            "jungle": {},
            "mid": {},
            "adc": {},
            "support": {},
            "urf": {},
            "aram": {}
        };
        this.game.spellSets = [];

        let i18nLocale = await this.app.window.getLocalStorage("i18n");
        let isKR = i18nLocale === "kr";

        let mode = "ranked";
        if (queueId === 900) {
            mode = "urf";
            tier = "gold_plus";
        } else if (queueId === 450) {
            mode = "aram";
            tier = "gold_plus";
        }

        let primaryLane = mode;
        let overviewAPI = `/api/${region}/champions/${mode}/${championId}`;
        let summaries = null;

        if (position === "") {
            summaries = await this.callAPI("GET", "lol-api-champion", `/api/${region}/champions/${mode}/${championId}/summaries?tier=${tier}&version=${version}`).catch(() => {
                return null;
            });

            // if (summaries && (summaries.data.data.is_rip || summaries.data.data.positions.length === 0)) {
                // this.broadcastIPC("champions", {
                //     data: summaries.data.data,
                //     queueId: 0,
                //     tips: null,
                //     lane: null
                // });
                // return null;
            // }
        }

        if (mode === "ranked") {
            if (summaries) {
                if (summaries && (summaries.data.data.is_rip || summaries.data.data.positions.length === 0)) {
                    primaryLane = "top";
                } else {
                    primaryLane = summaries.data.data.positions[0].name.toLowerCase();
                }
            }
            if (position) {
                primaryLane = position.toLowerCase();
            }
            overviewAPI += `/${primaryLane}?tier=${tier}&target_champion=${targetChampion === -1 ? "" : targetChampion}&version=${version}`;
        } else {
            overviewAPI += `/none?tier=${tier}&version=${version}`;
        }

        if (summaries || position) {
            // Edited By BlacK201
            // let tips = await this.callAPI("GET", "s3-980ti", `/tips/{0}/tips_${isKR ? "kr" : "en"}.json`.format(championId))
            //     .catch(() => {return null;});
            // if (tips) tips = tips.data;

            // let counters = await this.callAPI("GET", "s3", `/analytics/counter/${championId}/${primaryLane}.json`)
            //     .catch(() => {return null;});
            // if (counters) counters = counters.data;

            let overview = await this.callAPI("GET", "lol-api-champion", overviewAPI).catch(() => {return null;});
            if (overview) {
                overview = overview.data.data;
                if (isLive) {
                    // Edited By BlacK201
                    this.broadcastIPC("champions", {
                        queueId: queueId,
                        data: overview,
                        tips: null,
                        lane: primaryLane,
                        counters: null
                    });

                    // 자동 스펠 설정
                    let selectionBody = {};
                    if (overview.summoner_spells.length > 0) {
                        let flashIndex = overview.summoner_spells[0].ids[0] === 4 ? 0 : 1;
                        if (overview.summoner_spells[0].ids[0] !== 4 && overview.summoner_spells[0].ids[1] !== 4) {
                            flashIndex = 0;
                        }
                        selectionBody = {
                            "spell1Id": overview.summoner_spells[0].ids[1-flashIndex], // d
                            "spell2Id": overview.summoner_spells[0].ids[flashIndex] // f
                        }

                        if (this.config.spellLocation === "d") {
                            selectionBody = {
                                "spell1Id": overview.summoner_spells[0].ids[flashIndex], // d
                                "spell2Id": overview.summoner_spells[0].ids[1-flashIndex] // f
                            }
                        }
                        this.game.spellSets = [overview.summoner_spells[0].ids[flashIndex], overview.summoner_spells[0].ids[1-flashIndex]];
                    }

                    // 자동 룬 설정
                    overview.rune_pages.map((page, index) => {
                        if (index < 2) {
                            page.builds.map((build, i) => {
                                if (i < 2) {
                                    let tmp = {
                                        "autoModifiedSelections": [
                                            0
                                        ],
                                        "current": true,
                                        "id": 0,
                                        "isActive": true,
                                        "isDeletable": true,
                                        "isEditable": true,
                                        "isValid": true,
                                        "lastModified": 0,
                                        "name": `OP.GG ${primaryLane} ${this.app.i18n[i18nLocale].translation["champions"][championId]}`,
                                        "order": 0,
                                        "primaryStyleId": build.primary_page_id,
                                        "selectedPerkIds": [].concat(build.primary_rune_ids, build.secondary_rune_ids, build.stat_mod_ids),
                                        "subStyleId": build.secondary_page_id
                                    };

                                    this.game.perkPages[primaryLane].push(tmp);
                                }
                            })
                        }
                    });

                    // 자동 아이템 설정
                    let makeBlock = (type) => {
                        return {
                            "type": type,
                            "hideIfSummonerSpell": "",
                            "showIfSummonerSpell": "",
                            "items": []
                        };
                    };

                    let itemSet = {
                        "associatedChampions": championId === 0 ? [] : [championId],
                        "associatedMaps": [],
                        "blocks": [],
                        "map": "any",
                        "mode": "any",
                        "preferredItemSlots": [],
                        "sortrank": 1,
                        "priority":true,
                        "startedFrom": "blank",
                        "title": `OP.GG ${this.app.i18n[i18nLocale].translation["champions"][championId]}`,
                        "type": "custom",
                        "uid": v4()
                    };
                    let block = {};
                    let cnt = 0;
                    let title = "";

                    // 시작 아이템
                    if (overview.starter_items.length > 0) {
                        cnt = 0;
                        overview.starter_items.some((starter_item) => {
                            if (cnt === 2) return;
                            title = `${this.app.i18n[i18nLocale].translation.live.feature.champion["starter-item"]}`;
                            if (cnt === 0 && overview.skills.length > 0) {
                                title += ` - Lv 1~4 ${overview.skills[0].order[0]}>${overview.skills[0].order[1]}>${overview.skills[0].order[2]}>${overview.skills[0].order[3]}`;
                            }
                            block = makeBlock(title);
                            starter_item.ids.forEach((id) => {
                                let itemObject = {
                                    count: 1,
                                    id: id.toString()
                                }
                                block.items.push(itemObject);
                            });
                            itemSet.blocks.push(block);
                            cnt += 1;
                        });
                    }

                    // 신발
                    title = `${this.app.i18n[i18nLocale].translation.live.feature.champion["boots"]}`;
                    if (overview.skill_masteries.length > 0) {
                        title += ` - Skill Build ${overview.skill_masteries[0].ids[0]}>${overview.skill_masteries[0].ids[1]}>${overview.skill_masteries[0].ids[2]}`
                    }
                    block = makeBlock(title);
                    if (overview.boots.length > 0) {
                        cnt = 0;
                        overview.boots.some((boot) => {
                            if (cnt === 3) return;
                            let itemObject = {
                                count: 1,
                                id: boot.ids[0].toString()
                            }
                            block.items.push(itemObject);
                            cnt += 1;
                        });
                        itemSet.blocks.push(block);
                    }

                    // 추천 빌드
                    cnt = 0;
                    overview.core_items.forEach((coreItem) => {
                        if (cnt === 3) return;
                        block = makeBlock(`${this.app.i18n[i18nLocale].translation.live.feature.champion["recommend-build"]} - Pick:${(coreItem.pick_rate*100).toFixed(2)}, Win:${(coreItem.win/coreItem.play*100).toFixed(2)}`);
                        coreItem.ids.forEach((id) => {
                            id = this.itemBugHotfix(id);
                            let itemObject = {
                                count: 1,
                                id: id.toString()
                            }
                            block.items.push(itemObject);
                        })
                        itemSet.blocks.push(block);
                        cnt += 1;
                    });

                    let tmpItems = [];
                    cnt = 0;
                    block = makeBlock(this.app.i18n[i18nLocale].translation.live.feature.champion["core-items"]);
                    overview.core_items.some((core_item) => {
                        if (cnt === 10) return;
                        core_item.ids.some((id) => {
                            id = this.itemBugHotfix(id);
                            if (tmpItems.indexOf(id) === -1) {
                                tmpItems.push(id);
                                cnt += 1;
                                let itemObject = {
                                    count: 1,
                                    id: id.toString()
                                }
                                block.items.push(itemObject);
                            }
                        })
                    });
                    itemSet.blocks.push(block);

                    this.game.itemSets[primaryLane] = itemSet;

                    if (this.config.isSpellOn) {
                        let updateResult = await this.callAPI("PATCH", "lol", lolConstants.LOL_CHAMPSELECT_MY_SELECTION, selectionBody).catch(() => { return null; });
                        if (!updateResult) {
                            // 스펠 설정 오류 알림
                        }
                    }

                    if (this.config.isRuneOn) {
                        this.checkPerkPage(this.game.perkPages[primaryLane][0]);
                    }

                    if (this.config.isItemBuildOn) {
                        this.updateItemSet(this.game.itemSets[primaryLane]);
                    }
                } else {
                    // Edited By BlacK201
                    let tips = await this.callAPI("GET", "s3-980ti", `/tips/{0}/tips_${isKR ? "kr" : "en"}.json`.format(championId))
                    .catch(() => {return null;});
                    if (tips) tips = tips.data;

                    let counters = await this.callAPI("GET", "s3", `/analytics/counter/${championId}/${primaryLane}.json`)
                        .catch(() => {return null;});
                    if (counters) counters = counters.data;
                    return {
                        queueId: queueId,
                        data: overview,
                        tips: tips,
                        lane: primaryLane,
                        counters: counters
                    };
                }
            }
            else {
                this.broadcastIPC("champions", null);
            }
        } else {
            this.broadcastIPC("champions", null);
        }
    }

    checkPerkPage(newPage) {
        if (newPage) {
            this.callAPI("GET", "lol", lolConstants.LOL_PERK_PAGES).then((response) => {
                let pageExists = false;
                response.data.some((page) => {
                    if (page.name.indexOf("OP.GG") !== -1) {
                        pageExists = true;
                        this.callAPI("DELETE", "lol", lolConstants.LOL_PERK_PAGE.format(page.id)).then((response) => {
                            this.updatePerkPage(newPage)
                        }).catch((err) => {
                            console.log(err);
                        });
                        return true;
                    }
                });

                if (!pageExists) {
                    this.updatePerkPage(newPage);
                }
            });
        }
    }

    updatePerkPage(page) {
        this.callAPI("POST", "lol", lolConstants.LOL_PERK_PAGES, page).then((_) => {})
            .catch((err) => {
            // if all rune pages are not available
            this.callAPI("GET", "lol", lolConstants.LOL_PERK_PAGES).then((response) => {
                this.callAPI("DELETE", "lol", lolConstants.LOL_PERK_PAGE.format(response.data[0].id))
                    .then((_) => {this.updatePerkPage(page)})
                    .catch((_) => {});
            });
        });
    };

    updateItemSet(itemSet) {
        if (this.game.summoner !== null) {
            this.callAPI("GET", "lol",
                lolConstants.LOL_ITEM_SETS.format(this.game.summoner.summonerId))
                .then((response) => {

                let data = response.data;

                let newItemSets = {
                    accountId: this.game.summoner.accountId,
                    timestamp: Date.now(),
                    itemSets: []
                };

                data.itemSets.forEach((d) => {
                    if (d.title.indexOf("OP.GG") === -1 && d.title !== "" && d.associatedChampions.length > 0) {
                        newItemSets.itemSets.push(d);
                    }
                });
                newItemSets.itemSets.push(itemSet);

                this.callAPI("PUT", "lol",
                    lolConstants.LOL_ITEM_SETS.format(this.game.summoner.summonerId), newItemSets);
            });
        }
    }

    updateSpellSet(key) {
        if (this.game.summoner !== null && this.game.queueId !== 1300 && this.game.queueId !== 1400) {
            try {
                let tmp = this.game.spellSets;
                let selectionBody = {
                    "spell1Id": tmp[1],
                    "spell2Id": tmp[0],
                };

                if (key === "d") {
                    selectionBody = {
                        "spell1Id": tmp[0],
                        "spell2Id": tmp[1],
                    };
                }

                this.callAPI("PATCH", "lol", lolConstants.LOL_CHAMPSELECT_MY_SELECTION, selectionBody);
            }
             catch (_) {}
        }
    }

    getIngameData(summonerName) {
        this.callAPI("GET", "opgg", encodeURI(`/app/summoner/spectator/index.json/summonerName=${summonerName}`)).then((data) => {
            this.broadcastIPC("ingame", data.data);
        }).catch((error) => {
            // console.log(error);
        });
    }

    async renewal(arg) {
        let opgg = await this.callAPI("GET", "lol-api-summoner", `/api/${lolConstants.RIOT_REGION_MAP[this.config.region.region]}/summoners?name=${encodeURI(arg)}`).catch(() => {return null});
        if (!opgg) return null;

        return await this.callAPI("POST", "lol-api-summoner", `/api/${lolConstants.RIOT_REGION_MAP[this.config.region.region]}/summoners/${opgg.data.data[0].summoner_id}/renewal`).then((res) => {
            return res.data;
        }).catch(() => {
            return null;
        });
    }

    async getMyPage(arg) {
        try {
            let i18nLocale = await this.app.window.getLocalStorage("i18n");
            try {
                let summoner = await this.callAPI("GET", "lol", `${lolConstants.LOL_GET_SUMMONER}?${encodeURI(`name=${arg}`)}`).catch(() => {
                    return null
                });
                if (summoner) {
                    summoner = summoner.data;
                    let response = await this.callAPI("GET", "lol", `${lolConstants.LOL_RANKED_STATS}/${summoner.puuid}`).catch(() => {
                        return null
                    });
                    if (response) {
                        let ranked = response.data;
                        let response2 = await this.callAPI("GET", "lol", lolConstants.LOL_CAREER_STATS_SUMMONER_GAMES.format(summoner.puuid)).catch(() => {
                            return null
                        });
                        if (response2) {
                            let opgg = await this.callAPI("GET", "lol-api-summoner", `/api/${lolConstants.RIOT_REGION_MAP[this.config.region.region]}/summoners?name=${encodeURI(summoner.displayName)}`).catch(() => {
                                return null
                            });
                            // let opgg = await callAPI("GET", "lol-api-summoner", `/api/${newRegionMap[regionConfig.region]}/summoners?name=${encodeURI("디알엑스 제트")}`).catch((err) => {return null});
                            if (opgg) {
                                let opggSummoner = await this.callAPI("GET", "lol-api-summoner", `/api/${lolConstants.RIOT_REGION_MAP[this.config.region.region]}/summoners/${opgg.data.data[0].summoner_id}?hl=${lolConstants.LOCALE_MAP[i18nLocale]}`).catch(() => {
                                    return null
                                });
                                if (opggSummoner) {
                                    opggSummoner = opggSummoner.data.data;
                                    if (opggSummoner.lp_histories) {
                                        for (let i = 0; i < opggSummoner.lp_histories.length; i++) {
                                            let tmpDate = new Date(opggSummoner.lp_histories[i].created_at);
                                            let lpHistory = opggSummoner.lp_histories[i];
                                            lpHistory.created_at = `${('0' + (tmpDate.getMonth() + 1)).slice(-2)}.${('0' + tmpDate.getDate()).slice(-2)}`;
                                            if (lpHistory.tier_info) {
                                                lpHistory.tier = lpHistory.tier_info.tier[0] + lpHistory.tier_info.division + " " + lpHistory.tier_info.lp + "LP";
                                            } else {
                                                lpHistory.tier = "";
                                            }
                                        }
                                    }

                                    let games = await this.callAPI("GET", "lol-api-summoner", `/api/${lolConstants.RIOT_REGION_MAP[this.config.region.region]}/summoners/${opgg.data.data[0].summoner_id}/games?limit=20&hl=${lolConstants.LOCALE_MAP[i18nLocale]}`).catch(() => {
                                        return null
                                    });
                                    if (games) {
                                        return {
                                            career: response2.data,
                                            summoner: summoner,
                                            ranked: ranked,
                                            opgg: opggSummoner,
                                            games: games.data.data
                                        }
                                    }

                                    return {
                                        career: response2.data,
                                        summoner: summoner,
                                        ranked: ranked,
                                        opgg: opggSummoner,
                                        games: []
                                    }
                                }
                            }

                            return {
                                career: response2.data,
                                summoner: summoner,
                                ranked: ranked,
                                opgg: null,
                                games: []
                            }
                        }
                        return {
                            career: null,
                            summoner: summoner,
                            ranked: ranked,
                            opgg: null,
                            games: []
                        }
                    }
                    return {
                        career: null,
                        summoner: summoner,
                        ranked: null,
                        opgg: null,
                        games: []
                    }
                }

                return null;
            } catch (e) {
                return null;
            }
        } catch (_) {return null;}
    }

    itemBugHotfix(id) {
        switch (id) {
            case 3042: // 무라마나 -> 마나무네
                id = 3004;
                break;
            case 3040: // 대천사의 포옹 => 대천사의 지팡이
                id = 3003;
                break;
            default:
                break;
        }

        return id;
    }

    ipc() {
        ipcMain.on("current-summoner", (event) => {
            event.returnValue = this.game.summoner;
        });

        ipcMain.handle("current-summoner", () => {
            return this.game.summoner;
        });

        ipcMain.on("force-refresh-champion", () => {
            this.game.championId = 0;
            this.game.queueId = 0;
            this.initDesktopApp();
        });

        ipcMain.on("update-perk-page", (event, arg) => {
            try {
                if (this.config.isRuneOn || arg["clicked"]) {
                    if (this.game.perkPages[arg["lane"]].length > 0) {
                        this.checkPerkPage(this.game.perkPages[arg["lane"]][arg["page"]]);
                    }
                }
            } catch (e) {}
        });

        ipcMain.on("update-item-set", (event, arg) => {
            if (this.config.isItemBuildOn) {
                this.updateItemSet(this.game.itemSets[arg]);
            }
        });

        ipcMain.on("update-spell-set", (event, arg) => {
            try {
                if (this.config.isSpellOn) {
                    this.updateSpellSet(arg);
                }
            } catch(e) {}
        });

        ipcMain.on("update-champion-lane", (event, arg) => {
            this.getChampionData(arg[0], arg[1], arg[2], true, arg[4], arg[5], -1, arg[6]);
        });

        ipcMain.handle("get-champion-data", async (event, arg) => {
            return this.getChampionData(arg[0], arg[1], arg[2], arg[3], arg[4], arg[5], arg[6], arg[7]);
        });

        ipcMain.handle("get-combos", () => {
            return this.api.combos;
        });

        ipcMain.on("autorune", (event, arg) => {
            this.config.isRuneOn = arg;
        });

        ipcMain.on("autoitem", (event, arg) => {
            this.config.isItemBuildOn = arg;
        });

        ipcMain.on("autoaccept", (event, arg) => {
            this.config.isAutoAcceptOn = arg;
        });

        ipcMain.on("spell", (event, arg) => {
            this.config.spellLocation = arg;
        });

        ipcMain.on("isSpell", (event, arg) => {
            this.config.isSpellOn = arg;
        });

        ipcMain.on("isOverlay", (event, arg) => {
            this.config.isOverlayOn = arg;
        });

        ipcMain.on("openOPGG", (event) => {
            shell.openExternal(`https://${this.config.opggRegion}.op.gg/`);
        });

        ipcMain.on("openSummonerPage", (event, arg) => {
            if (arg) {
                if (arg === true) {
                    arg = this.game.summoner.displayName;
                }
                shell.openExternal(`https://${this.config.opggRegion}.op.gg/summoner/userName=${arg}`);
            }
        });

        ipcMain.on("openChampionPage", (event, arg) => {
            let mode = this.game.queueId === 900 ? "urf" : (this.game.queueId === 450 ? "aram" : "champion");
            shell.openExternal(`https://${this.config.opggRegion}.op.gg/${mode}/${arg["key"]}/statistics${arg["lane"] ? `/${arg["lane"]}` : ""}`);
        });

        ipcMain.on("openChampionMainPage", (event, arg) => {
            shell.openExternal(`https://${this.config.opggRegion}.op.gg/champion/statistics`);
        });

        ipcMain.on("openChampionPageWithParameter", (event, arg) => {
            shell.openExternal(`https://${this.config.opggRegion}.op.gg/${arg["mode"]}/${arg["key"]}/statistics/${arg["lane"]}`);
        });

        ipcMain.on("reloadIngameData", (event, arg) => {
            this.getIngameData(this.game.summoner.displayName);
        });

        ipcMain.handle("lol-renewal", async (event, arg) => {
            return await this.renewal(arg);
        });

        ipcMain.handle("mypage", async (event, arg) => {
            return await this.getMyPage(arg);
        });

        ipcMain.handle("ingame-lcu", async () => {
            let liveClientData = await this.callAPI("GET", "liveclientdata", "/allgamedata").catch((_) => {return null;});
            let gameFlow = await this.callAPI("GET", "lol", lolConstants.LOL_GAMEFLOW_SESSION).catch((_) => {return null;});
            let summoners = [];
            let tmpSummoners = [];
            if (!liveClientData || !gameFlow) return {gameFlow: null, summoners: null};

            gameFlow.data.gameData.playerChampionSelections2 = [];
            liveClientData.data.allPlayers.forEach((player) => {
                summoners.push(player.summonerName);
                let championId = keyToId(player.rawChampionName.split("game_character_displayname_")[1]);
                let spell1Id = spellKeyToId[player.summonerSpells.summonerSpellOne.rawDisplayName.split("GeneratedTip_SummonerSpell_")[1].split("_DisplayName")[0]];
                let spell2Id = spellKeyToId[player.summonerSpells.summonerSpellTwo.rawDisplayName.split("GeneratedTip_SummonerSpell_")[1].split("_DisplayName")[0]];

                gameFlow.data.gameData.playerChampionSelections2.push({
                    championId: championId,
                    selectedSkinIndex: 0,
                    spell1Id: spell1Id,
                    spell2Id: spell2Id,
                    summonerInternalName: player.summonerName
                });
            });

            let summonersResult = await this.callAPI("GET", "lol-api-summoner", `/api/${lolConstants.RIOT_REGION_MAP[this.config.region.region]}/summoners?name=${encodeURI(summoners.join(","))}`);
            if (summonersResult.status === 200) {
                if (summonersResult.data) {
                    let summonerIds = [];
                    summonersResult.data.data.map((summoner) => {
                        summonerIds.push(summoner.summoner_id);
                    });

                    if (summonerIds.length > 0) {
                        for (let i = 0; i < summonerIds.length; i++) {
                            let tmp = await this.callAPI("GET", "lol-api-summoner", `/api/${lolConstants.RIOT_REGION_MAP[this.config.region.region]}/summoners/${summonerIds[i]}/summary`)
                                .catch(() => {
                                    return null;
                                });
                            if (tmp) {
                                tmpSummoners.push(tmp.data.data);
                            }
                        }
                    }
                }
            }

            return {
                gameFlow: gameFlow.data,
                summoners: tmpSummoners
            }
        });
    }
}

module.exports = LoL;