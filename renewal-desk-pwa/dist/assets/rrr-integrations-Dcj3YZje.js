import{f as A,g as b,j as C,p as D,n as w}from"./index-8YfHVAgj.js";const H={async mount(e){e.addEventListener("input",()=>{e.dataset.draftEdited="true"}),e.addEventListener("change",()=>{e.dataset.draftEdited="true"}),await y(e),A(e,()=>y(e,!0),15e3)},pause(){k()},resume(e){if(e.dataset.pendingCommand)try{const[t,r]=JSON.parse(e.dataset.pendingCommand);x(e,t,r)}catch{delete e.dataset.pendingCommand}},async unmount(){k()}},d=C;let g=null;const k=()=>{g&&(clearInterval(g),g=null)};function E(e){if(!e)return"never";const t=Math.max(0,Math.round((Date.now()-new Date(e).getTime())/1e3));if(t<60)return"just now";const r=Math.round(t/60);if(r<60)return`${r} min ago`;const a=Math.round(r/60);return a<48?`${a} h ago`:`${Math.round(a/24)} d ago`}function S(e){const t=e?.last_seen_at||e?.last_success_at;return!e||e.status!=="connected"||!t?!1:Date.now()-new Date(t).getTime()<300*1e3}function q(e){if(S(e))return'<span class="rrr-status-pill is-live">LIVE</span>';const t=e?.last_seen_at||e?.last_success_at;return t?`<span class="rrr-status-pill">LAST SEEN ${d(E(t).toUpperCase())}</span>`:'<span class="rrr-status-pill">NOT CONNECTED</span>'}async function $(e,t){try{await navigator.clipboard.writeText(e)}catch{const r=document.createElement("textarea");r.value=e,document.body.appendChild(r),r.select();try{document.execCommand("copy")}catch{}r.remove()}if(t){const r=t.textContent;t.textContent="Copied ✓",t.classList.add("copied"),setTimeout(()=>{t.textContent=r,t.classList.remove("copied")},1600)}}function f(e,t){return d(e?.error?.message||e?.data?.message||t)}async function y(e,t=!1){if(t&&(e.dataset.draftEdited==="true"||g))return;t||k(),t||(e.innerHTML='<div class="rrr-loading">Preparing your connection workspace…</div>');const r=await b("/api/mobile/v1/rrr/integrations"),a=r.ok?r.data.integrations||[]:[],n=a.find(m=>m.type==="adms_direct"),s=a.find(m=>m.type==="ebioserver"),i=r.ok?r.data.devices||[]:[],c=n?await b(`/api/mobile/v1/rrr/integrations/${n.id}/adms/commands`):null,o=c?.ok?c.data.commands||[]:[];if(e.dataset.screenDisposed==="true"||t&&(!r.ok||c&&!c.ok||e.dataset.draftEdited==="true"||document.activeElement?.matches("input, textarea, select")))return;e.dataset.draftEdited="false";const l=Math.max(n?.unmapped_records||0,s?.unmapped_records||0);e.innerHTML=`<main class="rrr-page rrr-integrations-page">
    <header class="rrr-header rrr-integrations-header">
      <button id="rrr-back" class="rrr-back-button" aria-label="Back">←</button>
      <div class="rrr-brand"><b>RRR</b><span>Gym Growth System</span></div>
      <span class="rrr-help-label">Device setup</span>
    </header>
    <section class="rrr-setup-hero">
      <div><span class="rrr-eyebrow">${C((D()?.tenantName||"YOUR GYM").toUpperCase())} · ATTENDANCE</span><h1>Connect your terminal, not another computer.</h1><p>Choose Direct Cloud for the cleanest setup. RRR receives attendance securely from your eSSL device and turns it into member actions.</p></div>
      <div class="rrr-setup-progress"><b>${n&&S(n)?"Connected":"Step 1 of 3"}</b><span>${n?.records_synced||0} verified records</span></div>
    </section>
    <section class="rrr-connection-grid">
      <article class="rrr-connect-card rrr-connect-card-primary">
        <div class="rrr-card-top"><span class="rrr-option-icon">☁</span><div>${q(n)}<h2>Direct Cloud</h2><p>No gym PC or bridge required for attendance.</p></div></div>
        ${n?M(n,o):N()}
      </article>
      <article class="rrr-connect-card">
        <div class="rrr-card-top"><span class="rrr-option-icon rrr-option-muted">⌘</span><div><span class="rrr-status-pill">FALLBACK</span><h2>eBioServer Bridge</h2><p>Use only when your licensed eBioServer stays on a gym PC.</p></div></div>
        ${I(s,i)}
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
        <li class="${n?"done":""}"><b>1</b><div><strong>Register the terminal</strong><span>Save the terminal serial number in RRR.</span></div></li>
        <li class="${n&&S(n)?"done":""}"><b>2</b><div><strong>Point it to RRR Cloud</strong><span>Enter the server address shown above in Cloud Server Settings.</span></div></li>
        <li class="${(n?.records_synced||0)>0?"done":""}"><b>3</b><div><strong>Make one real punch</strong><span>RRR confirms the event, then you map any unknown member once.</span></div></li>
      </ol>
      ${n||s?`<button class="rrr-link-button" id="rrr-mappings">Review unknown punches (${l}) →</button>
    <button class="rrr-link-button" id="rrr-enroll-match">Match terminal users to members →</button>
    <button class="rrr-link-button" id="rrr-delete-members">Manage terminal members (deactivate) →</button>`:""}
    </section>
    <aside class="rrr-safety-note"><span>ⓘ</span><p><b>Access-control safety:</b> attendance flows as soon as the terminal connects. Automatic door block/unblock for expired members switches on only after the supervised commissioning below — a real punch, a verified test command, and a physical door test you confirm in person.</p></aside>

  </main>`,e.querySelector("#rrr-back")?.addEventListener("click",()=>w.back()),e.querySelector("#rrr-mappings")?.addEventListener("click",()=>w.push("rrr-mappings")),e.querySelector("#rrr-enroll-match")?.addEventListener("click",()=>w.push("rrr-enroll-match")),e.querySelector("#rrr-delete-members")?.addEventListener("click",()=>w.push("rrr-delete-members")),P(e),O(e,s),n&&G(e,n,o)}function P(e){e.querySelector("#rrr-direct-form")?.addEventListener("submit",async t=>{t.preventDefault();const r=t.currentTarget,a=r.querySelector("button"),n=e.querySelector("#rrr-direct-error");a.disabled=!0,a.textContent="Saving terminal…",n.textContent="";const s=await b("/api/mobile/v1/rrr/integrations/adms/provision",{method:"POST",body:{device_serial:String(new FormData(r).get("device_serial")||"").trim(),device_name:String(new FormData(r).get("device_name")||"").trim()}});s.ok?await y(e):(a.disabled=!1,a.textContent="Continue →",n.textContent=f(s,"We could not save that terminal. Check the serial number and try again."))})}function N(){return`<form id="rrr-direct-form" class="rrr-direct-form">
    <label>Terminal serial number
      <input name="device_serial" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Example: X2008-123456" required>
    </label>
    <label>Friendly name <input name="device_name" value="Elite Gym Entry" maxlength="120" autocapitalize="off"></label>
    <p id="rrr-direct-error" class="rrr-form-error" role="alert"></p>
    <button class="rrr-primary-button" type="submit">Continue <span>→</span></button>
  </form>`}function p(e,t){return`<div class="rrr-copy-row"><div><span>${d(e)}</span><code>${d(t)}</code></div><button type="button" class="rrr-copy-btn" data-copy="${d(t)}">Copy</button></div>`}function M(e,t){const r=e.terminal_settings||{},a=S(e),n=t[0];return`<div class="rrr-direct-live">
    <div class="rrr-device-identity"><b>${d(e.device_name||"Elite Gym Entry")}</b><span>Serial ${d(e.device_serial||"")}</span></div>
    ${a?"":`
      <div class="rrr-empty-state">
        <b>${e.last_seen_at?"This terminal has not polled recently.":"We haven't heard from this terminal yet."}</b>
        ${e.last_seen_at?`<p>Last terminal poll: ${d(E(e.last_seen_at))}.</p>`:""}
        ${e.last_error?`<p>Last error: ${d(e.last_error)}</p>`:""}
        <p>Checklist: ① the values below are saved in <b>Menu → Comm. → Cloud Server Setting</b>, ② the terminal has internet access, ③ the serial matches the sticker on the device.</p>
      </div>`}
    <div class="rrr-server-card">
      <span class="rrr-server-card-title">Type these into the terminal</span>
      ${p("Cloud Server Address",r.server_address||"—")}
      ${p("Port",String(r.server_port??"—"))}
      ${p("HTTPS",r.https?"On":"Off")}
      ${p("Path",r.path||"/iclock")}
      ${p("Mode",r.server_mode||"ADMS")}
    </div>
    ${r.token_present?`
    <div class="rrr-empty-state" id="rrr-rotate-box">
      <b>Connection values hidden.</b>
      <p>The token for this terminal is stored securely and can't be shown again — that's why the address and port above are blank. Rotate to get fresh values.</p>
      <button class="rrr-secondary-button" id="rrr-rotate-token" type="button">Rotate token — get fresh values</button>
      <p id="rrr-rotate-error" class="rrr-form-error" role="alert"></p>
      <div id="rrr-serial-box"></div>
    </div>`:""}
    <p class="rrr-muted-copy">On the terminal: <b>Menu → Comm. → Cloud Server Setting</b>. Save these values, then make one test punch. ${r.https?"<b>Important:</b> if your terminal has no HTTPS/SSL option in its menu, it cannot use Direct Cloud — use the eBioServer bridge instead.":"<b>Note:</b> this terminal talks plain HTTP — keep it on a trusted network or use a VPN."}</p>
    <section class="rrr-command-console">
      <div><b>Live commissioning</b><span id="rrr-cmd-progress">${n?T(n):"No commissioning command sent yet."}</span></div>
      <button class="rrr-secondary-button" data-adms-action="probe_info" ${a?"":"disabled"}>1. Send safe connection probe</button>
      ${a?"":'<p class="rrr-muted-copy">Buttons unlock once the terminal phones home — finish step 2 above first.</p>'}
      <label>Enrolled test-user ID<input id="rrr-test-enroll-number" inputmode="numeric" pattern="[0-9]*" placeholder="Example: 999"></label>
      <label>Current name shown on terminal<input id="rrr-test-user-name" maxlength="24" autocomplete="off" placeholder="Enter the exact test-user name"></label>
      <label class="rrr-test-confirm"><input id="rrr-test-member-confirm" type="checkbox"> I confirm this is the dedicated fake test account I created, not a real customer.</label>
      <div class="rrr-command-actions">
        <button class="rrr-test-block" data-adms-action="essl_group_block_test" ${a?"":"disabled"}>2. Test eSSL block (Grp=100)</button>
        <button class="rrr-test-unblock" data-adms-action="essl_group_unblock_test" ${a?"":"disabled"}>3. Test eSSL unblock (Grp=1)</button>
      </div>
      <p class="rrr-muted-copy">Use only the dedicated, fingerprint-enrolled fake account you created. A fake account saved as a Renewal Desk member is accepted when its current terminal name exactly matches the member name. The command updates USERINFO with Grp=100 or Grp=1 and does not use DELETE. After each terminal acknowledgement, test the same finger at the device; the acknowledgement alone does not prove access changed or that the fingerprint remained enrolled. These tests do not enable automatic membership commands.</p>
      <p id="rrr-command-error" class="rrr-form-error" role="alert"></p>
    </section>
    ${R("direct",e,t)}
  </div>`}function T(e){const t=String(e.action||""),r=d(t.replace(/_/g," "));return e.status==="acked"&&t==="essl_group_block_test"?"✓ Grp=100 update acknowledged. Check that the test ID is denied at the terminal.":e.status==="acked"&&t==="essl_group_unblock_test"?"✓ Grp=1 update acknowledged. Check that the same fingerprint works again.":e.status==="acked"?`✓ ${r} — terminal acknowledged.`:e.status==="failed"?e.result_message?`✗ ${r} — ${d(e.result_message)}`:`✗ ${r} — terminal reported failure${e.result_code?` (result ${d(e.result_code)})`:""}. Check the device and retry.`:e.status==="delivered"?`… ${r} — terminal received it, waiting for acknowledgement.`:`… ${r} — sent, waiting for the terminal to pick it up.`}function G(e,t,r){e.querySelectorAll("[data-copy]").forEach(s=>s.addEventListener("click",()=>$(s.dataset.copy,s))),e.querySelector("#rrr-rotate-token")?.addEventListener("click",async()=>{const s=e.querySelector("#rrr-rotate-token"),i=e.querySelector("#rrr-rotate-error"),c=e.querySelector("#rrr-rotate-box");if(!window.confirm("Rotate the connection token? You will get fresh values to type into the terminal (shown once — copy them before leaving this screen). The old values keep working for 7 days."))return;s.disabled=!0,s.textContent="Rotating…",i.textContent="";const o=await b(`/api/mobile/v1/rrr/integrations/${t.id}/adms/rotate-token`,{method:"POST",body:{}});if(!o.ok){s.disabled=!1,s.textContent="Rotate token — get fresh values",i.textContent=f(o,"Could not rotate the token. Try again.");return}const l=o.data.terminal_settings||{};c.outerHTML=`<div class="rrr-server-card" id="rrr-fresh-settings">
      <span class="rrr-server-card-title">Fresh values — copy them NOW</span>
      <p class="rrr-muted-copy"><b>Shown once.</b> ${d(o.data.warning||"Save these in the terminal before leaving this screen.")}</p>
      ${p("Cloud Server Address",l.server_address||"—")}
      ${p("Port",String(l.server_port??"—"))}
      ${p("HTTPS",l.https?"On":"Off")}
      ${p("Path",l.path||"/iclock")}
      ${p("Mode",l.server_mode||"ADMS")}
    </div>`,e.querySelectorAll("#rrr-fresh-settings [data-copy]").forEach(m=>m.addEventListener("click",()=>$(m.dataset.copy,m)))});const a=s=>{const i=e.querySelector("#rrr-serial-box");i&&(i.innerHTML=s?`
      <p class="rrr-muted-copy"><b>Serial-number login is ON</b> for this terminal — it connects with address + port only, no token needed.</p>
      <button class="rrr-secondary-button" id="rrr-serial-fallback" type="button">Turn off serial login</button>
      <p id="rrr-serial-error" class="rrr-form-error" role="alert"></p>`:`
      <p class="rrr-muted-copy"><b>No path/URL field on your terminal?</b> Some terminals can't send the token. Let this terminal log in with its serial number instead — it then needs only the address and port.</p>
      <button class="rrr-secondary-button" id="rrr-serial-fallback" type="button">Connect with serial number instead</button>
      <p id="rrr-serial-error" class="rrr-form-error" role="alert"></p>`,i.querySelector("#rrr-serial-fallback")?.addEventListener("click",()=>n(!s)))},n=async s=>{const i=e.querySelector("#rrr-serial-fallback"),c=e.querySelector("#rrr-serial-error");if(!i||!window.confirm(s?"Let this terminal log in with its serial number? It will connect with just the server address and port — no token needed. You can turn this off again any time.":"Turn off serial-number login? This terminal will stop connecting until it uses the token path."))return;i.disabled=!0,i.textContent="Switching…",c&&(c.textContent="");const o=await b(`/api/mobile/v1/rrr/integrations/${t.id}/adms/serial-fallback`,{method:"POST",body:{enabled:s}});if(!o.ok){i.disabled=!1,i.textContent=s?"Connect with serial number instead":"Turn off serial login",c&&(c.textContent=f(o,"Could not switch login mode. Try again."));return}a(s)};a(!!t.allow_serial_fallback),e.querySelectorAll("[data-adms-action]").forEach(s=>s.addEventListener("click",async()=>{const i=s.dataset.admsAction,c=e.querySelector("#rrr-command-error"),o=e.querySelector("#rrr-test-enroll-number")?.value.trim(),l=e.querySelector("#rrr-test-user-name")?.value.trim(),m=!!e.querySelector("#rrr-test-member-confirm")?.checked,v=["essl_group_block_test","essl_group_unblock_test"].includes(i);if(i!=="probe_info"&&!/^[1-9][0-9]{0,8}$/.test(o||"")){c.textContent="Enter the enrolled, terminal-local test-user ID first (digits only).";return}if(v&&!l){c.textContent="Enter the test user’s current name exactly as it appears on the terminal.";return}if(v&&!m){c.textContent="Confirm this is the fake test account you created before sending the Group test.";return}if(i==="essl_group_block_test"&&!window.confirm(`Queue a Grp=100 USERINFO update for fake test ID ${o}? If this ID is linked to a Renewal Desk member, its name must match exactly. This may update the displayed name to “${l}”.`)||i==="essl_group_unblock_test"&&!window.confirm(`Queue a Grp=1 USERINFO update for fake test ID ${o}? If linked to a Renewal Desk member, its name must match exactly. Verify the same fingerprint at the terminal after acknowledgement.`))return;c.textContent="",e.querySelectorAll("[data-adms-action]").forEach(_=>{_.disabled=!0});const h={action:i,test_enroll_number:o};v&&(h.test_user_name=l,h.test_member_confirmed=!0);const u=await b(`/api/mobile/v1/rrr/integrations/${t.id}/adms/commands`,{method:"POST",body:h});if(!u.ok){e.querySelectorAll("[data-adms-action]").forEach(_=>{_.disabled=!1}),c.textContent=f(u,"The terminal did not accept another test yet.");return}x(e,t.id,u.data.command.id)})),L(e,"direct",t,r)}function x(e,t,r){k(),e.dataset.pendingCommand=JSON.stringify([t,r]);const a=()=>e.querySelector("#rrr-cmd-progress");let n=0;const s=async()=>{if(!e.isConnected||e.dataset.screenActive==="false"||document.visibilityState==="hidden")return;n+=1;const i=await b(`/api/mobile/v1/rrr/integrations/${t}/adms/commands`),c=i.ok?i.data.commands||[]:[],o=c.find(l=>l.id===r)||c[0];if(o&&a()&&(a().textContent=T(o)),!o||n>=24||o.status==="acked"||o.status==="failed"){k(),delete e.dataset.pendingCommand,n>=24&&o&&!["acked","failed"].includes(o.status)&&a()&&(a().textContent="Still waiting — the terminal may be offline. It will pick the command up when it reconnects."),o&&["acked","failed"].includes(o.status)&&setTimeout(()=>{e.isConnected&&e.dataset.screenActive!=="false"&&y(e)},1500);return}};s(),g=setInterval(s,2500)}function R(e,t,r=[]){if(t.commands_enabled)return`<section class="rrr-commission is-on"><b>✓ Automatic block/unblock is ON</b><p>Expired members are blocked and renewed members are restored automatically on this terminal.</p>${e==="direct"?"<p><b>Direct ADMS:</b> automatic blocks use the tested Grp=100 update; renewal restores Grp=1, keeping fingerprints enrolled.</p>":""}</section>`;const a=(t.records_synced||0)>0,n=e==="direct"?r.some(o=>o.status==="acked"&&o.action==="essl_group_block_test"):!0,s=e==="direct"?r.some(o=>o.status==="acked"&&o.action==="essl_group_unblock_test"):!0,i=(o,l)=>`<li class="${o?"done":""}"><i>${o?"✓":"○"}</i><span>${l}</span></li>`,c=e==="direct"?i(n,"The Grp=100 block test was acknowledged")+i(s,"The Grp=1 restore test was acknowledged"):"";return`<section class="rrr-commission">
    <b>Supervised commissioning</b>
    <p>Stand at the door with the terminal. Automatic block/unblock switches on only after:</p>
    ${e==="direct"?"<p><b>Direct ADMS:</b> automation uses the tested Grp=100 block and Grp=1 restore; it keeps the terminal user and fingerprint enrolled.</p>":""}
    <ol class="rrr-checklist">
      ${i(a,"A real member punch reached RRR")}
      ${c}
      ${i(!1,"You watched the door stay locked on test block and open on test unblock")}
    </ol>
    <label class="rrr-confirm"><input type="checkbox" id="rrr-door-confirm-${e}"> I stood at the door and verified the lock behaviour myself.</label>
    <button class="rrr-primary-button" id="rrr-commission-btn-${e}" disabled>Enable automatic block/unblock</button>
    <p id="rrr-commission-error-${e}" class="rrr-form-error" role="alert"></p>
  </section>`}function L(e,t,r,a=[]){const n=e.querySelector(`#rrr-door-confirm-${t}`),s=e.querySelector(`#rrr-commission-btn-${t}`),i=e.querySelector(`#rrr-commission-error-${t}`);if(!n||!s)return;const c=(r.records_synced||0)>0,o=t==="direct"?a.some(u=>u.status==="acked"&&u.action==="essl_group_block_test"):!0,l=t==="direct"?a.some(u=>u.status==="acked"&&u.action==="essl_group_unblock_test"):!0,m=o&&l,v=()=>n.checked&&c&&m,h=document.createElement("p");h.className="rrr-muted-copy",v()||(h.textContent=t==="direct"&&!m?"Run both eSSL Group tests and wait for the Grp=100 and Grp=1 acknowledgements.":c?"After verifying the door at the terminal, check the confirmation box to enable automatic block/unblock.":"The button unlocks after the first real punch above reaches RRR.",s.after(h)),n.addEventListener("change",()=>{const u=v();s.disabled=!u,u&&h.remove()}),s.addEventListener("click",async()=>{s.disabled=!0,s.textContent="Enabling…",i.textContent="";const u=await b(`/api/mobile/v1/rrr/integrations/${r.id}/commission`,{method:"POST",body:{physical_test_passed:!0}});if(u.ok){await y(e);return}s.disabled=!1,s.textContent="Enable automatic block/unblock",i.textContent=f(u,"Commissioning failed. Finish the checklist above and try again.")})}function I(e,t){const r=e&&["connected","paired"].includes(e.status),a=e?t.filter(n=>n.integration_id===e.id):[];return`
    ${e?`<div class="rrr-bridge-summary"><b>${d(r?"Bridge connected":e.status||"Not configured")}</b><span>${d(e.device_name||e.device_serial||"Awaiting device selection")}</span></div>`:'<p class="rrr-muted-copy">Not needed for Direct Cloud. It remains available for existing eBioServer installations.</p>'}
    ${e&&a.length?`<div class="rrr-device-list rrr-device-list-inline"><h2>Devices reported by the bridge</h2>${a.map(n=>`
      <div class="rrr-device-row"><div><b>${d(n.name||"Terminal")}</b><span>${d(n.serial_number||"")} · ${d(n.status||"unknown")}</span></div>
      ${n.selected?'<span class="rrr-selected-pill">Selected ✓</span>':`<button class="rrr-secondary-button rrr-device-select" data-device-id="${n.id}">Select</button>`}
      </div>`).join("")}</div>`:""}
    ${e?R("ebio",e):""}
    <div class="rrr-pair-row">
      ${r?'<button class="rrr-link-button" id="rrr-pair">Generate a new code</button>':'<button class="rrr-secondary-button" id="rrr-pair">Generate bridge pairing code</button>'}
    </div>
    <div id="rrr-pair-code" class="rrr-code-box" hidden></div>`}function O(e,t,r){e.querySelector("#rrr-pair")?.addEventListener("click",async()=>{const a=await b("/api/mobile/v1/rrr/integrations/ebioserver/pairing",{method:"POST",body:{}}),n=e.querySelector("#rrr-pair-code");if(n.hidden=!1,!a.ok){n.innerHTML=`<span>${f(a,"Could not create a pairing code.")}</span>`;return}n.innerHTML=`<div class="rrr-code-row"><b>${d(a.data.pairing_code)}</b><button class="rrr-copy-btn" id="rrr-copy-code">Copy</button></div><small>Valid for <b>10 minutes</b> — expires ${d(new Date(a.data.expires_at).toLocaleTimeString())}. Type it into the eBioServer Bridge on the gym PC.</small>`,n.querySelector("#rrr-copy-code")?.addEventListener("click",s=>$(a.data.pairing_code,s.currentTarget))}),e.querySelectorAll(".rrr-device-select").forEach(a=>a.addEventListener("click",async()=>{a.disabled=!0;const n=t.id,s=await b(`/api/mobile/v1/rrr/integrations/${n}/device`,{method:"POST",body:{device_id:Number(a.dataset.deviceId)}});s.ok?await y(e):(a.disabled=!1,a.textContent=f(s,"Could not select that device."))})),t&&L(e,"ebio",t)}export{H as default};
