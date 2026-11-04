import{a as w,t as x,b as $,f as k,g as v,v as S,w as E,n as p,z as L,j as n,i as b}from"./index-dk1H9QdO.js";const R={async mount(l){l.innerHTML=`
      ${w({title:"Renewals",showBack:!0,actions:[{icon:"megaphone",label:"Campaigns"}]})}
      <div class="scroll-view" id="renewals-list">${x()}</div>`,$(l,{actions:[{onClick:()=>p.push("campaigns")}]});async function m(g=!1){const[s,o]=await Promise.all([v("/api/mobile/v1/renewals/upcoming"),v("/api/mobile/v1/renewals/expired")]),i=l.querySelector("#renewals-list");if(!s.ok&&!o.ok){g||(i.innerHTML=S(s.error?.message||"Failed to load"));return}if(g&&(!s.ok||!o.ok))return;const d=s.ok?s.data.members||[]:[],u=o.ok?o.data.members||[]:[],y=d.filter(e=>e.days_until_expiry===0),h=d.filter(e=>e.days_until_expiry>0&&e.days_until_expiry<=7),f=d.filter(e=>e.days_until_expiry>7);if(d.length===0&&u.length===0){i.innerHTML=E({icon:"renewals",title:"No renewals",text:"All members are up to date!"});return}let r='<div class="scroll-content">';const c=(e,t,_)=>t.length===0?"":`${L(`${e} (${t.length})`)}
        <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
          ${t.map(a=>`
            <div class="list-item" data-member='${n(JSON.stringify(a))}'>
              <div class="list-item-content">
                <div class="list-item-title">${n(a.full_name)}</div>
                <div class="list-item-subtitle">${n(a.phone)} · ${n(a.plan?.name||"—")}</div>
              </div>
              <div style="display:flex;gap:6px;align-items:center">
                <a href="tel:${n(a.phone)}" class="btn btn-secondary btn-sm" style="text-decoration:none" data-stop="1" aria-label="Call">${b("phone",15)}</a>
                <a href="https://wa.me/${n(String(a.phone).replace(/\D/g,""))}" target="_blank" rel="noopener" class="btn btn-whatsapp btn-sm" style="text-decoration:none" data-stop="1" aria-label="WhatsApp">${b("whatsapp",15,"white")}</a>
                <button class="btn btn-primary btn-sm" data-renew='${n(JSON.stringify(a))}'>Renew</button>
              </div>
            </div>
          `).join("")}
        </div>`;r+=c("Expiring Today",y),r+=c("Next 7 Days",h),r+=c("Upcoming",f),r+=c("Expired",u.slice(0,20)),r+="</div>",i.innerHTML=r,i.querySelectorAll("[data-renew]").forEach(e=>{e.addEventListener("click",t=>{t.stopPropagation(),p.push("renew-member",{member:e.dataset.renew})})}),i.querySelectorAll("[data-stop]").forEach(e=>{e.addEventListener("click",t=>t.stopPropagation())}),i.querySelectorAll("[data-member]").forEach(e=>{e.addEventListener("click",()=>p.push("member-detail",{member:e.dataset.member}))})}await m(),k(l,()=>m(!0))}};export{R as default};
