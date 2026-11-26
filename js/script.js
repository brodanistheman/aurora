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

const SignInView = document.getElementById("SignInView");
const SignUpView = document.getElementById("SignUpView");
const AuthenticatedView = document.getElementById("AuthenticatedView");

const SignInForm = document.getElementById("SignInForm");
const SignUpForm = document.getElementById("SignUpForm");

const SignInMessage = document.getElementById("SignInMessage");
const SignUpMessage = document.getElementById("SignUpMessage");

const SignInButton = document.getElementById("SignInButton");
const SignUpButton = document.getElementById("SignUpButton");
const SignOutButton = document.getElementById("SignOutButton");

const AuthenticatedMessage = document.getElementById("AuthenticatedMessage");

const ShowSignUp = document.getElementById("ShowSignUp");
const ShowSignIn = document.getElementById("ShowSignIn");

let SignUpInProgress = false;

function ShowView(View) {
    SignInView.hidden = View !== "SignIn";
    SignUpView.hidden = View !== "SignUp";
    AuthenticatedView.hidden = View !== "Authenticated";

    SignInMessage.textContent = "";
    SignUpMessage.textContent = "";
}

function SetButtonState(Button, Disabled, Text) {
    Button.disabled = Disabled;
    Button.textContent = Text;
}

function LogFirebaseError(Context, Error) {
    console.error(`${Context} Error Code:`, Error.code);
    console.error(`${Context} Error Message:`, Error.message);
    console.error(`${Context} Error Details:`, Error);
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
        "auth/invalid-api-key": "The Firebase Configuration Is Invalid.",
        "auth/app-not-authorized": "This Website Is Not Authorized To Use Firebase Authentication.",
        "auth/requests-to-this-api-identitytoolkit-method-are-blocked": "Firebase Authentication Requests Are Currently Blocked.",
        "auth/quota-exceeded": "The Authentication Request Limit Has Been Reached. Please Try Again Later."
    };

    return Messages[Code] || "Something Went Wrong. Please Try Again.";
}

async function LoadAuthenticatedUser(User) {
    try {
        const UserRef = doc(Db, "Users", User.uid);
        const UserSnapshot = await getDoc(UserRef);

        if (!UserSnapshot.exists()) {
            AuthenticatedMessage.textContent = "Your Account Profile Could Not Be Found.";
            await signOut(Auth);
            return;
        }

        const UserData = UserSnapshot.data();

        AuthenticatedMessage.textContent = `Signed In As ${UserData.DisplayName}`;
        ShowView("Authenticated");
    } catch (Error) {
        LogFirebaseError("Load Account", Error);

        AuthenticatedMessage.textContent = "Unable To Load Your Account.";
        ShowView("Authenticated");
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

    if (DisplayName.length === 0 || DisplayName.length > 32) {
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
        const UsernameRef = doc(Db, "Usernames", Username);
        const UserRef = doc(Db, "Users", User.uid);

        await runTransaction(Db, async (Transaction) => {
            const UsernameSnapshot = await Transaction.get(UsernameRef);

            if (UsernameSnapshot.exists()) {
                throw new Error("UsernameTaken");
            }

            Transaction.set(UsernameRef, {
                Uid: User.uid,
                Username: Username,
                CreatedAt: serverTimestamp()
            });

            Transaction.set(UserRef, {
                Username: Username,
                DisplayName: DisplayName,
                Email: User.email,
                AvatarUrl: null,
                CreatedAt: serverTimestamp(),
                LastActive: serverTimestamp()
            });
        });

        ProfileCreated = true;
        SignUpForm.reset();
        SignUpInProgress = false;

        await LoadAuthenticatedUser(User);
    } catch (Error) {
        LogFirebaseError("Signup", Error);

        if (UserCredential && !ProfileCreated) {
            try {
                await deleteUser(UserCredential.user);
            } catch (DeleteError) {
                LogFirebaseError("Account Cleanup", DeleteError);

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
        const UserCredential = await signInWithEmailAndPassword(Auth, Email, Password);

        SignInForm.reset();

        try {
            await updateDoc(doc(Db, "Users", UserCredential.user.uid), {
                LastActive: serverTimestamp()
            });
        } catch (Error) {
            LogFirebaseError("Last Active Update", Error);
        }
    } catch (Error) {
        LogFirebaseError("Signin", Error);

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

SignOutButton.addEventListener("click", async () => {
    SetButtonState(SignOutButton, true, "Signing Out...");

    try {
        await signOut(Auth);
    } catch (Error) {
        LogFirebaseError("Signout", Error);
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
        ShowView("SignIn");
    }
});