import{k as n,a as u,r as a,L as b,b as p,s,n as d}from"./index-D6Fm9ZNQ.js";const y={async mount(e){const m=await n("/api/mobile/v1/settings"),o=m.ok?m.data.plans||[]:[];e.innerHTML=`
      ${u({title:"Add Member",showBack:!0})}
      <div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl)">
        <form id="add-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
          ${a({id:"am-name",label:"Full Name",placeholder:"Member name",required:!0})}
          ${a({id:"am-phone",label:"Phone",type:"tel",placeholder:"9876543210",required:!0})}
          ${a({id:"am-email",label:"Email",type:"email",placeholder:"member@example.com"})}
          ${a({id:"am-gender",label:"Gender",options:[{value:"Male",label:"Male"},{value:"Female",label:"Female"},{value:"Other",label:"Other"}]})}
          ${a({id:"am-plan",label:"Membership Plan",options:o.map(t=>({value:t.id,label:`${t.name} — ${t.duration_days} days`}))})}
          ${a({id:"am-start",label:"Start Date",type:"date",value:b()})}
          ${a({id:"am-notes",label:"Notes",type:"textarea",placeholder:"Any notes..."})}
          <button type="submit" class="btn btn-primary btn-lg btn-full" id="am-submit">Add Member</button>
        </form>
      </div></div>`,p(e,{onBack:()=>d.pop()}),e.querySelector("#add-form").addEventListener("submit",async t=>{t.preventDefault();const l=e.querySelector("#am-submit");l.disabled=!0,l.textContent="Adding...";const i={name:e.querySelector("#am-name").value.trim(),phone:e.querySelector("#am-phone").value.trim(),email:e.querySelector("#am-email").value.trim()||null,gender:e.querySelector("#am-gender").value||null,plan_id:e.querySelector("#am-plan").value?Number(e.querySelector("#am-plan").value):null,membership_start:e.querySelector("#am-start").value||null,notes:e.querySelector("#am-notes").value.trim()||null},r=await n("/api/mobile/v1/members",{method:"POST",body:i});r.ok?(s("Member added!","success"),d.replace("member-detail",{member:JSON.stringify(r.data)})):(s(r.error.message,"error"),l.disabled=!1,l.textContent="Add Member")})}};export{y as default};
