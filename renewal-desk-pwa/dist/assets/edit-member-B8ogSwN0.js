import{k as s,a as f,r as t,b as g,s as d,n as v,p as h}from"./index-BNW__y8c.js";const q={async mount(e,p){const i=p?.memberId,o=await s(`/api/mobile/v1/members/${i}`);if(!o.ok){e.innerHTML='<div class="empty-state"><div class="empty-state-title">Member not found</div></div>';return}const a=o.data,m=await s("/api/mobile/v1/settings"),b=m.ok?m.data.plans||[]:[];e.innerHTML=`
      ${f({title:"Edit Member",showBack:!0})}
      <div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl)">
        <form id="edit-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
          ${t({id:"em-name",label:"Full Name",value:a.full_name,required:!0})}
          ${t({id:"em-phone",label:"Phone",type:"tel",value:a.phone,required:!0})}
          ${t({id:"em-email",label:"Email",type:"email",value:a.email||""})}
          ${t({id:"em-gender",label:"Gender",value:a.gender||"",options:[{value:"Male",label:"Male"},{value:"Female",label:"Female"},{value:"Other",label:"Other"}]})}
          ${t({id:"em-plan",label:"Plan",value:a.plan?.id||"",options:b.map(l=>({value:l.id,label:l.name}))})}
          ${t({id:"em-notes",label:"Notes",type:"textarea",value:a.notes||""})}
          <button type="submit" class="btn btn-primary btn-lg btn-full" id="em-submit">Save Changes</button>
        </form>
      </div></div>`,g(e,{onBack:()=>v.pop()}),e.querySelector("#edit-form").addEventListener("submit",async l=>{l.preventDefault();const n=e.querySelector("#em-submit");n.disabled=!0,n.textContent="Saving...";const u=e.querySelector("#em-name").value.trim(),c=e.querySelector("#em-phone").value.trim(),y={full_name:u,name:u,phone:c,email:e.querySelector("#em-email").value.trim()||null,gender:e.querySelector("#em-gender").value||null,plan_id:e.querySelector("#em-plan").value?Number(e.querySelector("#em-plan").value):null,notes:e.querySelector("#em-notes").value.trim()||null},r=await s(`/api/mobile/v1/members/${i}`,{method:"PATCH",body:y});if(r.ok)d("Saved!","success"),v.pop();else{if(r.error?.status===401){h();return}d(r.error.message,"error"),n.disabled=!1,n.textContent="Save Changes"}})}};export{q as default};
