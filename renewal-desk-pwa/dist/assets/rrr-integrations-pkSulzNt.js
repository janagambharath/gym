import{f as m,g as C,o as D,n as S}from"./index-CpYOgd43.js";const B={async mount(e){await v(e)},async unmount(){g()}},l=C;let y=null;const g=()=>{y&&(clearInterval(y),y=null)};function T(e){if(!e)return"never";const r=Math.max(0,Math.round((Date.now()-new Date(e).getTime())/1e3));if(r<60)return"just now";const n=Math.round(r/60);if(n<60)return`${n} min ago`;const t=Math.round(n/60);return t<48?`${t} h ago`:`${Math.round(t/24)} d ago`}function k(e){const r=e?.last_seen_at||e?.last_success_at;return!e||e.status!=="connected"||!r?!1:Date.now()-new Date(r).getTime()<300*1e3}function A(e){if(k(e))return'<span class="rrr-status-pill is-live">LIVE</span>';const r=e?.last_seen_at||e?.last_success_at;return r?`<span class="rrr-status-pill">LAST SEEN ${l(T(r).toUpperCase())}</span>`:'<span class="rrr-status-pill">NOT CONNECTED</span>'}async function $(e,r){try{await navigator.clipboard.writeText(e)}catch{const n=document.createElement("textarea");n.value=e,document.body.appendChild(n),n.select();try{document.execCommand("copy")}catch{}n.remove()}if(r){const n=r.textContent;r.textContent="Copied ✓",r.classList.add("copied"),setTimeout(()=>{r.textContent=n,r.classList.remove("copied")},1600)}}function h(e,r){return l(e?.error?.message||e?.data?.message||r)}async function v(e){g(),e.innerHTML='<div class="rrr-loading">Preparing your connection workspace…</div>';const r=await m("/api/mobile/v1/rrr/integrations"),n=r.ok?r.data.integrations||[]:[],t=n.find(d=>d.type==="adms_direct"),a=n.find(d=>d.type==="ebioserver"),s=r.ok?r.data.devices||[]:[],i=t?await m(`/api/mobile/v1/rrr/integrations/${t.id}/adms/commands`):null,c=i?.ok?i.data.commands||[]:[],o=Math.max(t?.unmapped_records||0,a?.unmapped_records||0);e.innerHTML=`<main class="rrr-page rrr-integrations-page">
    <header class="rrr-header rrr-integrations-header">
      <button id="rrr-back" class="rrr-back-button" aria-label="Back">←</button>
      <div class="rrr-brand"><b>RRR</b><span>Gym Growth System</span></div>
      <span class="rrr-help-label">Device setup</span>
    </header>
    <section class="rrr-setup-hero">
      <div><span class="rrr-eyebrow">${C((D()?.tenantName||"YOUR GYM").toUpperCase())} · ATTENDANCE</span><h1>Connect your terminal, not another computer.</h1><p>Choose Direct Cloud for the cleanest setup. RRR receives attendance securely from your eSSL device and turns it into member actions.</p></div>
      <div class="rrr-setup-progress"><b>${t&&k(t)?"Connected":"Step 1 of 3"}</b><span>${t?.records_synced||0} verified records</span></div>
    </section>
    <section class="rrr-connection-grid">
      <article class="rrr-connect-card rrr-connect-card-primary">
        <div class="rrr-card-top"><span class="rrr-option-icon">☁</span><div>${A(t)}<h2>Direct Cloud</h2><p>No gym PC or bridge required for attendance.</p></div></div>
        ${t?P(t,c):q()}
      </article>
      <article class="rrr-connect-card">
        <div class="rrr-card-top"><span class="rrr-option-icon rrr-option-muted">⌘</span><div><span class="rrr-status-pill">FALLBACK</span><h2>eBioServer Bridge</h2><p>Use only when your licensed eBioServer stays on a gym PC.</p></div></div>
        ${N(a,s)}
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
        <li class="${t?"done":""}"><b>1</b><div><strong>Register the terminal</strong><span>Save the terminal serial number in RRR.</span></div></li>
        <li class="${t&&k(t)?"done":""}"><b>2</b><div><strong>Point it to RRR Cloud</strong><span>Enter the server address shown above in Cloud Server Settings.</span></div></li>
        <li class="${(t?.records_synced||0)>0?"done":""}"><b>3</b><div><strong>Make one real punch</strong><span>RRR confirms the event, then you map any unknown member once.</span></div></li>
      </ol>
      ${t||a?`<button class="rrr-link-button" id="rrr-mappings">Review unknown punches (${o}) →</button>
    <button class="rrr-link-button" id="rrr-enroll-match">Match terminal users to members →</button>`:""}
    </section>
    <aside class="rrr-safety-note"><span>ⓘ</span><p><b>Access-control safety:</b> attendance flows as soon as the terminal connects. Automatic door block/unblock for expired members switches on only after the supervised commissioning below — a real punch, a verified test command, and a physical door test you confirm in person.</p></aside>

  </main>`,e.querySelector("#rrr-back")?.addEventListener("click",()=>S.back()),e.querySelector("#rrr-mappings")?.addEventListener("click",()=>S.push("rrr-mappings")),e.querySelector("#rrr-enroll-match")?.addEventListener("click",()=>S.push("rrr-enroll-match")),L(e),M(e,a),t&&G(e,t,c)}function L(e){e.querySelector("#rrr-direct-form")?.addEventListener("submit",async r=>{r.preventDefault();const n=r.currentTarget,t=n.querySelector("button"),a=e.querySelector("#rrr-direct-error");t.disabled=!0,t.textContent="Saving terminal…",a.textContent="";const s=await m("/api/mobile/v1/rrr/integrations/adms/provision",{method:"POST",body:{device_serial:String(new FormData(n).get("device_serial")||"").trim(),device_name:String(new FormData(n).get("device_name")||"").trim()}});s.ok?await v(e):(t.disabled=!1,t.textContent="Continue →",a.textContent=h(s,"We could not save that terminal. Check the serial number and try again."))})}function q(){return`<form id="rrr-direct-form" class="rrr-direct-form">
    <label>Terminal serial number
      <input name="device_serial" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Example: X2008-123456" required>
    </label>
    <label>Friendly name <input name="device_name" value="Elite Gym Entry" maxlength="120" autocapitalize="off"></label>
    <p id="rrr-direct-error" class="rrr-form-error" role="alert"></p>
    <button class="rrr-primary-button" type="submit">Continue <span>→</span></button>
  </form>`}function p(e,r){return`<div class="rrr-copy-row"><div><span>${l(e)}</span><code>${l(r)}</code></div><button type="button" class="rrr-copy-btn" data-copy="${l(r)}">Copy</button></div>`}function P(e,r){const n=e.terminal_settings||{},t=k(e),a=r[0];return`<div class="rrr-direct-live">
    <div class="rrr-device-identity"><b>${l(e.device_name||"Elite Gym Entry")}</b><span>Serial ${l(e.device_serial||"")}</span></div>
    ${t?"":`
      <div class="rrr-empty-state">
        <b>${e.last_seen_at?"This terminal has not polled recently.":"We haven't heard from this terminal yet."}</b>
        ${e.last_seen_at?`<p>Last terminal poll: ${l(T(e.last_seen_at))}.</p>`:""}
        ${e.last_error?`<p>Last error: ${l(e.last_error)}</p>`:""}
        <p>Checklist: ① the values below are saved in <b>Menu → Comm. → Cloud Server Setting</b>, ② the terminal has internet access, ③ the serial matches the sticker on the device.</p>
      </div>`}
    <div class="rrr-server-card">
      <span class="rrr-server-card-title">Type these into the terminal</span>
      ${p("Cloud Server Address",n.server_address||"—")}
      ${p("Port",String(n.server_port??"—"))}
      ${p("HTTPS",n.https?"On":"Off")}
      ${p("Path",n.path||"/iclock")}
      ${p("Mode",n.server_mode||"ADMS")}
    </div>
    ${n.token_present?`
    <div class="rrr-empty-state" id="rrr-rotate-box">
      <b>Connection values hidden.</b>
      <p>The token for this terminal is stored securely and can't be shown again — that's why the address and port above are blank. Rotate to get fresh values.</p>
      <button class="rrr-secondary-button" id="rrr-rotate-token" type="button">Rotate token — get fresh values</button>
      <p id="rrr-rotate-error" class="rrr-form-error" role="alert"></p>
      <div id="rrr-serial-box"></div>
    </div>`:""}
    <p class="rrr-muted-copy">On the terminal: <b>Menu → Comm. → Cloud Server Setting</b>. Save these values, then make one test punch. ${n.https?"<b>Important:</b> if your terminal has no HTTPS/SSL option in its menu, it cannot use Direct Cloud — use the eBioServer bridge instead.":"<b>Note:</b> this terminal talks plain HTTP — keep it on a trusted network or use a VPN."}</p>
    <section class="rrr-command-console">
      <div><b>Live commissioning</b><span id="rrr-cmd-progress">${a?x(a):"No commissioning command sent yet."}</span></div>
      <button class="rrr-secondary-button" data-adms-action="probe_info" ${t?"":"disabled"}>1. Send safe connection probe</button>
      ${t?"":'<p class="rrr-muted-copy">Buttons unlock once the terminal phones home — finish step 2 above first.</p>'}
      <label>Enrolled test-user ID<input id="rrr-test-enroll-number" inputmode="numeric" pattern="[0-9]*" placeholder="Example: 999"></label>
      <label>Current name shown on terminal<input id="rrr-test-user-name" maxlength="24" autocomplete="off" placeholder="Enter the exact test-user name"></label>
      <label class="rrr-test-confirm"><input id="rrr-test-member-confirm" type="checkbox"> I confirm this is the dedicated fake test account I created, not a real customer.</label>
      <div class="rrr-command-actions">
        <button class="rrr-test-block" data-adms-action="essl_group_block_test" ${t?"":"disabled"}>2. Test eSSL block (Grp=100)</button>
        <button class="rrr-test-unblock" data-adms-action="essl_group_unblock_test" ${t?"":"disabled"}>3. Test eSSL unblock (Grp=1)</button>
      </div>
      <p class="rrr-muted-copy">Use only the dedicated, fingerprint-enrolled fake account you created. A fake account saved as a Renewal Desk member is accepted when its current terminal name exactly matches the member name. The command updates USERINFO with Grp=100 or Grp=1 and does not use DELETE. After each terminal acknowledgement, test the same finger at the device; the acknowledgement alone does not prove access changed or that the fingerprint remained enrolled. These tests do not enable automatic membership commands.</p>
      <details class="rrr-danger-probes">
        <summary>Advanced destructive fingerprint probes</summary>
        <p class="rrr-muted-copy">These commands delete fingerprint template data for the test ID. You will need to enroll it again; they are not needed for the Grp test above.</p>
        <div class="rrr-command-actions">
          <button class="rrr-secondary-button" data-adms-action="delete_biodata_test" ${t?"":"disabled"}>Delete fingerprints (FINGERTMP)</button>
          <button class="rrr-secondary-button" data-adms-action="delete_fingertmp_test" ${t?"":"disabled"}>Delete finger 0 (FID=0)</button>
        </div>
      </details>
      <p id="rrr-command-error" class="rrr-form-error" role="alert"></p>
    </section>
    ${E("direct",e,r)}
  </div>`}function x(e){const r=String(e.action||""),n=l(r.replace(/_/g," "));return e.status==="acked"&&r==="essl_group_block_test"?"✓ Grp=100 update acknowledged. Check that the test ID is denied at the terminal.":e.status==="acked"&&r==="essl_group_unblock_test"?"✓ Grp=1 update acknowledged. Check that the same fingerprint works again.":e.status==="acked"?`✓ ${n} — terminal acknowledged.`:e.status==="failed"?e.result_message?`✗ ${n} — ${l(e.result_message)}`:`✗ ${n} — terminal reported failure${e.result_code?` (result ${l(e.result_code)})`:""}. Check the device and retry.`:e.status==="delivered"?`… ${n} — terminal received it, waiting for acknowledgement.`:`… ${n} — sent, waiting for the terminal to pick it up.`}function G(e,r,n){e.querySelectorAll("[data-copy]").forEach(s=>s.addEventListener("click",()=>$(s.dataset.copy,s))),e.querySelector("#rrr-rotate-token")?.addEventListener("click",async()=>{const s=e.querySelector("#rrr-rotate-token"),i=e.querySelector("#rrr-rotate-error"),c=e.querySelector("#rrr-rotate-box");if(!window.confirm("Rotate the connection token? You will get fresh values to type into the terminal (shown once — copy them before leaving this screen). The old values keep working for 7 days."))return;s.disabled=!0,s.textContent="Rotating…",i.textContent="";const o=await m(`/api/mobile/v1/rrr/integrations/${r.id}/adms/rotate-token`,{method:"POST",body:{}});if(!o.ok){s.disabled=!1,s.textContent="Rotate token — get fresh values",i.textContent=h(o,"Could not rotate the token. Try again.");return}const d=o.data.terminal_settings||{};c.outerHTML=`<div class="rrr-server-card" id="rrr-fresh-settings">
      <span class="rrr-server-card-title">Fresh values — copy them NOW</span>
      <p class="rrr-muted-copy"><b>Shown once.</b> ${l(o.data.warning||"Save these in the terminal before leaving this screen.")}</p>
      ${p("Cloud Server Address",d.server_address||"—")}
      ${p("Port",String(d.server_port??"—"))}
      ${p("HTTPS",d.https?"On":"Off")}
      ${p("Path",d.path||"/iclock")}
      ${p("Mode",d.server_mode||"ADMS")}
    </div>`,e.querySelectorAll("#rrr-fresh-settings [data-copy]").forEach(b=>b.addEventListener("click",()=>$(b.dataset.copy,b)))});const t=s=>{const i=e.querySelector("#rrr-serial-box");i&&(i.innerHTML=s?`
      <p class="rrr-muted-copy"><b>Serial-number login is ON</b> for this terminal — it connects with address + port only, no token needed.</p>
      <button class="rrr-secondary-button" id="rrr-serial-fallback" type="button">Turn off serial login</button>
      <p id="rrr-serial-error" class="rrr-form-error" role="alert"></p>`:`
      <p class="rrr-muted-copy"><b>No path/URL field on your terminal?</b> Some terminals can't send the token. Let this terminal log in with its serial number instead — it then needs only the address and port.</p>
      <button class="rrr-secondary-button" id="rrr-serial-fallback" type="button">Connect with serial number instead</button>
      <p id="rrr-serial-error" class="rrr-form-error" role="alert"></p>`,i.querySelector("#rrr-serial-fallback")?.addEventListener("click",()=>a(!s)))},a=async s=>{const i=e.querySelector("#rrr-serial-fallback"),c=e.querySelector("#rrr-serial-error");if(!i||!window.confirm(s?"Let this terminal log in with its serial number? It will connect with just the server address and port — no token needed. You can turn this off again any time.":"Turn off serial-number login? This terminal will stop connecting until it uses the token path."))return;i.disabled=!0,i.textContent="Switching…",c&&(c.textContent="");const o=await m(`/api/mobile/v1/rrr/integrations/${r.id}/adms/serial-fallback`,{method:"POST",body:{enabled:s}});if(!o.ok){i.disabled=!1,i.textContent=s?"Connect with serial number instead":"Turn off serial login",c&&(c.textContent=h(o,"Could not switch login mode. Try again."));return}t(s)};t(!!r.allow_serial_fallback),e.querySelectorAll("[data-adms-action]").forEach(s=>s.addEventListener("click",async()=>{const i=s.dataset.admsAction,c=e.querySelector("#rrr-command-error"),o=e.querySelector("#rrr-test-enroll-number")?.value.trim(),d=e.querySelector("#rrr-test-user-name")?.value.trim(),b=!!e.querySelector("#rrr-test-member-confirm")?.checked,f=["essl_group_block_test","essl_group_unblock_test"].includes(i);if(i!=="probe_info"&&!/^[1-9][0-9]{0,8}$/.test(o||"")){c.textContent="Enter the enrolled, terminal-local test-user ID first (digits only).";return}if(f&&!d){c.textContent="Enter the test user’s current name exactly as it appears on the terminal.";return}if(f&&!b){c.textContent="Confirm this is the fake test account you created before sending the Group test.";return}if(i==="essl_group_block_test"&&!window.confirm(`Queue a Grp=100 USERINFO update for fake test ID ${o}? If this ID is linked to a Renewal Desk member, its name must match exactly. This may update the displayed name to “${d}”.`)||i==="essl_group_unblock_test"&&!window.confirm(`Queue a Grp=1 USERINFO update for fake test ID ${o}? If linked to a Renewal Desk member, its name must match exactly. Verify the same fingerprint at the terminal after acknowledgement.`))return;c.textContent="",e.querySelectorAll("[data-adms-action]").forEach(_=>{_.disabled=!0});const u={action:i,test_enroll_number:o};f&&(u.test_user_name=d,u.test_member_confirmed=!0);const w=await m(`/api/mobile/v1/rrr/integrations/${r.id}/adms/commands`,{method:"POST",body:u});if(!w.ok){e.querySelectorAll("[data-adms-action]").forEach(_=>{_.disabled=!1}),c.textContent=h(w,"The terminal did not accept another test yet.");return}I(e,r.id,w.data.command.id)})),R(e,"direct",r,n)}function I(e,r,n){g();const t=()=>e.querySelector("#rrr-cmd-progress");let a=0;const s=async()=>{a+=1;const i=await m(`/api/mobile/v1/rrr/integrations/${r}/adms/commands`),c=i.ok?i.data.commands||[]:[],o=c.find(d=>d.id===n)||c[0];if(o&&t()&&(t().textContent=x(o)),!o||a>=24||o.status==="acked"||o.status==="failed"){g(),a>=24&&o&&!["acked","failed"].includes(o.status)&&t()&&(t().textContent="Still waiting — the terminal may be offline. It will pick the command up when it reconnects."),o&&["acked","failed"].includes(o.status)&&setTimeout(()=>v(e),1500);return}};s(),y=setInterval(s,2500)}function E(e,r,n=[]){if(r.commands_enabled)return`<section class="rrr-commission is-on"><b>✓ Automatic block/unblock is ON</b><p>Expired members are blocked and renewed members are restored automatically on this terminal.</p>${e==="direct"?"<p><b>Direct ADMS:</b> automatic blocks use the tested Grp=100 update; renewal restores Grp=1, keeping fingerprints enrolled.</p>":""}</section>`;const t=(r.records_synced||0)>0,a=e==="direct"?n.some(o=>o.status==="acked"&&o.action==="essl_group_block_test"):!0,s=e==="direct"?n.some(o=>o.status==="acked"&&o.action==="essl_group_unblock_test"):!0,i=(o,d)=>`<li class="${o?"done":""}"><i>${o?"✓":"○"}</i><span>${d}</span></li>`,c=e==="direct"?i(a,"The Grp=100 block test was acknowledged")+i(s,"The Grp=1 restore test was acknowledged"):"";return`<section class="rrr-commission">
    <b>Supervised commissioning</b>
    <p>Stand at the door with the terminal. Automatic block/unblock switches on only after:</p>
    ${e==="direct"?"<p><b>Direct ADMS:</b> automation uses the tested Grp=100 block and Grp=1 restore; it keeps the terminal user and fingerprint enrolled.</p>":""}
    <ol class="rrr-checklist">
      ${i(t,"A real member punch reached RRR")}
      ${c}
      ${i(!1,"You watched the door stay locked on test block and open on test unblock")}
    </ol>
    <label class="rrr-confirm"><input type="checkbox" id="rrr-door-confirm-${e}"> I stood at the door and verified the lock behaviour myself.</label>
    <button class="rrr-primary-button" id="rrr-commission-btn-${e}" disabled>Enable automatic block/unblock</button>
    <p id="rrr-commission-error-${e}" class="rrr-form-error" role="alert"></p>
  </section>`}function R(e,r,n,t=[]){const a=e.querySelector(`#rrr-door-confirm-${r}`),s=e.querySelector(`#rrr-commission-btn-${r}`),i=e.querySelector(`#rrr-commission-error-${r}`);if(!a||!s)return;const c=(n.records_synced||0)>0,o=r==="direct"?t.some(u=>u.status==="acked"&&u.action==="essl_group_block_test"):!0,d=r==="direct"?t.some(u=>u.status==="acked"&&u.action==="essl_group_unblock_test"):!0,b=o&&d,f=()=>a.checked&&c&&b;if(a.addEventListener("change",()=>{s.disabled=!f()}),!f()){const u=document.createElement("p");u.className="rrr-muted-copy",u.textContent=r==="direct"&&!b?"Run both eSSL Group tests and wait for the Grp=100 and Grp=1 acknowledgements.":"The button unlocks after the first real punch above reaches RRR.",s.after(u)}s.addEventListener("click",async()=>{s.disabled=!0,s.textContent="Enabling…",i.textContent="";const u=await m(`/api/mobile/v1/rrr/integrations/${n.id}/commission`,{method:"POST",body:{physical_test_passed:!0}});if(u.ok){await v(e);return}s.disabled=!1,s.textContent="Enable automatic block/unblock",i.textContent=h(u,"Commissioning failed. Finish the checklist above and try again.")})}function N(e,r){const n=e&&["connected","paired"].includes(e.status),t=e?r.filter(a=>a.integration_id===e.id):[];return`
    ${e?`<div class="rrr-bridge-summary"><b>${l(n?"Bridge connected":e.status||"Not configured")}</b><span>${l(e.device_name||e.device_serial||"Awaiting device selection")}</span></div>`:'<p class="rrr-muted-copy">Not needed for Direct Cloud. It remains available for existing eBioServer installations.</p>'}
    ${e&&t.length?`<div class="rrr-device-list rrr-device-list-inline"><h2>Devices reported by the bridge</h2>${t.map(a=>`
      <div class="rrr-device-row"><div><b>${l(a.name||"Terminal")}</b><span>${l(a.serial_number||"")} · ${l(a.status||"unknown")}</span></div>
      ${a.selected?'<span class="rrr-selected-pill">Selected ✓</span>':`<button class="rrr-secondary-button rrr-device-select" data-device-id="${a.id}">Select</button>`}
      </div>`).join("")}</div>`:""}
    ${e?E("ebio",e):""}
    <div class="rrr-pair-row">
      ${n?'<button class="rrr-link-button" id="rrr-pair">Generate a new code</button>':'<button class="rrr-secondary-button" id="rrr-pair">Generate bridge pairing code</button>'}
    </div>
    <div id="rrr-pair-code" class="rrr-code-box" hidden></div>`}function M(e,r,n){e.querySelector("#rrr-pair")?.addEventListener("click",async()=>{const t=await m("/api/mobile/v1/rrr/integrations/ebioserver/pairing",{method:"POST",body:{}}),a=e.querySelector("#rrr-pair-code");if(a.hidden=!1,!t.ok){a.innerHTML=`<span>${h(t,"Could not create a pairing code.")}</span>`;return}a.innerHTML=`<div class="rrr-code-row"><b>${l(t.data.pairing_code)}</b><button class="rrr-copy-btn" id="rrr-copy-code">Copy</button></div><small>Valid for <b>10 minutes</b> — expires ${l(new Date(t.data.expires_at).toLocaleTimeString())}. Type it into the eBioServer Bridge on the gym PC.</small>`,a.querySelector("#rrr-copy-code")?.addEventListener("click",s=>$(t.data.pairing_code,s.currentTarget))}),e.querySelectorAll(".rrr-device-select").forEach(t=>t.addEventListener("click",async()=>{t.disabled=!0;const a=r.id,s=await m(`/api/mobile/v1/rrr/integrations/${a}/device`,{method:"POST",body:{device_id:Number(t.dataset.deviceId)}});s.ok?await v(e):(t.disabled=!1,t.textContent=h(s,"Could not select that device."))})),r&&R(e,"ebio",r)}export{B as default};
