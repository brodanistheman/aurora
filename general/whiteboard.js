
import {
    getApps,
    getApp,
    initializeApp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";

import {
    getAuth,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

import {
    getFirestore,
    doc,
    setDoc,
    addDoc,
    collection,
    query,
    where,
    onSnapshot,
    getDocs,
    deleteDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCLKCCpNbCs2AJm7g0JtGIjL43X5hr31N8",
    authDomain: "aurora-9e0fe.firebaseapp.com",
    projectId: "aurora-9e0fe",
    storageBucket: "aurora-9e0fe.firebasestorage.app",
    messagingSenderId: "1023486645506",
    appId: "1:1023486645506:web:c64a98ebf0c3c817e01e1b",
    measurementId: "G-3XVQTC189X"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const messageBox = document.getElementById("message-box");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");

const DEFAULT_COLOR = "#f2f2f0";
const DEFAULT_SECONDARY_COLOR = "#c2b28f";
const DEFAULT_THICKNESS = 4;
const PREVIEW_WIDTH = 320;
const PREVIEW_HEIGHT = 120;

let currentUser = null;
let currentDisplayName = "Anonymous";
let currentProfilePic = "";

const boardMessages = new Map();
const activeBoards = new Map();
const observedMessages = new WeakSet();

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getCachedAccount(uid) {
    try {
        const raw = localStorage.getItem(`aurora_account_${uid}`);
        return raw ? JSON.parse(raw).data : null;
    } catch {
        return null;
    }
}

onAuthStateChanged(auth, (user) => {
    currentUser = user;

    if (user) {
        const account = getCachedAccount(user.uid);

        if (account) {
            currentDisplayName = account.displayName || "Anonymous";
            currentProfilePic = account.profilePic || "";
        }
    }
});

function getMessageBody(messageElement) {
    return messageElement.querySelector(".message-body");
}

function getBoardStrokesRef(boardId) {
    return collection(db, "whiteboards", boardId, "strokes");
}

function getBoardRef(boardId) {
    return doc(db, "whiteboards", boardId);
}

function getBoardColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback;
}

function getBoardThickness(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return DEFAULT_THICKNESS;
    }

    return Math.min(32, Math.max(1, number));
}

function makeElement(tag, className, text = "") {
    const element = document.createElement(tag);

    if (className) {
        element.className = className;
    }

    if (text) {
        element.textContent = text;
    }

    return element;
}

function makeButton(text, className, title = text) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = className;
    button.textContent = text;
    button.title = title;

    return button;
}

function getCanvasPoint(event, canvas) {
    const rect = canvas.getBoundingClientRect();

    return {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    };
}

function createBoardMessage(messageId, message) {
    const messageElement = messageBox.querySelector(
        `[data-message-id="${CSS.escape(messageId)}"]`
    );

    if (!messageElement) {
        return;
    }

    const body = getMessageBody(messageElement);

    if (!body) {
        return;
    }

    const existing = body.querySelector(".whiteboard-message");

    if (existing && existing.dataset.boardId === message.whiteboardId) {
        return;
    }

    body.replaceChildren();

    const card = makeElement("section", "whiteboard-message");
    card.dataset.boardId = message.whiteboardId;

    const previewButton = makeButton(
        "",
        "whiteboard-preview-button",
        "Click to join whiteboard"
    );

    previewButton.setAttribute("aria-label", "Click to join whiteboard");

    const previewCanvas = document.createElement("canvas");
    previewCanvas.className = "whiteboard-preview-canvas";
    previewCanvas.width = PREVIEW_WIDTH;
    previewCanvas.height = PREVIEW_HEIGHT;

    const overlay = makeElement(
        "span",
        "whiteboard-preview-overlay",
        "Click to join"
    );

    previewButton.append(previewCanvas, overlay);

    const title = makeElement(
        "div",
        "whiteboard-card-title",
        `${message.displayName || "Anonymous"}'s whiteboard`
    );

    const expanded = makeElement("div", "whiteboard-expanded hidden");

    const toolbar = makeElement("div", "whiteboard-toolbar");

    const toolSelect = document.createElement("select");
    toolSelect.className = "whiteboard-tool-select";
    toolSelect.setAttribute("aria-label", "Drawing tool");

    [
        ["pen", "Pen"],
        ["eraser", "Eraser"],
        ["line", "Line"],
        ["rectangle", "Rectangle"],
        ["circle", "Circle"]
    ].forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        toolSelect.appendChild(option);
    });

    const thicknessLabel = makeElement("label", "whiteboard-control-label", "Thickness");

    const thicknessInput = document.createElement("input");
    thicknessInput.type = "range";
    thicknessInput.min = "1";
    thicknessInput.max = "32";
    thicknessInput.value = String(DEFAULT_THICKNESS);
    thicknessInput.className = "whiteboard-thickness";
    thicknessInput.setAttribute("aria-label", "Brush thickness");

    thicknessLabel.appendChild(thicknessInput);

    const thicknessValue = makeElement(
        "span",
        "whiteboard-thickness-value",
        `${DEFAULT_THICKNESS}px`
    );

    const colorLabel = makeElement("label", "whiteboard-control-label", "Color");

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = DEFAULT_COLOR;
    colorInput.className = "whiteboard-color";
    colorInput.setAttribute("aria-label", "Primary color");

    colorLabel.appendChild(colorInput);

    const secondaryLabel = makeElement(
        "label",
        "whiteboard-control-label",
        "Second color"
    );

    const secondaryInput = document.createElement("input");
    secondaryInput.type = "color";
    secondaryInput.value = DEFAULT_SECONDARY_COLOR;
    secondaryInput.className = "whiteboard-secondary-color";
    secondaryInput.setAttribute("aria-label", "Secondary color");

    secondaryLabel.appendChild(secondaryInput);

    const gradientLabel = makeElement("label", "whiteboard-checkbox-label");

    const gradientInput = document.createElement("input");
    gradientInput.type = "checkbox";
    gradientInput.className = "whiteboard-gradient";

    gradientLabel.append(gradientInput, document.createTextNode(" Gradient"));

    const clearButton = makeButton(
        "Clear",
        "whiteboard-control-button",
        "Clear the shared whiteboard"
    );

    const leaveButton = makeButton(
        "Leave",
        "whiteboard-control-button",
        "Collapse the whiteboard"
    );

    toolbar.append(
        toolSelect,
        thicknessLabel,
        thicknessValue,
        colorLabel,
        secondaryLabel,
        gradientLabel,
        clearButton,
        leaveButton
    );

    const canvasWrap = makeElement("div", "whiteboard-canvas-wrap");

    const canvas = document.createElement("canvas");
    canvas.className = "whiteboard-canvas";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Shared whiteboard drawing area");

    canvasWrap.appendChild(canvas);

    const status = makeElement(
        "div",
        "whiteboard-status",
        "Connecting to whiteboard..."
    );

    expanded.append(toolbar, canvasWrap, status);
    card.append(title, previewButton, expanded);
    body.appendChild(card);

    const boardState = {
        boardId: message.whiteboardId,
        messageId,
        message,
        card,
        previewCanvas,
        previewButton,
        expanded,
        canvas,
        canvasWrap,
        status,
        toolSelect,
        thicknessInput,
        thicknessValue,
        colorInput,
        secondaryInput,
        gradientInput,
        clearButton,
        leaveButton,
        strokes: [],
        unsubscribe: null,
        opened: false,
        drawing: false,
        pointerId: null,
        startPoint: null,
        draftPoints: [],
        resizeObserver: null,
        lastDrawTime: 0
    };

    activeBoards.set(message.whiteboardId, boardState);

    previewButton.addEventListener("click", () => {
        openBoard(boardState);
    });

    leaveButton.addEventListener("click", () => {
        closeBoard(boardState);
    });

    thicknessInput.addEventListener("input", () => {
        thicknessValue.textContent = `${thicknessInput.value}px`;
    });

    clearButton.addEventListener("click", async () => {
        if (!currentUser) {
            return;
        }

        if (!window.confirm("Clear every drawing from this shared whiteboard?")) {
            return;
        }

        clearButton.disabled = true;

        try {
            const snapshot = await getDocs(getBoardStrokesRef(boardState.boardId));

            await Promise.all(
                snapshot.docs.map((strokeDoc) => deleteDoc(strokeDoc.ref))
            );
        } catch (error) {
            console.error("Could not clear whiteboard:", error);
            status.textContent = "Could not clear the whiteboard.";
        } finally {
            clearButton.disabled = false;
        }
    });

    canvas.addEventListener("pointerdown", (event) => {
        if (!boardState.opened || !currentUser || boardState.drawing) {
            return;
        }

        if (event.button !== 0 && event.pointerType === "mouse") {
            return;
        }

        event.preventDefault();

        boardState.drawing = true;
        boardState.pointerId = event.pointerId;
        boardState.startPoint = getCanvasPoint(event, canvas);
        boardState.draftPoints = [boardState.startPoint];

        canvas.setPointerCapture(event.pointerId);
        renderBoard(boardState);
    });

    canvas.addEventListener("pointermove", (event) => {
        if (!boardState.drawing || event.pointerId !== boardState.pointerId) {
            return;
        }

        const point = getCanvasPoint(event, canvas);

        if (toolSelect.value === "pen" || toolSelect.value === "eraser") {
            boardState.draftPoints.push(point);
        } else {
            boardState.draftPoints = [boardState.startPoint, point];
        }

        renderBoard(boardState);
    });

    const finishDrawing = async (event) => {
        if (!boardState.drawing || event.pointerId !== boardState.pointerId) {
            return;
        }

        const point = getCanvasPoint(event, canvas);

        if (toolSelect.value === "pen" || toolSelect.value === "eraser") {
            boardState.draftPoints.push(point);
        } else {
            boardState.draftPoints = [boardState.startPoint, point];
        }

        const stroke = {
            uid: currentUser.uid,
            tool: toolSelect.value,
            color: getBoardColor(colorInput.value, DEFAULT_COLOR),
            color2: getBoardColor(
                secondaryInput.value,
                DEFAULT_SECONDARY_COLOR
            ),
            gradient: gradientInput.checked && toolSelect.value !== "eraser",
            thickness: getBoardThickness(thicknessInput.value),
            points: boardState.draftPoints.slice(0, 3000),
            createdAt: serverTimestamp()
        };

        boardState.drawing = false;
        boardState.pointerId = null;
        boardState.startPoint = null;
        boardState.draftPoints = [];

        renderBoard(boardState);

        if (stroke.points.length === 0) {
            return;
        }

        try {
            await addDoc(getBoardStrokesRef(boardState.boardId), stroke);
        } catch (error) {
            console.error("Could not save whiteboard stroke:", error);
            status.textContent = "Drawing could not be saved.";
        }
    };

    canvas.addEventListener("pointerup", finishDrawing);
    canvas.addEventListener("pointercancel", finishDrawing);

    canvas.addEventListener("lostpointercapture", () => {
        if (!boardState.drawing) {
            return;
        }

        boardState.drawing = false;
        boardState.pointerId = null;
        boardState.startPoint = null;
        boardState.draftPoints = [];

        renderBoard(boardState);
    });

    boardState.resizeObserver = new ResizeObserver(() => {
        resizeBoardCanvas(boardState);
    });

    boardState.resizeObserver.observe(canvasWrap);

    renderPreview(boardState);
}

function openBoard(boardState) {
    if (boardState.opened) {
        return;
    }

    boardState.opened = true;
    boardState.expanded.classList.remove("hidden");
    boardState.previewButton.classList.add("whiteboard-preview-joined");
    boardState.previewButton.querySelector(".whiteboard-preview-overlay").textContent =
        "Joined";

    resizeBoardCanvas(boardState);

    boardState.status.textContent = "Connecting to whiteboard...";

    boardState.unsubscribe = onSnapshot(
        query(getBoardStrokesRef(boardState.boardId)),
        (snapshot) => {
            boardState.strokes = snapshot.docs.map((strokeDoc) => ({
                id: strokeDoc.id,
                ...strokeDoc.data()
            }));

            renderBoard(boardState);
            renderPreview(boardState);

            boardState.status.textContent =
                `${boardState.strokes.length} drawing actions synchronized`;
        },
        (error) => {
            console.error("Whiteboard synchronization failed:", error);
            boardState.status.textContent =
                "Unable to synchronize this whiteboard.";
        }
    );
}

function closeBoard(boardState) {
    boardState.opened = false;
    boardState.expanded.classList.add("hidden");
    boardState.previewButton.classList.remove("whiteboard-preview-joined");
    boardState.previewButton.querySelector(".whiteboard-preview-overlay").textContent =
        "Click to join";

    if (boardState.unsubscribe) {
        boardState.unsubscribe();
        boardState.unsubscribe = null;
    }

    boardState.drawing = false;
    boardState.draftPoints = [];

    renderPreview(boardState);
}

function resizeBoardCanvas(boardState) {
    const canvas = boardState.canvas;
    const rect = boardState.canvasWrap.getBoundingClientRect();

    if (!rect.width || !rect.height) {
        return;
    }

    const pixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

    canvas.width = Math.round(rect.width * pixelRatio);
    canvas.height = Math.round(rect.height * pixelRatio);

    renderBoard(boardState);
}

function drawStroke(context, stroke, width, height) {
    if (!Array.isArray(stroke.points) || stroke.points.length === 0) {
        return;
    }

    const points = stroke.points;

    context.save();
    context.lineWidth = getBoardThickness(stroke.thickness);
    context.lineCap = "round";
    context.lineJoin = "round";

    if (stroke.tool === "eraser") {
        context.globalCompositeOperation = "destination-out";
        context.strokeStyle = "#000000";
        context.fillStyle = "#000000";
    } else {
        context.globalCompositeOperation = "source-over";

        if (stroke.gradient && points.length > 1) {
            const first = points[0];
            const last = points[points.length - 1];

            const gradient = context.createLinearGradient(
                first.x * width,
                first.y * height,
                last.x * width,
                last.y * height
            );

            gradient.addColorStop(
                0,
                getBoardColor(stroke.color, DEFAULT_COLOR)
            );

            gradient.addColorStop(
                1,
                getBoardColor(stroke.color2, DEFAULT_SECONDARY_COLOR)
            );

            context.strokeStyle = gradient;
            context.fillStyle = gradient;
        } else {
            context.strokeStyle = getBoardColor(stroke.color, DEFAULT_COLOR);
            context.fillStyle = context.strokeStyle;
        }
    }

    const first = points[0];

    if (stroke.tool === "rectangle" && points.length >= 2) {
        const last = points[points.length - 1];

        context.strokeRect(
            first.x * width,
            first.y * height,
            (last.x - first.x) * width,
            (last.y - first.y) * height
        );
    } else if (stroke.tool === "circle" && points.length >= 2) {
        const last = points[points.length - 1];
        const centerX = ((first.x + last.x) / 2) * width;
        const centerY = ((first.y + last.y) / 2) * height;
        const radiusX = Math.abs(last.x - first.x) * width / 2;
        const radiusY = Math.abs(last.y - first.y) * height / 2;

        context.beginPath();
        context.ellipse(
            centerX,
            centerY,
            Math.max(0.5, radiusX),
            Math.max(0.5, radiusY),
            0,
            0,
            Math.PI * 2
        );
        context.stroke();
    } else if (stroke.tool === "line" && points.length >= 2) {
        const last = points[points.length - 1];

        context.beginPath();
        context.moveTo(first.x * width, first.y * height);
        context.lineTo(last.x * width, last.y * height);
        context.stroke();
    } else {
        context.beginPath();
        context.moveTo(first.x * width, first.y * height);

        if (points.length === 1) {
            context.lineTo(
                first.x * width + 0.1,
                first.y * height + 0.1
            );
        } else {
            for (let index = 1; index < points.length; index += 1) {
                context.lineTo(
                    points[index].x * width,
                    points[index].y * height
                );
            }
        }

        context.stroke();
    }

    context.restore();
}

function renderBoard(boardState) {
    const canvas = boardState.canvas;
    const context = canvas.getContext("2d");

    if (!context || !canvas.width || !canvas.height) {
        return;
    }

    const pixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = canvas.width / pixelRatio;
    const height = canvas.height / pixelRatio;

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    context.fillStyle = "#080808";
    context.fillRect(0, 0, width, height);

    boardState.strokes.forEach((stroke) => {
        drawStroke(context, stroke, width, height);
    });

    if (boardState.drawing && boardState.draftPoints.length) {
        drawStroke(
            context,
            {
                tool: boardState.toolSelect.value,
                color: boardState.colorInput.value,
                color2: boardState.secondaryInput.value,
                gradient: boardState.gradientInput.checked,
                thickness: boardState.thicknessInput.value,
                points: boardState.draftPoints
            },
            width,
            height
        );
    }
}

function renderPreview(boardState) {
    const canvas = boardState.previewCanvas;
    const context = canvas.getContext("2d");

    if (!context) {
        return;
    }

    context.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    context.fillStyle = "#080808";
    context.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

    boardState.strokes.slice(-150).forEach((stroke) => {
        drawStroke(context, stroke, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    });
}

function processBoardMessage(messageId, message) {
    if (!message.whiteboardId) {
        return;
    }

    boardMessages.set(messageId, message);
    createBoardMessage(messageId, message);
}

function scanForBoardMessages() {
    if (!messageBox) {
        return;
    }

    boardMessages.forEach((message, messageId) => {
        processBoardMessage(messageId, message);
    });

    messageBox.querySelectorAll("[data-message-id]").forEach((element) => {
        if (observedMessages.has(element)) {
            return;
        }

        observedMessages.add(element);

        const observer = new MutationObserver(() => {
            const messageId = element.dataset.messageId;
            const message = boardMessages.get(messageId);

            if (message && element.isConnected) {
                processBoardMessage(messageId, message);
            }
        });

        observer.observe(element, {
            childList: true,
            subtree: true
        });
    });
}

function initWhiteboardMessages() {
    const whiteboardQuery = query(
        collection(db, "messages"),
        where("type", "==", "whiteboard")
    );

    onSnapshot(
        whiteboardQuery,
        (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                const messageId = change.doc.id;

                if (change.type === "removed") {
                    boardMessages.delete(messageId);

                    const boardElement = messageBox.querySelector(
                        `[data-message-id="${CSS.escape(messageId)}"] .whiteboard-message`
                    );

                    if (boardElement) {
                        const boardId = boardElement.dataset.boardId;
                        const state = activeBoards.get(boardId);

                        if (state) {
                            if (state.unsubscribe) {
                                state.unsubscribe();
                            }

                            if (state.resizeObserver) {
                                state.resizeObserver.disconnect();
                            }

                            activeBoards.delete(boardId);
                        }
                    }

                    return;
                }

                boardMessages.set(messageId, {
                    id: messageId,
                    ...change.doc.data()
                });
            });

            scanForBoardMessages();
        },
        (error) => {
            console.error("Could not load whiteboard messages:", error);
        }
    );

    const observer = new MutationObserver(() => {
        scanForBoardMessages();
    });

    observer.observe(messageBox, {
        childList: true,
        subtree: true
    });
}

async function createWhiteboard() {
    if (!currentUser) {
        return;
    }

    if (!messageInput || !messageBox) {
        return;
    }

    const boardRef = doc(collection(db, "whiteboards"));

    try {
        await setDoc(boardRef, {
            ownerUid: currentUser.uid,
            ownerName: currentDisplayName,
            createdAt: serverTimestamp()
        });

        await addDoc(collection(db, "messages"), {
            uid: currentUser.uid,
            displayName: currentDisplayName,
            profilePic: currentProfilePic,
            text: "",
            imageUrl: null,
            videoUrl: null,
            type: "whiteboard",
            whiteboardId: boardRef.id,
            createdAt: serverTimestamp()
        });

        messageInput.value = "";
        messageInput.focus();
    } catch (error) {
        console.error("Could not create whiteboard:", error);
        window.alert("The whiteboard could not be created. Check your connection and Firebase permissions.");
    }
}

if (messageForm && messageInput) {
    messageForm.addEventListener(
        "submit",
        (event) => {
            if (messageInput.value.trim().toLowerCase() !== "/whiteboard") {
                return;
            }

            event.preventDefault();
            event.stopImmediatePropagation();

            createWhiteboard();
        },
        true
    );
}

if (messageBox) {
    initWhiteboardMessages();
}

window.addEventListener("beforeunload", () => {
    activeBoards.forEach((boardState) => {
        if (boardState.unsubscribe) {
            boardState.unsubscribe();
        }

        if (boardState.resizeObserver) {
            boardState.resizeObserver.disconnect();
        }
    });
});
