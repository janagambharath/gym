import{e as m,t as y,n as $,f as v}from"./index-Be_aVmFu.js";const w={async mount(e){await d(e)},pause(){l()},unmount(){l(),i=!1},resume(e){if(!i||!e?.isConnected)return;const r=e.querySelector("#rrr-scan"),t=e.querySelector("#rrr-scan-status");if(!r||!r.disabled){i=!1;return}t&&!t.textContent&&(t.textContent="Waiting for the terminal to respond…"),b(e)}},a=v;let c=null,i=!1,u=0;const l=()=>{c&&(clearInterval(c),c=null)};function b(e){l(),c=setInterval(async()=>{u+=1;const r=await m("/api/mobile/v1/rrr/enroll-snapshot-status");if(r.ok&&r.data.has_snapshot){l(),i=!1,await d(e);return}if(u>=20){l(),i=!1;const t=e.querySelector("#rrr-scan"),n=e.querySelector("#rrr-scan-status");t&&(t.disabled=!1,t.textContent="Scan terminal users"),n&&(n.textContent="Still waiting — the terminal may be offline. It will respond when it reconnects; refresh this page then.")}},3e3)}async function d(e){l(),i=!1,e.innerHTML='<div class="rrr-loading">Loading terminal user matches…</div>';const r=await m("/api/mobile/v1/rrr/enroll-matches");if(!r.ok){e.innerHTML='<main class="rrr-page rrr-detail"><h1>Match members unavailable</h1><p>Retry after reconnecting.</p><button id="rrr-retry">Retry</button></main>',e.querySelector("#rrr-retry")?.addEventListener("click",()=>d(e));return}C(e,r.data)}function C(e,r){const t=r.suggestions||[],n=r.unmatched_terminal||[],s=r.snapshot;e.innerHTML=`<main class="rrr-page rrr-detail">
    <header class="rrr-header"><button id="rrr-back">← Integrations</button><div class="rrr-brand"><b>RRR</b><span>Match terminal users</span></div></header>
    <h1>Who is who on the terminal?</h1>
    <p>We read the names stored on your biometric terminal and matched them against your members. Confirm each match with one tap — nothing links without your approval.</p>
    ${s?`<p class="rrr-muted-copy">Terminal snapshot: ${s.terminal_user_count} users · ${s.source==="adms"?"Direct Cloud":"Bridge"} · ${s.acknowledged_at?y(s.acknowledged_at):""}</p>`:""}
    <div class="rrr-match-actions">
      <button id="rrr-scan" class="rrr-primary-button">Scan terminal users</button>
      <span id="rrr-scan-status" class="rrr-muted-copy"></span>
    </div>
    <p id="rrr-match-error" class="rrr-form-error" role="alert"></p>
    ${r.error==="no_snapshot"&&!t.length?'<p class="rrr-muted-copy">No terminal user list yet — hit <b>Scan terminal users</b> above, wait ~15 seconds, and this page will fill in.</p>':""}
    <section id="rrr-suggestions">
      ${t.length?"<h2>Suggested matches</h2>"+t.map(S).join(""):""}
    </section>
    ${n.length?`<section><h2>Couldn't match confidently (${n.length})</h2><p class="rrr-muted-copy">Ask staff who these are, then link them from the member profile.</p>${n.map(o=>`<article class="rrr-opportunity rrr-opportunity-muted"><div><h2>Terminal #${a(o.enroll_number)}</h2><p>${a(o.terminal_name||"No name on terminal")}</p></div></article>`).join("")}</section>`:""}
    ${!t.length&&!n.length&&s?'<p class="rrr-no-data">Everyone on the terminal is already linked. 🎉</p>':""}
  </main>`,e.querySelector("#rrr-back")?.addEventListener("click",()=>{l(),$.back()}),e.querySelector("#rrr-scan")?.addEventListener("click",()=>_(e)),e.querySelectorAll("[data-confirm]").forEach(o=>o.addEventListener("click",async()=>{const f=o.dataset.memberId,g=o.dataset.enroll,h=e.querySelector("#rrr-match-error");o.disabled=!0,o.textContent="Linking…",h.textContent="";const p=await m("/api/mobile/v1/rrr/enroll-matches/confirm",{method:"POST",body:{member_id:Number(f),enroll_number:g}});p.ok?await d(e):(o.disabled=!1,o.textContent="Confirm match",h.textContent=p.error?.message||"Could not link that member. Try again.")}))}function S(e){const r=e.confidence>=90?"High confidence":e.confidence>=70?"Good match":"Possible match";if(e.ambiguous){const t=(e.candidate_members||[]).map(n=>`<li>${a(n.name)}${n.phone?` · ${a(n.phone)}`:""}</li>`).join("");return`<article class="rrr-opportunity rrr-opportunity-muted" data-suggestion="${a(e.enroll_number)}">
      <div><h2>Terminal #${a(e.enroll_number)} · ${a(e.terminal_name||"No name")}</h2>
      <p>This name matches more than one member. Link the ID from the correct member profile.</p>
      ${t?`<ul>${t}</ul>`:""}</div>
    </article>`}return`<article class="rrr-opportunity" data-suggestion="${a(e.enroll_number)}">
    <div>
      <h2>Terminal #${a(e.enroll_number)} · ${a(e.terminal_name||"No name")}</h2>
      <p>→ <b>${a(e.member_name)}</b>${e.member_phone?` · ${a(e.member_phone)}`:""}</p>
      <p class="rrr-muted-copy">${r} (${e.confidence}%)</p>
    </div>
    <div><button class="rrr-primary-button" data-confirm data-member-id="${e.member_id}" data-enroll="${a(e.enroll_number)}">Confirm match</button></div>
  </article>`}async function _(e){const r=e.querySelector("#rrr-scan"),t=e.querySelector("#rrr-scan-status"),n=e.querySelector("#rrr-match-error");r.disabled=!0,r.textContent="Scanning…",n.textContent="",t.textContent="Asking the terminal for its user list…";const s=await m("/api/mobile/v1/rrr/enroll-scan",{method:"POST",body:{}});if(!s.ok){r.disabled=!1,r.textContent="Scan terminal users",t.textContent="",n.textContent=s.error?.message||"Scan failed. Is the terminal connected?";return}i=!0,u=0,t.textContent="Waiting for the terminal to respond…",b(e)}export{w as default};
