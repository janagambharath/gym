import{a as h,q as w,b as x,f as g,u as f,v as $,n as p,y as k,g as n,i as b}from"./index-C2gfj6pe.js";const _={async mount(d){d.innerHTML=`
      ${h({title:"Renewals",showBack:!0,actions:[{icon:"megaphone",label:"Campaigns"}]})}
      <div class="scroll-view" id="renewals-list">${w()}</div>`,x(d,{actions:[{onClick:()=>p.push("campaigns")}]});const[s,c]=await Promise.all([g("/api/mobile/v1/renewals/upcoming"),g("/api/mobile/v1/renewals/expired")]),r=d.querySelector("#renewals-list");if(!s.ok&&!c.ok){r.innerHTML=f(s.error?.message||"Failed to load");return}const l=s.ok?s.data.members||[]:[],m=c.ok?c.data.members||[]:[],u=l.filter(e=>e.days_until_expiry===0),v=l.filter(e=>e.days_until_expiry>0&&e.days_until_expiry<=7),y=l.filter(e=>e.days_until_expiry>7);if(l.length===0&&m.length===0){r.innerHTML=$({icon:"renewals",title:"No renewals",text:"All members are up to date!"});return}let i='<div class="scroll-content">';const o=(e,t,S)=>t.length===0?"":`${k(`${e} (${t.length})`)}
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
        </div>`;i+=o("Expiring Today",u),i+=o("Next 7 Days",v),i+=o("Upcoming",y),i+=o("Expired",m.slice(0,20)),i+="</div>",r.innerHTML=i,r.querySelectorAll("[data-renew]").forEach(e=>{e.addEventListener("click",t=>{t.stopPropagation(),p.push("renew-member",{member:e.dataset.renew})})}),r.querySelectorAll("[data-stop]").forEach(e=>{e.addEventListener("click",t=>t.stopPropagation())}),r.querySelectorAll("[data-member]").forEach(e=>{e.addEventListener("click",()=>p.push("member-detail",{member:e.dataset.member}))})}};export{_ as default};
