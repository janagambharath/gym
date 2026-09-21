import{a as y,z as x,b as f,k as u,p as b,o as h,A as w,n as o,y as $,v as k,f as _,e as p,w as S,x as E}from"./index-BcPSQxV-.js";const T={async mount(c){c.innerHTML=`
      ${y({title:"Renewals",showBack:!1,actions:[{icon:"megaphone",label:"Campaigns"}]})}
      <div class="scroll-view" id="renewals-scroll">
        <div class="scroll-content" id="renewals-content">
          ${x()}
        </div>
      </div>`,f(c,{onBack:()=>o.switchTab("dashboard"),actions:[{onClick:()=>o.push("campaigns")}]});const[t,i]=await Promise.all([u("/api/mobile/v1/renewals/upcoming"),u("/api/mobile/v1/renewals/expired")]),a=c.querySelector("#renewals-content");if(!a)return;if(!t.ok&&!i.ok){if(t.error?.status===401||i.error?.status===401)return b();a.innerHTML=h(t.error?.message||"Failed to load renewals");return}const v=t.ok?t.data.members||[]:[],n=i.ok?i.data.members||[]:[],r=v.filter(e=>e.days_until_expiry!==null&&e.days_until_expiry<=0),d=v.filter(e=>e.days_until_expiry!==null&&e.days_until_expiry>0);if(r.length+d.length+n.length===0){a.innerHTML=w({icon:"check",title:"All caught up!",text:"No upcoming renewals or expired memberships at the moment."});return}let l=`
      <div style="padding:0 var(--sp-lg) var(--sp-sm);font-size:var(--fs-xs);color:var(--muted)">
        ${v.length} upcoming · ${n.length} expired
      </div>`;const g=e=>{const s=$(e),m=k(e.days_until_expiry);return`
        <div class="upcoming-row-item">
          <div class="upcoming-row-main" data-member-id="${e.id}" style="cursor:pointer">
            ${_(e.full_name,"md")}
            <div class="upcoming-info">
              <div class="upcoming-name">${p(e.full_name)}</div>
              <div class="upcoming-detail">${p(e.phone||"")} · ${p(e.plan?.name||"Plan not set")}</div>
            </div>
            <div class="upcoming-right">
              <div class="upcoming-date">${S(e.membership_end)}</div>
              ${m?`<div class="upcoming-days">${m}</div>`:""}
              ${E(s)}
            </div>
          </div>
          <button class="upcoming-renew-btn" data-renew='${p(JSON.stringify(e))}'>Renew</button>
        </div>`};r.length>0&&(l+=`
        <div style="padding:0 var(--sp-lg) var(--sp-md)">
          <div style="display:flex;align-items:center;gap:var(--sp-xs);margin-bottom:var(--sp-xs)">
            <span class="device-dot" style="background:var(--status-expired)"></span>
            <span style="font-weight:var(--fw-bold);font-size:var(--fs-base);color:var(--text)">Expiring Today</span>
            <span class="badge badge-expired" style="font-size:10px;padding:1px 6px">${r.length}</span>
          </div>
          <div class="card">
            ${r.map(g).join("")}
          </div>
        </div>`),d.length>0&&(l+=`
        <div style="padding:0 var(--sp-lg) var(--sp-md)">
          <div style="display:flex;align-items:center;gap:var(--sp-xs);margin-bottom:var(--sp-xs)">
            <span class="device-dot" style="background:var(--status-expiring)"></span>
            <span style="font-weight:var(--fw-bold);font-size:var(--fs-base);color:var(--text)">Next 7 Days</span>
            <span class="badge badge-pending" style="font-size:10px;padding:1px 6px">${d.length}</span>
          </div>
          <div class="card">
            ${d.map(g).join("")}
          </div>
        </div>`),n.length>0&&(l+=`
        <div style="padding:0 var(--sp-lg) var(--sp-md)">
          <div style="display:flex;align-items:center;gap:var(--sp-xs);margin-bottom:var(--sp-xs)">
            <span class="device-dot" style="background:var(--status-expired)"></span>
            <span style="font-weight:var(--fw-bold);font-size:var(--fs-base);color:var(--text)">Expired</span>
            <span class="badge badge-expired" style="font-size:10px;padding:1px 6px">${n.length}</span>
          </div>
          <div class="card">
            ${n.map(g).join("")}
          </div>
        </div>`),a.innerHTML=l,a.querySelectorAll(".upcoming-row-main").forEach(e=>{e.addEventListener("click",()=>{const s=e.dataset.memberId;s&&o.push("member-detail",{member:JSON.stringify({id:s})})})}),a.querySelectorAll("[data-renew]").forEach(e=>{e.addEventListener("click",s=>{s.stopPropagation(),o.push("renew-member",{member:e.dataset.renew})})})}};export{T as default};
