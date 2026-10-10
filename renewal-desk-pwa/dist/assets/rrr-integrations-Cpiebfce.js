import{e as m,n as k,f as _}from"./index-3tbZ5J4-.js";const N={async mount(e){await v(e)}},c=_;let h=null;const y=()=>{h&&(clearInterval(h),h=null)};function C(e){if(!e)return"never";const t=Math.max(0,Math.round((Date.now()-new Date(e).getTime())/1e3));if(t<60)return"just now";const s=Math.round(t/60);if(s<60)return`${s} min ago`;const r=Math.round(s/60);return r<48?`${r} h ago`:`${Math.round(r/24)} d ago`}function f(e){return!e||e.status!=="connected"||!e.last_success_at?!1:Date.now()-new Date(e.last_success_at).getTime()<300*1e3}function T(e){return f(e)?'<span class="rrr-status-pill is-live">LIVE</span>':e?.last_success_at?`<span class="rrr-status-pill">LAST SEEN ${c(C(e.last_success_at).toUpperCase())}</span>`:'<span class="rrr-status-pill">NOT CONNECTED</span>'}async function g(e,t){try{await navigator.clipboard.writeText(e)}catch{const s=document.createElement("textarea");s.value=e,document.body.appendChild(s),s.select();try{document.execCommand("copy")}catch{}s.remove()}if(t){const s=t.textContent;t.textContent="Copied ✓",t.classList.add("copied"),setTimeout(()=>{t.textContent=s,t.classList.remove("copied")},1600)}}function b(e,t){return c(e?.error?.message||e?.data?.message||t)}async function v(e){y(),e.innerHTML='<div class="rrr-loading">Preparing your connection workspace…</div>';const t=await m("/api/mobile/v1/rrr/integrations"),s=t.ok?t.data.integrations||[]:[],r=s.find(u=>u.type==="adms_direct"),n=s.find(u=>u.type==="ebioserver"),a=t.ok?t.data.devices||[]:[],i=r?await m(`/api/mobile/v1/rrr/integrations/${r.id}/adms/commands`):null,d=i?.ok?i.data.commands||[]:[],o=Math.max(r?.unmapped_records||0,n?.unmapped_records||0);e.innerHTML=`<main class="rrr-page rrr-integrations-page">
    <header class="rrr-header rrr-integrations-header">
      <button id="rrr-back" class="rrr-back-button" aria-label="Back">←</button>
      <div class="rrr-brand"><b>RRR</b><span>Gym Growth System</span></div>
      <span class="rrr-help-label">Device setup</span>
    </header>
    <section class="rrr-setup-hero">
      <div><span class="rrr-eyebrow">ELITE GYM · ATTENDANCE</span><h1>Connect your terminal, not another computer.</h1><p>Choose Direct Cloud for the cleanest setup. RRR receives attendance securely from your eSSL device and turns it into member actions.</p></div>
      <div class="rrr-setup-progress"><b>${r&&f(r)?"Connected":"Step 1 of 3"}</b><span>${r?.records_synced||0} verified records</span></div>
    </section>
    <section class="rrr-connection-grid">
      <article class="rrr-connect-card rrr-connect-card-primary">
        <div class="rrr-card-top"><span class="rrr-option-icon">☁</span><div>${T(r)}<h2>Direct Cloud</h2><p>No gym PC or bridge required for attendance.</p></div></div>
        ${r?R(r,d):x()}
      </article>
      <article class="rrr-connect-card">
        <div class="rrr-card-top"><span class="rrr-option-icon rrr-option-muted">⌘</span><div><span class="rrr-status-pill">FALLBACK</span><h2>eBioServer Bridge</h2><p>Use only when your licensed eBioServer stays on a gym PC.</p></div></div>
        ${q(n,a)}
      </article>
    </section>
    <section class="rrr-steps-panel">
      <div class="rrr-panel-head"><div><span class="rrr-eyebrow">WHAT HAPPENS NEXT</span><h2>Three small steps. Then RRR takes over.</h2></div></div>
      <ol class="rrr-setup-steps">
        <li class="${r?"done":""}"><b>1</b><div><strong>Register the terminal</strong><span>Save the terminal serial number in RRR.</span></div></li>
        <li class="${r&&f(r)?"done":""}"><b>2</b><div><strong>Point it to RRR Cloud</strong><span>Enter the server address shown above in Cloud Server Settings.</span></div></li>
        <li class="${(r?.records_synced||0)>0?"done":""}"><b>3</b><div><strong>Make one real punch</strong><span>RRR confirms the event, then you map any unknown member once.</span></div></li>
      </ol>
      ${r||n?`<button class="rrr-link-button" id="rrr-mappings">Review unknown punches (${o}) →</button>`:""}
    </section>
    <aside class="rrr-safety-note"><span>ⓘ</span><p><b>Access-control safety:</b> attendance flows as soon as the terminal connects. Automatic door block/unblock for expired members switches on only after the supervised commissioning below — a real punch, a verified test command, and a physical door test you confirm in person.</p></aside>
  </main>`,e.querySelector("#rrr-back")?.addEventListener("click",()=>k.back()),e.querySelector("#rrr-mappings")?.addEventListener("click",()=>k.push("rrr-mappings")),E(e),P(e,n),r&&A(e,r,d)}function E(e){e.querySelector("#rrr-direct-form")?.addEventListener("submit",async t=>{t.preventDefault();const s=t.currentTarget,r=s.querySelector("button"),n=e.querySelector("#rrr-direct-error");r.disabled=!0,r.textContent="Saving terminal…",n.textContent="";const a=await m("/api/mobile/v1/rrr/integrations/adms/provision",{method:"POST",body:{device_serial:String(new FormData(s).get("device_serial")||"").trim(),device_name:String(new FormData(s).get("device_name")||"").trim()}});a.ok?await v(e):(r.disabled=!1,r.textContent="Continue →",n.textContent=b(a,"We could not save that terminal. Check the serial number and try again."))})}function x(){return`<form id="rrr-direct-form" class="rrr-direct-form">
    <label>Terminal serial number
      <input name="device_serial" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Example: X2008-123456" required>
    </label>
    <label>Friendly name <input name="device_name" value="Elite Gym Entry" maxlength="120" autocapitalize="off"></label>
    <p id="rrr-direct-error" class="rrr-form-error" role="alert"></p>
    <button class="rrr-primary-button" type="submit">Continue <span>→</span></button>
  </form>`}function p(e,t){return`<div class="rrr-copy-row"><div><span>${c(e)}</span><code>${c(t)}</code></div><button type="button" class="rrr-copy-btn" data-copy="${c(t)}">Copy</button></div>`}function R(e,t){const s=e.terminal_settings||{},r=f(e),n=t[0];return`<div class="rrr-direct-live">
    <div class="rrr-device-identity"><b>${c(e.device_name||"Elite Gym Entry")}</b><span>Serial ${c(e.device_serial||"")}</span></div>
    ${e.status==="connected"||e.last_success_at?"":`
      <div class="rrr-empty-state">
        <b>We haven't heard from this terminal yet.</b>
        ${e.last_error?`<p>Last error: ${c(e.last_error)}</p>`:""}
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
    <p class="rrr-muted-copy">On the terminal: <b>Menu → Comm. → Cloud Server Setting</b>. Save these values, then make one test punch. ${s.https?"":"<b>Note:</b> this terminal talks plain HTTP — keep it on a trusted network or use a VPN."}</p>
    <section class="rrr-command-console">
      <div><b>Live commissioning</b><span id="rrr-cmd-progress">${n?$(n):"No commissioning command sent yet."}</span></div>
      <button class="rrr-secondary-button" data-adms-action="probe_info" ${r?"":"disabled"}>1. Send safe connection probe</button>
      ${r?"":'<p class="rrr-muted-copy">Buttons unlock once the terminal phones home — finish step 2 above first.</p>'}
      <label>Temporary device User ID<input id="rrr-test-enroll-number" inputmode="numeric" pattern="[0-9]*" placeholder="Example: 999"></label>
      <div class="rrr-command-actions">
        <button class="rrr-test-block" data-adms-action="block_test" ${r?"":"disabled"}>2. Test block</button>
        <button class="rrr-test-unblock" data-adms-action="unblock_test" ${r?"":"disabled"}>3. Test unblock</button>
      </div>
      <p id="rrr-command-error" class="rrr-form-error" role="alert"></p>
    </section>
    ${w("direct",e,t)}
  </div>`}function $(e){const t=c(String(e.action||"").replace(/_/g," "));return e.status==="acked"?`✓ ${t} — terminal acknowledged.`:e.status==="failed"?`✗ ${t} — terminal reported failure${e.result_code?` (result ${c(e.result_code)})`:""}. Check the device and retry.`:e.status==="delivered"?`… ${t} — terminal received it, waiting for acknowledgement.`:`… ${t} — sent, waiting for the terminal to pick it up.`}function A(e,t,s){e.querySelectorAll("[data-copy]").forEach(r=>r.addEventListener("click",()=>g(r.dataset.copy,r))),e.querySelectorAll("[data-adms-action]").forEach(r=>r.addEventListener("click",async()=>{const n=r.dataset.admsAction,a=e.querySelector("#rrr-command-error"),i=e.querySelector("#rrr-test-enroll-number")?.value.trim();if(n!=="probe_info"&&!/^[1-9][0-9]{0,8}$/.test(i||"")){a.textContent="Enter the temporary device User ID first (digits only, e.g. 999).";return}a.textContent="",e.querySelectorAll("[data-adms-action]").forEach(o=>{o.disabled=!0});const d=await m(`/api/mobile/v1/rrr/integrations/${t.id}/adms/commands`,{method:"POST",body:{action:n,test_enroll_number:i}});if(!d.ok){e.querySelectorAll("[data-adms-action]").forEach(o=>{o.disabled=!1}),a.textContent=b(d,"The terminal did not accept another test yet.");return}L(e,t.id,d.data.command.id)})),S(e,"direct",t,s)}function L(e,t,s){y();const r=()=>e.querySelector("#rrr-cmd-progress");let n=0;const a=async()=>{n+=1;const i=await m(`/api/mobile/v1/rrr/integrations/${t}/adms/commands`),d=i.ok?i.data.commands||[]:[],o=d.find(u=>u.id===s)||d[0];if(o&&r()&&(r().textContent=$(o)),!o||n>=24||o.status==="acked"||o.status==="failed"){y(),n>=24&&o&&!["acked","failed"].includes(o.status)&&r()&&(r().textContent="Still waiting — the terminal may be offline. It will pick the command up when it reconnects."),o&&["acked","failed"].includes(o.status)&&setTimeout(()=>v(e),1500);return}};a(),h=setInterval(a,2500)}function w(e,t,s=[]){if(t.commands_enabled)return'<section class="rrr-commission is-on"><b>✓ Automatic block/unblock is ON</b><p>Expired members are blocked and renewed members are restored automatically on this terminal.</p></section>';const r=(t.records_synced||0)>0,n=e==="direct"?s.some(i=>i.status==="acked"&&["probe_info","block_test","unblock_test"].includes(i.action)):!0,a=(i,d)=>`<li class="${i?"done":""}"><i>${i?"✓":"○"}</i><span>${d}</span></li>`;return`<section class="rrr-commission">
    <b>Supervised commissioning</b>
    <p>Stand at the door with the terminal. Automatic block/unblock switches on only after:</p>
    <ol class="rrr-checklist">
      ${a(r,"A real member punch reached RRR")}
      ${e==="direct"?a(n,"A test command was acknowledged by the terminal"):""}
      ${a(!1,"You watched the door stay locked on test block and open on test unblock")}
    </ol>
    <label class="rrr-confirm"><input type="checkbox" id="rrr-door-confirm"> I stood at the door and verified the lock behaviour myself.</label>
    <button class="rrr-primary-button" id="rrr-commission-btn" disabled>Enable automatic block/unblock</button>
    <p id="rrr-commission-error" class="rrr-form-error" role="alert"></p>
  </section>`}function S(e,t,s,r=[]){const n=e.querySelector("#rrr-door-confirm"),a=e.querySelector("#rrr-commission-btn"),i=e.querySelector("#rrr-commission-error");if(!n||!a)return;const d=(s.records_synced||0)>0,o=t==="direct"?r.some(l=>l.status==="acked"&&["probe_info","block_test","unblock_test"].includes(l.action)):!0,u=()=>n.checked&&d&&o;if(n.addEventListener("change",()=>{a.disabled=!u()}),!u()){const l=document.createElement("p");l.className="rrr-muted-copy",l.textContent=t==="direct"&&!o?"The button unlocks after a test command above is acknowledged by the terminal.":"The button unlocks after the first real punch above reaches RRR.",a.after(l)}a.addEventListener("click",async()=>{a.disabled=!0,a.textContent="Enabling…",i.textContent="";const l=await m(`/api/mobile/v1/rrr/integrations/${s.id}/commission`,{method:"POST",body:{physical_test_passed:!0}});if(l.ok){await v(e);return}a.disabled=!1,a.textContent="Enable automatic block/unblock",i.textContent=b(l,"Commissioning failed. Finish the checklist above and try again.")})}function q(e,t){const s=e&&["connected","paired"].includes(e.status),r=e?t.filter(n=>n.integration_id===e.id):[];return`
    ${e?`<div class="rrr-bridge-summary"><b>${c(s?"Bridge connected":e.status||"Not configured")}</b><span>${c(e.device_name||e.device_serial||"Awaiting device selection")}</span></div>`:'<p class="rrr-muted-copy">Not needed for Direct Cloud. It remains available for existing eBioServer installations.</p>'}
    ${e&&r.length?`<div class="rrr-device-list rrr-device-list-inline"><h2>Devices reported by the bridge</h2>${r.map(n=>`
      <div class="rrr-device-row"><div><b>${c(n.name||"Terminal")}</b><span>${c(n.serial_number||"")} · ${c(n.status||"unknown")}</span></div>
      ${n.selected?'<span class="rrr-selected-pill">Selected ✓</span>':`<button class="rrr-secondary-button rrr-device-select" data-device-id="${n.id}">Select</button>`}
      </div>`).join("")}</div>`:""}
    ${e?w("ebio",e):""}
    <div class="rrr-pair-row">
      ${s?'<button class="rrr-link-button" id="rrr-pair">Generate a new code</button>':'<button class="rrr-secondary-button" id="rrr-pair">Generate bridge pairing code</button>'}
    </div>
    <div id="rrr-pair-code" class="rrr-code-box" hidden></div>`}function P(e,t,s){e.querySelector("#rrr-pair")?.addEventListener("click",async()=>{const r=await m("/api/mobile/v1/rrr/integrations/ebioserver/pairing",{method:"POST",body:{}}),n=e.querySelector("#rrr-pair-code");if(n.hidden=!1,!r.ok){n.innerHTML=`<span>${b(r,"Could not create a pairing code.")}</span>`;return}n.innerHTML=`<div class="rrr-code-row"><b>${c(r.data.pairing_code)}</b><button class="rrr-copy-btn" id="rrr-copy-code">Copy</button></div><small>Valid for <b>10 minutes</b> — expires ${c(new Date(r.data.expires_at).toLocaleTimeString())}. Type it into the eBioServer Bridge on the gym PC.</small>`,n.querySelector("#rrr-copy-code")?.addEventListener("click",a=>g(r.data.pairing_code,a.currentTarget))}),e.querySelectorAll(".rrr-device-select").forEach(r=>r.addEventListener("click",async()=>{r.disabled=!0;const n=t.id,a=await m(`/api/mobile/v1/rrr/integrations/${n}/device`,{method:"POST",body:{device_id:Number(r.dataset.deviceId)}});a.ok?await v(e):(r.disabled=!1,r.textContent=b(a,"Could not select that device."))})),t&&S(e,"ebio",t)}export{N as default};
