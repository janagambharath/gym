import{e as u,f as s,g as c,j as l,n as o,k as m}from"./index-DBAqsMek.js";const d={revenue:{title:"REVENUE",subtitle:"Grow revenue from existing members",color:"green",action:"Revenue"},retain:{title:"RETAIN",subtitle:"Prevent potential revenue loss",color:"amber",action:"Retain"},recover:{title:"RECOVER",subtitle:"Bring back lost revenue",color:"red",action:"Recover"}},$={async mount(r){r.innerHTML='<div class="rrr-loading">Loading your RRR growth view…</div>',await p(r)}};async function p(r){const t=await u("/api/mobile/v1/rrr/dashboard");if(!t.ok){r.innerHTML=`<div class="rrr-empty"><h2>RRR could not load</h2><p>${s(t.error?.message||"Please try again.")}</p><button id="rrr-retry">Retry</button></div>`,r.querySelector("#rrr-retry")?.addEventListener("click",()=>p(r));return}const e=t.data,v=m()?.tenantName||"Your Gym",n=e.integration;r.innerHTML=`<main class="rrr-page">
    <header class="rrr-header">
      <div class="rrr-brand"><b>RRR</b><span>Gym Growth System</span></div>
      <button id="rrr-integrations" class="rrr-connection ${n?.status==="connected"?"connected":""}">${n?.status==="connected"?"eBio Connected":"Connect eBioServer"}</button>
    </header>
    <section class="rrr-hero"><h1>Grow more from the members you already have.</h1><p>Revenue. Retain. Recover. The complete gym growth system for ${s(v)}.</p></section>
    <section class="rrr-kpis">
      <article><strong>${c(e.members.total)}</strong><span>Total Members</span></article>
      <article><strong>${e.members.attendance_rate}%</strong><span>Attendance Rate</span></article>
      <article><strong>${c(e.unmapped_count)}</strong><span>Needs Mapping</span></article>
    </section>
    <section class="rrr-pillars">${["revenue","retain","recover"].map(a=>g(e,a)).join("")}</section>
    <section class="rrr-insights">
      <article class="rrr-panel"><div class="rrr-panel-head"><h2>Revenue Impact</h2><span>Live pipeline</span></div>
        <div class="rrr-bars">${["revenue","retain","recover"].map(a=>`<div><i class="${a}"></i><b>${d[a].title}</b><strong>${l(e.pillars[a].potential_revenue)}</strong></div>`).join("")}</div>
      </article>
      <article class="rrr-panel"><div class="rrr-panel-head"><h2>Integration Health</h2><span class="${n?.status==="connected"?"rrr-ok":"rrr-warn"}">${s(n?.status||"Not configured")}</span></div>
        <p>${n?.device_name?`${s(n.device_name)} · `:""}${n?.device_serial?s(n.device_serial):"Pair your licensed local eBioServer from the gym PC."}</p>
        <button id="rrr-health">Manage integration</button>
      </article>
    </section>
    <section class="rrr-list-grid">${["revenue","retain","recover"].map(a=>h(e.pillars[a].items,a)).join("")}</section>
  </main>`,r.querySelector("#rrr-integrations")?.addEventListener("click",()=>o.push("rrr-integrations")),r.querySelector("#rrr-health")?.addEventListener("click",()=>o.push("rrr-integrations")),r.querySelectorAll("[data-pillar]").forEach(a=>a.addEventListener("click",()=>o.switchTab(a.dataset.pillar)))}function g(r,t){const e=d[t];return`<article class="rrr-pillar ${e.color}"><div><h2>${e.title}</h2><p>${e.subtitle}</p></div><div class="rrr-pillar-bottom"><strong>${c(r.count)}</strong><span>${t==="revenue"?"Opportunities":t==="retain"?"At-risk Members":"Inactive / Expired"}</span><em>${l(r.potential_revenue)}</em><button data-pillar="${t}">View all →</button></div></article>`}function h(r,t){return`<article class="rrr-panel rrr-member-list"><div class="rrr-panel-head"><h2>${d[t].title}</h2><button data-pillar="${t}">View all</button></div>${r.length?r.map(i=>`<div class="rrr-member-row"><div><b>${s(i.member.name)}</b><span>${s(i.reason)}</span></div><strong>${l(i.potential_revenue)}</strong></div>`).join(""):'<p class="rrr-no-data">No matching members yet. RRR only shows real data.</p>'}</article>`}export{$ as default};
