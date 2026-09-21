import{a as o,z as l,b as c,k as n,u as i,w as p,i as y,e as f,N as m,D as g,A as u,n as x}from"./index-D6Fm9ZNQ.js";const b={async mount(t){t.innerHTML=`${o({title:"Access Control",showBack:!0})}<div class="scroll-view" id="ac-scroll">${l()}</div>`,c(t,{onBack:()=>x.pop()});const[r,a]=await Promise.all([n("/api/mobile/v1/access/status"),n("/api/mobile/v1/access/log?page_size=20")]),v=t.querySelector("#ac-scroll"),s=r.ok?r.data:{},d=a.ok?a.data.events||a.data.log||[]:[];v.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-lg)">
      <div class="card card-body" style="text-align:center">
        <div style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm);margin-bottom:var(--sp-lg)">
          <span style="width:10px;height:10px;border-radius:50%;background:${s.device_online?"var(--success)":"var(--muted)"}"></span>
          <span style="font-weight:var(--fw-bold)">${s.device_online?"Device Online":"Device Offline"}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-lg)">
          <div><div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--brand)">${i(s.inside_now||0)}</div><div style="font-size:var(--fs-xs);color:var(--muted)">Inside Now</div></div>
          <div><div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--success)">${i(s.entries_today||0)}</div><div style="font-size:var(--fs-xs);color:var(--muted)">Entries</div></div>
          <div><div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--text-secondary)">${i(s.exits_today||0)}</div><div style="font-size:var(--fs-xs);color:var(--muted)">Exits</div></div>
        </div>
      </div>
    </div>
    ${d.length>0?`${p("Event Log")}
      <div class="card" style="margin:0 var(--sp-lg)">${d.map(e=>`
        <div class="list-item">
          <div style="width:32px;height:32px;border-radius:var(--r-full);background:${e.event_type==="entry"?"var(--success-surface)":"var(--gray-100)"};display:flex;align-items:center;justify-content:center">
            ${y(e.event_type==="entry"?"forward":"back",14,e.event_type==="entry"?"var(--success)":"var(--muted)")}
          </div>
          <div class="list-item-content">
            <div class="list-item-title">${f(e.member_name||"Unknown")}</div>
            <div class="list-item-subtitle">${m(e.timestamp||e.created_at)}</div>
          </div>
          ${g(e.event_type||"entry")}
        </div>`).join("")}</div>`:u({icon:"access",title:"No events",text:"Access events will appear here"})}
  </div>`}};export{b as default};
