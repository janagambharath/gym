import{k as y,a as S,r as t,J as v,b as q,s,n as h,p as $}from"./index-BcPSQxV-.js";const x={async mount(e){const c=await y("/api/mobile/v1/settings"),b=c.ok?c.data.plans||[]:[];e.innerHTML=`
      ${S({title:"Add Member",showBack:!0})}
      <div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl)">
        <form id="add-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
          ${t({id:"am-name",label:"Full Name",placeholder:"Member name",required:!0})}
          ${t({id:"am-phone",label:"Phone",type:"tel",placeholder:"9876543210",required:!0})}
          ${t({id:"am-email",label:"Email",type:"email",placeholder:"member@example.com"})}
          ${t({id:"am-gender",label:"Gender",options:[{value:"Male",label:"Male"},{value:"Female",label:"Female"},{value:"Other",label:"Other"}]})}
          ${t({id:"am-plan",label:"Membership Plan",options:b.map(l=>({value:l.id,label:`${l.name} — ${l.duration_days} days`}))})}
          ${t({id:"am-start",label:"Start Date",type:"date",value:v()})}
          ${t({id:"am-notes",label:"Notes",type:"textarea",placeholder:"Any notes..."})}
          <button type="submit" class="btn btn-primary btn-lg btn-full" id="am-submit">Add Member</button>
        </form>
      </div></div>`,q(e,{onBack:()=>h.pop()}),e.querySelector("#add-form").addEventListener("submit",async l=>{l.preventDefault();const r=e.querySelector("#am-submit"),d=e.querySelector("#am-name").value.trim(),o=e.querySelector("#am-phone").value.trim();if(!d){s("Please enter member name","error"),e.querySelector("#am-name").focus();return}const m=o.replace(/\D/g,"");if(!o||m.length<10){s("Please enter a valid phone number (at least 10 digits)","error"),e.querySelector("#am-phone").focus();return}r.disabled=!0,r.textContent="Adding...";const f=o.startsWith("+")?o:m.length===10?`+91${m}`:`+${m}`,i=e.querySelector("#am-plan").value?Number(e.querySelector("#am-plan").value):null,u=e.querySelector("#am-start").value||v();let p=u;if(i){const a=b.find(n=>n.id===i);if(a?.duration_days){const n=new Date(u);n.setDate(n.getDate()+Number(a.duration_days)),p=n.toISOString().slice(0,10)}}const g={full_name:d,name:d,phone:f,email:e.querySelector("#am-email").value.trim()||null,gender:e.querySelector("#am-gender").value||null,plan_id:i,membership_start:u,membership_end:p,notes:e.querySelector("#am-notes").value.trim()||null};try{const a=await y("/api/mobile/v1/members",{method:"POST",body:g});if(a.ok)s("Member added!","success"),h.replace("member-detail",{member:JSON.stringify(a.data)});else{if(a.error?.status===401){$();return}s(a.error?.message||"Failed to add member","error"),r.disabled=!1,r.textContent="Add Member"}}catch(a){s(a.message||"Network error","error"),r.disabled=!1,r.textContent="Add Member"}})}};export{x as default};
