const SignInTab = document.getElementById("SignInTab");
const SignUpTab = document.getElementById("SignUpTab");

const SignInForm = document.getElementById("SignInForm");
const SignUpForm = document.getElementById("SignUpForm");

const AuthTitle = document.getElementById("AuthTitle");
const AuthDescription = document.getElementById("AuthDescription");
const AuthFooterText = document.getElementById("AuthFooterText");
const FooterToggle = document.getElementById("FooterToggle");

function ShowSignIn() {
    SignInTab.classList.add("Active");
    SignUpTab.classList.remove("Active");

    SignInForm.classList.remove("Hidden");
    SignUpForm.classList.add("Hidden");

    AuthTitle.textContent = "Sign In";
    AuthDescription.textContent = "Welcome Back";

    AuthFooterText.textContent = "Don't Have An Account?";
    FooterToggle.textContent = "Sign Up";
}

function ShowSignUp() {
    SignUpTab.classList.add("Active");
    SignInTab.classList.remove("Active");

    SignUpForm.classList.remove("Hidden");
    SignInForm.classList.add("Hidden");

    AuthTitle.textContent = "Sign Up";
    AuthDescription.textContent = "Create Your Account";

    AuthFooterText.textContent = "Already Have An Account?";
    FooterToggle.textContent = "Sign In";
}

SignInTab.addEventListener("click", ShowSignIn);
SignUpTab.addEventListener("click", ShowSignUp);

FooterToggle.addEventListener("click", () => {
    if (SignInForm.classList.contains("Hidden")) {
        ShowSignIn();
    } else {
        ShowSignUp();
    }
});

SignInForm.addEventListener("submit", (Event) => {
    Event.preventDefault();
});

SignUpForm.addEventListener("submit", (Event) => {
    Event.preventDefault();
});