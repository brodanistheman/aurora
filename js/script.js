import { Auth, Db } from "./firebase.js";

import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    deleteUser
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

import {
    doc,
    getDoc,
    runTransaction,
    serverTimestamp,
    updateDoc,
    collection,
    query,
    orderBy,
    limit,
    onSnapshot,
    getDocs,
    startAfter,
    addDoc
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const AuthContainer = document.querySelector(".AuthContainer");

const ChatContainer = document.getElementById("ChatContainer");
const MessageList = document.getElementById("MessageList");
const ChatStatus = document.getElementById("ChatStatus");
const ChatComposer = document.getElementById("ChatComposer");
const MessageInput = document.getElementById("MessageInput");
const SendMessageButton = document.getElementById("SendMessageButton");
const AttachmentButton = document.getElementById("AttachmentButton");
const AttachmentInput = document.getElementById("AttachmentInput");
const AttachmentPreview = document.getElementById("AttachmentPreview");
const ReplyPreview = document.getElementById("ReplyPreview");
const ReplyPreviewText = document.getElementById("ReplyPreviewText");
const CancelReplyButton = document.getElementById("CancelReplyButton");
const ProfileSettingsButton = document.getElementById("ProfileSettingsButton");
const ChatSignOutButton = document.getElementById("ChatSignOutButton");

const SignInView = document.getElementById("SignInView");
const SignUpView = document.getElementById("SignUpView");
const AuthenticatedView = document.getElementById("AuthenticatedView");

const SignInForm = document.getElementById("SignInForm");
const SignUpForm = document.getElementById("SignUpForm");
const ProfileForm = document.getElementById("ProfileForm");

const SignInMessage = document.getElementById("SignInMessage");
const SignUpMessage = document.getElementById("SignUpMessage");
const ProfileMessage = document.getElementById("ProfileMessage");

const SignInButton = document.getElementById("SignInButton");
const SignUpButton = document.getElementById("SignUpButton");
const SaveProfileButton = document.getElementById("SaveProfileButton");
const SignOutButton = document.getElementById("SignOutButton");
const CloseProfileSettings = document.getElementById("CloseProfileSettings");

const AuthenticatedMessage = document.getElementById("AuthenticatedMessage");

const ShowSignUp = document.getElementById("ShowSignUp");
const ShowSignIn = document.getElementById("ShowSignIn");

const ProfileUsername = document.getElementById("ProfileUsername");
const ProfileDisplayName = document.getElementById("ProfileDisplayName");
const ProfileAvatarFile = document.getElementById("ProfileAvatarFile");
const ProfileAvatarPreview = document.getElementById("ProfileAvatarPreview");

const AvatarCropModal = document.getElementById("AvatarCropModal");
const AvatarCropViewport = AvatarCropModal.querySelector(".AvatarCropViewport");
const AvatarCropImageElement = AvatarCropModal.querySelector(".AvatarCropImage");
const AvatarCropZoom = AvatarCropModal.querySelector("#AvatarCropZoom");
const AvatarCropClose = AvatarCropModal.querySelector(".AvatarCropClose");
const AvatarCropCancel = AvatarCropModal.querySelector(".AvatarCropCancel");
const AvatarCropSave = AvatarCropModal.querySelector(".AvatarCropSave");

const ImageKitAuthEndpoint = "https://aurora-imagekit-auth.4dapple.workers.dev/auth";
const ImageKitUploadEndpoint = "https://upload.imagekit.io/api/v1/files/upload";

const MaximumAvatarSize = 5 * 1024 * 1024;
const MaximumImageSize = 25 * 1024 * 1024;
const MaximumVideoSize = 35 * 1024 * 1024;
const MaximumAttachments = 4;
const MessagePageSize = 30;

const AllowedAvatarTypes = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif"
};

let SignUpInProgress = false;
let CurrentUser = null;
let CurrentAvatarUrl = null;
let SelectedAvatarFile = null;
let AvatarPreviewUrl = null;
let AvatarCropImage = null;
let AvatarCropObjectUrl = null;
let AvatarCropBaseScale = 1;
let AvatarCropScale = 1;
let AvatarCropOffsetX = 0;
let AvatarCropOffsetY = 0;
let AvatarCropDragging = false;
let AvatarCropPointerX = 0;
let AvatarCropPointerY = 0;
let AvatarCropStartX = 0;
let AvatarCropStartY = 0;
let SelectedAvatarBlob = null;

let SelectedAttachments = [];
let CurrentReplyTo = null;
let IsSendingMessage = false;
let IsLoadingOlderMessages = false;
let HasMoreMessages = true;
let OldestLoadedSnapshot = null;
let InitialMessagesLoaded = false;
let ChatUnsubscribe = null;

const MessagesById = new Map();
const MessageElements = new Map();
const ProfileCache = new Map();
const ProfileListeners = new Map();

function ShowView(View) {
    SignInView.hidden = View !== "SignIn";
    SignUpView.hidden = View !== "SignUp";
    AuthenticatedView.hidden = View !== "Authenticated";

    AuthContainer.classList.toggle("SignUpMode", View === "SignUp");

    SignInMessage.textContent = "";
    SignUpMessage.textContent = "";
    ProfileMessage.textContent = "";
    ProfileMessage.style.color = "";

    window.scrollTo(0, 0);
    AuthContainer.scrollTop = 0;
}

function SetButtonState(Button, Disabled, Text) {
    Button.disabled = Disabled;
    Button.textContent = Text;
}

function GetAuthMessage(Code) {
    const Messages = {
        "auth/email-already-in-use": "This Email Address Is Already Registered.",
        "auth/invalid-email": "Please Enter A Valid Email Address.",
        "auth/invalid-credential": "The Email Or Password Is Incorrect.",
        "auth/user-not-found": "No Account Was Found With This Email.",
        "auth/wrong-password": "The Password Is Incorrect.",
        "auth/weak-password": "Your Password Is Too Weak.",
        "auth/too-many-requests": "Too Many Attempts. Please Try Again Later.",
        "auth/network-request-failed": "Please Check Your Internet Connection.",
        "auth/operation-not-allowed": "Email And Password Sign In Is Not Enabled.",
        "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "The Firebase Configuration Is Invalid.",
        "auth/app-not-authorized": "This Website Is Not Authorized To Use Firebase Authentication.",
        "auth/requests-to-this-api-identitytoolkit-method-are-blocked": "Firebase Authentication Requests Are Currently Blocked.",
        "auth/quota-exceeded": "The Authentication Request Limit Has Been Reached. Please Try Again Later."
    };

    return Messages[Code] || "Something Went Wrong. Please Try Again.";
}

function GetUsernameErrorMessage(Error) {
    if (Error.message === "UsernameTaken") {
        return "That Username Is Already Taken.";
    }

    if (Error.message === "UsernameReservationInvalid") {
        return "Your Username Reservation Could Not Be Verified.";
    }

    if (Error.message === "ProfileNotFound") {
        return "Your Profile Could Not Be Found.";
    }

    if (Error.message === "AvatarUploadFailed") {
        return "Unable To Upload Your Avatar. Please Try Again.";
    }

    return "Unable To Save Your Profile. Please Try Again.";
}

function ValidateProfile(Username, DisplayName) {
    if (!/^[a-z0-9_]{3,20}$/.test(Username)) {
        return "Usernames Must Be 3 To 20 Characters And Contain Only Lowercase Letters, Numbers, And Underscores.";
    }

    if (DisplayName.length < 1 || DisplayName.length > 32) {
        return "Display Names Must Be Between 1 And 32 Characters.";
    }

    return null;
}

function UpdateAvatarPreview(Url) {
    if (AvatarPreviewUrl) {
        URL.revokeObjectURL(AvatarPreviewUrl);
        AvatarPreviewUrl = null;
    }

    if (Url) {
        ProfileAvatarPreview.src = Url;
        ProfileAvatarPreview.hidden = false;
    } else {
        ProfileAvatarPreview.removeAttribute("src");
        ProfileAvatarPreview.hidden = true;
    }
}

function SetAvatarPreviewFromFile(File) {
    if (AvatarPreviewUrl) {
        URL.revokeObjectURL(AvatarPreviewUrl);
    }

    AvatarPreviewUrl = URL.createObjectURL(File);
    ProfileAvatarPreview.src = AvatarPreviewUrl;
    ProfileAvatarPreview.hidden = false;
}

function UpdateAvatarCropPosition() {
    if (!AvatarCropImage) return;

    const Width = AvatarCropImage.naturalWidth * AvatarCropBaseScale * AvatarCropScale;
    const Height = AvatarCropImage.naturalHeight * AvatarCropBaseScale * AvatarCropScale;
    const Size = AvatarCropViewport.clientWidth;

    AvatarCropOffsetX = Math.min(
        (Width - Size) / 2,
        Math.max((Size - Width) / 2, AvatarCropOffsetX)
    );

    AvatarCropOffsetY = Math.min(
        (Height - Size) / 2,
        Math.max((Size - Height) / 2, AvatarCropOffsetY)
    );

    AvatarCropImageElement.style.width = `${Width}px`;
    AvatarCropImageElement.style.height = `${Height}px`;
    AvatarCropImageElement.style.left = `calc(50% - ${Width / 2}px + ${AvatarCropOffsetX}px)`;
    AvatarCropImageElement.style.top = `calc(50% - ${Height / 2}px + ${AvatarCropOffsetY}px)`;
}

function CloseAvatarCrop() {
    AvatarCropModal.hidden = true;
    AvatarCropDragging = false;

    if (AvatarCropObjectUrl) {
        URL.revokeObjectURL(AvatarCropObjectUrl);
        AvatarCropObjectUrl = null;
    }

    AvatarCropImage = null;
    ProfileAvatarFile.value = "";
}

function OpenAvatarCrop(File) {
    if (AvatarCropObjectUrl) {
        URL.revokeObjectURL(AvatarCropObjectUrl);
    }

    AvatarCropObjectUrl = URL.createObjectURL(File);

    const AvatarImage = new window.Image();

    AvatarImage.onload = () => {
        AvatarCropImage = AvatarImage;
        AvatarCropModal.hidden = false;

        AvatarCropBaseScale = Math.max(
            AvatarCropViewport.clientWidth / AvatarImage.naturalWidth,
            AvatarCropViewport.clientHeight / AvatarImage.naturalHeight
        );

        AvatarCropScale = 1;
        AvatarCropOffsetX = 0;
        AvatarCropOffsetY = 0;
        AvatarCropZoom.value = "1";
        AvatarCropImageElement.src = AvatarCropObjectUrl;

        UpdateAvatarCropPosition();
    };

    AvatarImage.onerror = () => {
        ProfileMessage.textContent = "This Image Could Not Be Opened.";
        CloseAvatarCrop();
    };

    AvatarImage.src = AvatarCropObjectUrl;
}

function CreateCroppedAvatar() {
    if (!AvatarCropImage) {
        throw new Error("AvatarUploadFailed");
    }

    const Size = AvatarCropViewport.clientWidth;
    const OutputSize = 512;
    const Scale = AvatarCropBaseScale * AvatarCropScale;
    const SourceSize = Size / Scale;

    const SourceX =
        (AvatarCropImage.naturalWidth - SourceSize) / 2 -
        AvatarCropOffsetX / Scale;

    const SourceY =
        (AvatarCropImage.naturalHeight - SourceSize) / 2 -
        AvatarCropOffsetY / Scale;

    const Canvas = document.createElement("canvas");
    Canvas.width = OutputSize;
    Canvas.height = OutputSize;

    const Context = Canvas.getContext("2d");

    if (!Context) {
        throw new Error("AvatarUploadFailed");
    }

    Context.drawImage(
        AvatarCropImage,
        SourceX,
        SourceY,
        SourceSize,
        SourceSize,
        0,
        0,
        OutputSize,
        OutputSize
    );

    return new Promise((Resolve, Reject) => {
        Canvas.toBlob(
            (Blob) => {
                if (Blob) {
                    Resolve(Blob);
                } else {
                    Reject(new Error("AvatarUploadFailed"));
                }
            },
            "image/jpeg",
            0.92
        );
    });
}

async function GetImageKitAuthentication() {
    const AuthResponse = await fetch(ImageKitAuthEndpoint, {
        method: "GET",
        cache: "no-store"
    });

    if (!AuthResponse.ok) {
        throw new Error("AvatarUploadFailed");
    }

    const AuthData = await AuthResponse.json();

    if (
        !AuthData.token ||
        !AuthData.expire ||
        !AuthData.signature ||
        !AuthData.publicKey
    ) {
        throw new Error("AvatarUploadFailed");
    }

    return AuthData;
}

async function UploadFileToImageKit(File, Folder, User) {
    const AuthData = await GetImageKitAuthentication();
    const Extension = File.type === "image/png"
        ? "png"
        : File.type === "image/webp"
            ? "webp"
            : File.type === "image/gif"
                ? "gif"
                : File.type.startsWith("video/")
                    ? File.name.split(".").pop().toLowerCase()
                    : "jpg";

    const FormDataBody = new FormData();

    FormDataBody.append("file", File);
    FormDataBody.append(
        "fileName",
        `${Folder}_${User.uid}_${Date.now()}.${Extension}`
    );
    FormDataBody.append("publicKey", AuthData.publicKey);
    FormDataBody.append("signature", AuthData.signature);
    FormDataBody.append("expire", String(AuthData.expire));
    FormDataBody.append("token", AuthData.token);
    FormDataBody.append("folder", `/aurora/${Folder}`);
    FormDataBody.append("useUniqueFileName", "true");

    const UploadResponse = await fetch(ImageKitUploadEndpoint, {
        method: "POST",
        body: FormDataBody
    });

    const UploadData = await UploadResponse.json();

    if (!UploadResponse.ok || !UploadData.url) {
        throw new Error("AvatarUploadFailed");
    }

    return UploadData.url;
}

async function UploadAvatar(File, User) {
    return UploadFileToImageKit(File, "avatars", User);
}

async function MigrateUserProfile(User) {
    const UserRef = doc(Db, "Users", User.uid);
    const ProfileRef = doc(Db, "Profiles", User.uid);

    await runTransaction(Db, async (Transaction) => {
        const UserSnapshot = await Transaction.get(UserRef);

        if (!UserSnapshot.exists()) {
            throw new Error("ProfileNotFound");
        }

        const UserData = UserSnapshot.data();
        const ProfileSnapshot = await Transaction.get(ProfileRef);

        const Username = (
            ProfileSnapshot.exists()
                ? ProfileSnapshot.data().Username
                : UserData.Username
        )?.toLowerCase();

        if (!Username) {
            throw new Error("ProfileNotFound");
        }

        const UsernameRef = doc(Db, "Usernames", Username);
        const UsernameSnapshot = await Transaction.get(UsernameRef);

        if (
            UsernameSnapshot.exists() &&
            UsernameSnapshot.data().Uid !== User.uid
        ) {
            throw new Error("UsernameReservationInvalid");
        }

        if (!ProfileSnapshot.exists()) {
            if (!UserData.DisplayName) {
                throw new Error("ProfileNotFound");
            }

            Transaction.set(ProfileRef, {
                Username: Username,
                DisplayName: UserData.DisplayName,
                AvatarUrl: UserData.AvatarUrl ?? null,
                CreatedAt: serverTimestamp(),
                UpdatedAt: serverTimestamp()
            });
        }

        if (!UsernameSnapshot.exists()) {
            Transaction.set(UsernameRef, {
                Uid: User.uid,
                Username: Username,
                CreatedAt: serverTimestamp()
            });
        }
    });
}

function GetProfileFallback(Uid) {
    return {
        Username: "Unknown",
        DisplayName: "Unknown User",
        AvatarUrl: null,
        Uid: Uid
    };
}

function EnsureProfileListener(Uid) {
    if (!Uid || ProfileListeners.has(Uid)) return;

    const ProfileRef = doc(Db, "Profiles", Uid);

    const Unsubscribe = onSnapshot(
        ProfileRef,
        (Snapshot) => {
            if (!Snapshot.exists()) {
                ProfileCache.set(Uid, GetProfileFallback(Uid));
            } else {
                ProfileCache.set(Uid, {
                    ...Snapshot.data(),
                    Uid: Uid
                });
            }

            UpdateMessageProfiles(Uid);
        },
        () => {
            if (!ProfileCache.has(Uid)) {
                ProfileCache.set(Uid, GetProfileFallback(Uid));
            }

            UpdateMessageProfiles(Uid);
        }
    );

    ProfileListeners.set(Uid, Unsubscribe);
}

function StopProfileListeners() {
    for (const Unsubscribe of ProfileListeners.values()) {
        Unsubscribe();
    }

    ProfileListeners.clear();
    ProfileCache.clear();
}

function UpdateMessageProfiles(Uid) {
    const Profile = ProfileCache.get(Uid);

    if (!Profile) return;

    const Elements = MessageList.querySelectorAll(
        `.MessageItem[data-uid="${CSS.escape(Uid)}"]`
    );

    for (const Element of Elements) {
        const Author = Element.querySelector(".MessageAuthor");
        const Username = Element.querySelector(".MessageUsername");
        const AvatarImage = Element.querySelector(".MessageAvatar img");
        const AvatarFallback = Element.querySelector(".MessageAvatarFallback");

        if (Author) {
            Author.textContent = Profile.DisplayName || Profile.Username || "Unknown User";
        }

        if (Username) {
            Username.textContent = Profile.Username
                ? `@${Profile.Username}`
                : "";
        }

        if (AvatarImage) {
            if (Profile.AvatarUrl) {
                AvatarImage.src = Profile.AvatarUrl;
                AvatarImage.hidden = false;
                AvatarFallback.hidden = true;
            } else {
                AvatarImage.removeAttribute("src");
                AvatarImage.hidden = true;
                AvatarFallback.hidden = false;
                AvatarFallback.textContent = GetInitials(Profile.DisplayName || Profile.Username);
            }
        }
    }
}

function GetInitials(Value) {
    return String(Value || "?")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((Part) => Part.charAt(0).toUpperCase())
        .join("") || "?";
}

function GetMessageTimestamp(Message) {
    if (Message.CreatedAt?.toMillis) {
        return Message.CreatedAt.toMillis();
    }

    return 0;
}

function FormatMessageTimestamp(Message) {
    if (!Message.CreatedAt?.toDate) {
        return "Just Now";
    }

    return Message.CreatedAt.toDate().toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

function GetMessagePreview(Message) {
    if (!Message) {
        return "Original Message";
    }

    if (Message.Deleted) {
        return "This Message Was Deleted.";
    }

    if (Message.Content) {
        return Message.Content;
    }

    if (Message.Attachments?.length) {
        return Message.Attachments.length === 1
            ? "Attachment"
            : `${Message.Attachments.length} Attachments`;
    }

    return "Message";
}

function UpdateReplyPreviews(MessageId) {
    const Elements = MessageList.querySelectorAll(
        `.MessageItem[data-reply-to="${CSS.escape(MessageId)}"]`
    );

    for (const Element of Elements) {
        const Preview = Element.querySelector(".MessageReply p");
        const Message = MessagesById.get(MessageId);

        if (Preview) {
            Preview.textContent = GetMessagePreview(Message);
        }
    }
}

function CreateMessageElement(MessageId, Data) {
    const Element = document.createElement("article");
    Element.className = "MessageItem";
    Element.dataset.messageId = MessageId;
    Element.dataset.uid = Data.Uid || "";
    Element.dataset.replyTo = Data.ReplyTo || "";

    const Avatar = document.createElement("div");
    Avatar.className = "MessageAvatar";

    const AvatarImage = document.createElement("img");
    AvatarImage.alt = "";
    AvatarImage.hidden = true;

    const AvatarFallback = document.createElement("div");
    AvatarFallback.className = "MessageAvatarFallback";
    AvatarFallback.textContent = "?";

    Avatar.append(AvatarImage, AvatarFallback);

    const Body = document.createElement("div");
    Body.className = "MessageBody";

    const Header = document.createElement("div");
    Header.className = "MessageHeader";

    const Author = document.createElement("span");
    Author.className = "MessageAuthor";
    Author.textContent = "Loading...";

    const Username = document.createElement("span");
    Username.className = "MessageUsername";

    const Timestamp = document.createElement("span");
    Timestamp.className = "MessageTimestamp";

    const Edited = document.createElement("span");
    Edited.className = "MessageEdited";

    Header.append(Author, Username, Timestamp, Edited);

    const Reply = document.createElement("div");
    Reply.className = "MessageReply";
    Reply.hidden = true;

    const ReplyLabel = document.createElement("span");
    ReplyLabel.textContent = "Replying To";

    const ReplyText = document.createElement("p");

    Reply.append(ReplyLabel, ReplyText);

    const Content = document.createElement("div");
    Content.className = "MessageContent";

    const Attachments = document.createElement("div");
    Attachments.className = "MessageAttachments";

    const Actions = document.createElement("div");
    Actions.className = "MessageActions";

    const ReplyButton = document.createElement("button");
    ReplyButton.type = "button";
    ReplyButton.dataset.action = "reply";
    ReplyButton.textContent = "Reply";

    const EditButton = document.createElement("button");
    EditButton.type = "button";
    EditButton.dataset.action = "edit";
    EditButton.textContent = "Edit";

    const DeleteButton = document.createElement("button");
    DeleteButton.type = "button";
    DeleteButton.dataset.action = "delete";
    DeleteButton.textContent = "Delete";

    Actions.append(ReplyButton, EditButton, DeleteButton);

    Body.append(
        Header,
        Reply,
        Content,
        Attachments,
        Actions
    );

    Element.append(Avatar, Body);

    return Element;
}

function RenderMessageAttachments(Container, Attachments) {
    Container.replaceChildren();

    if (!Array.isArray(Attachments)) return;

    for (const Attachment of Attachments) {
        if (!Attachment?.Url) continue;

        if (Attachment.Type === "Image") {
            const Image = document.createElement("img");
            Image.className = "MessageAttachmentImage";
            Image.src = Attachment.Url;
            Image.alt = Attachment.Name || "Uploaded Image";
            Image.loading = "lazy";
            Image.decoding = "async";
            Container.append(Image);
            continue;
        }

        if (Attachment.Type === "Video") {
            const Video = document.createElement("video");
            Video.className = "MessageAttachmentVideo";
            Video.src = Attachment.Url;
            Video.controls = true;
            Video.preload = "metadata";
            Container.append(Video);
            continue;
        }

        const FileLink = document.createElement("a");
        FileLink.className = "MessageAttachmentFile";
        FileLink.href = Attachment.Url;
        FileLink.target = "_blank";
        FileLink.rel = "noopener noreferrer";
        FileLink.textContent = Attachment.Name || "Open Attachment";

        Container.append(FileLink);
    }
}

function UpdateMessageElement(MessageId, Element, Data) {
    Element.dataset.uid = Data.Uid || "";
    Element.dataset.replyTo = Data.ReplyTo || "";

    const Profile = ProfileCache.get(Data.Uid) || GetProfileFallback(Data.Uid);

    const Author = Element.querySelector(".MessageAuthor");
    const Username = Element.querySelector(".MessageUsername");
    const AvatarImage = Element.querySelector(".MessageAvatar img");
    const AvatarFallback = Element.querySelector(".MessageAvatarFallback");
    const Timestamp = Element.querySelector(".MessageTimestamp");
    const Edited = Element.querySelector(".MessageEdited");
    const Reply = Element.querySelector(".MessageReply");
    const ReplyText = Element.querySelector(".MessageReply p");
    const Content = Element.querySelector(".MessageContent");
    const Attachments = Element.querySelector(".MessageAttachments");
    const EditButton = Element.querySelector('[data-action="edit"]');
    const DeleteButton = Element.querySelector('[data-action="delete"]');

    Author.textContent = Profile.DisplayName || Profile.Username || "Unknown User";
    Username.textContent = Profile.Username ? `@${Profile.Username}` : "";

    if (Profile.AvatarUrl) {
        AvatarImage.src = Profile.AvatarUrl;
        AvatarImage.hidden = false;
        AvatarFallback.hidden = true;
    } else {
        AvatarImage.removeAttribute("src");
        AvatarImage.hidden = true;
        AvatarFallback.hidden = false;
        AvatarFallback.textContent = GetInitials(Profile.DisplayName || Profile.Username);
    }

    Timestamp.textContent = FormatMessageTimestamp(Data);
    Edited.textContent = Data.UpdatedAt ? "(Edited)" : "";

    if (Data.ReplyTo) {
        Reply.hidden = false;
        ReplyText.textContent = GetMessagePreview(MessagesById.get(Data.ReplyTo));
    } else {
        Reply.hidden = true;
    }

    Content.classList.toggle("MessageDeleted", Boolean(Data.Deleted));
    Content.textContent = Data.Deleted
        ? "This Message Was Deleted."
        : Data.Content || "";

    RenderMessageAttachments(
        Attachments,
        Data.Deleted ? [] : Data.Attachments
    );

    const IsOwnMessage = CurrentUser && Data.Uid === CurrentUser.uid;

    EditButton.hidden = !IsOwnMessage || Data.Deleted;
    DeleteButton.hidden = !IsOwnMessage || Data.Deleted;

    if (Data.Deleted) {
        EditButton.hidden = true;
        DeleteButton.hidden = true;
    }
}

function InsertMessageElement(Element, Data) {
    const Timestamp = GetMessageTimestamp(Data);
    const ExistingTimestamp = Element.parentElement
        ? GetMessageTimestamp(MessagesById.get(Element.dataset.messageId))
        : null;

    if (Element.parentElement === MessageList && ExistingTimestamp === Timestamp) {
        return;
    }

    if (Element.parentElement) {
        Element.remove();
    }

    const Children = Array.from(MessageList.children).filter(
        (Child) => Child.classList.contains("MessageItem")
    );

    const BeforeElement = Children.find((Child) => {
        const ExistingMessage = MessagesById.get(Child.dataset.messageId);

        return ExistingMessage &&
            GetMessageTimestamp(ExistingMessage) > Timestamp;
    });

    if (BeforeElement) {
        MessageList.insertBefore(Element, BeforeElement);
    } else {
        MessageList.append(Element);
    }
}

function UpsertMessage(MessageId, Data) {
    const ExistingElement = MessageElements.get(MessageId);
    const Element = ExistingElement || CreateMessageElement(MessageId, Data);

    MessagesById.set(MessageId, Data);

    if (!ExistingElement) {
        MessageElements.set(MessageId, Element);
    }

    UpdateMessageElement(MessageId, Element, Data);
    InsertMessageElement(Element, Data);

    EnsureProfileListener(Data.Uid);

    if (Data.ReplyTo) {
        UpdateReplyPreviews(Data.ReplyTo);
    }
}

function UpdateChatStatus(Text) {
    ChatStatus.textContent = Text;
    ChatStatus.hidden = !Text;
}

function StartChat() {
    StopChat();

    InitialMessagesLoaded = false;
    HasMoreMessages = true;
    OldestLoadedSnapshot = null;

    MessageList.replaceChildren();
    UpdateChatStatus("Loading Messages...");

    const MessagesQuery = query(
        collection(Db, "Messages"),
        orderBy("CreatedAt", "desc"),
        limit(MessagePageSize)
    );

    ChatUnsubscribe = onSnapshot(
        MessagesQuery,
        (Snapshot) => {
            const WasNearBottom =
                MessageList.scrollHeight -
                MessageList.scrollTop -
                MessageList.clientHeight < 100;

            const Documents = Snapshot.docs;

            if (!OldestLoadedSnapshot && Documents.length) {
                OldestLoadedSnapshot = Documents[Documents.length - 1];
            }

            HasMoreMessages = Documents.length === MessagePageSize;

            for (const Document of Documents.slice().reverse()) {
                UpsertMessage(Document.id, Document.data());
            }

            if (!Documents.length && !MessagesById.size) {
                UpdateChatStatus("No Messages Yet. Start The Conversation.");
            } else {
                UpdateChatStatus("");
            }

            if (!InitialMessagesLoaded) {
                InitialMessagesLoaded = true;
                MessageList.scrollTop = MessageList.scrollHeight;
            } else if (WasNearBottom) {
                MessageList.scrollTop = MessageList.scrollHeight;
            }
        },
        () => {
            UpdateChatStatus("Unable To Load Messages. Please Refresh The Page.");
        }
    );
}

function StopChat() {
    if (ChatUnsubscribe) {
        ChatUnsubscribe();
        ChatUnsubscribe = null;
    }

    StopProfileListeners();

    MessagesById.clear();
    MessageElements.clear();

    MessageList.replaceChildren();
    InitialMessagesLoaded = false;
    OldestLoadedSnapshot = null;
    HasMoreMessages = true;
    IsLoadingOlderMessages = false;
}

async function LoadOlderMessages() {
    if (
        IsLoadingOlderMessages ||
        !HasMoreMessages ||
        !OldestLoadedSnapshot ||
        !CurrentUser
    ) {
        return;
    }

    IsLoadingOlderMessages = true;

    const PreviousHeight = MessageList.scrollHeight;
    const PreviousTop = MessageList.scrollTop;

    try {
        const OlderQuery = query(
            collection(Db, "Messages"),
            orderBy("CreatedAt", "desc"),
            startAfter(OldestLoadedSnapshot),
            limit(MessagePageSize)
        );

        const Snapshot = await getDocs(OlderQuery);

        if (!Snapshot.docs.length) {
            HasMoreMessages = false;
            return;
        }

        OldestLoadedSnapshot = Snapshot.docs[Snapshot.docs.length - 1];
        HasMoreMessages = Snapshot.docs.length === MessagePageSize;

        for (const Document of Snapshot.docs.slice().reverse()) {
            UpsertMessage(Document.id, Document.data());
        }

        MessageList.scrollTop =
            PreviousTop + (MessageList.scrollHeight - PreviousHeight);
    } catch (Error) {
        UpdateChatStatus("Unable To Load Older Messages.");
    } finally {
        IsLoadingOlderMessages = false;
    }
}

function GetAttachmentType(File) {
    if (File.type.startsWith("image/")) {
        return "Image";
    }

    if (File.type.startsWith("video/")) {
        return "Video";
    }

    return null;
}

function ValidateAttachment(File) {
    const Type = GetAttachmentType(File);

    if (!Type) {
        return "Only Images And Videos Can Be Uploaded.";
    }

    if (Type === "Image" && File.size > MaximumImageSize) {
        return "Images Must Be Smaller Than 25 MB.";
    }

    if (Type === "Video" && File.size > MaximumVideoSize) {
        return "Videos Must Be Smaller Than 35 MB.";
    }

    return null;
}

function RenderAttachmentPreview() {
    AttachmentPreview.replaceChildren();
    AttachmentPreview.hidden = SelectedAttachments.length === 0;

    SelectedAttachments.forEach((File, Index) => {
        const Item = document.createElement("div");
        Item.className = "AttachmentPreviewItem";

        const Name = document.createElement("span");
        Name.textContent = File.name;

        const RemoveButton = document.createElement("button");
        RemoveButton.type = "button";
        RemoveButton.textContent = "×";
        RemoveButton.setAttribute("aria-label", "Remove Attachment");
        RemoveButton.addEventListener("click", () => {
            SelectedAttachments.splice(Index, 1);
            RenderAttachmentPreview();
        });

        Item.append(Name, RemoveButton);
        AttachmentPreview.append(Item);
    });
}

function SetReply(MessageId) {
    const Message = MessagesById.get(MessageId);

    if (!Message || Message.Deleted) return;

    CurrentReplyTo = MessageId;
    ReplyPreviewText.textContent = GetMessagePreview(Message);
    ReplyPreview.hidden = false;
    MessageInput.focus();
}

function ClearReply() {
    CurrentReplyTo = null;
    ReplyPreview.hidden = true;
    ReplyPreviewText.textContent = "";
}

async function SendMessage(Event) {
    Event.preventDefault();

    if (!CurrentUser || IsSendingMessage) return;

    const Content = MessageInput.value.trim();
    const Files = [...SelectedAttachments];

    if (!Content && !Files.length) return;

    if (Files.length > MaximumAttachments) {
        UpdateChatStatus("You Can Attach A Maximum Of 4 Files.");
        return;
    }

    IsSendingMessage = true;
    SetButtonState(SendMessageButton, true, "Sending...");
    AttachmentButton.disabled = true;

    try {
        const Attachments = [];

        for (let Index = 0; Index < Files.length; Index++) {
            const File = Files[Index];
            const ValidationMessage = ValidateAttachment(File);

            if (ValidationMessage) {
                throw new Error(ValidationMessage);
            }

            SendMessageButton.textContent = `Uploading ${Index + 1}/${Files.length}...`;

            const Url = await UploadFileToImageKit(
                File,
                "messages",
                CurrentUser
            );

            Attachments.push({
                Url: Url,
                Type: GetAttachmentType(File),
                Name: File.name,
                Size: File.size
            });
        }

        let Type = "Text";

        if (Attachments.length) {
            const AttachmentTypes = new Set(
                Attachments.map((Attachment) => Attachment.Type)
            );

            if (Content || AttachmentTypes.size > 1) {
                Type = "Mixed";
            } else if (AttachmentTypes.has("Image")) {
                Type = "Image";
            } else {
                Type = "Video";
            }
        }

        await addDoc(collection(Db, "Messages"), {
            Uid: CurrentUser.uid,
            Content: Content,
            Type: Type,
            Attachments: Attachments,
            CreatedAt: serverTimestamp(),
            UpdatedAt: null,
            ReplyTo: CurrentReplyTo,
            Deleted: false
        });

        MessageInput.value = "";
        MessageInput.style.height = "36px";
        SelectedAttachments = [];
        RenderAttachmentPreview();
        ClearReply();
        UpdateChatStatus("");
        MessageList.scrollTop = MessageList.scrollHeight;
    } catch (Error) {
        UpdateChatStatus(
            Error.message === "AvatarUploadFailed"
                ? "Unable To Upload Your Attachments. Please Try Again."
                : Error.message || "Unable To Send Your Message."
        );
    } finally {
        IsSendingMessage = false;
        SetButtonState(SendMessageButton, false, "Send");
        AttachmentButton.disabled = false;
    }
}

async function EditMessage(MessageId) {
    const Message = MessagesById.get(MessageId);

    if (!Message || Message.Uid !== CurrentUser?.uid || Message.Deleted) {
        return;
    }

    const NewContent = window.prompt(
        "Edit Your Message",
        Message.Content || ""
    );

    if (NewContent === null) return;

    const Content = NewContent.trim();

    if (!Content) {
        UpdateChatStatus("A Message Cannot Be Empty.");
        return;
    }

    try {
        await updateDoc(doc(Db, "Messages", MessageId), {
            Content: Content,
            UpdatedAt: serverTimestamp()
        });
    } catch (Error) {
        UpdateChatStatus("Unable To Edit Your Message.");
    }
}

async function DeleteMessage(MessageId) {
    const Message = MessagesById.get(MessageId);

    if (!Message || Message.Uid !== CurrentUser?.uid || Message.Deleted) {
        return;
    }

    if (!window.confirm("Delete This Message?")) {
        return;
    }

    try {
        await updateDoc(doc(Db, "Messages", MessageId), {
            Content: "",
            Deleted: true
        });
    } catch (Error) {
        UpdateChatStatus("Unable To Delete Your Message.");
    }
}

async function LoadAuthenticatedUser(User) {
    CurrentUser = User;

    try {
        await MigrateUserProfile(User);

        const UserRef = doc(Db, "Users", User.uid);
        const ProfileRef = doc(Db, "Profiles", User.uid);

        const [UserSnapshot, ProfileSnapshot] = await Promise.all([
            getDoc(UserRef),
            getDoc(ProfileRef)
        ]);

        if (!UserSnapshot.exists() || !ProfileSnapshot.exists()) {
            throw new Error("ProfileNotFound");
        }

        const ProfileData = ProfileSnapshot.data();

        await updateDoc(UserRef, {
            LastActive: serverTimestamp()
        });

        ProfileUsername.value = ProfileData.Username || "";
        ProfileDisplayName.value = ProfileData.DisplayName || "";

        CurrentAvatarUrl = ProfileData.AvatarUrl || null;
        SelectedAvatarFile = null;
        SelectedAvatarBlob = null;
        ProfileAvatarFile.value = "";

        ProfileCache.set(User.uid, {
            ...ProfileData,
            Uid: User.uid
        });

        UpdateAvatarPreview(CurrentAvatarUrl);

        AuthenticatedMessage.textContent = `Signed In As ${ProfileData.Username}`;

        AuthContainer.hidden = true;
        ChatContainer.hidden = false;

        StartChat();
    } catch (Error) {
        AuthenticatedMessage.textContent = "Unable To Load Your Account Profile.";
        ShowView("Authenticated");
        AuthContainer.hidden = false;
    }
}

ShowSignUp.addEventListener("click", () => {
    ShowView("SignUp");
});

ShowSignIn.addEventListener("click", () => {
    ShowView("SignIn");
});

ProfileSettingsButton.addEventListener("click", () => {
    ShowView("Authenticated");
    AuthContainer.hidden = false;
});

CloseProfileSettings.addEventListener("click", () => {
    AuthContainer.hidden = true;
    ChatContainer.hidden = false;
});

ProfileAvatarFile.addEventListener("change", () => {
    const File = ProfileAvatarFile.files[0];

    ProfileMessage.textContent = "";
    ProfileMessage.style.color = "";

    if (!File) return;

    if (!AllowedAvatarTypes[File.type]) {
        ProfileMessage.textContent = "Please Select A PNG, JPG, WebP, Or GIF Image.";
        ProfileAvatarFile.value = "";
        return;
    }

    if (File.size > MaximumAvatarSize) {
        ProfileMessage.textContent = "Your Avatar Must Be Smaller Than 5 MB.";
        ProfileAvatarFile.value = "";
        return;
    }

    OpenAvatarCrop(File);
});

AvatarCropZoom.addEventListener("input", () => {
    AvatarCropScale = Number(AvatarCropZoom.value);
    UpdateAvatarCropPosition();
});

AvatarCropViewport.addEventListener("pointerdown", (Event) => {
    if (!AvatarCropImage) return;

    AvatarCropDragging = true;
    AvatarCropPointerX = Event.clientX;
    AvatarCropPointerY = Event.clientY;
    AvatarCropStartX = AvatarCropOffsetX;
    AvatarCropStartY = AvatarCropOffsetY;

    AvatarCropViewport.setPointerCapture(Event.pointerId);
});

AvatarCropViewport.addEventListener("pointermove", (Event) => {
    if (!AvatarCropDragging) return;

    AvatarCropOffsetX =
        AvatarCropStartX + Event.clientX - AvatarCropPointerX;

    AvatarCropOffsetY =
        AvatarCropStartY + Event.clientY - AvatarCropPointerY;

    UpdateAvatarCropPosition();
});

AvatarCropViewport.addEventListener("pointerup", () => {
    AvatarCropDragging = false;
});

AvatarCropViewport.addEventListener("pointercancel", () => {
    AvatarCropDragging = false;
});

function CancelAvatarCrop() {
    CloseAvatarCrop();
}

AvatarCropClose.addEventListener("click", CancelAvatarCrop);
AvatarCropCancel.addEventListener("click", CancelAvatarCrop);

AvatarCropModal.addEventListener("click", (Event) => {
    if (Event.target === AvatarCropModal) {
        CancelAvatarCrop();
    }
});

AvatarCropSave.addEventListener("click", async () => {
    AvatarCropSave.disabled = true;
    AvatarCropSave.textContent = "Preparing...";

    try {
        SelectedAvatarBlob = await CreateCroppedAvatar();

        SelectedAvatarFile = new File(
            [SelectedAvatarBlob],
            `avatar_${Date.now()}.jpg`,
            { type: "image/jpeg" }
        );

        SetAvatarPreviewFromFile(SelectedAvatarFile);
        CloseAvatarCrop();
    } catch (Error) {
        ProfileMessage.textContent = "Unable To Prepare This Avatar. Please Try Again.";
    } finally {
        AvatarCropSave.disabled = false;
        AvatarCropSave.textContent = "Use Avatar";
    }
});

SignUpForm.addEventListener("submit", async (Event) => {
    Event.preventDefault();

    const Username = document.getElementById("SignUpUsername").value.trim().toLowerCase();
    const DisplayName = document.getElementById("SignUpDisplayName").value.trim();
    const Email = document.getElementById("SignUpEmail").value.trim();
    const Password = document.getElementById("SignUpPassword").value;
    const ConfirmPassword = document.getElementById("ConfirmPassword").value;

    SignUpMessage.textContent = "";

    if (!/^[a-z0-9_]{3,20}$/.test(Username)) {
        SignUpMessage.textContent = "Usernames Must Be 3 To 20 Characters And Contain Only Lowercase Letters, Numbers, And Underscores.";
        return;
    }

    if (DisplayName.length < 1 || DisplayName.length > 32) {
        SignUpMessage.textContent = "Please Enter A Display Name Between 1 And 32 Characters.";
        return;
    }

    if (Password.length < 8) {
        SignUpMessage.textContent = "Your Password Must Contain At Least 8 Characters.";
        return;
    }

    if (Password !== ConfirmPassword) {
        SignUpMessage.textContent = "Your Passwords Do Not Match.";
        return;
    }

    SignUpInProgress = true;
    SetButtonState(SignUpButton, true, "Creating Account...");

    let UserCredential = null;
    let ProfileCreated = false;

    try {
        UserCredential = await createUserWithEmailAndPassword(Auth, Email, Password);

        const User = UserCredential.user;

        const UserRef = doc(Db, "Users", User.uid);
        const ProfileRef = doc(Db, "Profiles", User.uid);
        const UsernameRef = doc(Db, "Usernames", Username);

        await runTransaction(Db, async (Transaction) => {
            const UsernameSnapshot = await Transaction.get(UsernameRef);

            if (UsernameSnapshot.exists()) {
                throw new Error("UsernameTaken");
            }

            Transaction.set(UserRef, {
                Email: User.email,
                CreatedAt: serverTimestamp(),
                LastActive: serverTimestamp()
            });

            Transaction.set(ProfileRef, {
                Username: Username,
                DisplayName: DisplayName,
                AvatarUrl: null,
                CreatedAt: serverTimestamp(),
                UpdatedAt: serverTimestamp()
            });

            Transaction.set(UsernameRef, {
                Uid: User.uid,
                Username: Username,
                CreatedAt: serverTimestamp()
            });
        });

        ProfileCreated = true;

        await LoadAuthenticatedUser(User);

        SignUpForm.reset();
    } catch (Error) {
        if (UserCredential && !ProfileCreated) {
            try {
                await deleteUser(UserCredential.user);
            } catch (DeleteError) {
                SignUpMessage.textContent = "Account Cleanup Could Not Be Completed. Please Contact Support.";
                return;
            }
        }

        if (Error.message === "UsernameTaken") {
            SignUpMessage.textContent = "That Username Is Already Taken.";
        } else {
            SignUpMessage.textContent = GetAuthMessage(Error.code);
        }
    } finally {
        SignUpInProgress = false;
        SetButtonState(SignUpButton, false, "Create Account");
    }
});

SignInForm.addEventListener("submit", async (Event) => {
    Event.preventDefault();

    const Email = document.getElementById("SignInEmail").value.trim();
    const Password = document.getElementById("SignInPassword").value;

    SignInMessage.textContent = "";

    SetButtonState(SignInButton, true, "Signing In...");

    try {
        await signInWithEmailAndPassword(Auth, Email, Password);
    } catch (Error) {
        if (
            Error.code === "auth/user-not-found" ||
            Error.code === "auth/wrong-password" ||
            Error.code === "auth/invalid-credential"
        ) {
            SignInMessage.textContent = "The Email Or Password Is Incorrect.";
        } else {
            SignInMessage.textContent = GetAuthMessage(Error.code);
        }
    } finally {
        SetButtonState(SignInButton, false, "Sign In");
    }
});

ProfileForm.addEventListener("submit", async (Event) => {
    Event.preventDefault();

    if (!CurrentUser) {
        ProfileMessage.textContent = "Please Sign In Again.";
        return;
    }

    const Username = ProfileUsername.value.trim().toLowerCase();
    const DisplayName = ProfileDisplayName.value.trim();

    ProfileMessage.textContent = "";
    ProfileMessage.style.color = "";

    const ValidationMessage = ValidateProfile(
        Username,
        DisplayName
    );

    if (ValidationMessage) {
        ProfileMessage.textContent = ValidationMessage;
        return;
    }

    SetButtonState(SaveProfileButton, true, "Saving Changes...");

    try {
        const User = CurrentUser;
        let AvatarUrl = CurrentAvatarUrl;

        if (SelectedAvatarFile) {
            SetButtonState(SaveProfileButton, true, "Uploading Avatar...");
            AvatarUrl = await UploadAvatar(SelectedAvatarFile, User);
        }

        SetButtonState(SaveProfileButton, true, "Saving Changes...");

        const ProfileRef = doc(Db, "Profiles", User.uid);

        await runTransaction(Db, async (Transaction) => {
            const ProfileSnapshot = await Transaction.get(ProfileRef);

            if (!ProfileSnapshot.exists()) {
                throw new Error("ProfileNotFound");
            }

            const CurrentProfile = ProfileSnapshot.data();
            const PreviousUsername = CurrentProfile.Username.toLowerCase();

            const PreviousUsernameRef = doc(Db, "Usernames", PreviousUsername);
            const NewUsernameRef = doc(Db, "Usernames", Username);

            const PreviousUsernameSnapshot = await Transaction.get(PreviousUsernameRef);

            let NewUsernameSnapshot = PreviousUsernameSnapshot;

            if (Username !== PreviousUsername) {
                NewUsernameSnapshot = await Transaction.get(NewUsernameRef);
            }

            if (
                !PreviousUsernameSnapshot.exists() ||
                PreviousUsernameSnapshot.data().Uid !== User.uid
            ) {
                throw new Error("UsernameReservationInvalid");
            }

            if (
                Username !== PreviousUsername &&
                NewUsernameSnapshot.exists()
            ) {
                throw new Error("UsernameTaken");
            }

            if (Username !== PreviousUsername) {
                Transaction.delete(PreviousUsernameRef);

                Transaction.set(NewUsernameRef, {
                    Uid: User.uid,
                    Username: Username,
                    CreatedAt: serverTimestamp()
                });
            }

            Transaction.update(ProfileRef, {
                Username: Username,
                DisplayName: DisplayName,
                AvatarUrl: AvatarUrl,
                UpdatedAt: serverTimestamp()
            });
        });

        CurrentAvatarUrl = AvatarUrl;
        SelectedAvatarFile = null;
        SelectedAvatarBlob = null;
        ProfileAvatarFile.value = "";

        UpdateAvatarPreview(CurrentAvatarUrl);

        const UpdatedProfile = {
            Username: Username,
            DisplayName: DisplayName,
            AvatarUrl: AvatarUrl,
            Uid: User.uid
        };

        ProfileCache.set(User.uid, UpdatedProfile);
        UpdateMessageProfiles(User.uid);

        AuthenticatedMessage.textContent = `Signed In As ${Username}`;
        ProfileMessage.style.color = "#8fbd99";
        ProfileMessage.textContent = "Your Profile Has Been Updated.";
    } catch (Error) {
        ProfileMessage.style.color = "#e18a8a";
        ProfileMessage.textContent = GetUsernameErrorMessage(Error);
    } finally {
        SetButtonState(SaveProfileButton, false, "Save Changes");
    }
});

async function SignOutUser() {
    try {
        await signOut(Auth);
    } catch (Error) {
        UpdateChatStatus("Unable To Sign Out. Please Try Again.");
    }
}

SignOutButton.addEventListener("click", async () => {
    SetButtonState(SignOutButton, true, "Signing Out...");
    await SignOutUser();
    SetButtonState(SignOutButton, false, "Sign Out");
});

ChatSignOutButton.addEventListener("click", SignOutUser);

ChatComposer.addEventListener("submit", SendMessage);

MessageInput.addEventListener("input", () => {
    MessageInput.style.height = "36px";
    MessageInput.style.height = `${Math.min(MessageInput.scrollHeight, 160)}px`;
});

MessageInput.addEventListener("keydown", (Event) => {
    if (Event.key === "Enter" && !Event.shiftKey) {
        Event.preventDefault();
        ChatComposer.requestSubmit();
    }
});

AttachmentButton.addEventListener("click", () => {
    AttachmentInput.click();
});

AttachmentInput.addEventListener("change", () => {
    const Files = Array.from(AttachmentInput.files || []);

    for (const File of Files) {
        if (SelectedAttachments.length >= MaximumAttachments) {
            UpdateChatStatus("You Can Attach A Maximum Of 4 Files.");
            break;
        }

        const ValidationMessage = ValidateAttachment(File);

        if (ValidationMessage) {
            UpdateChatStatus(ValidationMessage);
            continue;
        }

        SelectedAttachments.push(File);
    }

    AttachmentInput.value = "";
    RenderAttachmentPreview();
});

CancelReplyButton.addEventListener("click", ClearReply);

MessageList.addEventListener("scroll", () => {
    if (MessageList.scrollTop < 100) {
        LoadOlderMessages();
    }
});

MessageList.addEventListener("click", (Event) => {
    const Button = Event.target.closest("button[data-action]");

    if (!Button) return;

    const MessageElement = Button.closest(".MessageItem");

    if (!MessageElement) return;

    const MessageId = MessageElement.dataset.messageId;
    const Action = Button.dataset.action;

    if (Action === "reply") {
        SetReply(MessageId);
    }

    if (Action === "edit") {
        EditMessage(MessageId);
    }

    if (Action === "delete") {
        DeleteMessage(MessageId);
    }
});

onAuthStateChanged(Auth, async (User) => {
    if (SignUpInProgress) {
        return;
    }

    if (User) {
        await LoadAuthenticatedUser(User);
    } else {
        StopChat();

        CurrentUser = null;
        CurrentAvatarUrl = null;
        SelectedAvatarFile = null;
        SelectedAvatarBlob = null;
        SelectedAttachments = [];

        ClearReply();
        RenderAttachmentPreview();
        UpdateAvatarPreview(null);

        ChatContainer.hidden = true;

        ShowView("SignIn");
        AuthContainer.hidden = false;
    }
});