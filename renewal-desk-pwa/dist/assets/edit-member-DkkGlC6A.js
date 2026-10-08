import{k as s,a as f,r as t,b as g,s as u,n as v,p as h}from"./index-DKUK_qO8.js";const q={async mount(e,c){const o=c?.memberId,i=await s(`/api/mobile/v1/members/${o}`);if(!i.ok){e.innerHTML='<div class="empty-state"><div class="empty-state-title">Member not found</div></div>';return}const a=i.data,m=await s("/api/mobile/v1/settings"),b=m.ok?m.data.plans||[]:[];e.innerHTML=`
      ${f({title:"Edit Member",showBack:!0})}
      <div class="scroll-view"><div class="scroll-content form-scroll-content">
        <form id="edit-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
          ${t({id:"em-name",label:"Full Name",value:a.full_name,required:!0})}
          ${t({id:"em-phone",label:"Phone",type:"tel",value:a.phone,required:!0})}
          ${t({id:"em-email",label:"Email",type:"email",value:a.email||""})}
          ${t({id:"em-gender",label:"Gender",value:a.gender||"",options:[{value:"Male",label:"Male"},{value:"Female",label:"Female"},{value:"Other",label:"Other"}]})}
          ${t({id:"em-address",label:"Address",type:"textarea",value:a.address||""})}
          ${t({id:"em-plan",label:"Plan",value:a.plan?.id||"",options:b.map(l=>({value:l.id,label:l.name}))})}
          ${t({id:"em-notes",label:"Notes",type:"textarea",value:a.notes||""})}
          <button type="submit" class="btn btn-primary btn-lg btn-full" id="em-submit">Save Changes</button>
        </form>
      </div></div>`,g(e,{onBack:()=>v.pop()}),e.querySelector("#edit-form").addEventListener("submit",async l=>{l.preventDefault();const r=e.querySelector("#em-submit");r.disabled=!0,r.textContent="Saving...";const d=e.querySelector("#em-name").value.trim(),p=e.querySelector("#em-phone").value.trim(),y={full_name:d,name:d,phone:p,email:e.querySelector("#em-email").value.trim()||null,gender:e.querySelector("#em-gender").value||null,plan_id:e.querySelector("#em-plan").value?Number(e.querySelector("#em-plan").value):null,notes:e.querySelector("#em-notes").value.trim()||null,address:e.querySelector("#em-address").value.trim()||null},n=await s(`/api/mobile/v1/members/${o}`,{method:"PATCH",body:y});if(n.ok)u("Saved!","success"),window.dispatchEvent(new CustomEvent("member-updated",{detail:n.data})),v.pop();else{if(n.error?.status===401){h();return}u(n.error.message,"error"),r.disabled=!1,r.textContent="Save Changes"}})}};export{q as default};
