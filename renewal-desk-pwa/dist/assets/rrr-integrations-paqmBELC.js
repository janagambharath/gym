import{e as c,f as s,n as u}from"./index-BRoIJu_f.js";const f={async mount(r){await m(r)}};function b(){return{host:new URL(window.location.origin).host,port:window.location.protocol==="https:"?"443":"80",https:window.location.protocol==="https:"?"On":"Off"}}async function m(r){r.innerHTML='<div class="rrr-loading">Preparing your connection workspace…</div>';const n=await c("/api/mobile/v1/rrr/integrations"),d=n.ok?n.data.integrations||[]:[],t=d.find(e=>e.type==="adms_direct"),i=d.find(e=>e.type==="ebioserver"),l=n.ok?n.data.devices||[]:[],v=b();r.innerHTML=`<main class="rrr-page rrr-integrations-page">
    <header class="rrr-header rrr-integrations-header">
      <button id="rrr-back" class="rrr-back-button" aria-label="Back">←</button>
      <div class="rrr-brand"><b>RRR</b><span>Gym Growth System</span></div>
      <span class="rrr-help-label">Device setup</span>
    </header>
    <section class="rrr-setup-hero">
      <div><span class="rrr-eyebrow">ELITE GYM · ATTENDANCE</span><h1>Connect your terminal, not another computer.</h1><p>Choose Direct Cloud for the cleanest setup. RRR receives attendance securely from your eSSL device and turns it into member actions.</p></div>
      <div class="rrr-setup-progress"><b>${t?.status==="connected"?"Connected":"Step 1 of 3"}</b><span>${t?.records_synced||0} verified records</span></div>
    </section>
    <section class="rrr-connection-grid">
      <article class="rrr-connect-card rrr-connect-card-primary">
        <div class="rrr-card-top"><span class="rrr-option-icon">☁</span><div><span class="rrr-status-pill ${t?.status==="connected"?"is-live":""}">${t?.status==="connected"?"LIVE":"RECOMMENDED"}</span><h2>Direct Cloud</h2><p>No gym PC or bridge required for attendance.</p></div></div>
        ${t?g(t,v):h()}
      </article>
      <article class="rrr-connect-card">
        <div class="rrr-card-top"><span class="rrr-option-icon rrr-option-muted">⌘</span><div><span class="rrr-status-pill">FALLBACK</span><h2>eBioServer Bridge</h2><p>Use only when your licensed eBioServer stays on a gym PC.</p></div></div>
        ${i?`<div class="rrr-bridge-summary"><b>${s(i.status||"Not configured")}</b><span>${s(i.device_name||i.device_serial||"Awaiting device selection")}</span></div>`:'<p class="rrr-muted-copy">Not needed for Direct Cloud. It remains available for existing eBioServer installations.</p>'}
        <button class="rrr-secondary-button" id="rrr-pair">Generate bridge pairing code</button><div id="rrr-pair-code" class="rrr-code-box" hidden></div>
      </article>
    </section>
    <section class="rrr-steps-panel">
      <div class="rrr-panel-head"><div><span class="rrr-eyebrow">WHAT HAPPENS NEXT</span><h2>Three small steps. Then RRR takes over.</h2></div></div>
      <ol class="rrr-setup-steps">
        <li class="${t?"done":""}"><b>1</b><div><strong>Register the terminal</strong><span>Save the terminal serial number in RRR.</span></div></li>
        <li class="${t?.status==="connected"?"done":""}"><b>2</b><div><strong>Point it to RRR Cloud</strong><span>Enter the server address shown above in Cloud Server Settings.</span></div></li>
        <li class="${t?.last_success_at?"done":""}"><b>3</b><div><strong>Make one real punch</strong><span>RRR confirms the event, then you map any unknown member once.</span></div></li>
      </ol>
      ${t?`<button class="rrr-link-button" id="rrr-mappings">Review unknown punches (${t.unmapped_records||0}) →</button>`:""}
    </section>
    ${l.length?`<section class="rrr-device-list"><h2>Bridge device inventory</h2>${l.map(e=>`<div><b>${s(e.name)}</b><span>${s(e.serial_number)} · ${s(e.status||"unknown")}</span></div>`).join("")}</section>`:""}
    <aside class="rrr-safety-note"><span>ⓘ</span><p><b>Access-control safety:</b> direct attendance is available now. Physical door block/unblock stays disabled until this exact terminal completes a supervised commissioning test and returns a verified command acknowledgement.</p></aside>
  </main>`,r.querySelector("#rrr-back")?.addEventListener("click",()=>u.switchTab("dashboard")),r.querySelector("#rrr-mappings")?.addEventListener("click",()=>u.push("rrr-mappings")),r.querySelector("#rrr-direct-form")?.addEventListener("submit",async e=>{e.preventDefault();const a=new FormData(e.currentTarget),o=e.currentTarget.querySelector("button");o.disabled=!0,o.textContent="Saving terminal…";const p=await c("/api/mobile/v1/rrr/integrations/adms/provision",{method:"POST",body:{device_serial:String(a.get("device_serial")||"").trim(),device_name:String(a.get("device_name")||"").trim()}});p.ok?await m(r):(o.disabled=!1,o.textContent="Continue",r.querySelector("#rrr-direct-error").textContent=p.error?.message||"We could not save that terminal. Check the serial number.")}),r.querySelector("#rrr-pair")?.addEventListener("click",async()=>{const e=await c("/api/mobile/v1/rrr/integrations/ebioserver/pairing",{method:"POST",body:{}}),a=r.querySelector("#rrr-pair-code");a.hidden=!1,a.textContent=e.ok?`Pairing code: ${e.data.pairing_code} · expires ${new Date(e.data.expires_at).toLocaleTimeString()}`:"Could not create a pairing code."})}function h(){return'<form id="rrr-direct-form" class="rrr-direct-form"><label>Terminal serial number<input name="device_serial" autocomplete="off" placeholder="Example: X2008-123456" required></label><label>Friendly name <input name="device_name" value="Elite Gym Entry" maxlength="120"></label><p id="rrr-direct-error" class="rrr-form-error"></p><button class="rrr-primary-button" type="submit">Continue <span>→</span></button></form>'}function g(r,n){return`<div class="rrr-direct-live"><div class="rrr-device-identity"><b>${s(r.device_name||"Elite Gym Entry")}</b><span>${s(r.device_serial)}</span></div><div class="rrr-server-card"><span>Cloud Server Address</span><code>${s(n.host)}</code><small>Port ${n.port} · HTTPS ${n.https} · Mode ADMS</small></div><p class="rrr-muted-copy">On the terminal: <b>Menu → Comm. → Cloud Server Setting</b>. Save these values, then make one test punch.</p><button id="rrr-mappings" class="rrr-primary-button">Check connection status <span>→</span></button></div>`}export{f as default};
