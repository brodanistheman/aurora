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
    deleteField
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
const ProfileAvatarUrl = document.getElementById("ProfileAvatarUrl");

let SignUpInProgress = false;
let CurrentUser = null;

function ShowView(View) {
    SignInView.hidden = View !== "SignIn";
    SignUpView.hidden = View !== "SignUp";
    AuthenticatedView.hidden = View !== "Authenticated";

    AuthContainer.classList.toggle("SignUpMode", View === "SignUp");

    SignInMessage.textContent = "";
    SignUpMessage.textContent = "";
    ProfileMessage.textContent = "";

    window.scrollTo(0, 0);
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

    return "Unable To Save Your Profile. Please Try Again.";
}

function ValidateProfile(Username, DisplayName, AvatarUrl) {
    if (!/^[a-z0-9_]{3,20}$/.test(Username)) {
        return "Usernames Must Be 3 To 20 Characters And Contain Only Lowercase Letters, Numbers, And Underscores.";
    }

    if (DisplayName.length < 1 || DisplayName.length > 32) {
        return "Display Names Must Be Between 1 And 32 Characters.";
    }

    if (AvatarUrl) {
        try {
            const Url = new URL(AvatarUrl);

            if (Url.protocol !== "https:") {
                return "Avatar URLs Must Use HTTPS.";
            }
        } catch (Error) {
            return "Please Enter A Valid Avatar URL.";
        }
    }

    return null;
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
                CreatedAt: UserData.CreatedAt || serverTimestamp(),
                UpdatedAt: UserData.UpdatedAt || serverTimestamp()
            });
        }

        if (!UsernameSnapshot.exists()) {
            Transaction.set(UsernameRef, {
                Uid: User.uid,
                Username: Username,
                CreatedAt: serverTimestamp()
            });
        }

        const UserUpdates = {};

        if ("Username" in UserData) {
            UserUpdates.Username = deleteField();
        }

        if ("DisplayName" in UserData) {
            UserUpdates.DisplayName = deleteField();
        }

        if ("AvatarUrl" in UserData) {
            UserUpdates.AvatarUrl = deleteField();
        }

        if ("UpdatedAt" in UserData) {
            UserUpdates.UpdatedAt = deleteField();
        }

        if (Object.keys(UserUpdates).length > 0) {
            Transaction.update(UserRef, UserUpdates);
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
        ProfileAvatarUrl.value = ProfileData.AvatarUrl || "";

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
    const AvatarUrl = ProfileAvatarUrl.value.trim();

    ProfileMessage.textContent = "";

    const ValidationMessage = ValidateProfile(
        Username,
        DisplayName,
        AvatarUrl
    );

    if (ValidationMessage) {
        ProfileMessage.textContent = ValidationMessage;
        return;
    }

    SetButtonState(SaveProfileButton, true, "Saving Changes...");

    try {
        const User = CurrentUser;
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
                AvatarUrl: AvatarUrl || null,
                UpdatedAt: serverTimestamp()
            });
        });

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
        ShowView("SignIn");
        AuthContainer.hidden = false;
    }
});