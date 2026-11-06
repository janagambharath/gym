import{a as $,u as S,b as k,f as E,g as u,w as L,x as _,n as h,A as H,j as l,i as b}from"./index-BZNT0j-X.js";let o=20;const R={async mount(d){d.innerHTML=`
      ${$({title:"Renewals",showBack:!0,actions:[{icon:"megaphone",label:"Campaigns"}]})}
      <div class="scroll-view" id="renewals-list">${S()}</div>`,k(d,{actions:[{onClick:()=>h.push("campaigns")}]});async function g(v=!1,f=!1){!v&&!f&&(o=20);const[s,p]=await Promise.all([u("/api/mobile/v1/renewals/upcoming"),u("/api/mobile/v1/renewals/expired")]),n=d.querySelector("#renewals-list");if(!s.ok&&!p.ok){v||(n.innerHTML=L(s.error?.message||"Failed to load"));return}if(v&&(!s.ok||!p.ok))return;const c=s.ok?s.data.members||[]:[],t=p.ok?p.data.members||[]:[],y=c.filter(e=>e.days_until_expiry===0),x=c.filter(e=>e.days_until_expiry>0&&e.days_until_expiry<=7),w=c.filter(e=>e.days_until_expiry>7);if(c.length===0&&t.length===0){n.innerHTML=_({icon:"renewals",title:"No renewals",text:"All members are up to date!"});return}let a='<div class="scroll-content">';const m=(e,i,q)=>i.length===0?"":`${H(`${e} (${i.length})`)}
        <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
          ${i.map(r=>`
            <div class="list-item" data-member-id="${r.id}">
              <div class="list-item-content">
                <div class="list-item-title">${l(r.full_name)}</div>
                <div class="list-item-subtitle">${l(r.phone)} · ${l(r.plan?.name||"—")}</div>
              </div>
              <div style="display:flex;gap:6px;align-items:center">
                <a href="tel:${l(r.phone)}" class="btn btn-secondary btn-sm" style="text-decoration:none" data-stop="1" aria-label="Call">${b("phone",15)}</a>
                <a href="https://wa.me/${l(String(r.phone).replace(/\D/g,""))}" target="_blank" rel="noopener" class="btn btn-whatsapp btn-sm" style="text-decoration:none" data-stop="1" aria-label="WhatsApp">${b("whatsapp",15,"white")}</a>
                <button class="btn btn-primary btn-sm" data-renew="${r.id}">Renew</button>
              </div>
            </div>
          `).join("")}
        </div>`;a+=m("Expiring Today",y),a+=m("Next 7 Days",x),a+=m("Upcoming",w),a+=m("Expired",t.slice(0,o)),t.length>o?a+=`<div style="padding:0 var(--sp-lg) var(--sp-lg);text-align:center"><div style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:var(--sp-sm)">Showing ${o} of ${t.length} expired members</div><button class="btn btn-secondary" id="exp-more">Show more expired</button></div>`:t.length&&(a+=`<div style="padding:0 var(--sp-lg) var(--sp-lg);text-align:center;font-size:var(--fs-sm);color:var(--muted)">Showing ${t.length} of ${t.length} expired members</div>`),a+="</div>",n.innerHTML=a,n.querySelector("#exp-more")?.addEventListener("click",()=>{o=t.length,g(!1,!0)}),n.querySelectorAll("[data-renew]").forEach(e=>{e.addEventListener("click",i=>{i.stopPropagation(),h.push("renew-member",{memberId:String(e.dataset.renew)})})}),n.querySelectorAll("[data-stop]").forEach(e=>{e.addEventListener("click",i=>i.stopPropagation())}),n.querySelectorAll("[data-member-id]").forEach(e=>{e.addEventListener("click",()=>h.push("member-detail",{memberId:String(e.dataset.memberId)}))})}await g(),E(d,()=>g(!0))}};export{R as default};
