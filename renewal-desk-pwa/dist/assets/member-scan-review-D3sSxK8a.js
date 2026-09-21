import{a as p,e as r,i as m,b as v,k as c,s as l,n as d}from"./index-DcA9rnoc.js";const b={mount(s,i){const a=i?.members?JSON.parse(i.members):[];s.innerHTML=`${p({title:`Review (${a.length})`,showBack:!0})}<div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-lg)">
    <div class="card" style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:var(--fs-sm)">
        <thead><tr style="background:var(--gray-50)">
          <th style="padding:var(--sp-sm);text-align:left">Name</th>
          <th style="padding:var(--sp-sm);text-align:left">Phone</th>
          <th style="padding:var(--sp-sm);text-align:left">Plan</th>
        </tr></thead>
        <tbody>${a.map((e,t)=>`<tr style="border-top:1px solid var(--border-light)">
          <td style="padding:var(--sp-sm)"><input class="form-input" style="min-height:32px;font-size:var(--fs-sm);padding:var(--sp-xs) var(--sp-sm)" value="${r(e.name||"")}" data-idx="${t}" data-field="name"></td>
          <td style="padding:var(--sp-sm)"><input class="form-input" style="min-height:32px;font-size:var(--fs-sm);padding:var(--sp-xs) var(--sp-sm)" value="${r(e.phone||"")}" data-idx="${t}" data-field="phone"></td>
          <td style="padding:var(--sp-sm)"><input class="form-input" style="min-height:32px;font-size:var(--fs-sm);padding:var(--sp-xs) var(--sp-sm)" value="${r(e.plan||"")}" data-idx="${t}" data-field="plan"></td>
        </tr>`).join("")}</tbody>
      </table>
    </div>
    <button class="btn btn-primary btn-lg btn-full" id="sr-import" style="margin-top:var(--sp-xl)">${m("upload",18,"white")} Import ${a.length} Members</button>
  </div></div>`,v(s,{onBack:()=>d.pop()}),s.querySelectorAll("input[data-idx]").forEach(e=>e.addEventListener("input",t=>{const n=Number(t.target.dataset.idx),o=t.target.dataset.field;a[n]&&(a[n][o]=t.target.value)})),s.querySelector("#sr-import")?.addEventListener("click",async()=>{const e=s.querySelector("#sr-import");e.disabled=!0,e.textContent="Importing...";const t=await c("/api/mobile/v1/members/batch",{method:"POST",body:{members:a}});t.ok?(l(`${t.data?.imported||a.length} members imported!`,"success"),d.pop(),d.pop()):(l(t.error.message,"error"),e.disabled=!1,e.textContent=`Import ${a.length} Members`)})}};export{b as default};
