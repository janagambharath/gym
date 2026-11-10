import{a as p,i,b as u,N as v,e as g,n as c,s as d}from"./index-Cn_Ntmv6.js";const f={mount(r){r.innerHTML=`${p({title:"Scan Document",showBack:!0})}<div class="scroll-view"><div class="scroll-content form-scroll-content" style="text-align:center">
    <div style="width:80px;height:80px;border-radius:var(--r-full);background:var(--success-surface);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-xl)">${i("camera",36,"var(--success)")}</div>
    <h3 style="margin-bottom:var(--sp-sm)">Scan a Register Page</h3>
    <p style="color:var(--text-secondary);margin-bottom:var(--sp-xxl)">Take a photo of your physical member register. AI will extract member details automatically.</p>
    <label class="btn btn-primary btn-lg btn-full" id="ms-photo-label" style="cursor:pointer">
      ${i("camera",18,"white")} Take Photo
      <input type="file" accept="image/*" capture="environment" id="ms-file" style="display:none">
    </label>
    <div style="margin-top:var(--sp-lg)">
      <label class="btn btn-secondary btn-full" id="ms-gallery-label" style="cursor:pointer">
        ${i("upload",16)} Choose from Gallery
        <input type="file" accept="image/*" id="ms-gallery" style="display:none">
      </label>
    </div>
    <div id="ms-preview" class="hidden" style="margin-top:var(--sp-xl)"></div>
  </div></div>`,u(r,{onBack:()=>c.pop()});let l=!1;const m=v(),n=e=>{for(const a of["#ms-file","#ms-gallery"]){const t=r.querySelector(a);t&&(t.disabled=!e)}for(const a of["#ms-photo-label","#ms-gallery-label"]){const t=r.querySelector(a);t&&(t.style.opacity=e?"":"0.5")}},y=e=>new Promise((a,t)=>{const s=new FileReader;s.onload=()=>a(s.result),s.onerror=()=>t(new Error("Could not read image")),s.readAsDataURL(e)}),o=async e=>{if(!e||l)return;l=!0,n(!1);const a=r.querySelector("#ms-preview");a.classList.remove("hidden"),a.innerHTML='<div class="full-loader"><div class="spinner"></div><div class="full-loader-text">Analyzing image with AI...</div></div>';try{const t=await y(e),s=await g("/api/mobile/v1/members/scan",{method:"POST",body:{images:[t]},headers:{"Idempotency-Key":m},timeoutMs:12e4});if(s.ok&&s.data?.members){c.replace("member-scan-review",{members:JSON.stringify(s.data.members)});return}d(s.error?.message||"Scan failed","error"),a.classList.add("hidden")}catch{d("Could not read that image — try again","error"),a.classList.add("hidden")}finally{l=!1,n(!0)}};r.querySelector("#ms-file").addEventListener("change",e=>o(e.target.files[0])),r.querySelector("#ms-gallery").addEventListener("change",e=>o(e.target.files[0]))}};export{f as default};
