(function () {
  if (AdminAPI.isLoggedIn()) {
    window.location.href = "index.html";
    return;
  }

  let bootstrapMode = false;

  const el = {
    subtitle: document.getElementById("modeSubtitle"),
    error: document.getElementById("formError"),
    form: document.getElementById("authForm"),
    nameRow: document.getElementById("nameRow"),
    nameInput: document.getElementById("nameInput"),
    emailInput: document.getElementById("emailInput"),
    passwordInput: document.getElementById("passwordInput"),
    submitBtn: document.getElementById("submitBtn"),
    toggleBtn: document.getElementById("toggleModeBtn"),
  };

  function setMode(isBootstrap) {
    bootstrapMode = isBootstrap;
    el.nameRow.style.display = isBootstrap ? "block" : "none";
    el.subtitle.textContent = isBootstrap
      ? "สร้างบัญชีแอดมินคนแรกของร้าน (ทำได้ครั้งเดียว)"
      : "เข้าสู่ระบบเพื่อจัดการร้าน";
    el.submitBtn.textContent = isBootstrap ? "สร้างบัญชีแรก" : "เข้าสู่ระบบ";
    el.toggleBtn.textContent = isBootstrap
      ? "มีบัญชีอยู่แล้ว? เข้าสู่ระบบ"
      : "ยังไม่มีบัญชีแรก? ตั้งค่าเริ่มต้นที่นี่";
    el.error.classList.add("hidden");
  }

  el.toggleBtn.addEventListener("click", () => setMode(!bootstrapMode));

  el.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    el.error.classList.add("hidden");
    el.submitBtn.disabled = true;

    const email = el.emailInput.value.trim();
    const password = el.passwordInput.value;

    try {
      let result;
      if (bootstrapMode) {
        result = await AdminAPI.bootstrap({ email, password, name: el.nameInput.value.trim() || undefined });
      } else {
        result = await AdminAPI.login({ email, password });
      }
      AdminAPI.setToken(result.token);
      window.location.href = "index.html";
    } catch (err) {
      const messages = {
        invalid_credentials: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
        already_bootstrapped: "มีบัญชีแอดมินแล้ว กรุณาเข้าสู่ระบบตามปกติ",
      };
      el.error.textContent = messages[err.message] || err.message || "เกิดข้อผิดพลาด";
      el.error.classList.remove("hidden");
      if (err.message === "already_bootstrapped") setMode(false);
    } finally {
      el.submitBtn.disabled = false;
    }
  });
})();
