// js/auth-guard.js
import { auth } from "./firebaseConfig.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";

const userNameEl = document.getElementById("userName");   // index.html side menu
const logoutBtn = document.getElementById("logoutBtn");   // index.html side menu

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  // Side menu’de kullanıcıyı göster
  if (userNameEl) userNameEl.textContent = user.email;

  // (opsiyonel) başka yerler de kullanıyorsa
  localStorage.setItem("fs_email", user.email);
});

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    localStorage.removeItem("fs_email");
    window.location.href = "login.html";
  });
}
