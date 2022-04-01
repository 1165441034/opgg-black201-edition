import React, {ChangeEvent, useCallback, useEffect, useState} from 'react';
import {useTranslation} from "react-i18next";
import {useDispatch} from "react-redux";
import {setAppMode} from "../../../redux/slices/common";
import {useTypedSelector} from "../../../redux/store";
import Modal from "react-modal";
import customToastr from "../../../lib/toastr";
import { useHistory } from "react-router-dom";
import html2canvas from "html2canvas";
const Chance = require("chance");
const {isNMP} = require("../../../utils/nmp");
import {aprilFoolsDay} from "../../../utils/utils";

if (aprilFoolsDay(2022)) {
    window.$ = window.jQuery = require("jquery");
    require("jquery.easing");
}

let chance = new Chance();

const customStyles = {
    overlay: {
        backgroundColor: "transparent",
    },
    content : {
        top: '50%',
        left: '50%',
        right: 'auto',
        bottom: 'auto',
        marginRight: '-50%',
        transform: 'translate(-50%, -50%)',
        backgroundColor: "transparent",
        width: "800px",
        height: "150px",
        border: "none",
    }
};

const Header = () => {
    const { t, i18n } = useTranslation();
    const dispatch = useDispatch();
    const [closeModalIsOpen, setCloseModalIsOpen] = useState(false);
    const {appMode, summonerName, thumbnailUrl, lolCurrentGameQueue} = useTypedSelector(state => state.common);
    const [fingerSnap, setFingerSnap] = useState(false);
    const history = useHistory();

    let isOverlay;
    if (process.env.NODE_ENV === "development") {
        isOverlay = navigator.userAgent.includes("overlay");
    } else {
        isOverlay = location.href.includes("overlay");
    }

    useEffect(() => {

    }, [summonerName]);

    const onClickMinimize = () => {
        window.api.send("window-minimize");
    }

    const onClickClose = () => {
        if (isNMP) {
            setCloseModalIsOpen(true);
        } else {
            window.api.send("window-close");
        }
    }

    const onChangeAppMode = () => {
        const html = document.getElementsByTagName("html")[0];
        const changeAppMode = appMode === "full" ? "mini" : "full";
        html.classList[changeAppMode === 'mini' ? 'add' : 'remove']('mini');
        window.api.send("change-app-mode-react", changeAppMode);
        localStorage.setItem("app_mode", changeAppMode);
        dispatch(setAppMode(changeAppMode));
    };

    const onClickSummonerName = (summonerName: string) => () => {
        if (summonerName) {
            // window.api.send("openSummonerPage", summonerName);
            history.push("/");
        } else {
            customToastr.warning(t("run-warning"));
        }
    }

    const tanos = () => {
        if (!fingerSnap && aprilFoolsDay(2022)) {
            setFingerSnap(true);
            let imageDataArray = [];
            let canvasCount = 35;
            let content = document.querySelector(".content");
            html2canvas(content).then(canvas => {
                let ctx = canvas.getContext("2d");
                ctx.fillStyle = "black";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                let pixelArr = imageData.data;
                createBlankImageData(imageData);
                for (let i = 0; i < pixelArr.length; i += 4) {
                    let p = Math.floor((i / pixelArr.length) * canvasCount);
                    let a = imageDataArray[weightedRandomDistrib(p)];
                    a[i] = pixelArr[i];
                    a[i + 1] = pixelArr[i + 1];
                    a[i + 2] = pixelArr[i + 2];
                    a[i + 3] = pixelArr[i + 3];
                }
                for (let i = 0; i < canvasCount; i++) {
                    let c = newCanvasFromImageData(imageDataArray[i], canvas.width, canvas.height);
                    c.classList.add("dust");
                    $(".content").append(c);
                }
                setTimeout(() => {
                    document.querySelector(".april-fool-text").style.display = "block";
                }, 6000);
                $(".content").children().not(".dust").fadeOut(6000);
                $(".dust").each(function (index) {
                    animateBlur($(this), 0.8, 0);
                    setTimeout(() => {
                        animateTransform($(this), 100, -100, chance.integer({min: -15, max: 15}), 800 + (110 * index));
                    }, 70 * index);
                    $(this).delay(70 * index).fadeOut((110 * index) + 800, "easeInQuint", () => {
                        $(this).remove();
                    });
                });
            });

            function weightedRandomDistrib(peak) {
                let prob = [], seq = [];
                for (let i = 0; i < canvasCount; i++) {
                    prob.push(Math.pow(canvasCount - Math.abs(peak - i), 3));
                    seq.push(i);
                }
                return chance.weighted(seq, prob);
            }

            function animateBlur(elem, radius, duration) {
                let r = 0;
                $({rad: 0}).animate({rad: radius}, {
                    duration: duration,
                    easing: "easeOutQuad",
                    step: function (now) {
                        elem.css({
                            filter: 'blur(' + now + 'px)'
                        });
                    }
                });
            }

            function animateTransform(elem, sx, sy, angle, duration) {
                let td, tx, ty = 0;
                $({x: 0, y: 0, deg: 0}).animate({x: sx, y: sy, deg: angle}, {
                    duration: duration,
                    easing: "easeInQuad",
                    step: function (now, fx) {
                        if (fx.prop == "x")
                            tx = now;
                        else if (fx.prop == "y")
                            ty = now;
                        else if (fx.prop == "deg")
                            td = now;
                        elem.css({
                            transform: 'rotate(' + td + 'deg)' + 'translate(' + tx + 'px,' + ty + 'px)'
                        });
                    }
                });
            }

            function createBlankImageData(imageData) {
                for (let i = 0; i < canvasCount; i++) {
                    let arr = new Uint8ClampedArray(imageData.data);
                    for (let j = 0; j < arr.length; j++) {
                        arr[j] = 0;
                    }
                    imageDataArray.push(arr);
                }
            }

            function newCanvasFromImageData(imageDataArray, w, h) {
                let canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                let tempCtx = canvas.getContext("2d");
                tempCtx.fillStyle = "black";
                tempCtx.fillRect(0, 0, canvas.width, canvas.height);
                tempCtx.putImageData(new ImageData(imageDataArray, w, h), 0, 0);

                return canvas;
            }
        }
    };

    return (
        <header id="app-header-win" className="app-header">
            <div className="game-select">
                <img width="32px" height="32px" src="../../assets/images/opgg-logo-square.svg" />
                {/*<img width="16px" height="16px" src="../../assets/images/icon-down.svg" className="down-arrow" />*/}
                <img width="24px" height="24px" src="../../assets/images/img-sidebar-lol.svg" style={{marginLeft: "8px"}} />
                <div style={{
                    marginLeft: "4px",
                    fontSize: "12px",
                    fontWeight: "normal"
                }}>League of Legends</div>
            </div>

            {lolCurrentGameQueue !== -9999 &&
                <>
                    {i18n.exists(`queue.${lolCurrentGameQueue}`)
                        ? <div className={"current-game-mode-badge"}>{t(`queue.${lolCurrentGameQueue}`)}</div>
                        : <div className={"current-game-mode-badge"}>{t(`queue.default`)}</div>
                    }
                </>
            }

            <div className="user-profile">
                {!isOverlay && <SummonerSearch />}

                <div className="account-info account-info-win" onMouseEnter={tanos}>
                    <div className="profile-image-wrapper">
                        <img className="info-profile-image" src={thumbnailUrl} alt={"thumbnail"} />
                    </div>

                    <div className="account">
                        <div className="summoner-name">
                            <div className="info-summoner-name" onClick={onClickSummonerName(summonerName)}>{summonerName ? summonerName : "Login First"}</div>
                        </div>
                        <div className="text-account-wrapper">
                            <div className="text-account">LoL Account</div>
                        </div>
                    </div>

                    {(aprilFoolsDay(2022) && localStorage.getItem("logged-in") === "true") &&
                      <div className={"content"} style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          marginLeft: "10px",
                          width: "60px",
                          height: "60px"
                      }}>
                          <img src={"../../assets/images/april/challenger.webp"} height={60}/>
                          <div className={"april-fool-text"} style={{
                              fontSize: "12px",
                              fontWeight: "bold",
                              textAlign: "center",
                              top: "10px",
                              display: "none",
                              wordBreak: "keep-all"
                          }}>HAHA April Fool's Day
                          </div>
                      </div>
                    }
                </div>
            </div>

            {!isOverlay &&
            <div className="title-bar-tools">
                <div className="tool-wrapper" id="minimize" onClick={onClickMinimize}>
                    <img alt="minimize" src="../../assets/images/icon-minus.svg"/>
                </div>
                <div className="tool-wrapper" id="close" onClick={onClickClose}>
                    <img alt="close" src="../../assets/images/icon-close.svg"/>
                </div>
                {!isNMP &&
                <div className="tool-wrapper" onClick={onChangeAppMode}>
                    <img alt="sidebar" src="../../assets/images/icon-mini.svg"/>
                </div>
                }
            </div>
            }
            {isOverlay &&
            <div style={{color: "#7b7a8e", fontSize: "12px", fontWeight: "bold"}}>Overlay On / Off [Shift + Tab]</div>
            }
            {isOverlay &&
            <img className="img-overlay-beta-main" src="../../assets/images/overlay-beta-main.svg" />
            }
            {isNMP && <CheckCloseModal  setModalIsOpen={setCloseModalIsOpen} modalIsOpen={closeModalIsOpen} />}
        </header>
    );
}

function SummonerSearch({ searchStyle = {}, inputStyle = {}, imgStyle = {} }) {
    const {t} = useTranslation();
    const [summonerName, setSummonerName] = useState("");
    const [modalIsOpen, setModalIsOpen] = useState(false);
    const handleUserKeyPress = useCallback(e => {
        if(e.which === 122) {
            e.preventDefault();
        } else if (e.key === "Enter" && e.ctrlKey) {
            // reactGa.event({
            //     category: 'SUMMONER_SEARCH',
            //     action: 'CLICKED',
            //     label: 'KEYBOARD'
            // });
            setModalIsOpen(!modalIsOpen);
        }
    }, [modalIsOpen]);

    useEffect(() => {
        window.addEventListener('keydown', handleUserKeyPress);

        return () => {
            window.removeEventListener('keydown', handleUserKeyPress);
        };
    }, [handleUserKeyPress]);

    const onFocusIn = (input: HTMLInputElement | null) => {
        if(input) input.focus();
    };

    const onClose = () => {
        setModalIsOpen(false);
    };

    const onOpen = () => {
        // reactGa.event({
        //     category: 'SUMMONER_SEARCH',
        //     action: 'CLICKED',
        //     label: 'INPUT'
        // });
        setModalIsOpen(true);
    };

    const onSearchSummonerName = (e: any) => {
        e.preventDefault();
        if(summonerName && summonerName !== "") {
            window.api.send("openSummonerPage", summonerName);
            setModalIsOpen(false);
            setSummonerName("");
        }
    };

    const onChangeSummonerName = (e: ChangeEvent<HTMLInputElement>) => {
        setSummonerName(e.target.value)
    };

    return (
        <>
            <div className="summoner-search" style={searchStyle} onClick={onOpen}>
                <input type="text" disabled className="summoner-search-input" placeholder={t("search-summoner")} style={inputStyle} />
                <img src="../../assets/images/icon-search.svg" style={imgStyle} />
            </div>
            <Modal
                isOpen={modalIsOpen}
                onRequestClose={onClose}
                style={customStyles}>
                <form onSubmit={onSearchSummonerName}>
                    <div id="popup-search" className="popup-search" style={{display: "flex"}}>
                        <input type="text" ref={onFocusIn} className="popup-search-input" placeholder={t("search-summoner")}  onChange={onChangeSummonerName} value={summonerName} />
                        <img src="../../assets/images/icon-search.svg"/>
                    </div>
                </form>
            </Modal>
        </>
    )
}


const CheckCloseModalStyles = {
    overlay: {
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        top: "0",
        left: "0",
        width: "1280px",
        height: "720px",
        position: "absolute",
        zIndex: "1000",
        backdropFilter: "blur(8px)",
        backgroundImage: "radial-gradient(circle at 50% 0, rgba(34, 34, 42, 0.82), rgba(19, 19, 23, 0.71) 75%)",
        backgroundColor: "transparent !important"
    },
    content : {
        top: '50%',
        left: '50%',
        right: 'auto',
        bottom: 'auto',
        marginRight: '-50%',
        transform: 'translate(-50%, -50%)',
        backgroundColor: "#282830",
        width: "350px",
        height: "170px",
        border: "none",
    }
};
interface CheckCloseModalProps {
    modalIsOpen: boolean
    setModalIsOpen: React.Dispatch<React.SetStateAction<boolean>>
}
function CheckCloseModal({modalIsOpen, setModalIsOpen}: CheckCloseModalProps) {
    const onClose = () => {
        setModalIsOpen(false);
    };

    return (
        <>
            <Modal
                isOpen={modalIsOpen}
                onRequestClose={onClose}
                style={CheckCloseModalStyles}>
                <div style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    height: "100%"
                }}>
                    <div style={{
                        fontSize: "15px",
                        fontWeight: "bold",
                        textAlign: "center",
                        marginBottom: "40px",
                        wordBreak: "keep-all"
                    }}>OP.GG for Desktop을 종료 시 다양한 기능을 이용하실 수 없습니다. 종료하시겠습니까?</div>
                    <div style={{
                        width: "fit-content",
                        display: "flex",
                        alignItems: "center",
                        fontSize: "12px",
                        margin: "0 auto"
                    }}>
                        <div style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "6px 12px",
                            borderRadius: "4px",
                            backgroundColor: "#5f32e6",
                            marginRight: "12px",
                            minWidth: "50px",
                            cursor: "pointer"
                        }} onClick={() => {
                            window.api.send("window-quit");
                        }}>예</div>
                        <div style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "6px 12px",
                            borderRadius: "4px",
                            backgroundColor: "#181819",
                            cursor: "pointer"
                        }} onClick={() => {
                            window.api.send("window-close");
                            window.api.send("change-caption");
                            setModalIsOpen(false);
                        }}>아니요 (트레이로 이동)</div>
                    </div>
                </div>
            </Modal>
        </>
    )
}

export default Header;