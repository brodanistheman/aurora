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
    updateDoc
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const AuthContainer = document.querySelector(".AuthContainer");

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

    Canvas.getContext("2d").drawImage(
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

async function UploadAvatar(File, User) {
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

    const Extension = "jpg";
    const FormDataBody = new FormData();

    FormDataBody.append("file", File);
    FormDataBody.append(
        "fileName",
        `avatar_${User.uid}_${Date.now()}.${Extension}`
    );
    FormDataBody.append("publicKey", AuthData.publicKey);
    FormDataBody.append("signature", AuthData.signature);
    FormDataBody.append("expire", String(AuthData.expire));
    FormDataBody.append("token", AuthData.token);
    FormDataBody.append("folder", "/aurora/avatars");
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

        UpdateAvatarPreview(CurrentAvatarUrl);

        AuthenticatedMessage.textContent = `Signed In As ${ProfileData.DisplayName}`;

        ShowView("Authenticated");
        AuthContainer.hidden = false;
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

        SignInForm.reset();
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

        AuthenticatedMessage.textContent = `Signed In As ${DisplayName}`;
        ProfileMessage.style.color = "#8fbd99";
        ProfileMessage.textContent = "Your Profile Has Been Updated.";
    } catch (Error) {
        ProfileMessage.style.color = "#e18a8a";
        ProfileMessage.textContent = GetUsernameErrorMessage(Error);
    } finally {
        SetButtonState(SaveProfileButton, false, "Save Changes");
    }
});

SignOutButton.addEventListener("click", async () => {
    SetButtonState(SignOutButton, true, "Signing Out...");

    try {
        await signOut(Auth);
        CurrentUser = null;
    } catch (Error) {
        AuthenticatedMessage.textContent = "Unable To Sign Out. Please Try Again.";
    } finally {
        SetButtonState(SignOutButton, false, "Sign Out");
    }
});

onAuthStateChanged(Auth, async (User) => {
    if (SignUpInProgress) {
        return;
    }

    if (User) {
        await LoadAuthenticatedUser(User);
    } else {
        CurrentUser = null;
        CurrentAvatarUrl = null;
        SelectedAvatarFile = null;
        SelectedAvatarBlob = null;

        UpdateAvatarPreview(null);

        ShowView("SignIn");
        AuthContainer.hidden = false;
    }
});