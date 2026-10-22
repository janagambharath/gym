import{f as m,n as g,g as f}from"./index-BO2OANjy.js";const k={async mount(e){await d(e)}},o=f;let l=null;const c=()=>{l&&(clearInterval(l),l=null)};async function d(e){c(),e.innerHTML='<div class="rrr-loading">Loading terminal user matches…</div>';const r=await m("/api/mobile/v1/rrr/enroll-matches");if(!r.ok){e.innerHTML='<main class="rrr-page rrr-detail"><h1>Match members unavailable</h1><p>Retry after reconnecting.</p><button id="rrr-retry">Retry</button></main>',e.querySelector("#rrr-retry")?.addEventListener("click",()=>d(e));return}p(e,r.data)}function p(e,r){const n=r.suggestions||[],s=r.unmatched_terminal||[],a=r.snapshot;e.innerHTML=`<main class="rrr-page rrr-detail">
    <header class="rrr-header"><button id="rrr-back">← Integrations</button><div class="rrr-brand"><b>RRR</b><span>Match terminal users</span></div></header>
    <h1>Who is who on the terminal?</h1>
    <p>We read the names stored on your biometric terminal and matched them against your members. Confirm each match with one tap — nothing links without your approval.</p>
    ${a?`<p class="rrr-muted-copy">Terminal snapshot: ${a.terminal_user_count} users · ${a.source==="adms"?"Direct Cloud":"Bridge"} · ${a.acknowledged_at?new Date(a.acknowledged_at).toLocaleString():""}</p>`:""}
    <div class="rrr-match-actions">
      <button id="rrr-scan" class="rrr-primary-button">Scan terminal users</button>
      <span id="rrr-scan-status" class="rrr-muted-copy"></span>
    </div>
    <p id="rrr-match-error" class="rrr-form-error" role="alert"></p>
    ${r.error==="no_snapshot"&&!n.length?'<p class="rrr-muted-copy">No terminal user list yet — hit <b>Scan terminal users</b> above, wait ~15 seconds, and this page will fill in.</p>':""}
    <section id="rrr-suggestions">
      ${n.length?"<h2>Suggested matches</h2>"+n.map(y).join(""):""}
    </section>
    ${s.length?`<section><h2>Couldn't match confidently (${s.length})</h2><p class="rrr-muted-copy">Ask staff who these are, then link them from the member profile.</p>${s.map(t=>`<article class="rrr-opportunity rrr-opportunity-muted"><div><h2>Terminal #${o(t.enroll_number)}</h2><p>${o(t.terminal_name||"No name on terminal")}</p></div></article>`).join("")}</section>`:""}
    ${!n.length&&!s.length&&a?'<p class="rrr-no-data">Everyone on the terminal is already linked. 🎉</p>':""}
  </main>`,e.querySelector("#rrr-back")?.addEventListener("click",()=>{c(),g.back()}),e.querySelector("#rrr-scan")?.addEventListener("click",()=>v(e)),e.querySelectorAll("[data-confirm]").forEach(t=>t.addEventListener("click",async()=>{const i=t.dataset.memberId,b=t.dataset.enroll,h=e.querySelector("#rrr-match-error");t.disabled=!0,t.textContent="Linking…",h.textContent="";const u=await m("/api/mobile/v1/rrr/enroll-matches/confirm",{method:"POST",body:{member_id:Number(i),enroll_number:b}});u.ok?await d(e):(t.disabled=!1,t.textContent="Confirm match",h.textContent=u.error?.message||"Could not link that member. Try again.")}))}function y(e){const r=e.confidence>=90?"High confidence":e.confidence>=70?"Good match":"Possible match";return`<article class="rrr-opportunity" data-suggestion="${o(e.enroll_number)}">
    <div>
      <h2>Terminal #${o(e.enroll_number)} · ${o(e.terminal_name||"No name")}</h2>
      <p>→ <b>${o(e.member_name)}</b>${e.member_phone?` · ${o(e.member_phone)}`:""}</p>
      <p class="rrr-muted-copy">${r} (${e.confidence}%)</p>
    </div>
    <div><button class="rrr-primary-button" data-confirm data-member-id="${e.member_id}" data-enroll="${o(e.enroll_number)}">Confirm match</button></div>
  </article>`}async function v(e){const r=e.querySelector("#rrr-scan"),n=e.querySelector("#rrr-scan-status"),s=e.querySelector("#rrr-match-error");r.disabled=!0,r.textContent="Scanning…",s.textContent="",n.textContent="Asking the terminal for its user list…";const a=await m("/api/mobile/v1/rrr/enroll-scan",{method:"POST",body:{}});if(!a.ok){r.disabled=!1,r.textContent="Scan terminal users",n.textContent="",s.textContent=a.error?.message||"Scan failed. Is the terminal connected?";return}let t=0;c(),n.textContent="Waiting for the terminal to respond…",l=setInterval(async()=>{t+=1;const i=await m("/api/mobile/v1/rrr/enroll-matches");if(i.ok&&(i.data.snapshot||i.data.suggestions?.length)){c(),p(e,i.data);return}t>=20&&(c(),r.disabled=!1,r.textContent="Scan terminal users",n.textContent="Still waiting — the terminal may be offline. It will respond when it reconnects; refresh this page then.")},3e3)}export{k as default};
