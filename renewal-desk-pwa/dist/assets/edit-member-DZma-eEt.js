import{n,k as m,a as g,b as h,i,r as a,s as d,p as B}from"./index-1Q0YpctZ.js";const D={async mount(e,S){const o=S?.memberId;if(!o){n.pop();return}const c=await m(`/api/mobile/v1/members/${o}`);if(!c.ok){e.innerHTML=`
        ${g({title:"Edit Member",showBack:!0})}
        <div class="empty-state">
          <div class="empty-state-title">Member not found</div>
          <button class="btn btn-primary" id="em-back-btn" style="margin-top:var(--sp-md)">Go Back</button>
        </div>
      `,h(e,{onBack:()=>n.pop()}),e.querySelector("#em-back-btn")?.addEventListener("click",()=>n.pop());return}const t=c.data,u=await m("/api/mobile/v1/settings"),$=u.ok?u.data.plans||[]:[];e.innerHTML=`
      ${g({title:"Edit Member",showBack:!0})}
      <div class="scroll-view">
        <div class="scroll-content" style="padding:var(--sp-lg);gap:var(--sp-lg);display:flex;flex-direction:column;max-width:640px;margin:0 auto;width:100%">

          <div id="em-error-banner" class="form-error-banner" style="display:none">
            <span style="flex-shrink:0">${i("alert",18,"var(--critical)")}</span>
            <span id="em-error-message" style="flex:1"></span>
          </div>

          <form id="em-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">

            <div class="form-section-card">
              <div class="form-section-title">
                ${i("person",20,"var(--brand)")}
                <span>Member Information</span>
              </div>

              ${a({id:"em-name",label:"Full Name",value:t.full_name,required:!0})}
              ${a({id:"em-phone",label:"Phone Number",type:"tel",value:t.phone,required:!0})}
              ${a({id:"em-email",label:"Email Address",type:"email",value:t.email||""})}
              ${a({id:"em-gender",label:"Gender",value:t.gender||"",options:[{value:"Male",label:"Male"},{value:"Female",label:"Female"},{value:"Other",label:"Other"}]})}
            </div>

            <div class="form-section-card">
              <div class="form-section-title">
                ${i("star",20,"var(--brand)")}
                <span>Membership Details</span>
              </div>

              ${a({id:"em-plan",label:"Assigned Plan",value:t.plan?.id||"",options:$.map(s=>({value:s.id,label:`${s.name} (${s.duration_days}d)`}))})}
              ${a({id:"em-start",label:"Start Date",type:"date",value:t.membership_start||""})}
              ${a({id:"em-end",label:"End Date",type:"date",value:t.membership_end||""})}
            </div>

            <div class="form-section-card">
              <div class="form-section-title">
                ${i("edit",20,"var(--brand)")}
                <span>Notes</span>
              </div>
              ${a({id:"em-notes",type:"textarea",value:t.notes||"",placeholder:"Additional notes..."})}
            </div>

            <button type="submit" class="btn btn-primary btn-lg btn-full" id="em-submit" style="height:50px;font-size:var(--fs-base)">
              Save Changes
            </button>
          </form>
        </div>
      </div>
    `,h(e,{onBack:()=>n.pop()}),e.querySelector("#em-form").addEventListener("submit",async s=>{s.preventDefault();const r=e.querySelector("#em-submit");r.disabled=!0,r.textContent="Saving Changes...";const p=e.querySelector("#em-name").value.trim(),q=e.querySelector("#em-phone").value.trim(),x=e.querySelector("#em-email").value.trim()||null,k=e.querySelector("#em-gender").value||null,b=e.querySelector("#em-plan").value,M=e.querySelector("#em-start").value||null,w=e.querySelector("#em-end").value||null,C=e.querySelector("#em-notes").value.trim()||null,_={full_name:p,name:p,phone:q,email:x,gender:k,plan_id:b?Number(b):null,membership_start:M,membership_end:w,notes:C};try{const l=await m(`/api/mobile/v1/members/${o}`,{method:"PATCH",body:_});if(l.ok)d("Member updated successfully!","success"),n.pop();else{if(l.error?.status===401){B();return}const v=l.error?.message||"Failed to update member.",y=e.querySelector("#em-error-banner"),f=e.querySelector("#em-error-message");y&&f&&(f.textContent=v,y.style.display="flex"),d(v,"error"),r.disabled=!1,r.textContent="Save Changes"}}catch{d("Network error updating member","error"),r.disabled=!1,r.textContent="Save Changes"}})}};export{D as default};
