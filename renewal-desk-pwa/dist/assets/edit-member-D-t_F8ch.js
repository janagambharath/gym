import{f as c,a as h,r as l,b as q,s as v,n as S,t as x}from"./index-pUkAnkn_.js";const w={async mount(e,g){const p=g?.memberId,b=await c(`/api/mobile/v1/members/${p}`);if(!b.ok){e.innerHTML='<div class="empty-state"><div class="empty-state-title">Member not found</div></div>';return}const r=b.data,f=await c("/api/mobile/v1/settings"),y=f.ok?f.data.plans||[]:[];e.innerHTML=`
      ${h({title:"Edit Member",showBack:!0})}
      <div class="scroll-view"><div class="scroll-content form-scroll-content">
        <form id="edit-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
          ${l({id:"em-name",label:"Full Name",value:r.full_name,required:!0})}
          ${l({id:"em-phone",label:"Phone",type:"tel",value:r.phone,required:!0})}
          ${l({id:"em-email",label:"Email",type:"email",value:r.email||""})}
          ${l({id:"em-gender",label:"Gender",value:r.gender||"",options:[{value:"Male",label:"Male"},{value:"Female",label:"Female"},{value:"Other",label:"Other"}]})}
          ${l({id:"em-address",label:"Address",type:"textarea",value:r.address||""})}
          ${l({id:"em-plan",label:"Plan",value:r.plan?.id||"",options:y.map(s=>({value:s.id,label:s.name}))})}
          ${l({id:"em-start",label:"Start Date",type:"date",value:r.membership_start||""})}
          <div class="form-group">
            <label class="form-label">End Date (auto-calculated)</label>
            <div id="em-end-display" class="form-input" style="background:var(--bg-muted,#f1f5f9);color:var(--muted);">—</div>
            <span class="form-hint">Calculated from Plan + Start Date. To grant extra days, use the owner override.</span>
          </div>
          ${l({id:"em-notes",label:"Notes",type:"textarea",value:r.notes||""})}
          <button type="submit" class="btn btn-primary btn-lg btn-full" id="em-submit">Save Changes</button>
        </form>
      </div></div>`,q(e,{onBack:()=>S.pop()});const i=()=>{const s=e.querySelector("#em-plan")?.value?Number(e.querySelector("#em-plan").value):null,t=e.querySelector("#em-start")?.value||null,a=e.querySelector("#em-end-display");if(!s||!t)return a&&(a.textContent="—"),null;const m=y.find(d=>d.id===s);if(!m?.duration_days)return a&&(a.textContent="—"),null;const n=new Date(t);n.setDate(n.getDate()+Number(m.duration_days)-1);const o=n.toISOString().slice(0,10);return a&&(a.textContent=o),o};e.querySelector("#em-plan")?.addEventListener("change",i),e.querySelector("#em-start")?.addEventListener("change",i),i(),e.querySelector("#edit-form").addEventListener("submit",async s=>{s.preventDefault();const t=e.querySelector("#em-submit");t.disabled=!0,t.textContent="Saving...";const a=e.querySelector("#em-name").value.trim(),m=e.querySelector("#em-phone").value.trim(),n=e.querySelector("#em-start").value||null,o=i();if(n&&o&&o<n){v("End date cannot be before start date","error"),t.disabled=!1,t.textContent="Save Changes";return}const d={full_name:a,name:a,phone:m,email:e.querySelector("#em-email").value.trim()||null,gender:e.querySelector("#em-gender").value||null,plan_id:e.querySelector("#em-plan").value?Number(e.querySelector("#em-plan").value):null,notes:e.querySelector("#em-notes").value.trim()||null,address:e.querySelector("#em-address").value.trim()||null};n&&(d.membership_start=n),o&&(d.membership_end=o);const u=await c(`/api/mobile/v1/members/${p}`,{method:"PATCH",body:d});if(u.ok)v("Saved!","success"),window.dispatchEvent(new CustomEvent("member-updated",{detail:u.data})),S.pop();else{if(u.error?.status===401){x();return}v(u.error.message,"error"),t.disabled=!1,t.textContent="Save Changes"}})}};export{w as default};
