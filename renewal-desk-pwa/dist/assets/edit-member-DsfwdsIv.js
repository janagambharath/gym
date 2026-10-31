import{f as o,a as S,r as a,b as g,s as d,n as p,t as q}from"./index-Dv7TxQNl.js";const w={async mount(e,y){const u=y?.memberId,b=await o(`/api/mobile/v1/members/${u}`);if(!b.ok){e.innerHTML='<div class="empty-state"><div class="empty-state-title">Member not found</div></div>';return}const t=b.data,v=await o("/api/mobile/v1/settings"),f=v.ok?v.data.plans||[]:[];e.innerHTML=`
      ${S({title:"Edit Member",showBack:!0})}
      <div class="scroll-view"><div class="scroll-content form-scroll-content">
        <form id="edit-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
          ${a({id:"em-name",label:"Full Name",value:t.full_name,required:!0})}
          ${a({id:"em-phone",label:"Phone",type:"tel",value:t.phone,required:!0})}
          ${a({id:"em-email",label:"Email",type:"email",value:t.email||""})}
          ${a({id:"em-gender",label:"Gender",value:t.gender||"",options:[{value:"Male",label:"Male"},{value:"Female",label:"Female"},{value:"Other",label:"Other"}]})}
          ${a({id:"em-address",label:"Address",type:"textarea",value:t.address||""})}
          ${a({id:"em-plan",label:"Plan",value:t.plan?.id||"",options:f.map(r=>({value:r.id,label:r.name}))})}
          ${a({id:"em-start",label:"Start Date",type:"date",value:t.membership_start||""})}
          ${a({id:"em-end",label:"End Date",type:"date",value:t.membership_end||""})}
          ${a({id:"em-notes",label:"Notes",type:"textarea",value:t.notes||""})}
          <button type="submit" class="btn btn-primary btn-lg btn-full" id="em-submit">Save Changes</button>
        </form>
      </div></div>`,g(e,{onBack:()=>p.pop()}),e.querySelector("#edit-form").addEventListener("submit",async r=>{r.preventDefault();const l=e.querySelector("#em-submit");l.disabled=!0,l.textContent="Saving...";const c=e.querySelector("#em-name").value.trim(),h=e.querySelector("#em-phone").value.trim(),n=e.querySelector("#em-start").value||null,s=e.querySelector("#em-end").value||null;if(n&&s&&s<n){d("End date cannot be before start date","error"),l.disabled=!1,l.textContent="Save Changes";return}const i={full_name:c,name:c,phone:h,email:e.querySelector("#em-email").value.trim()||null,gender:e.querySelector("#em-gender").value||null,plan_id:e.querySelector("#em-plan").value?Number(e.querySelector("#em-plan").value):null,notes:e.querySelector("#em-notes").value.trim()||null,address:e.querySelector("#em-address").value.trim()||null};n&&(i.membership_start=n),s&&(i.membership_end=s);const m=await o(`/api/mobile/v1/members/${u}`,{method:"PATCH",body:i});if(m.ok)d("Saved!","success"),window.dispatchEvent(new CustomEvent("member-updated",{detail:m.data})),p.pop();else{if(m.error?.status===401){q();return}d(m.error.message,"error"),l.disabled=!1,l.textContent="Save Changes"}})}};export{w as default};
