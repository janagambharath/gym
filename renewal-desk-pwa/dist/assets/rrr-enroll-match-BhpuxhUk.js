import{g as m,n as g,j as f}from"./index-Dki4YC0q.js";const _={async mount(e){await d(e)}},n=f;let c=null;const l=()=>{c&&(clearInterval(c),c=null)};async function d(e){l(),e.innerHTML='<div class="rrr-loading">Loading terminal user matches…</div>';const r=await m("/api/mobile/v1/rrr/enroll-matches");if(!r.ok){e.innerHTML='<main class="rrr-page rrr-detail"><h1>Match members unavailable</h1><p>Retry after reconnecting.</p><button id="rrr-retry">Retry</button></main>',e.querySelector("#rrr-retry")?.addEventListener("click",()=>d(e));return}p(e,r.data)}function p(e,r){const a=r.suggestions||[],o=r.unmatched_terminal||[],i=r.snapshot;e.innerHTML=`<main class="rrr-page rrr-detail">
    <header class="rrr-header"><button id="rrr-back">← Integrations</button><div class="rrr-brand"><b>RRR</b><span>Match terminal users</span></div></header>
    <h1>Who is who on the terminal?</h1>
    <p>We read the names stored on your biometric terminal and matched them against your members. Confirm each match with one tap — nothing links without your approval.</p>
    ${i?`<p class="rrr-muted-copy">Terminal snapshot: ${i.terminal_user_count} users · ${i.source==="adms"?"Direct Cloud":"Bridge"} · ${i.acknowledged_at?new Date(i.acknowledged_at).toLocaleString():""}</p>`:""}
    <div class="rrr-match-actions">
      <button id="rrr-scan" class="rrr-primary-button">Scan terminal users</button>
      <span id="rrr-scan-status" class="rrr-muted-copy"></span>
    </div>
    <p id="rrr-match-error" class="rrr-form-error" role="alert"></p>
    ${r.error==="no_snapshot"&&!a.length?'<p class="rrr-muted-copy">No terminal user list yet — hit <b>Scan terminal users</b> above, wait ~15 seconds, and this page will fill in.</p>':""}
    <section id="rrr-suggestions">
      ${a.length?"<h2>Suggested matches</h2>"+a.map(y).join(""):""}
    </section>
    ${o.length?`<section><h2>Couldn't match confidently (${o.length})</h2><p class="rrr-muted-copy">Ask staff who these are, then link them from the member profile.</p>${o.map(t=>`<article class="rrr-opportunity rrr-opportunity-muted"><div><h2>Terminal #${n(t.enroll_number)}</h2><p>${n(t.terminal_name||"No name on terminal")}</p></div></article>`).join("")}</section>`:""}
    ${!a.length&&!o.length&&i?'<p class="rrr-no-data">Everyone on the terminal is already linked. 🎉</p>':""}
  </main>`,e.querySelector("#rrr-back")?.addEventListener("click",()=>{l(),g.back()}),e.querySelector("#rrr-scan")?.addEventListener("click",()=>$(e)),e.querySelectorAll("[data-confirm]").forEach(t=>t.addEventListener("click",async()=>{const s=t.dataset.memberId,b=t.dataset.enroll,h=e.querySelector("#rrr-match-error");t.disabled=!0,t.textContent="Linking…",h.textContent="";const u=await m("/api/mobile/v1/rrr/enroll-matches/confirm",{method:"POST",body:{member_id:Number(s),enroll_number:b}});u.ok?await d(e):(t.disabled=!1,t.textContent="Confirm match",h.textContent=u.error?.message||"Could not link that member. Try again.")}))}function y(e){const r=e.confidence>=90?"High confidence":e.confidence>=70?"Good match":"Possible match";if(e.ambiguous){const a=(e.candidate_members||[]).map(o=>`<li>${n(o.name)}${o.phone?` · ${n(o.phone)}`:""}</li>`).join("");return`<article class="rrr-opportunity rrr-opportunity-muted" data-suggestion="${n(e.enroll_number)}">
      <div><h2>Terminal #${n(e.enroll_number)} · ${n(e.terminal_name||"No name")}</h2>
      <p>This name matches more than one member. Link the ID from the correct member profile.</p>
      ${a?`<ul>${a}</ul>`:""}</div>
    </article>`}return`<article class="rrr-opportunity" data-suggestion="${n(e.enroll_number)}">
    <div>
      <h2>Terminal #${n(e.enroll_number)} · ${n(e.terminal_name||"No name")}</h2>
      <p>→ <b>${n(e.member_name)}</b>${e.member_phone?` · ${n(e.member_phone)}`:""}</p>
      <p class="rrr-muted-copy">${r} (${e.confidence}%)</p>
    </div>
    <div><button class="rrr-primary-button" data-confirm data-member-id="${e.member_id}" data-enroll="${n(e.enroll_number)}">Confirm match</button></div>
  </article>`}async function $(e){const r=e.querySelector("#rrr-scan"),a=e.querySelector("#rrr-scan-status"),o=e.querySelector("#rrr-match-error");r.disabled=!0,r.textContent="Scanning…",o.textContent="",a.textContent="Asking the terminal for its user list…";const i=await m("/api/mobile/v1/rrr/enroll-scan",{method:"POST",body:{}});if(!i.ok){r.disabled=!1,r.textContent="Scan terminal users",a.textContent="",o.textContent=i.error?.message||"Scan failed. Is the terminal connected?";return}let t=0;l(),a.textContent="Waiting for the terminal to respond…",c=setInterval(async()=>{t+=1;const s=await m("/api/mobile/v1/rrr/enroll-matches");if(s.ok&&(s.data.snapshot||s.data.suggestions?.length)){l(),p(e,s.data);return}t>=20&&(l(),r.disabled=!1,r.textContent="Scan terminal users",a.textContent="Still waiting — the terminal may be offline. It will respond when it reconnects; refresh this page then.")},3e3)}export{_ as default};
