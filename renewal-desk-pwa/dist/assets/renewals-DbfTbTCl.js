import{a as b,z as w,b as x,k as u,o as f,A as h,n as p,w as k,e as n}from"./index-ivBBLkG7.js";const E={async mount(d){d.innerHTML=`
      ${b({title:"Renewals",showBack:!0,actions:[{icon:"megaphone",label:"Campaigns"}]})}
      <div class="scroll-view" id="renewals-list">${w()}</div>`,x(d,{actions:[{onClick:()=>p.push("campaigns")}]});const[s,c]=await Promise.all([u("/api/mobile/v1/renewals/upcoming"),u("/api/mobile/v1/renewals/expired")]),a=d.querySelector("#renewals-list");if(!s.ok&&!c.ok){a.innerHTML=f(s.error?.message||"Failed to load");return}const l=s.ok?s.data.members||[]:[],m=c.ok?c.data.members||[]:[],g=l.filter(e=>e.days_until_expiry===0),v=l.filter(e=>e.days_until_expiry>0&&e.days_until_expiry<=7),y=l.filter(e=>e.days_until_expiry>7);if(l.length===0&&m.length===0){a.innerHTML=h({icon:"renewals",title:"No renewals",text:"All members are up to date!"});return}let t='<div class="scroll-content">';const o=(e,i,$)=>i.length===0?"":`${k(`${e} (${i.length})`)}
        <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
          ${i.map(r=>`
            <div class="list-item" data-member='${n(JSON.stringify(r))}'>
              <div class="list-item-content">
                <div class="list-item-title">${n(r.full_name)}</div>
                <div class="list-item-subtitle">${n(r.phone)} · ${n(r.plan?.name||"—")}</div>
              </div>
              <button class="btn btn-primary btn-sm" data-renew='${n(JSON.stringify(r))}'>Renew</button>
            </div>
          `).join("")}
        </div>`;t+=o("Expiring Today",g),t+=o("Next 7 Days",v),t+=o("Upcoming",y),t+=o("Expired",m.slice(0,20)),t+="</div>",a.innerHTML=t,a.querySelectorAll("[data-renew]").forEach(e=>{e.addEventListener("click",i=>{i.stopPropagation(),p.push("renew-member",{member:e.dataset.renew})})}),a.querySelectorAll("[data-member]").forEach(e=>{e.addEventListener("click",()=>p.push("member-detail",{member:e.dataset.member}))})}};export{E as default};
