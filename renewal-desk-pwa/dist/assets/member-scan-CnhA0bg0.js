import{a as o,i as r,b as c,R as d,n,s as m}from"./index-B7TN3ch4.js";const v={mount(a){a.innerHTML=`${o({title:"Scan Document",showBack:!0})}<div class="scroll-view"><div class="scroll-content form-scroll-content" style="text-align:center">
    <div style="width:80px;height:80px;border-radius:var(--r-full);background:var(--success-surface);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-xl)">${r("camera",36,"var(--success)")}</div>
    <h3 style="margin-bottom:var(--sp-sm)">Scan a Register Page</h3>
    <p style="color:var(--text-secondary);margin-bottom:var(--sp-xxl)">Take a photo of your physical member register. AI will extract member details automatically.</p>
    <label class="btn btn-primary btn-lg btn-full" style="cursor:pointer">
      ${r("camera",18,"white")} Take Photo
      <input type="file" accept="image/*" capture="environment" id="ms-file" style="display:none">
    </label>
    <div style="margin-top:var(--sp-lg)">
      <label class="btn btn-secondary btn-full" style="cursor:pointer">
        ${r("upload",16)} Choose from Gallery
        <input type="file" accept="image/*" id="ms-gallery" style="display:none">
      </label>
    </div>
    <div id="ms-preview" class="hidden" style="margin-top:var(--sp-xl)"></div>
  </div></div>`,c(a,{onBack:()=>n.pop()});const i=async e=>{if(!e)return;const t=a.querySelector("#ms-preview");t.classList.remove("hidden"),t.innerHTML='<div class="full-loader"><div class="spinner"></div><div class="full-loader-text">Analyzing image with AI...</div></div>';const l=new FormData;l.append("image",e);const s=await d("/api/mobile/v1/members/scan",l);s.ok&&s.data?.members?n.replace("member-scan-review",{members:JSON.stringify(s.data.members)}):(m(s.error?.message||"Scan failed","error"),t.classList.add("hidden"))};a.querySelector("#ms-file").addEventListener("change",e=>i(e.target.files[0])),a.querySelector("#ms-gallery").addEventListener("change",e=>i(e.target.files[0]))}};export{v as default};
