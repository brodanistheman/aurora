import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
    getFirestore,
    doc,
    collection,
    addDoc,
    query,
    orderBy,
    limit,
    startAfter,
    onSnapshot,
    serverTimestamp,
    getDocs,
    deleteDoc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { loadAccount } from "../account-store.js";

const FirebaseConfig = {
    apiKey: "AIzaSyCLKCCpNbCs2AJm7g0JtGIjL43X5hr31N8",
    authDomain: "aurora-9e0fe.firebaseapp.com",
    projectId: "aurora-9e0fe",
    storageBucket: "aurora-9e0fe.firebasestorage.app",
    messagingSenderId: "1023486645506",
    appId: "1:1023486645506:web:c64a98ebf0c3c817e01e1b",
    measurementId: "G-3XVQTC189X"
};

const ModeratorUids = [
    "AQ1oLVW0fNgESU0H5GEvcycxYJ73",
    "IW24TCbQSkamV2LdxSFObbBg9u73"
];

const ImageKitAuthUrl = "https://aurora-imagekit-auth.4dapple.workers.dev/auth";
const ImageKitUploadUrl = "https://upload.imagekit.io/api/v1/files/upload";

const MaxImageBytes = 25 * 1024 * 1024;
const MaxVideoBytes = 35 * 1024 * 1024;
const ScrollNearBottomPx = 80;
const ScrollNearTopPx = 60;
const MessagePageSize = 30;

const App = initializeApp(FirebaseConfig);
const Auth = getAuth(App);
const Db = getFirestore(App);

const LogoutButton = document.getElementById("logout-button");
const MessageBox = document.getElementById("message-box");
const MessageForm = document.getElementById("message-form");
const MessageInput = document.getElementById("message-input");
const SendButton = document.getElementById("send-button");
const ImageInput = document.getElementById("image-file-input");
const AttachButton = document.getElementById("attach-button");
const ImageModal = document.getElementById("image-modal");
const ImageModalImg = document.getElementById("image-modal-img");
const ImageModalClose = document.getElementById("image-modal-close");

const DefaultAvatar = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2366665f'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/></svg>";

let CurrentDisplayName = "Anonymous";
let CurrentProfilePic = DefaultAvatar;
let IsSending = false;

function EscapeHtml(Value) {
    if (Value === null || Value === undefined) return "";

    return String(Value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function IsSafeMediaSrc(Src, Kind) {
    if (!Src) return false;

    try {
        const Url = new URL(Src);
        return Url.protocol === "https:" || Url.protocol === "http:";
    } catch {
        return typeof Src === "string" && Src.startsWith(`data:${Kind}/`);
    }
}

function IsSafeImageSrc(Src) {
    return IsSafeMediaSrc(Src, "image");
}

function IsSafeVideoSrc(Src) {
    return IsSafeMediaSrc(Src, "video");
}

function FormatMessageText(Value) {
    if (!Value) return "";

    const Escaped = EscapeHtml(Value);
    const UrlRegex = /(https?:\/\/[^\s]+)/g;

    return Escaped.replace(UrlRegex, (Url) => {
        const SafeUrl = EscapeHtml(Url);
        return `<a href="${SafeUrl}" target="_blank" rel="noopener noreferrer">${SafeUrl}</a>`;
    });
}

function FormatTime(Milliseconds) {
    const DateValue = new Date(Milliseconds);
    const Now = new Date();
    const Time = DateValue.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
    });

    if (DateValue.toDateString() === Now.toDateString()) return Time;

    const Yesterday = new Date(Now);
    Yesterday.setDate(Now.getDate() - 1);

    if (DateValue.toDateString() === Yesterday.toDateString()) {
        return `Yesterday ${Time}`;
    }

    return `${DateValue.toLocaleDateString([], {
        month: "short",
        day: "numeric"
    })} ${Time}`;
}

function SetAvatar(Image, Src) {
    Image.addEventListener("error", () => {
        Image.src = DefaultAvatar;
    }, { once: true });

    Image.src = IsSafeImageSrc(Src) ? Src : DefaultAvatar;
}

function ApplyUserData(UserData) {
    if (UserData?.displayName) {
        CurrentDisplayName = UserData.displayName;
    }

    CurrentProfilePic = IsSafeImageSrc(UserData?.profilePic)
        ? UserData.profilePic
        : DefaultAvatar;
}

function OpenLightbox(ImageSrc) {
    if (!ImageModal || !ImageModalImg) return;

    ImageModalImg.src = ImageSrc;
    ImageModal.classList.remove("hidden");
}

function CloseLightbox() {
    if (!ImageModal) return;

    ImageModal.classList.add("hidden");

    if (ImageModalImg) ImageModalImg.src = "";
}

if (ImageModalClose) {
    ImageModalClose.addEventListener("click", CloseLightbox);
}

if (ImageModal) {
    ImageModal.addEventListener("click", (Event) => {
        if (Event.target === ImageModal) CloseLightbox();
    });
}

document.addEventListener("keydown", (Event) => {
    if (Event.key === "Escape" && ImageModal && !ImageModal.classList.contains("hidden")) {
        CloseLightbox();
    }
});

function IsScrolledNearBottom(Element) {
    return Element.scrollHeight - Element.scrollTop - Element.clientHeight < ScrollNearBottomPx;
}

function EnterEditMode(Element, Message) {
    const Body = Element.querySelector(".message-body");
    if (!Body || Body.querySelector(".edit-form")) return;

    const OriginalHtml = Body.innerHTML;

    Body.innerHTML = `
        <div class="edit-form">
            <input type="text" class="edit-input" value="${EscapeHtml(Message.text || "")}">
            <div class="edit-actions">
                <button type="button" class="edit-save">Save</button>
                <button type="button" class="edit-cancel">Cancel</button>
            </div>
        </div>
    `;

    const Input = Body.querySelector(".edit-input");
    const Cancel = () => {
        Body.innerHTML = OriginalHtml;
    };

    const Save = async () => {
        const NewText = Input.value.trim();

        if (!NewText) return;

        if (NewText === Message.text) {
            Cancel();
            return;
        }

        try {
            await updateDoc(doc(Db, "messages", Message.id), {
                text: NewText,
                edited: true
            });
        } catch (Error) {
            console.error("Message Edit Failed:", Error);
            alert("Could Not Save Your Edit. Please Try Again.");
        }
    };

    Body.querySelector(".edit-save").addEventListener("click", Save);
    Body.querySelector(".edit-cancel").addEventListener("click", Cancel);

    Input.addEventListener("keydown", (Event) => {
        if (Event.key === "Enter") Save();

        if (Event.key === "Escape") {
            Event.stopPropagation();
            Cancel();
        }
    });

    Input.focus();
    Input.setSelectionRange(Input.value.length, Input.value.length);
}

const MessageElements = new Map();
const MessageData = new Map();

let OldestMessageDoc = null;
let PaginationStarted = false;
let HasMoreOlderMessages = true;
let IsLoadingOlderMessages = false;

function MessageTimestampMs(Message) {
    return Message.createdAt?.toMillis
        ? Message.createdAt.toMillis()
        : Date.now();
}

function IsMainFeedMessage(Message) {
    return Boolean(Message.text || Message.imageUrl || Message.videoUrl);
}

function BuildMessageNode(Message, Milliseconds) {
    const Element = document.createElement("div");
    Element.className = "message";
    Element.dataset.messageId = Message.id;
    Element.dataset.ts = String(Milliseconds);

    const IsOwn = Boolean(Auth.currentUser && Message.uid === Auth.currentUser.uid);
    let ContentHtml = "";

    if (Message.text) {
        ContentHtml += `<span class="message-text">${FormatMessageText(Message.text)}</span>`;

        if (Message.edited) {
            ContentHtml += `<span class="edited-tag"> (edited)</span>`;
        }
    }

    if (Message.imageUrl && IsSafeImageSrc(Message.imageUrl)) {
        ContentHtml += `<div class="message-media"><img class="message-image" alt="Attached image"></div>`;
    }

    if (Message.videoUrl && IsSafeVideoSrc(Message.videoUrl)) {
        ContentHtml += `<div class="message-media"><video class="message-video" controls preload="metadata"></video></div>`;
    }

    const EditButtonHtml = IsOwn && Message.text
        ? `<button type="button" class="msg-action msg-edit-btn" title="Edit" aria-label="Edit message"><i class="fa-solid fa-pen"></i></button>`
        : "";

    Element.innerHTML = `
        <img class="message-avatar" alt="">
        <div class="message-main">
            <div class="message-header">
                <span class="message-name">${EscapeHtml(Message.displayName || "Anonymous")}</span>
                <time class="message-time"></time>
                <div class="message-actions">${EditButtonHtml}</div>
            </div>
            <div class="message-body">${ContentHtml}</div>
        </div>
    `;

    SetAvatar(Element.querySelector(".message-avatar"), Message.profilePic);

    const TimeElement = Element.querySelector(".message-time");
    TimeElement.textContent = FormatTime(Milliseconds);
    TimeElement.dateTime = new Date(Milliseconds).toISOString();
    TimeElement.title = new Date(Milliseconds).toLocaleString();

    const Image = Element.querySelector(".message-image");

    if (Image) {
        Image.src = Message.imageUrl;
        Image.addEventListener("click", () => OpenLightbox(Image.src));
    }

    const Video = Element.querySelector(".message-video");
    if (Video) Video.src = Message.videoUrl;

    const EditButton = Element.querySelector(".msg-edit-btn");

    if (EditButton) {
        EditButton.addEventListener("click", () => EnterEditMode(Element, Message));
    }

    return Element;
}

function InsertMessageNode(Node, Milliseconds) {
    const ExistingNodes = MessageBox.querySelectorAll("[data-message-id]");

    for (const Existing of ExistingNodes) {
        if (Milliseconds < Number(Existing.dataset.ts || 0)) {
            MessageBox.insertBefore(Node, Existing);
            return;
        }
    }

    MessageBox.appendChild(Node);
}

function UpsertMessageElement(Message) {
    const Milliseconds = MessageTimestampMs(Message);
    MessageData.set(Message.id, Message);

    const Existing = MessageElements.get(Message.id);

    if (Existing) {
        const Rebuilt = BuildMessageNode(Message, Milliseconds);
        Existing.replaceWith(Rebuilt);
        MessageElements.set(Message.id, Rebuilt);
    } else {
        const Node = BuildMessageNode(Message, Milliseconds);
        MessageElements.set(Message.id, Node);
        InsertMessageNode(Node, Milliseconds);
    }
}

function RemoveMessageElement(Id) {
    const Element = MessageElements.get(Id);

    if (Element) Element.remove();

    MessageElements.delete(Id);
    MessageData.delete(Id);
}

function RefreshEmptyState() {
    const EmptyState = MessageBox.querySelector(".empty-state");

    if (MessageElements.size === 0) {
        if (!EmptyState) {
            MessageBox.innerHTML = '<p class="empty-state">No messages yet.</p>';
        }
    } else if (EmptyState) {
        EmptyState.remove();
    }
}

async function LoadOlderMessages() {
    if (
        IsLoadingOlderMessages ||
        !HasMoreOlderMessages ||
        !OldestMessageDoc ||
        !MessageBox
    ) {
        return;
    }

    IsLoadingOlderMessages = true;
    PaginationStarted = true;
    let AddedCount = 0;

    try {
        const MessageQuery = query(
            collection(Db, "messages"),
            orderBy("createdAt", "desc"),
            startAfter(OldestMessageDoc),
            limit(MessagePageSize)
        );

        const Snapshot = await getDocs(MessageQuery);

        if (Snapshot.empty) {
            HasMoreOlderMessages = false;
            return;
        }

        OldestMessageDoc = Snapshot.docs[Snapshot.docs.length - 1];

        if (Snapshot.docs.length < MessagePageSize) {
            HasMoreOlderMessages = false;
        }

        const PreviousHeight = MessageBox.scrollHeight;

        [...Snapshot.docs].reverse().forEach((Document) => {
            const Message = {
                id: Document.id,
                ...Document.data()
            };

            if (!IsMainFeedMessage(Message) || MessageElements.has(Message.id)) {
                return;
            }

            MessageData.set(Message.id, Message);

            const Milliseconds = MessageTimestampMs(Message);
            const Node = BuildMessageNode(Message, Milliseconds);

            MessageElements.set(Message.id, Node);
            MessageBox.insertBefore(Node, MessageBox.firstChild);
            AddedCount += 1;
        });

        MessageBox.scrollTop += MessageBox.scrollHeight - PreviousHeight;
    } catch (Error) {
        console.error("Older Messages Could Not Be Loaded:", Error);
    } finally {
        IsLoadingOlderMessages = false;
    }

    if (AddedCount === 0 && HasMoreOlderMessages) {
        await LoadOlderMessages();
    }
}

function HandleMessageScroll() {
    if (MessageBox.scrollTop < ScrollNearTopPx) {
        LoadOlderMessages();
    }
}

function InitChat() {
    if (!MessageBox) return;

    const MessageQuery = query(
        collection(Db, "messages"),
        orderBy("createdAt", "desc"),
        limit(MessagePageSize)
    );

    onSnapshot(MessageQuery, (Snapshot) => {
        if (!PaginationStarted) {
            OldestMessageDoc = Snapshot.docs[Snapshot.docs.length - 1] || OldestMessageDoc;
            HasMoreOlderMessages = Snapshot.docs.length === MessagePageSize;
        }

        const ShouldStick = IsScrolledNearBottom(MessageBox);

        Snapshot.docChanges().forEach((Change) => {
            const Message = {
                id: Change.doc.id,
                ...Change.doc.data()
            };

            if (Change.type === "removed") {
                RemoveMessageElement(Message.id);
                return;
            }

            if (!IsMainFeedMessage(Message)) {
                RemoveMessageElement(Message.id);
                return;
            }

            UpsertMessageElement(Message);
        });

        RefreshEmptyState();

        if (ShouldStick) {
            MessageBox.scrollTop = MessageBox.scrollHeight;
        }
    }, (Error) => {
        console.error("Chat Messages Could Not Be Loaded:", Error);
    });

    MessageBox.addEventListener("scroll", HandleMessageScroll);
}

async function ClearAllMessages() {
    const Snapshot = await getDocs(collection(Db, "messages"));

    await Promise.all(
        Snapshot.docs.map((Document) => deleteDoc(doc(Db, "messages", Document.id)))
    );
}

const ModeratorCommands = {
    "/clear msgs": ClearAllMessages
};

function SetSending(Sending) {
    IsSending = Sending;

    if (SendButton) {
        SendButton.disabled = Sending;
        SendButton.textContent = Sending ? "Sending..." : "Send";
    }

    if (AttachButton) {
        AttachButton.disabled = Sending;
    }
}

async function GetImageKitAuth() {
    const Response = await fetch(ImageKitAuthUrl, {
        method: "GET",
        headers: {
            Accept: "application/json"
        },
        cache: "no-store"
    });

    if (!Response.ok) {
        throw new Error("Image Upload Authentication Failed.");
    }

    const AuthData = await Response.json();

    if (
        !AuthData.token ||
        !AuthData.expire ||
        !AuthData.signature ||
        !AuthData.publicKey
    ) {
        throw new Error("Image Upload Authentication Was Incomplete.");
    }

    return AuthData;
}

async function UploadMedia(File) {
    const AuthData = await GetImageKitAuth();
    const FormDataBody = new FormData();

    FormDataBody.append("file", File);
    FormDataBody.append("fileName", File.name);
    FormDataBody.append("token", AuthData.token);
    FormDataBody.append("expire", String(AuthData.expire));
    FormDataBody.append("signature", AuthData.signature);
    FormDataBody.append("publicKey", AuthData.publicKey);

    const Response = await fetch(ImageKitUploadUrl, {
        method: "POST",
        body: FormDataBody
    });

    const Result = await Response.json().catch(() => ({}));

    if (!Response.ok || !Result.url) {
        throw new Error(Result.message || "Media Upload Failed.");
    }

    return Result.url;
}

async function SendChatMessage(Text, Attachment = null) {
    const User = Auth.currentUser;

    if (!User || IsSending) return;

    const Command = Text
        ? ModeratorCommands[Text.trim().toLowerCase()]
        : null;

    if (Command) {
        if (!ModeratorUids.includes(User.uid)) {
            alert("You Do Not Have Permission To Use This Command.");
            if (MessageInput) MessageInput.value = "";
            return;
        }

        SetSending(true);

        try {
            await Command();
        } catch (Error) {
            console.error("Moderator Command Failed:", Error);
            alert("The Command Could Not Be Completed.");
        } finally {
            if (MessageInput) MessageInput.value = "";
            SetSending(false);
        }

        return;
    }

    if (!Text && !Attachment) return;

    SetSending(true);

    try {
        await addDoc(collection(Db, "messages"), {
            uid: User.uid,
            displayName: CurrentDisplayName,
            profilePic: CurrentProfilePic,
            text: Text || "",
            imageUrl: Attachment?.type === "image" ? Attachment.url : null,
            videoUrl: Attachment?.type === "video" ? Attachment.url : null,
            createdAt: serverTimestamp()
        });

        if (MessageInput) MessageInput.value = "";
        if (ImageInput) ImageInput.value = "";
    } catch (Error) {
        console.error("Message Send Failed:", Error);
        alert("Your Message Could Not Be Sent. Please Try Again.");
    } finally {
        SetSending(false);

        if (MessageInput) MessageInput.focus();
    }
}

async function HandleMediaFile(File) {
    if (!File || IsSending) return;

    const IsImage = File.type.startsWith("image/");
    const IsVideo = File.type.startsWith("video/");

    if (!IsImage && !IsVideo) {
        alert("Please Choose An Image Or Video File.");
        return;
    }

    const MaxBytes = IsVideo ? MaxVideoBytes : MaxImageBytes;
    const LimitLabel = IsVideo ? "35 MB" : "25 MB";

    if (File.size > MaxBytes) {
        alert(`${IsVideo ? "Video" : "Image"} Is Too Large. The Limit Is ${LimitLabel}.`);
        if (ImageInput) ImageInput.value = "";
        return;
    }

    SetSending(true);

    try {
        const MediaUrl = await UploadMedia(File);
        const Text = MessageInput?.value.trim() || "";

        await SendUploadedMedia(Text, {
            type: IsVideo ? "video" : "image",
            url: MediaUrl
        });
    } catch (Error) {
        console.error("Media Upload Failed:", Error);
        alert("Your Media Could Not Be Uploaded. Please Try Again.");
    } finally {
        if (ImageInput) ImageInput.value = "";
        SetSending(false);

        if (MessageInput) MessageInput.focus();
    }
}

async function SendUploadedMedia(Text, Attachment) {
    const User = Auth.currentUser;

    if (!User) {
        throw new Error("You Must Be Signed In To Send Media.");
    }

    await addDoc(collection(Db, "messages"), {
        uid: User.uid,
        displayName: CurrentDisplayName,
        profilePic: CurrentProfilePic,
        text: Text || "",
        imageUrl: Attachment.type === "image" ? Attachment.url : null,
        videoUrl: Attachment.type === "video" ? Attachment.url : null,
        createdAt: serverTimestamp()
    });

    if (MessageInput) MessageInput.value = "";
}

if (AttachButton && ImageInput) {
    AttachButton.addEventListener("click", () => {
        if (!IsSending) ImageInput.click();
    });

    ImageInput.addEventListener("change", (Event) => {
        HandleMediaFile(Event.target.files?.[0]);
    });
}

if (MessageInput) {
    MessageInput.addEventListener("paste", (Event) => {
        const Items = Event.clipboardData?.items || [];

        for (const Item of Items) {
            if (
                Item.kind === "file" &&
                (Item.type.startsWith("image/") || Item.type.startsWith("video/"))
            ) {
                Event.preventDefault();
                HandleMediaFile(Item.getAsFile());
                break;
            }
        }
    });
}

if (MessageForm) {
    MessageForm.addEventListener("submit", (Event) => {
        Event.preventDefault();

        const Text = MessageInput?.value.trim() || "";
        if (Text) SendChatMessage(Text);
    });
} else if (SendButton) {
    SendButton.addEventListener("click", () => {
        const Text = MessageInput?.value.trim() || "";
        if (Text) SendChatMessage(Text);
    });

    if (MessageInput) {
        MessageInput.addEventListener("keydown", (Event) => {
            if (Event.key === "Enter" && !Event.shiftKey) {
                Event.preventDefault();

                const Text = MessageInput.value.trim();
                if (Text) SendChatMessage(Text);
            }
        });
    }
}

function GetInitialCachedAccount(Uid) {
    try {
        const Raw = localStorage.getItem(`aurora_account_${Uid}`);
        if (!Raw) return null;

        return JSON.parse(Raw).data;
    } catch {
        return null;
    }
}

onAuthStateChanged(Auth, async (User) => {
    if (!User) {
        window.location.href = "../";
        return;
    }

    const CachedAccount = GetInitialCachedAccount(User.uid);

    if (CachedAccount) {
        ApplyUserData(CachedAccount);
    }

    try {
        const { data } = await loadAccount(Db, User.uid, {
            onFresh: (FreshAccount) => ApplyUserData(FreshAccount)
        });

        if (data) ApplyUserData(data);
    } catch (Error) {
        console.error("Account Data Could Not Be Loaded:", Error);
    }

    InitChat();
});

if (LogoutButton) {
    LogoutButton.addEventListener("click", async () => {
        try {
            await signOut(Auth);
            localStorage.clear();
            window.location.href = "../";
        } catch (Error) {
            console.error("Logout Failed:", Error);
            alert("Could Not Log Out. Please Try Again.");
        }
    });
}