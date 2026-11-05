import{a as p,j as r,i as m,b as c,g as v,s as l,n as i}from"./index-B1po66HU.js";const g={mount(s,d){let t=[];try{t=d?.members?JSON.parse(d.members):[]}catch{t=[]}Array.isArray(t)||(t=[]),s.innerHTML=`${p({title:`Review (${t.length})`,showBack:!0})}<div class="scroll-view"><div class="scroll-content form-scroll-content">
    <div class="card" style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:var(--fs-sm)">
        <thead><tr style="background:var(--gray-50)">
          <th style="padding:var(--sp-sm);text-align:left">Name</th>
          <th style="padding:var(--sp-sm);text-align:left">Phone</th>
          <th style="padding:var(--sp-sm);text-align:left">Plan</th>
        </tr></thead>
        <tbody>${t.map((a,e)=>`<tr style="border-top:1px solid var(--border-light)">
          <td style="padding:var(--sp-sm)"><input class="form-input" style="min-height:32px;font-size:var(--fs-sm);padding:var(--sp-xs) var(--sp-sm)" value="${r(a.name||"")}" data-idx="${e}" data-field="name"></td>
          <td style="padding:var(--sp-sm)"><input class="form-input" style="min-height:32px;font-size:var(--fs-sm);padding:var(--sp-xs) var(--sp-sm)" value="${r(a.phone||"")}" data-idx="${e}" data-field="phone"></td>
          <td style="padding:var(--sp-sm)"><input class="form-input" style="min-height:32px;font-size:var(--fs-sm);padding:var(--sp-xs) var(--sp-sm)" value="${r(a.plan||"")}" data-idx="${e}" data-field="plan"></td>
        </tr>`).join("")}</tbody>
      </table>
    </div>
    <button class="btn btn-primary btn-lg btn-full" id="sr-import" style="margin-top:var(--sp-xl)">${m("upload",18,"white")} Import ${t.length} Members</button>
  </div></div>`,c(s,{onBack:()=>i.pop()}),s.querySelectorAll("input[data-idx]").forEach(a=>a.addEventListener("input",e=>{const n=Number(e.target.dataset.idx),o=e.target.dataset.field;t[n]&&(t[n][o]=e.target.value)})),s.querySelector("#sr-import")?.addEventListener("click",async()=>{const a=s.querySelector("#sr-import");a.disabled=!0,a.textContent="Importing...";const e=await v("/api/mobile/v1/members/batch-create",{method:"POST",body:{members:t}});e.ok?(l(`${e.data?.imported||t.length} members imported!`,"success"),i.pop(),i.pop()):(l(e.error.message,"error"),a.disabled=!1,a.textContent=`Import ${t.length} Members`)})}};export{g as default};
