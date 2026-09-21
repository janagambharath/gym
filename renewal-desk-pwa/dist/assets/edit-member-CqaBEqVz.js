import{k as r,a as b,r as l,b as c,s as o,n as d}from"./index-BPPTfp3n.js";const f={async mount(e,u){const n=u?.memberId,s=await r(`/api/mobile/v1/members/${n}`);if(!s.ok){e.innerHTML='<div class="empty-state"><div class="empty-state-title">Member not found</div></div>';return}const a=s.data,i=await r("/api/mobile/v1/settings"),v=i.ok?i.data.plans||[]:[];e.innerHTML=`${b({title:"Edit Member",showBack:!0})}<div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl)">
    <form id="edit-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
      ${l({id:"em-name",label:"Full Name",value:a.full_name,required:!0})}
      ${l({id:"em-phone",label:"Phone",type:"tel",value:a.phone,required:!0})}
      ${l({id:"em-email",label:"Email",type:"email",value:a.email||""})}
      ${l({id:"em-gender",label:"Gender",value:a.gender||"",options:[{value:"Male",label:"Male"},{value:"Female",label:"Female"},{value:"Other",label:"Other"}]})}
      ${l({id:"em-plan",label:"Plan",value:a.plan?.id||"",options:v.map(t=>({value:t.id,label:t.name}))})}
      ${l({id:"em-notes",label:"Notes",type:"textarea",value:a.notes||""})}
      <button type="submit" class="btn btn-primary btn-lg btn-full">Save Changes</button>
    </form></div></div>`,c(e,{onBack:()=>d.pop()}),e.querySelector("#edit-form").addEventListener("submit",async t=>{t.preventDefault();const p={name:e.querySelector("#em-name").value.trim(),phone:e.querySelector("#em-phone").value.trim(),email:e.querySelector("#em-email").value.trim()||null,gender:e.querySelector("#em-gender").value||null,plan_id:e.querySelector("#em-plan").value?Number(e.querySelector("#em-plan").value):null,notes:e.querySelector("#em-notes").value.trim()||null},m=await r(`/api/mobile/v1/members/${n}`,{method:"PATCH",body:p});m.ok?(o("Saved!","success"),d.pop()):o(m.error.message,"error")})}};export{f as default};
