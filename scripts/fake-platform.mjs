// A tiny stand-in for fincraftly.com used ONLY for local smoke tests of the
// shell (routing, sidebar hiding, theme sync, menu navigation). It mimics the
// platform's shapes: `/dashboard` → 302 → `/dashboard/{id}/dashboard`, a
// `<html data-theme>` document with a `[data-tour="sidebar-root"]` sidebar and
// the `window.FinCraftlyUI.navigateToView` bus.
//
//   node scripts/fake-platform.mjs            # http://127.0.0.1:3999
//   FINCRAFTLY_ORIGIN=http://127.0.0.1:3999 npm run dev
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 3999);
const USER = "user_2test";

function page(view, theme) {
  return `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><title>${view} — FinCraftly</title>
<style>
 body{margin:0;font-family:Inter,Segoe UI,sans-serif;background:${theme === "dark" ? "#121417" : "#F7F6F3"};color:${theme === "dark" ? "#F7F6F3" : "#121417"}}
 .fin-desktop{display:flex;flex-direction:column;height:100vh}
 .topbar{height:52px;display:flex;align-items:center;gap:12px;padding:0 16px;border-bottom:1px solid rgba(154,162,174,.16)}
 .row{display:flex;flex:1;min-height:0}
 .side{width:240px;background:#1B1F24;color:#fff;padding:16px}
 main{flex:1;padding:24px}
 button{font:inherit}
</style></head><body>
<div class="fin-desktop">
  <header class="topbar"><button data-tour="tb-sidebar-toggle" aria-expanded="true" onclick="(function(b){const a=document.querySelector('[data-tour=sidebar-root]');const open=b.getAttribute('aria-expanded')==='true';b.setAttribute('aria-expanded',String(!open));a.style.display=open?'none':'';})(this)">☰ sidebar</button><strong>FinCraftly</strong>
    <button data-tour="tb-hydra" title="Ask Hydra" style="position:absolute;left:50%;top:0;width:220px;height:44px">NOTCH (must be hidden)</button>
    <button aria-label="Toggle desktop mode" class="relative h-9 rounded-full flex items-center gap-1.5 px-2.5" style="background: rgb(31, 36, 43); border: 1px solid rgba(154, 162, 174, 0.18);">Desktop (must be hidden)</button>
    <span data-tour="tb-credits">1,250 credits</span>
    <button id="theme">toggle theme</button><a href="https://example.com/help" target="_blank">external link</a><span style="margin-left:auto">account ▾</span></header>
  <div class="row">
    <aside data-tour="sidebar-root" class="side flex flex-col">
      <div class="h-16 flex items-center px-4"><div><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt=""><span>FinCraftly</span></div></div>
      <nav><div><button><span>Finance</span><svg></svg></button><div class="grid"><div>
        <div class="relative group/navitem"><button data-tour="nav-AIWS" style="background: rgba(78, 132, 243, 0.14); border: 1px solid rgba(78, 132, 243, 0.38); color: rgb(78, 132, 243);"><span style="color:#4E84F3"><svg></svg></span><span>AI Workspace</span></button><button title="Open AI Workspace in window">⧉</button></div>
        <div class="relative group/navitem"><button data-tour="nav-Invoices" style="background: transparent; border: 1px solid transparent;"><span style="color:#D9A441"><svg></svg></span><span>Invoices</span></button></div>
      </div></div></div></nav>
      <div class="p-4"><div><div><div><svg></svg></div><div><span>Free Plan</span><span>Status: Active</span></div></div><button style="background:#4E84F3;color:#fff">Upgrade Plan</button></div></div>
    </aside>
    <div aria-hidden class="absolute left-0 top-0 bottom-0 z-30 w-2" id="hover-strip" style="position:absolute;left:0;top:0;bottom:0;width:8px;background:red"></div>
    <main><h1 id="view">${view}</h1><p>user ${USER}</p><p id="desktop"></p><p id="hydra">hydra: closed</p></main>
  </div>
</div>
<div class="fixed bottom-0 left-1/2 -translate-x-1/2 z-[9994] flex" style="position:fixed;bottom:0;left:50%;height:28px;width:420px;background:#4E84F3" id="taskbar-line">TASKBAR LINE (must be hidden)</div>
<div class="fixed inset-x-0 bottom-0 z-[9995] h-[86px]" style="position:fixed;bottom:0;left:0;right:0;height:86px;background:#222" id="taskbar">TASKBAR (must be hidden)</div>
<script>
  window.FinCraftlyUI = { navigateToView(v){ document.getElementById('view').textContent = v; window.dispatchEvent(new CustomEvent('fincraftly:navigate',{detail:{viewName:v}})); } };
  document.getElementById('theme').onclick = () => {
    const r = document.documentElement; const next = r.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    r.setAttribute('data-theme', next); r.classList.toggle('dark', next === 'dark'); location.href = '/theme/' + next;
  };
  document.getElementById('desktop').textContent = 'desktop marker: ' + (window.fincraftlyDesktop ? JSON.stringify(window.fincraftlyDesktop) : 'none');
  window.addEventListener('hydra:open', () => { document.getElementById('hydra').textContent = 'hydra: open'; });
  window.Clerk = { signOut: async () => { await fetch('/fake/signout'); } };
</script></body></html>`;
}

let theme = "dark";

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const desktopHeader = req.headers["x-fincraftly-desktop"];
  console.log(req.method, url.pathname, desktopHeader ? `[desktop ${desktopHeader}]` : "", req.headers["user-agent"]?.includes("Electron") ? "!! UA leaks Electron" : "");

  if (url.pathname.startsWith("/theme/")) {
    theme = url.pathname.endsWith("light") ? "light" : "dark";
    res.writeHead(302, { Location: `/dashboard/${USER}/AIWS` });
    return res.end();
  }
  // Session = a cookie, like Clerk's. Signed out → the dashboard bounces to
  // /sign-in; a `__clerk_ticket` signs in and bounces back, like Clerk's <SignIn/>.
  const signedIn = /(^|;\s*)fc_session=1/.test(req.headers.cookie ?? "");
  if (url.pathname === "/fake/signout") {
    res.writeHead(200, { "set-cookie": "fc_session=; Max-Age=0; Path=/" });
    return res.end("ok");
  }
  if (url.pathname === "/sign-in") {
    if (url.searchParams.get("__clerk_ticket")) {
      res.writeHead(302, { "set-cookie": "fc_session=1; Path=/", Location: url.searchParams.get("redirect_url") || "/dashboard" });
      return res.end();
    }
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(`<!doctype html><html data-theme="${theme}"><body style="font-family:sans-serif;background:#121417;color:#fff;padding:40px"><h1>Sign in (must NEVER be visible in the app)</h1></body></html>`);
  }
  // Clerk's session handshake, on ANOTHER origin: the real middleware bounces
  // a page load through clerk.fincraftly.com when the session cookie is stale
  // and Clerk bounces straight back. The app must follow it in-app, never
  // hand it to the browser. Here the "other origin" is 127.0.0.2 → same server.
  if (url.pathname === "/v1/client/handshake") {
    res.writeHead(302, { Location: url.searchParams.get("redirect_url") || `http://127.0.0.1:${PORT}/dashboard` });
    return res.end();
  }
  // The first signed-in page load after a ticket goes through the handshake.
  if (url.pathname.startsWith("/dashboard") && signedIn && !/(^|;\s*)fc_handshake=1/.test(req.headers.cookie ?? "")) {
    const back = `http://127.0.0.1:${PORT}${url.pathname}`;
    res.writeHead(302, { "set-cookie": "fc_handshake=1; Path=/", Location: `http://127.0.0.2:${PORT}/v1/client/handshake?redirect_url=${encodeURIComponent(back)}` });
    return res.end();
  }
  if ((url.pathname.startsWith("/dashboard") || url.pathname.startsWith("/platform")) && !signedIn) {
    res.writeHead(302, { Location: `/sign-in?redirect_url=${encodeURIComponent(url.pathname)}` });
    return res.end();
  }
  if (url.pathname === "/dashboard") {
    res.writeHead(302, { Location: `/dashboard/${USER}/dashboard` });
    return res.end();
  }
  // /platform/{view} resolver — forwards straight to the user's view.
  const resolver = /^\/platform\/?([^/]*)/.exec(url.pathname);
  if (resolver) {
    res.writeHead(302, { Location: `/dashboard/${USER}/${resolver[1] || "dashboard"}` });
    return res.end();
  }
  const match = /^\/dashboard\/([^/]+)\/([^/]+)/.exec(url.pathname);
  if (match) {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(page(decodeURIComponent(match[2]), theme));
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}).listen(PORT, "0.0.0.0", () => console.log(`fake platform on http://127.0.0.1:${PORT} (and 127.0.0.2, the fake Clerk host)`));
