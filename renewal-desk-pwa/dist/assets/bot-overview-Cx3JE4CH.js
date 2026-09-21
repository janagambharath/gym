import{a as i,z as d,b as v,k as b,t as a,u as s,D as o,n as l}from"./index-DcA9rnoc.js";const g={async mount(r){r.innerHTML=`${i({title:"AI Receptionist",showBack:!0})}<div class="scroll-view" id="bot-scroll">${d()}</div>`,v(r,{onBack:()=>l.pop()});const t=await b("/api/mobile/v1/bot/overview"),c=r.querySelector("#bot-scroll"),e=t.ok?t.data:{};c.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-lg)"><div class="metric-grid">
      ${a({label:"Conversations",value:s(e.total_conversations||0),iconName:"chatbubble",color:"var(--brand)",bgColor:"var(--brand-subtle)"})}
      ${a({label:"Leads",value:s(e.total_leads||0),iconName:"target",color:"var(--success)",bgColor:"var(--success-surface)"})}
      ${a({label:"Handovers",value:s(e.handover_count||0),iconName:"alert",color:"var(--warning)",bgColor:"var(--warning-surface)"})}
      ${a({label:"Resolution",value:(e.resolution_rate||"0")+"%",iconName:"check",color:"var(--success)",bgColor:"var(--success-surface)"})}
    </div></div>
    <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
      ${o({iconName:"chatbubble",label:"Conversations",desc:"View chat transcripts",onClick:"bot-conversations",iconBg:"var(--brand-subtle)",iconColor:"var(--brand)"})}
      ${o({iconName:"target",label:"Leads",desc:"Potential customers",onClick:"bot-leads",iconBg:"var(--success-surface)",iconColor:"var(--success)"})}
      ${o({iconName:"settings",label:"Bot Setup",desc:"Configure greeting, hours & FAQ",onClick:"bot-setup",iconBg:"var(--gray-100)",iconColor:"var(--gray-600)"})}
      ${o({iconName:"flash",label:"Test Bot",desc:"Try a sandbox conversation",onClick:"bot-test",iconBg:"#ede9fe",iconColor:"#7c3aed"})}
    </div>
  </div>`,c.querySelectorAll("[data-action]").forEach(n=>n.addEventListener("click",()=>l.push(n.dataset.action)))}};export{g as default};
