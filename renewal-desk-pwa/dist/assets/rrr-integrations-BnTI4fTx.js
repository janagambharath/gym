import{f as m,g as w,o as _,n as g}from"./index-BUgGwFA5.js";const N={async mount(e){await h(e)},async unmount(){f()}},l=w;let v=null;const f=()=>{v&&(clearInterval(v),v=null)};function T(e){if(!e)return"never";const t=Math.max(0,Math.round((Date.now()-new Date(e).getTime())/1e3));if(t<60)return"just now";const s=Math.round(t/60);if(s<60)return`${s} min ago`;const r=Math.round(s/60);return r<48?`${r} h ago`:`${Math.round(r/24)} d ago`}function y(e){return!e||e.status!=="connected"||!e.last_success_at?!1:Date.now()-new Date(e.last_success_at).getTime()<300*1e3}function x(e){return y(e)?'<span class="rrr-status-pill is-live">LIVE</span>':e?.last_success_at?`<span class="rrr-status-pill">LAST SEEN ${l(T(e.last_success_at).toUpperCase())}</span>`:'<span class="rrr-status-pill">NOT CONNECTED</span>'}async function k(e,t){try{await navigator.clipboard.writeText(e)}catch{const s=document.createElement("textarea");s.value=e,document.body.appendChild(s),s.select();try{document.execCommand("copy")}catch{}s.remove()}if(t){const s=t.textContent;t.textContent="Copied ✓",t.classList.add("copied"),setTimeout(()=>{t.textContent=s,t.classList.remove("copied")},1600)}}function b(e,t){return l(e?.error?.message||e?.data?.message||t)}async function h(e){f(),e.innerHTML='<div class="rrr-loading">Preparing your connection workspace…</div>';const t=await m("/api/mobile/v1/rrr/integrations"),s=t.ok?t.data.integrations||[]:[],r=s.find(d=>d.type==="adms_direct"),a=s.find(d=>d.type==="ebioserver"),n=t.ok?t.data.devices||[]:[],o=r?await m(`/api/mobile/v1/rrr/integrations/${r.id}/adms/commands`):null,c=o?.ok?o.data.commands||[]:[],i=Math.max(r?.unmapped_records||0,a?.unmapped_records||0);e.innerHTML=`<main class="rrr-page rrr-integrations-page">
    <header class="rrr-header rrr-integrations-header">
      <button id="rrr-back" class="rrr-back-button" aria-label="Back">←</button>
      <div class="rrr-brand"><b>RRR</b><span>Gym Growth System</span></div>
      <span class="rrr-help-label">Device setup</span>
    </header>
    <section class="rrr-setup-hero">
      <div><span class="rrr-eyebrow">${w((_()?.tenantName||"YOUR GYM").toUpperCase())} · ATTENDANCE</span><h1>Connect your terminal, not another computer.</h1><p>Choose Direct Cloud for the cleanest setup. RRR receives attendance securely from your eSSL device and turns it into member actions.</p></div>
      <div class="rrr-setup-progress"><b>${r&&y(r)?"Connected":"Step 1 of 3"}</b><span>${r?.records_synced||0} verified records</span></div>
    </section>
    <section class="rrr-connection-grid">
      <article class="rrr-connect-card rrr-connect-card-primary">
        <div class="rrr-card-top"><span class="rrr-option-icon">☁</span><div>${x(r)}<h2>Direct Cloud</h2><p>No gym PC or bridge required for attendance.</p></div></div>
        ${r?L(r,c):R()}
      </article>
      <article class="rrr-connect-card">
        <div class="rrr-card-top"><span class="rrr-option-icon rrr-option-muted">⌘</span><div><span class="rrr-status-pill">FALLBACK</span><h2>eBioServer Bridge</h2><p>Use only when your licensed eBioServer stays on a gym PC.</p></div></div>
        ${A(a,n)}
      </article>
      <article class="rrr-connect-card">
        <div class="rrr-card-top"><span class="rrr-option-icon">💻</span><div><h2>TCP Bridge (.exe)</h2><p>Custom Windows bridge for direct terminal connection.</p></div></div>
        <p class="rrr-muted-copy">For gyms using the Renewal Desk Bridge .exe on a Windows PC. Download the latest build, enter the pairing code, and it connects directly to your terminal via TCP.</p>
        <button class="rrr-btn rrr-btn-outline" id="rrr-tcp-guide">Download bridge .exe</button>
      </article>
    </section>
    <section class="rrr-steps-panel">
      <div class="rrr-panel-head"><div><span class="rrr-eyebrow">WHAT HAPPENS NEXT</span><h2>Three small steps. Then RRR takes over.</h2></div></div>
      <ol class="rrr-setup-steps">
        <li class="${r?"done":""}"><b>1</b><div><strong>Register the terminal</strong><span>Save the terminal serial number in RRR.</span></div></li>
        <li class="${r&&y(r)?"done":""}"><b>2</b><div><strong>Point it to RRR Cloud</strong><span>Enter the server address shown above in Cloud Server Settings.</span></div></li>
        <li class="${(r?.records_synced||0)>0?"done":""}"><b>3</b><div><strong>Make one real punch</strong><span>RRR confirms the event, then you map any unknown member once.</span></div></li>
      </ol>
      ${r||a?`<button class="rrr-link-button" id="rrr-mappings">Review unknown punches (${i}) →</button>
    <button class="rrr-link-button" id="rrr-enroll-match">Match terminal users to members →</button>`:""}
    </section>
    <aside class="rrr-safety-note"><span>ⓘ</span><p><b>Access-control safety:</b> attendance flows as soon as the terminal connects. Automatic door block/unblock for expired members switches on only after the supervised commissioning below — a real punch, a verified test command, and a physical door test you confirm in person.</p></aside>

  </main>`,e.querySelector("#rrr-back")?.addEventListener("click",()=>g.back()),e.querySelector("#rrr-mappings")?.addEventListener("click",()=>g.push("rrr-mappings")),e.querySelector("#rrr-enroll-match")?.addEventListener("click",()=>g.push("rrr-enroll-match")),E(e),D(e,a),r&&q(e,r,c)}function E(e){e.querySelector("#rrr-direct-form")?.addEventListener("submit",async t=>{t.preventDefault();const s=t.currentTarget,r=s.querySelector("button"),a=e.querySelector("#rrr-direct-error");r.disabled=!0,r.textContent="Saving terminal…",a.textContent="";const n=await m("/api/mobile/v1/rrr/integrations/adms/provision",{method:"POST",body:{device_serial:String(new FormData(s).get("device_serial")||"").trim(),device_name:String(new FormData(s).get("device_name")||"").trim()}});n.ok?await h(e):(r.disabled=!1,r.textContent="Continue →",a.textContent=b(n,"We could not save that terminal. Check the serial number and try again."))})}function R(){return`<form id="rrr-direct-form" class="rrr-direct-form">
    <label>Terminal serial number
      <input name="device_serial" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Example: X2008-123456" required>
    </label>
    <label>Friendly name <input name="device_name" value="Elite Gym Entry" maxlength="120" autocapitalize="off"></label>
    <p id="rrr-direct-error" class="rrr-form-error" role="alert"></p>
    <button class="rrr-primary-button" type="submit">Continue <span>→</span></button>
  </form>`}function p(e,t){return`<div class="rrr-copy-row"><div><span>${l(e)}</span><code>${l(t)}</code></div><button type="button" class="rrr-copy-btn" data-copy="${l(t)}">Copy</button></div>`}function L(e,t){const s=e.terminal_settings||{},r=y(e),a=t[0];return`<div class="rrr-direct-live">
    <div class="rrr-device-identity"><b>${l(e.device_name||"Elite Gym Entry")}</b><span>Serial ${l(e.device_serial||"")}</span></div>
    ${e.status==="connected"||e.last_success_at?"":`
      <div class="rrr-empty-state">
        <b>We haven't heard from this terminal yet.</b>
        ${e.last_error?`<p>Last error: ${l(e.last_error)}</p>`:""}
        <p>Checklist: ① the values below are saved in <b>Menu → Comm. → Cloud Server Setting</b>, ② the terminal has internet access, ③ the serial matches the sticker on the device.</p>
      </div>`}
    <div class="rrr-server-card">
      <span class="rrr-server-card-title">Type these into the terminal</span>
      ${p("Cloud Server Address",s.server_address||"—")}
      ${p("Port",String(s.server_port??"—"))}
      ${p("HTTPS",s.https?"On":"Off")}
      ${p("Path",s.path||"/iclock")}
      ${p("Mode",s.server_mode||"ADMS")}
    </div>
    ${s.token_present?`
    <div class="rrr-empty-state" id="rrr-rotate-box">
      <b>Connection values hidden.</b>
      <p>The token for this terminal is stored securely and can't be shown again — that's why the address and port above are blank. Rotate to get fresh values.</p>
      <button class="rrr-secondary-button" id="rrr-rotate-token" type="button">Rotate token — get fresh values</button>
      <p id="rrr-rotate-error" class="rrr-form-error" role="alert"></p>
      <div id="rrr-serial-box"></div>
    </div>`:""}
    <p class="rrr-muted-copy">On the terminal: <b>Menu → Comm. → Cloud Server Setting</b>. Save these values, then make one test punch. ${s.https?"<b>Important:</b> if your terminal has no HTTPS/SSL option in its menu, it cannot use Direct Cloud — use the eBioServer bridge instead.":"<b>Note:</b> this terminal talks plain HTTP — keep it on a trusted network or use a VPN."}</p>
    <section class="rrr-command-console">
      <div><b>Live commissioning</b><span id="rrr-cmd-progress">${a?S(a):"No commissioning command sent yet."}</span></div>
      <button class="rrr-secondary-button" data-adms-action="probe_info" ${r?"":"disabled"}>1. Send safe connection probe</button>
      ${r?"":'<p class="rrr-muted-copy">Buttons unlock once the terminal phones home — finish step 2 above first.</p>'}
      <label>Temporary device User ID<input id="rrr-test-enroll-number" inputmode="numeric" pattern="[0-9]*" placeholder="Example: 999"></label>
      <div class="rrr-command-actions">
        <button class="rrr-test-block" data-adms-action="block_test" ${r?"":"disabled"}>2. Test block</button>
        <button class="rrr-test-unblock" data-adms-action="unblock_test" ${r?"":"disabled"}>3. Test unblock</button>
      </div>
      <div class="rrr-command-actions" style="margin-top:8px">
        <button class="rrr-secondary-button" data-adms-action="delete_biodata_test" ${r?"":"disabled"}>4. Delete fingerprints (FINGERTMP)</button>
        <button class="rrr-secondary-button" data-adms-action="delete_fingertmp_test" ${r?"":"disabled"}>5. Delete finger 0 (FID=0)</button>
      </div>
      <p class="rrr-muted-copy">Tests 4-5 try to remove just the fingerprint template, keeping the user. If the punch fails but the user still shows in the terminal, we've cracked non-destructive blocking.</p>
      <p id="rrr-command-error" class="rrr-form-error" role="alert"></p>
    </section>
    ${$("direct",e,t)}
  </div>`}function S(e){const t=l(String(e.action||"").replace(/_/g," "));return e.status==="acked"?`✓ ${t} — terminal acknowledged.`:e.status==="failed"?e.result_message?`✗ ${t} — ${l(e.result_message)}`:`✗ ${t} — terminal reported failure${e.result_code?` (result ${l(e.result_code)})`:""}. Check the device and retry.`:e.status==="delivered"?`… ${t} — terminal received it, waiting for acknowledgement.`:`… ${t} — sent, waiting for the terminal to pick it up.`}function q(e,t,s){e.querySelectorAll("[data-copy]").forEach(n=>n.addEventListener("click",()=>k(n.dataset.copy,n))),e.querySelector("#rrr-rotate-token")?.addEventListener("click",async()=>{const n=e.querySelector("#rrr-rotate-token"),o=e.querySelector("#rrr-rotate-error"),c=e.querySelector("#rrr-rotate-box");if(!window.confirm("Rotate the connection token? You will get fresh values to type into the terminal (shown once — copy them before leaving this screen). The old values keep working for 7 days."))return;n.disabled=!0,n.textContent="Rotating…",o.textContent="";const i=await m(`/api/mobile/v1/rrr/integrations/${t.id}/adms/rotate-token`,{method:"POST",body:{}});if(!i.ok){n.disabled=!1,n.textContent="Rotate token — get fresh values",o.textContent=b(i,"Could not rotate the token. Try again.");return}const d=i.data.terminal_settings||{};c.outerHTML=`<div class="rrr-server-card" id="rrr-fresh-settings">
      <span class="rrr-server-card-title">Fresh values — copy them NOW</span>
      <p class="rrr-muted-copy"><b>Shown once.</b> ${l(i.data.warning||"Save these in the terminal before leaving this screen.")}</p>
      ${p("Cloud Server Address",d.server_address||"—")}
      ${p("Port",String(d.server_port??"—"))}
      ${p("HTTPS",d.https?"On":"Off")}
      ${p("Path",d.path||"/iclock")}
      ${p("Mode",d.server_mode||"ADMS")}
    </div>`,e.querySelectorAll("#rrr-fresh-settings [data-copy]").forEach(u=>u.addEventListener("click",()=>k(u.dataset.copy,u)))});const r=n=>{const o=e.querySelector("#rrr-serial-box");o&&(o.innerHTML=n?`
      <p class="rrr-muted-copy"><b>Serial-number login is ON</b> for this terminal — it connects with address + port only, no token needed.</p>
      <button class="rrr-secondary-button" id="rrr-serial-fallback" type="button">Turn off serial login</button>
      <p id="rrr-serial-error" class="rrr-form-error" role="alert"></p>`:`
      <p class="rrr-muted-copy"><b>No path/URL field on your terminal?</b> Some terminals can't send the token. Let this terminal log in with its serial number instead — it then needs only the address and port.</p>
      <button class="rrr-secondary-button" id="rrr-serial-fallback" type="button">Connect with serial number instead</button>
      <p id="rrr-serial-error" class="rrr-form-error" role="alert"></p>`,o.querySelector("#rrr-serial-fallback")?.addEventListener("click",()=>a(!n)))},a=async n=>{const o=e.querySelector("#rrr-serial-fallback"),c=e.querySelector("#rrr-serial-error");if(!o||!window.confirm(n?"Let this terminal log in with its serial number? It will connect with just the server address and port — no token needed. You can turn this off again any time.":"Turn off serial-number login? This terminal will stop connecting until it uses the token path."))return;o.disabled=!0,o.textContent="Switching…",c&&(c.textContent="");const i=await m(`/api/mobile/v1/rrr/integrations/${t.id}/adms/serial-fallback`,{method:"POST",body:{enabled:n}});if(!i.ok){o.disabled=!1,o.textContent=n?"Connect with serial number instead":"Turn off serial login",c&&(c.textContent=b(i,"Could not switch login mode. Try again."));return}r(n)};r(!!t.allow_serial_fallback),e.querySelectorAll("[data-adms-action]").forEach(n=>n.addEventListener("click",async()=>{const o=n.dataset.admsAction,c=e.querySelector("#rrr-command-error"),i=e.querySelector("#rrr-test-enroll-number")?.value.trim();if(o!=="probe_info"&&!/^[1-9][0-9]{0,8}$/.test(i||"")){c.textContent="Enter the temporary device User ID first (digits only, e.g. 999).";return}c.textContent="",e.querySelectorAll("[data-adms-action]").forEach(u=>{u.disabled=!0});const d=await m(`/api/mobile/v1/rrr/integrations/${t.id}/adms/commands`,{method:"POST",body:{action:o,test_enroll_number:i}});if(!d.ok){e.querySelectorAll("[data-adms-action]").forEach(u=>{u.disabled=!1}),c.textContent=b(d,"The terminal did not accept another test yet.");return}P(e,t.id,d.data.command.id)})),C(e,"direct",t,s)}function P(e,t,s){f();const r=()=>e.querySelector("#rrr-cmd-progress");let a=0;const n=async()=>{a+=1;const o=await m(`/api/mobile/v1/rrr/integrations/${t}/adms/commands`),c=o.ok?o.data.commands||[]:[],i=c.find(d=>d.id===s)||c[0];if(i&&r()&&(r().textContent=S(i)),!i||a>=24||i.status==="acked"||i.status==="failed"){f(),a>=24&&i&&!["acked","failed"].includes(i.status)&&r()&&(r().textContent="Still waiting — the terminal may be offline. It will pick the command up when it reconnects."),i&&["acked","failed"].includes(i.status)&&setTimeout(()=>h(e),1500);return}};n(),v=setInterval(n,2500)}function $(e,t,s=[]){if(t.commands_enabled)return'<section class="rrr-commission is-on"><b>✓ Automatic block/unblock is ON</b><p>Expired members are blocked and renewed members are restored automatically on this terminal.</p></section>';const r=(t.records_synced||0)>0,a=e==="direct"?s.some(o=>o.status==="acked"&&["probe_info","block_test","unblock_test"].includes(o.action)):!0,n=(o,c)=>`<li class="${o?"done":""}"><i>${o?"✓":"○"}</i><span>${c}</span></li>`;return`<section class="rrr-commission">
    <b>Supervised commissioning</b>
    <p>Stand at the door with the terminal. Automatic block/unblock switches on only after:</p>
    <ol class="rrr-checklist">
      ${n(r,"A real member punch reached RRR")}
      ${e==="direct"?n(a,"A test command was acknowledged by the terminal"):""}
      ${n(!1,"You watched the door stay locked on test block and open on test unblock")}
    </ol>
    <label class="rrr-confirm"><input type="checkbox" id="rrr-door-confirm-${e}"> I stood at the door and verified the lock behaviour myself.</label>
    <button class="rrr-primary-button" id="rrr-commission-btn-${e}" disabled>Enable automatic block/unblock</button>
    <p id="rrr-commission-error-${e}" class="rrr-form-error" role="alert"></p>
  </section>`}function C(e,t,s,r=[]){const a=e.querySelector(`#rrr-door-confirm-${t}`),n=e.querySelector(`#rrr-commission-btn-${t}`),o=e.querySelector(`#rrr-commission-error-${t}`);if(!a||!n)return;const c=(s.records_synced||0)>0,i=t==="direct"?r.some(u=>u.status==="acked"&&["probe_info","block_test","unblock_test"].includes(u.action)):!0,d=()=>a.checked&&c&&i;if(a.addEventListener("change",()=>{n.disabled=!d()}),!d()){const u=document.createElement("p");u.className="rrr-muted-copy",u.textContent=t==="direct"&&!i?"The button unlocks after a test command above is acknowledged by the terminal.":"The button unlocks after the first real punch above reaches RRR.",n.after(u)}n.addEventListener("click",async()=>{n.disabled=!0,n.textContent="Enabling…",o.textContent="";const u=await m(`/api/mobile/v1/rrr/integrations/${s.id}/commission`,{method:"POST",body:{physical_test_passed:!0}});if(u.ok){await h(e);return}n.disabled=!1,n.textContent="Enable automatic block/unblock",o.textContent=b(u,"Commissioning failed. Finish the checklist above and try again.")})}function A(e,t){const s=e&&["connected","paired"].includes(e.status),r=e?t.filter(a=>a.integration_id===e.id):[];return`
    ${e?`<div class="rrr-bridge-summary"><b>${l(s?"Bridge connected":e.status||"Not configured")}</b><span>${l(e.device_name||e.device_serial||"Awaiting device selection")}</span></div>`:'<p class="rrr-muted-copy">Not needed for Direct Cloud. It remains available for existing eBioServer installations.</p>'}
    ${e&&r.length?`<div class="rrr-device-list rrr-device-list-inline"><h2>Devices reported by the bridge</h2>${r.map(a=>`
      <div class="rrr-device-row"><div><b>${l(a.name||"Terminal")}</b><span>${l(a.serial_number||"")} · ${l(a.status||"unknown")}</span></div>
      ${a.selected?'<span class="rrr-selected-pill">Selected ✓</span>':`<button class="rrr-secondary-button rrr-device-select" data-device-id="${a.id}">Select</button>`}
      </div>`).join("")}</div>`:""}
    ${e?$("ebio",e):""}
    <div class="rrr-pair-row">
      ${s?'<button class="rrr-link-button" id="rrr-pair">Generate a new code</button>':'<button class="rrr-secondary-button" id="rrr-pair">Generate bridge pairing code</button>'}
    </div>
    <div id="rrr-pair-code" class="rrr-code-box" hidden></div>`}function D(e,t,s){e.querySelector("#rrr-pair")?.addEventListener("click",async()=>{const r=await m("/api/mobile/v1/rrr/integrations/ebioserver/pairing",{method:"POST",body:{}}),a=e.querySelector("#rrr-pair-code");if(a.hidden=!1,!r.ok){a.innerHTML=`<span>${b(r,"Could not create a pairing code.")}</span>`;return}a.innerHTML=`<div class="rrr-code-row"><b>${l(r.data.pairing_code)}</b><button class="rrr-copy-btn" id="rrr-copy-code">Copy</button></div><small>Valid for <b>10 minutes</b> — expires ${l(new Date(r.data.expires_at).toLocaleTimeString())}. Type it into the eBioServer Bridge on the gym PC.</small>`,a.querySelector("#rrr-copy-code")?.addEventListener("click",n=>k(r.data.pairing_code,n.currentTarget))}),e.querySelectorAll(".rrr-device-select").forEach(r=>r.addEventListener("click",async()=>{r.disabled=!0;const a=t.id,n=await m(`/api/mobile/v1/rrr/integrations/${a}/device`,{method:"POST",body:{device_id:Number(r.dataset.deviceId)}});n.ok?await h(e):(r.disabled=!1,r.textContent=b(n,"Could not select that device."))})),t&&C(e,"ebio",t)}export{N as default};
