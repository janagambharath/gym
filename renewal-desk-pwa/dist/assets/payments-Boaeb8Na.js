import{a as $,t as h,i as w,b as x,n as y,g as b,u as S,v as T,o as q,k as L,w as E,A as z,f as H}from"./index-dk1H9QdO.js";const P={async mount(e){let d=[],l=1,c=0,s="all",p=!1,v="";e.innerHTML=`
      ${$({title:"Payments",showBack:!0,actions:[{icon:"add",label:"Record"}]})}
      <div id="pay-summary"></div>
      <div style="padding:0 var(--sp-lg) var(--sp-sm)">
        <input id="pay-search" class="search-input" type="search" placeholder="Search member, amount, reference…" autocomplete="off">
      </div>
      <div class="filter-chips" id="pay-filters">
        <button class="filter-chip active" data-filter="all">All</button>
        <button class="filter-chip" data-filter="pending">Pending</button>
        <button class="filter-chip" data-filter="verified">Verified</button>
        <button class="filter-chip" data-filter="rejected">Rejected</button>
      </div>
      <div class="scroll-view" id="payments-list">${h()}</div>
      <button class="fab" id="fab-pay">${w("add",24,"white")}</button>`,x(e,{actions:[{onClick:()=>y.push("record-payment")}]}),e.querySelector("#fab-pay").addEventListener("click",()=>y.push("record-payment"));let f;e.querySelector("#pay-search").addEventListener("input",a=>{clearTimeout(f),f=setTimeout(()=>{v=a.target.value,l=1,o()},400)}),e.querySelector("#pay-filters").addEventListener("click",a=>{const i=a.target.closest(".filter-chip");i&&(e.querySelectorAll(".filter-chip").forEach(r=>r.classList.remove("active")),i.classList.add("active"),s=i.dataset.filter,l=1,d=[],o())});let u=0;async function o(a=!1){if(a&&p)return;const i=++u;p=!0;const r=e.querySelector("#payments-list");a||(r.innerHTML=h());let m=`/api/mobile/v1/payments?page=${l}&page_size=20`;s!=="all"&&(m+=`&status=${s}`),v.trim()&&(m+=`&q=${encodeURIComponent(v.trim())}`);const[n,g]=await Promise.all([b(m),l===1?b("/api/mobile/v1/payments/summary"):Promise.resolve(null)]);if(i===u){if(p=!1,!n.ok){if(n.error.status===401)return S();a||(r.innerHTML=T(n.error.message));return}if(d=n.data.payments||[],c=n.data.pagination?.total||0,g?.ok){const t=g.data;e.querySelector("#pay-summary").innerHTML=`
          <div style="padding:var(--sp-lg);display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--sp-sm)">
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold);color:var(--success)">${q(t.today?.total_collected||"0")}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Today</div>
            </div>
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold);color:var(--status-pending)">${t.pending?.count||0}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Pending</div>
            </div>
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold)">${L(t.today?.payment_count||0)}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Count</div>
            </div>
          </div>`}if(d.length===0){r.innerHTML=E({icon:"payments",title:"No payments",text:s!=="all"?`No ${s} payments found`:"Record your first payment"});return}r.innerHTML=`<div class="scroll-content">
        <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-sm);color:var(--muted)">${L(c)} payment${c!==1?"s":""}</div>
        <div class="card" style="margin:0 var(--sp-lg)">${d.map(t=>z(t)).join("")}</div>
      </div>`,r.querySelectorAll("[data-payment-id]").forEach(t=>{t.addEventListener("click",()=>y.push("payment-detail",{paymentId:t.dataset.paymentId}))})}}await o(),H(e,()=>o(!0),3e4,()=>clearTimeout(f))}};export{P as default};
