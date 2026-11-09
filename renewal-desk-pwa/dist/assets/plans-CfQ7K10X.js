import{e as u,J as y,a as b,z as f,A as g,f as h,m as S,i as m,b as $,n as E,u as k,s as v,r as p}from"./index-CIkiyrdY.js";const w={async mount(a){let n=[],t=null,o=null;async function c(){const s=await u("/api/mobile/v1/settings");s.ok?(o=null,n=s.data.plans||[]):(o=s.error?.message||"Failed to load",n=[]),l()}function l(){const s=y();a.innerHTML=`${b({title:"Membership Plans",showBack:!0,actions:[{icon:"add",label:"Add"}]})}
      <div class="scroll-view"><div class="scroll-content">
        ${o?f(o,"plans-retry"):n.length===0?g({icon:"plan",title:"No plans",text:"Create your first membership plan",actionText:"Add Plan",actionId:"add-plan"}):`<div class="card" style="margin:var(--sp-lg)">${n.map(e=>`
            <div class="list-item" data-id="${e.id}">
              <div class="list-item-content">
                <div class="list-item-title">${h(e.name)}</div>
                <div class="list-item-subtitle">${e.duration_days} days</div>
              </div>
              <div style="font-weight:var(--fw-bold)">${S(e.price)}</div>
              <button class="btn btn-sm btn-secondary" data-edit="${e.id}">${m("edit",14)}</button>
              <button class="btn btn-sm btn-secondary" data-del="${e.id}" style="color:var(--critical)">${m("delete",14)}</button>
            </div>`).join("")}</div>`}
        ${t!==null?`<div style="padding:var(--sp-lg)"><div class="card card-body">
          <h3 style="margin-bottom:var(--sp-lg)">${t.id?"Edit":"New"} Plan</h3>
          <form id="plan-form" style="display:flex;flex-direction:column;gap:var(--sp-md)">
            ${p({id:"pl-name",label:"Name",value:t.name||"",required:!0,placeholder:"e.g. Monthly"})}
            ${p({id:"pl-days",label:"Duration (days)",type:"number",value:t.duration_days||"30",required:!0})}
            ${p({id:"pl-price",label:"Price",type:"number",value:t.price||"",required:!0})}
            <div style="display:flex;gap:var(--sp-sm)">
              <button type="submit" class="btn btn-primary" style="flex:1">Save</button>
              <button type="button" class="btn btn-secondary" id="plan-cancel">Cancel</button>
            </div>
          </form></div></div>`:""}
      </div></div>`,$(a,{onBack:()=>E.pop(),actions:[{onClick:()=>{t={},l()}}]}),a.querySelector("#plans-retry")?.addEventListener("click",c),a.querySelector("#add-plan")?.addEventListener("click",()=>{t={},l()}),a.querySelectorAll("[data-edit]").forEach(e=>e.addEventListener("click",i=>{i.stopPropagation(),t=n.find(d=>String(d.id)===e.dataset.edit)||{},l()})),a.querySelectorAll("[data-del]").forEach(e=>e.addEventListener("click",async i=>{if(i.stopPropagation(),await k({title:"Delete Plan",message:"Remove this plan?",confirmText:"Delete",destructive:!0})){const r=await u(`/api/mobile/v1/plans/${e.dataset.del}`,{method:"DELETE"});v(r.ok?"Deleted":r.error.message,r.ok?"success":"error"),r.ok&&c()}})),a.querySelector("#plan-cancel")?.addEventListener("click",()=>{t=null,l()}),a.querySelector("#plan-form")?.addEventListener("submit",async e=>{e.preventDefault();const i=e.currentTarget.querySelector('button[type="submit"]');if(i?.disabled)return;i&&(i.disabled=!0,i.textContent="Saving…");const d={name:a.querySelector("#pl-name").value.trim(),duration_days:Number(a.querySelector("#pl-days").value),price:a.querySelector("#pl-price").value},r=t.id?await u(`/api/mobile/v1/plans/${t.id}`,{method:"PATCH",body:d,headers:{"Idempotency-Key":s}}):await u("/api/mobile/v1/plans",{method:"POST",body:d,headers:{"Idempotency-Key":s}});v(r.ok?"Saved!":r.error.message,r.ok?"success":"error"),r.ok?(t=null,c()):i&&(i.disabled=!1,i.textContent="Save")})}await c()}};export{w as default};
