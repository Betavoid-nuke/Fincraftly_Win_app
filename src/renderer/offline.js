// offline.js — retry logic for offline.html (shown when the platform cannot be reached)

(() => {
  const params = new URLSearchParams(location.search);
  const theme = params.get("theme") === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", theme);

  const reason = params.get("reason") || "";
  const reasonNode = document.getElementById("reason");
  if (reason && reasonNode) reasonNode.textContent = reason;

  const retry = document.getElementById("retry");
  const target = params.get("retry") || "https://fincraftly.com/dashboard";
  const attempt = () => {
    retry.disabled = true;
    retry.textContent = "Connecting…";
    location.replace(target);
    // If the navigation was refused instantly (still offline) re-enable.
    setTimeout(() => { retry.disabled = false; retry.textContent = "Try again"; }, 4000);
  };
  retry.addEventListener("click", attempt);
  window.addEventListener("online", attempt);
})();
