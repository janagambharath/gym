import{S as v,k as i,a as g,r,i as d,b,s as c,u as y,E as f,n as m}from"./index-DcA9rnoc.js";const h={async mount(e){const p=Object.entries(v).map(([t,a])=>({value:t,label:a})),n=await i("/api/mobile/v1/campaigns/templates"),o=(n.ok?n.data.templates||n.data||[]:[]).map(t=>({value:t.id||t.name,label:t.name||t.id}));e.innerHTML=`${g({title:"New Campaign",showBack:!0})}<div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl)">
    <form id="cc-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
      ${r({id:"cc-name",label:"Campaign Name",placeholder:"e.g. Monthly renewal reminder",required:!0})}
      ${r({id:"cc-segment",label:"Target Segment",options:p,required:!0})}
      ${o.length?r({id:"cc-templ",label:"Message Template",options:o}):r({id:"cc-msg",label:"Message",type:"textarea",placeholder:"Hi {name}, your membership...",required:!0})}
      <div id="cc-preview" class="card card-body hidden" style="background:var(--gray-50)">
        <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-sm)">Preview</div>
        <div id="cc-preview-text" style="font-size:var(--fs-sm);color:var(--text-secondary)"></div>
        <div id="cc-preview-count" style="font-size:var(--fs-sm);color:var(--brand);margin-top:var(--sp-sm)"></div>
      </div>
      <button type="button" class="btn btn-secondary btn-full" id="cc-preview-btn">${d("eye",16)} Preview & Count</button>
      <button type="submit" class="btn btn-whatsapp btn-lg btn-full" id="cc-send">${d("send",18,"white")} Send Campaign</button>
    </form>
  </div></div>`,b(e,{onBack:()=>m.pop()}),e.querySelector("#cc-preview-btn")?.addEventListener("click",async()=>{const t=e.querySelector("#cc-segment")?.value;if(!t){c("Select a segment first","error");return}const a=await i(`/api/mobile/v1/campaigns/preview?segment=${t}`),s=e.querySelector("#cc-preview");a.ok&&(s.classList.remove("hidden"),e.querySelector("#cc-preview-count").textContent=`${y(a.data.count||0)} recipients will receive this message`)}),e.querySelector("#cc-form").addEventListener("submit",async t=>{if(t.preventDefault(),!await f({title:"Send Campaign",message:"This will send messages to all recipients. Continue?",confirmText:"Send"}))return;const s=e.querySelector("#cc-send");s.disabled=!0;const u={name:e.querySelector("#cc-name").value.trim(),segment:e.querySelector("#cc-segment").value,template_id:e.querySelector("#cc-templ")?.value||null,message:e.querySelector("#cc-msg")?.value.trim()||null},l=await i("/api/mobile/v1/campaigns",{method:"POST",body:u});l.ok?(c("Campaign launched!","success"),m.pop()):(c(l.error.message,"error"),s.disabled=!1)})}};export{h as default};
