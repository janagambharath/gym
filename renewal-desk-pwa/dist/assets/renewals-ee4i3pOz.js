import{a as f,t as x,b as $,f as k,g as v,v as S,w as E,n as p,z as L,j as s,i as b}from"./index-8vE_Qb-N.js";const R={async mount(l){l.innerHTML=`
      ${f({title:"Renewals",showBack:!0,actions:[{icon:"megaphone",label:"Campaigns"}]})}
      <div class="scroll-view" id="renewals-list">${x()}</div>`,$(l,{actions:[{onClick:()=>p.push("campaigns")}]});async function m(g=!1){const[r,o]=await Promise.all([v("/api/mobile/v1/renewals/upcoming"),v("/api/mobile/v1/renewals/expired")]),n=l.querySelector("#renewals-list");if(!r.ok&&!o.ok){g||(n.innerHTML=S(r.error?.message||"Failed to load"));return}if(g&&(!r.ok||!o.ok))return;const d=r.ok?r.data.members||[]:[],u=o.ok?o.data.members||[]:[],h=d.filter(e=>e.days_until_expiry===0),y=d.filter(e=>e.days_until_expiry>0&&e.days_until_expiry<=7),w=d.filter(e=>e.days_until_expiry>7);if(d.length===0&&u.length===0){n.innerHTML=E({icon:"renewals",title:"No renewals",text:"All members are up to date!"});return}let i='<div class="scroll-content">';const c=(e,t,_)=>t.length===0?"":`${L(`${e} (${t.length})`)}
        <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
          ${t.map(a=>`
            <div class="list-item" data-member-id="${a.id}">
              <div class="list-item-content">
                <div class="list-item-title">${s(a.full_name)}</div>
                <div class="list-item-subtitle">${s(a.phone)} · ${s(a.plan?.name||"—")}</div>
              </div>
              <div style="display:flex;gap:6px;align-items:center">
                <a href="tel:${s(a.phone)}" class="btn btn-secondary btn-sm" style="text-decoration:none" data-stop="1" aria-label="Call">${b("phone",15)}</a>
                <a href="https://wa.me/${s(String(a.phone).replace(/\D/g,""))}" target="_blank" rel="noopener" class="btn btn-whatsapp btn-sm" style="text-decoration:none" data-stop="1" aria-label="WhatsApp">${b("whatsapp",15,"white")}</a>
                <button class="btn btn-primary btn-sm" data-renew="${a.id}">Renew</button>
              </div>
            </div>
          `).join("")}
        </div>`;i+=c("Expiring Today",h),i+=c("Next 7 Days",y),i+=c("Upcoming",w),i+=c("Expired",u.slice(0,20)),i+="</div>",n.innerHTML=i,n.querySelectorAll("[data-renew]").forEach(e=>{e.addEventListener("click",t=>{t.stopPropagation(),p.push("renew-member",{memberId:String(e.dataset.renew)})})}),n.querySelectorAll("[data-stop]").forEach(e=>{e.addEventListener("click",t=>t.stopPropagation())}),n.querySelectorAll("[data-member-id]").forEach(e=>{e.addEventListener("click",()=>p.push("member-detail",{memberId:String(e.dataset.memberId)}))})}await m(),k(l,()=>m(!0))}};export{R as default};
