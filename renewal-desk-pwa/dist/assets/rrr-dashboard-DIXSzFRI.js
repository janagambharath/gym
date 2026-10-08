import{e as u,f as s,g as c,j as l,n as o,k as g}from"./index-BRoIJu_f.js";const d={revenue:{title:"REVENUE",subtitle:"Grow revenue from existing members",color:"green",action:"Revenue"},retain:{title:"RETAIN",subtitle:"Prevent potential revenue loss",color:"amber",action:"Retain"},recover:{title:"RECOVER",subtitle:"Bring back lost revenue",color:"red",action:"Recover"}},y={async mount(e){e.innerHTML='<div class="rrr-loading">Loading your RRR growth view…</div>',await p(e)}};async function p(e){const t=await u("/api/mobile/v1/rrr/dashboard");if(!t.ok){e.innerHTML=`<div class="rrr-empty"><h2>RRR could not load</h2><p>${s(t.error?.message||"Please try again.")}</p><button id="rrr-retry">Retry</button></div>`,e.querySelector("#rrr-retry")?.addEventListener("click",()=>p(e));return}const r=t.data,v=g()?.tenantName||"Your Gym",n=r.integration,m=n?.type==="adms_direct"?"Direct Cloud":"eBioServer";e.innerHTML=`<main class="rrr-page">
    <header class="rrr-header">
      <div class="rrr-brand"><b>RRR</b><span>Gym Growth System</span></div>
      <button id="rrr-integrations" class="rrr-connection ${n?.status==="connected"?"connected":""}">${n?.status==="connected"?`${m} connected`:"Connect attendance"}</button>
    </header>
    <section class="rrr-hero"><h1>Grow more from the members you already have.</h1><p>Revenue. Retain. Recover. The complete gym growth system for ${s(v)}.</p></section>
    <section class="rrr-kpis">
      <article><strong>${c(r.members.total)}</strong><span>Total Members</span></article>
      <article><strong>${r.members.attendance_rate}%</strong><span>Attendance Rate</span></article>
      <article><strong>${c(r.unmapped_count)}</strong><span>Needs Mapping</span></article>
    </section>
    <section class="rrr-pillars">${["revenue","retain","recover"].map(a=>h(r,a)).join("")}</section>
    <section class="rrr-insights">
      <article class="rrr-panel"><div class="rrr-panel-head"><h2>Revenue Impact</h2><span>Live pipeline</span></div>
        <div class="rrr-bars">${["revenue","retain","recover"].map(a=>`<div><i class="${a}"></i><b>${d[a].title}</b><strong>${l(r.pillars[a].potential_revenue)}</strong></div>`).join("")}</div>
      </article>
      <article class="rrr-panel"><div class="rrr-panel-head"><h2>Integration Health</h2><span class="${n?.status==="connected"?"rrr-ok":"rrr-warn"}">${s(n?.status||"Not configured")}</span></div>
        <p>${n?.device_name?`${s(n.device_name)} · `:""}${n?.device_serial?s(n.device_serial):"Connect your eSSL terminal directly to RRR. No gym PC is needed for attendance."}</p>
        <button id="rrr-health">Manage integration</button>
      </article>
    </section>
    <section class="rrr-list-grid">${["revenue","retain","recover"].map(a=>b(r.pillars[a].items,a)).join("")}</section>
  </main>`,e.querySelector("#rrr-integrations")?.addEventListener("click",()=>o.push("rrr-integrations")),e.querySelector("#rrr-health")?.addEventListener("click",()=>o.push("rrr-integrations")),e.querySelectorAll("[data-pillar]").forEach(a=>a.addEventListener("click",()=>o.switchTab(a.dataset.pillar)))}function h(e,t){const r=d[t];return`<article class="rrr-pillar ${r.color}"><div><h2>${r.title}</h2><p>${r.subtitle}</p></div><div class="rrr-pillar-bottom"><strong>${c(e.count)}</strong><span>${t==="revenue"?"Opportunities":t==="retain"?"At-risk Members":"Inactive / Expired"}</span><em>${l(e.potential_revenue)}</em><button data-pillar="${t}">View all →</button></div></article>`}function b(e,t){return`<article class="rrr-panel rrr-member-list"><div class="rrr-panel-head"><h2>${d[t].title}</h2><button data-pillar="${t}">View all</button></div>${e.length?e.map(i=>`<div class="rrr-member-row"><div><b>${s(i.member.name)}</b><span>${s(i.reason)}</span></div><strong>${l(i.potential_revenue)}</strong></div>`).join(""):'<p class="rrr-no-data">No matching members yet. RRR only shows real data.</p>'}</article>`}export{y as default};
