import{d as D,e as h,f as E,o as q,n as w,g as P}from"./index-B8sWifMR.js";const U={async mount(e){e.addEventListener("input",()=>{e.dataset.draftEdited="true"}),e.addEventListener("change",()=>{e.dataset.draftEdited="true"}),await v(e),D(e,()=>v(e,!0),15e3)},pause(){k()},resume(e){if(e.dataset.pendingCommand)try{const[t,n]=JSON.parse(e.dataset.pendingCommand);L(e,t,n)}catch{delete e.dataset.pendingCommand}},async unmount(){k()}},l=E;let g=null;const k=()=>{g&&(clearInterval(g),g=null)};function T(e){if(!e)return"never";const t=Math.max(0,Math.round((Date.now()-new Date(e).getTime())/1e3));if(t<60)return"just now";const n=Math.round(t/60);if(n<60)return`${n} min ago`;const s=Math.round(n/60);return s<48?`${s} h ago`:`${Math.round(s/24)} d ago`}function S(e){const t=e?.last_seen_at||e?.last_success_at;return!e||e.status!=="connected"||!t?!1:Date.now()-new Date(t).getTime()<300*1e3}function N(e){if(S(e))return'<span class="rrr-status-pill is-live">LIVE</span>';const t=e?.last_seen_at||e?.last_success_at;return t?`<span class="rrr-status-pill">LAST SEEN ${l(T(t).toUpperCase())}</span>`:'<span class="rrr-status-pill">NOT CONNECTED</span>'}async function $(e,t){try{await navigator.clipboard.writeText(e)}catch{const n=document.createElement("textarea");n.value=e,document.body.appendChild(n),n.select();try{document.execCommand("copy")}catch{}n.remove()}if(t){const n=t.textContent;t.textContent="Copied ✓",t.classList.add("copied"),setTimeout(()=>{t.textContent=n,t.classList.remove("copied")},1600)}}function y(e,t){return l(e?.error?.message||e?.data?.message||t)}async function v(e,t=!1){if(t&&(e.dataset.draftEdited==="true"||g))return;t||k(),t||(e.innerHTML='<div class="rrr-loading">Preparing your connection workspace…</div>');const n=await h("/api/mobile/v1/rrr/integrations");if(!t&&!n.ok){if(e.dataset.screenDisposed==="true")return;e.innerHTML=`<main class="rrr-page rrr-integrations-page"><div class="rrr-empty"><h2>Could not load your terminal connection.</h2><p>${l(n.error?.message||"Check your connection and try again.")}</p><button class="rrr-btn" id="rrr-retry">Try again</button></div></main>`,e.querySelector("#rrr-retry")?.addEventListener("click",()=>v(e));return}const s=n.ok?n.data.integrations||[]:[],r=s.find(p=>p.type==="adms_direct"),o=s.find(p=>p.type==="ebioserver"),i=n.ok?n.data.devices||[]:[],a=r?await h(`/api/mobile/v1/rrr/integrations/${r.id}/adms/commands`):null,c=a?.ok?a.data.commands||[]:[],d=!!(r&&a&&!a.ok);if(e.dataset.screenDisposed==="true"||t&&(!n.ok||a&&!a.ok||e.dataset.draftEdited==="true"||document.activeElement?.matches("input, textarea, select")))return;e.dataset.draftEdited="false";const u=Math.max(r?.unmapped_records||0,o?.unmapped_records||0);e.innerHTML=`<main class="rrr-page rrr-integrations-page">
    <header class="rrr-header rrr-integrations-header">
      <button id="rrr-back" class="rrr-back-button" aria-label="Back">←</button>
      <div class="rrr-brand"><b>RRR</b><span>Gym Growth System</span></div>
      <span class="rrr-help-label">Device setup</span>
    </header>
    <section class="rrr-setup-hero">
      <div><span class="rrr-eyebrow">${E((q()?.tenantName||"YOUR GYM").toUpperCase())} · ATTENDANCE</span><h1>Connect your terminal, not another computer.</h1><p>Choose Direct Cloud for the cleanest setup. RRR receives attendance securely from your eSSL device and turns it into member actions.</p></div>
      <div class="rrr-setup-progress"><b>${r&&S(r)?"Connected":"Step 1 of 3"}</b><span>${r?.records_synced||0} verified records</span></div>
    </section>
    <section class="rrr-connection-grid">
      <article class="rrr-connect-card rrr-connect-card-primary">
        <div class="rrr-card-top"><span class="rrr-option-icon">☁</span><div>${N(r)}<h2>Direct Cloud</h2><p>No gym PC or bridge required for attendance.</p></div></div>
        ${r?I(r,c,d):G()}
      </article>
      <article class="rrr-connect-card">
        <div class="rrr-card-top"><span class="rrr-option-icon rrr-option-muted">⌘</span><div><span class="rrr-status-pill">FALLBACK</span><h2>eBioServer Bridge</h2><p>Use only when your licensed eBioServer stays on a gym PC.</p></div></div>
        ${B(o,i)}
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
        <li class="${r&&S(r)?"done":""}"><b>2</b><div><strong>Point it to RRR Cloud</strong><span>Enter the server address shown above in Cloud Server Settings.</span></div></li>
        <li class="${(r?.records_synced||0)>0?"done":""}"><b>3</b><div><strong>Make one real punch</strong><span>RRR confirms the event, then you map any unknown member once.</span></div></li>
      </ol>
      ${r||o?`<button class="rrr-link-button" id="rrr-mappings">Review unknown punches (${u}) →</button>
    <button class="rrr-link-button" id="rrr-enroll-match">Match terminal users to members →</button>
    <button class="rrr-link-button" id="rrr-delete-members">Manage terminal members (deactivate) →</button>`:""}
    </section>
    <aside class="rrr-safety-note"><span>ⓘ</span><p><b>Access-control safety:</b> attendance flows as soon as the terminal connects. Automatic door block/unblock for expired members switches on only after the supervised commissioning below — a real punch, a verified test command, and a physical door test you confirm in person.</p></aside>

  </main>`,e.querySelector("#rrr-back")?.addEventListener("click",()=>w.back()),e.querySelector("#rrr-mappings")?.addEventListener("click",()=>w.push("rrr-mappings")),e.querySelector("#rrr-enroll-match")?.addEventListener("click",()=>w.push("rrr-enroll-match")),e.querySelector("#rrr-delete-members")?.addEventListener("click",()=>w.push("rrr-delete-members")),M(e),H(e,o),r&&O(e,r,c,d)}function M(e){e.querySelector("#rrr-direct-form")?.addEventListener("submit",async t=>{t.preventDefault();const n=t.currentTarget,s=n.querySelector("button"),r=e.querySelector("#rrr-direct-error");s.disabled=!0,s.textContent="Saving terminal…",r.textContent="";const o=await h("/api/mobile/v1/rrr/integrations/adms/provision",{method:"POST",body:{device_serial:String(new FormData(n).get("device_serial")||"").trim(),device_name:String(new FormData(n).get("device_name")||"").trim()}});o.ok?await v(e):(s.disabled=!1,s.textContent="Continue →",r.textContent=y(o,"We could not save that terminal. Check the serial number and try again."))})}function G(){return`<form id="rrr-direct-form" class="rrr-direct-form">
    <label>Terminal serial number
      <input name="device_serial" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Example: X2008-123456" required>
    </label>
    <label>Friendly name <input name="device_name" value="Elite Gym Entry" maxlength="120" autocapitalize="off"></label>
    <p id="rrr-direct-error" class="rrr-form-error" role="alert"></p>
    <button class="rrr-primary-button" type="submit">Continue <span>→</span></button>
  </form>`}function b(e,t){return`<div class="rrr-copy-row"><div><span>${l(e)}</span><code>${l(t)}</code></div><button type="button" class="rrr-copy-btn" data-copy="${l(t)}">Copy</button></div>`}function I(e,t,n=!1){const s=e.terminal_settings||{},r=S(e),o=t[0];return`<div class="rrr-direct-live">
    <div class="rrr-device-identity"><b>${l(e.device_name||"Elite Gym Entry")}</b><span>Serial ${l(e.device_serial||"")}</span></div>
    ${r?"":`
      <div class="rrr-empty-state">
        <b>${e.last_seen_at?"This terminal has not polled recently.":"We haven't heard from this terminal yet."}</b>
        ${e.last_seen_at?`<p>Last terminal poll: ${l(T(e.last_seen_at))}.</p>`:""}
        ${e.last_error?`<p>Last error: ${l(e.last_error)}</p>`:""}
        <p>Checklist: ① the values below are saved in <b>Menu → Comm. → Cloud Server Setting</b>, ② the terminal has internet access, ③ the serial matches the sticker on the device.</p>
      </div>`}
    <div class="rrr-server-card">
      <span class="rrr-server-card-title">Type these into the terminal</span>
      ${b("Cloud Server Address",s.server_address||"—")}
      ${b("Port",String(s.server_port??"—"))}
      ${b("HTTPS",s.https?"On":"Off")}
      ${b("Path",s.path||"/iclock")}
      ${b("Mode",s.server_mode||"ADMS")}
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
      <div><b>Live commissioning</b><span id="rrr-cmd-progress">${n?"Could not load the commissioning test status — try again below.":o?x(o):"No commissioning command sent yet."}</span></div>
      <button class="rrr-secondary-button" data-adms-action="probe_info" ${r?"":"disabled"}>1. Send safe connection probe</button>
      ${r?"":'<p class="rrr-muted-copy">Buttons unlock once the terminal phones home — finish step 2 above first.</p>'}
      <label>Enrolled test-user ID<input id="rrr-test-enroll-number" inputmode="numeric" pattern="[0-9]*" placeholder="Example: 999"></label>
      <label>Current name shown on terminal<input id="rrr-test-user-name" maxlength="24" autocomplete="off" placeholder="Enter the exact test-user name"></label>
      <label class="rrr-test-confirm"><input id="rrr-test-member-confirm" type="checkbox"> I confirm this is the dedicated fake test account I created, not a real customer.</label>
      <div class="rrr-command-actions">
        <button class="rrr-test-block" data-adms-action="essl_group_block_test" ${r?"":"disabled"}>2. Test eSSL block (Grp=100)</button>
        <button class="rrr-test-unblock" data-adms-action="essl_group_unblock_test" ${r?"":"disabled"}>3. Test eSSL unblock (Grp=1)</button>
      </div>
      <p class="rrr-muted-copy">Use only the dedicated, fingerprint-enrolled fake account you created. A fake account saved as a Renewal Desk member is accepted when its current terminal name exactly matches the member name. The command updates USERINFO with Grp=100 or Grp=1 and does not use DELETE. After each terminal acknowledgement, test the same finger at the device; the acknowledgement alone does not prove access changed or that the fingerprint remained enrolled. These tests do not enable automatic membership commands.</p>
      <p id="rrr-command-error" class="rrr-form-error" role="alert"></p>
    </section>
    ${R("direct",e,t,n)}
  </div>`}function x(e){const t=String(e.action||""),n=l(t.replace(/_/g," "));return e.status==="acked"&&t==="essl_group_block_test"?"✓ Grp=100 update acknowledged. Check that the test ID is denied at the terminal.":e.status==="acked"&&t==="essl_group_unblock_test"?"✓ Grp=1 update acknowledged. Check that the same fingerprint works again.":e.status==="acked"?`✓ ${n} — terminal acknowledged.`:e.status==="failed"?e.result_message?`✗ ${n} — ${l(e.result_message)}`:`✗ ${n} — terminal reported failure${e.result_code?` (result ${l(e.result_code)})`:""}. Check the device and retry.`:e.status==="delivered"?`… ${n} — terminal received it, waiting for acknowledgement.`:`… ${n} — sent, waiting for the terminal to pick it up.`}function O(e,t,n,s=!1){e.querySelectorAll("[data-copy]").forEach(i=>i.addEventListener("click",()=>$(i.dataset.copy,i))),e.querySelector("#rrr-commands-retry")?.addEventListener("click",()=>v(e)),e.querySelector("#rrr-rotate-token")?.addEventListener("click",async()=>{const i=e.querySelector("#rrr-rotate-token"),a=e.querySelector("#rrr-rotate-error"),c=e.querySelector("#rrr-rotate-box");if(!window.confirm("Rotate the connection token? You will get fresh values to type into the terminal (shown once — copy them before leaving this screen). The old values keep working for 7 days."))return;i.disabled=!0,i.textContent="Rotating…",a.textContent="";const d=await h(`/api/mobile/v1/rrr/integrations/${t.id}/adms/rotate-token`,{method:"POST",body:{}});if(!d.ok){i.disabled=!1,i.textContent="Rotate token — get fresh values",a.textContent=y(d,"Could not rotate the token. Try again.");return}const u=d.data.terminal_settings||{};c.outerHTML=`<div class="rrr-server-card" id="rrr-fresh-settings">
      <span class="rrr-server-card-title">Fresh values — copy them NOW</span>
      <p class="rrr-muted-copy"><b>Shown once.</b> ${l(d.data.warning||"Save these in the terminal before leaving this screen.")}</p>
      ${b("Cloud Server Address",u.server_address||"—")}
      ${b("Port",String(u.server_port??"—"))}
      ${b("HTTPS",u.https?"On":"Off")}
      ${b("Path",u.path||"/iclock")}
      ${b("Mode",u.server_mode||"ADMS")}
    </div>`,e.querySelectorAll("#rrr-fresh-settings [data-copy]").forEach(p=>p.addEventListener("click",()=>$(p.dataset.copy,p)))});const r=i=>{const a=e.querySelector("#rrr-serial-box");a&&(a.innerHTML=i?`
      <p class="rrr-muted-copy"><b>Serial-number login is ON</b> for this terminal — it connects with address + port only, no token needed.</p>
      <button class="rrr-secondary-button" id="rrr-serial-fallback" type="button">Turn off serial login</button>
      <p id="rrr-serial-error" class="rrr-form-error" role="alert"></p>`:`
      <p class="rrr-muted-copy"><b>No path/URL field on your terminal?</b> Some terminals can't send the token. Let this terminal log in with its serial number instead — it then needs only the address and port.</p>
      <button class="rrr-secondary-button" id="rrr-serial-fallback" type="button">Connect with serial number instead</button>
      <p id="rrr-serial-error" class="rrr-form-error" role="alert"></p>`,a.querySelector("#rrr-serial-fallback")?.addEventListener("click",()=>o(!i)))},o=async i=>{const a=e.querySelector("#rrr-serial-fallback"),c=e.querySelector("#rrr-serial-error");if(!a||!window.confirm(i?"Let this terminal log in with its serial number? It will connect with just the server address and port — no token needed. You can turn this off again any time.":"Turn off serial-number login? This terminal will stop connecting until it uses the token path."))return;a.disabled=!0,a.textContent="Switching…",c&&(c.textContent="");const d=await h(`/api/mobile/v1/rrr/integrations/${t.id}/adms/serial-fallback`,{method:"POST",body:{enabled:i}});if(!d.ok){a.disabled=!1,a.textContent=i?"Connect with serial number instead":"Turn off serial login",c&&(c.textContent=y(d,"Could not switch login mode. Try again."));return}r(i)};r(!!t.allow_serial_fallback),e.querySelectorAll("[data-adms-action]").forEach(i=>i.addEventListener("click",async()=>{const a=i.dataset.admsAction,c=e.querySelector("#rrr-command-error"),d=e.querySelector("#rrr-test-enroll-number")?.value.trim(),u=e.querySelector("#rrr-test-user-name")?.value.trim(),p=!!e.querySelector("#rrr-test-member-confirm")?.checked,f=["essl_group_block_test","essl_group_unblock_test"].includes(a);if(a!=="probe_info"&&!/^[1-9][0-9]{0,8}$/.test(d||"")){c.textContent="Enter the enrolled, terminal-local test-user ID first (digits only).";return}if(f&&!u){c.textContent="Enter the test user’s current name exactly as it appears on the terminal.";return}if(f&&!p){c.textContent="Confirm this is the fake test account you created before sending the Group test.";return}if(a==="essl_group_block_test"&&!window.confirm(`Queue a Grp=100 USERINFO update for fake test ID ${d}? If this ID is linked to a Renewal Desk member, its name must match exactly. This may update the displayed name to “${u}”.`)||a==="essl_group_unblock_test"&&!window.confirm(`Queue a Grp=1 USERINFO update for fake test ID ${d}? If linked to a Renewal Desk member, its name must match exactly. Verify the same fingerprint at the terminal after acknowledgement.`))return;c.textContent="",e.querySelectorAll("[data-adms-action]").forEach(C=>{C.disabled=!0});const m={action:a,test_enroll_number:d};f&&(m.test_user_name=u,m.test_member_confirmed=!0);const _=await h(`/api/mobile/v1/rrr/integrations/${t.id}/adms/commands`,{method:"POST",body:m});if(!_.ok){e.querySelectorAll("[data-adms-action]").forEach(C=>{C.disabled=!1}),c.textContent=y(_,"The terminal did not accept another test yet.");return}L(e,t.id,_.data.command.id)})),A(e,"direct",t,n)}function L(e,t,n){k(),e.dataset.pendingCommand=JSON.stringify([t,n]);const s=()=>e.querySelector("#rrr-cmd-progress");let r=0;const o=async()=>{if(!e.isConnected||e.dataset.screenActive==="false"||document.visibilityState==="hidden")return;r+=1;const i=await h(`/api/mobile/v1/rrr/integrations/${t}/adms/commands`),a=i.ok?i.data.commands||[]:[],c=a.find(d=>d.id===n)||a[0];if(c&&s()&&(s().textContent=x(c)),!c||r>=24||c.status==="acked"||c.status==="failed"){k(),delete e.dataset.pendingCommand,r>=24&&c&&!["acked","failed"].includes(c.status)&&s()&&(s().textContent="Still waiting — the terminal may be offline. It will pick the command up when it reconnects."),c&&["acked","failed"].includes(c.status)&&setTimeout(()=>{e.isConnected&&e.dataset.screenActive!=="false"&&v(e)},1500);return}};o(),g=setInterval(o,2500)}function R(e,t,n=[],s=!1){if(t.commands_enabled)return`<section class="rrr-commission is-on"><b>✓ Automatic block/unblock is ON</b><p>Expired members are blocked and renewed members are restored automatically on this terminal.</p>${e==="direct"?"<p><b>Direct ADMS:</b> automatic blocks use the tested Grp=100 update; renewal restores Grp=1, keeping fingerprints enrolled.</p>":""}</section>`;if(e==="direct"&&s)return`<section class="rrr-commission">
    <b>Supervised commissioning</b>
    <p>Could not load the commissioning test results — the eSSL block/unblock test status is unknown, not un-run.</p>
    <button class="rrr-secondary-button" id="rrr-commands-retry" type="button">Try again</button>
  </section>`;const r=(t.records_synced||0)>0,o=e==="direct"?n.some(d=>d.status==="acked"&&d.action==="essl_group_block_test"):!0,i=e==="direct"?n.some(d=>d.status==="acked"&&d.action==="essl_group_unblock_test"):!0,a=(d,u)=>`<li class="${d?"done":""}"><i>${d?"✓":"○"}</i><span>${u}</span></li>`,c=e==="direct"?a(o,"The Grp=100 block test was acknowledged")+a(i,"The Grp=1 restore test was acknowledged"):"";return`<section class="rrr-commission">
    <b>Supervised commissioning</b>
    <p>Stand at the door with the terminal. Automatic block/unblock switches on only after:</p>
    ${e==="direct"?"<p><b>Direct ADMS:</b> automation uses the tested Grp=100 block and Grp=1 restore; it keeps the terminal user and fingerprint enrolled.</p>":""}
    <ol class="rrr-checklist">
      ${a(r,"A real member punch reached RRR")}
      ${c}
      ${a(!1,"You watched the door stay locked on test block and open on test unblock")}
    </ol>
    <label class="rrr-confirm"><input type="checkbox" id="rrr-door-confirm-${e}"> I stood at the door and verified the lock behaviour myself.</label>
    <button class="rrr-primary-button" id="rrr-commission-btn-${e}" disabled>Enable automatic block/unblock</button>
    <p id="rrr-commission-error-${e}" class="rrr-form-error" role="alert"></p>
  </section>`}function A(e,t,n,s=[]){const r=e.querySelector(`#rrr-door-confirm-${t}`),o=e.querySelector(`#rrr-commission-btn-${t}`),i=e.querySelector(`#rrr-commission-error-${t}`);if(!r||!o)return;const a=(n.records_synced||0)>0,c=t==="direct"?s.some(m=>m.status==="acked"&&m.action==="essl_group_block_test"):!0,d=t==="direct"?s.some(m=>m.status==="acked"&&m.action==="essl_group_unblock_test"):!0,u=c&&d,p=()=>r.checked&&a&&u,f=document.createElement("p");f.className="rrr-muted-copy",p()||(f.textContent=t==="direct"&&!u?"Run both eSSL Group tests and wait for the Grp=100 and Grp=1 acknowledgements.":a?"After verifying the door at the terminal, check the confirmation box to enable automatic block/unblock.":"The button unlocks after the first real punch above reaches RRR.",o.after(f)),r.addEventListener("change",()=>{const m=p();o.disabled=!m,m&&f.remove()}),o.addEventListener("click",async()=>{o.disabled=!0,o.textContent="Enabling…",i.textContent="";const m=await h(`/api/mobile/v1/rrr/integrations/${n.id}/commission`,{method:"POST",body:{physical_test_passed:!0}});if(m.ok){await v(e);return}o.disabled=!1,o.textContent="Enable automatic block/unblock",i.textContent=y(m,"Commissioning failed. Finish the checklist above and try again.")})}function B(e,t){const n=e&&["connected","paired"].includes(e.status),s=e?t.filter(r=>r.integration_id===e.id):[];return`
    ${e?`<div class="rrr-bridge-summary"><b>${l(n?"Bridge connected":e.status||"Not configured")}</b><span>${l(e.device_name||e.device_serial||"Awaiting device selection")}</span></div>`:'<p class="rrr-muted-copy">Not needed for Direct Cloud. It remains available for existing eBioServer installations.</p>'}
    ${e&&s.length?`<div class="rrr-device-list rrr-device-list-inline"><h2>Devices reported by the bridge</h2>${s.map(r=>`
      <div class="rrr-device-row"><div><b>${l(r.name||"Terminal")}</b><span>${l(r.serial_number||"")} · ${l(r.status||"unknown")}</span></div>
      ${r.selected?'<span class="rrr-selected-pill">Selected ✓</span>':`<button class="rrr-secondary-button rrr-device-select" data-device-id="${r.id}">Select</button>`}
      </div>`).join("")}</div>`:""}
    ${e?R("ebio",e):""}
    <div class="rrr-pair-row">
      ${n?'<button class="rrr-link-button" id="rrr-pair">Generate a new code</button>':'<button class="rrr-secondary-button" id="rrr-pair">Generate bridge pairing code</button>'}
    </div>
    <div id="rrr-pair-code" class="rrr-code-box" hidden></div>`}function H(e,t,n){e.querySelector("#rrr-pair")?.addEventListener("click",async()=>{const s=await h("/api/mobile/v1/rrr/integrations/ebioserver/pairing",{method:"POST",body:{}}),r=e.querySelector("#rrr-pair-code");if(r.hidden=!1,!s.ok){r.innerHTML=`<span>${y(s,"Could not create a pairing code.")}</span>`;return}r.innerHTML=`<div class="rrr-code-row"><b>${l(s.data.pairing_code)}</b><button class="rrr-copy-btn" id="rrr-copy-code">Copy</button></div><small>Valid for <b>10 minutes</b> — expires ${l(P(s.data.expires_at))} (gym time). Type it into the eBioServer Bridge on the gym PC.</small>`,r.querySelector("#rrr-copy-code")?.addEventListener("click",o=>$(s.data.pairing_code,o.currentTarget))}),e.querySelectorAll(".rrr-device-select").forEach(s=>s.addEventListener("click",async()=>{s.disabled=!0;const r=t.id,o=await h(`/api/mobile/v1/rrr/integrations/${r}/device`,{method:"POST",body:{device_id:Number(s.dataset.deviceId)}});o.ok?await v(e):(s.disabled=!1,s.textContent=y(o,"Could not select that device."))})),t&&A(e,"ebio",t)}export{U as default};
