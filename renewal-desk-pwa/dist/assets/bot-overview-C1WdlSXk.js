import{a as v,x as i,b,e as u,z as g,a0 as r,k as n,I as o,n as d}from"./index-ClFlXszA.js";const C={async mount(s){s.innerHTML=`${v({title:"AI Receptionist",showBack:!0})}<div class="scroll-view" id="bot-scroll">${i()}</div>`,b(s,{onBack:()=>d.pop()});async function c(){const e=s.querySelector("#bot-scroll");e&&(e.innerHTML=i());const t=await u("/api/mobile/v1/bot/overview");if(!t.ok){e.innerHTML=g(t.error?.message||"Failed to load"),e.querySelector("#retry-btn")?.addEventListener("click",c);return}const a=t.data||{};e.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-lg)"><div class="metric-grid">
      ${r({label:"Conversations",value:n(a.total_conversations||0),iconName:"chatbubble",color:"var(--brand)",bgColor:"var(--brand-subtle)"})}
      ${r({label:"Leads",value:n(a.total_leads||0),iconName:"target",color:"var(--success)",bgColor:"var(--success-surface)"})}
      ${r({label:"Handovers",value:n(a.handover_count||0),iconName:"alert",color:"var(--warning)",bgColor:"var(--warning-surface)"})}
      ${r({label:"Resolution",value:(a.resolution_rate||"0")+"%",iconName:"check",color:"var(--success)",bgColor:"var(--success-surface)"})}
    </div></div>
    <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
      ${o({iconName:"chatbubble",label:"Conversations",desc:"View chat transcripts",onClick:"bot-conversations",iconBg:"var(--brand-subtle)",iconColor:"var(--brand)"})}
      ${o({iconName:"target",label:"Leads",desc:"Potential customers",onClick:"bot-leads",iconBg:"var(--success-surface)",iconColor:"var(--success)"})}
      ${o({iconName:"settings",label:"Bot Setup",desc:"Configure greeting, hours & FAQ",onClick:"bot-setup",iconBg:"var(--gray-100)",iconColor:"var(--gray-600)"})}
      ${o({iconName:"flash",label:"Test Bot",desc:"Try a sandbox conversation",onClick:"bot-test",iconBg:"#ede9fe",iconColor:"#7c3aed"})}
    </div>
  </div>`,e.querySelectorAll("[data-action]").forEach(l=>l.addEventListener("click",()=>d.push(l.dataset.action)))}await c()}};export{C as default};
