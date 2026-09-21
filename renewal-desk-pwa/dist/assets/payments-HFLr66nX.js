import{a as m,z as p,i as u,b as g,n as o,k as y,p as b,o as h,v as L,u as f,A as x,y as $}from"./index-BNW__y8c.js";const k={async mount(e){let n=[],d=1,l=0,r="all";e.innerHTML=`
      ${m({title:"Payments",showBack:!0,actions:[{icon:"add",label:"Record"}]})}
      <div id="pay-summary"></div>
      <div class="filter-chips" id="pay-filters">
        <button class="filter-chip active" data-filter="all">All</button>
        <button class="filter-chip" data-filter="pending">Pending</button>
        <button class="filter-chip" data-filter="verified">Verified</button>
        <button class="filter-chip" data-filter="rejected">Rejected</button>
      </div>
      <div class="scroll-view" id="payments-list">${p()}</div>
      <button class="fab" id="fab-pay">${u("add",24,"white")}</button>`,g(e,{actions:[{onClick:()=>o.push("record-payment")}]}),e.querySelector("#fab-pay").addEventListener("click",()=>o.push("record-payment")),e.querySelector("#pay-filters").addEventListener("click",a=>{const i=a.target.closest(".filter-chip");i&&(e.querySelectorAll(".filter-chip").forEach(s=>s.classList.remove("active")),i.classList.add("active"),r=i.dataset.filter,d=1,n=[],c())});async function c(){const a=e.querySelector("#payments-list");a.innerHTML=p();let i=`/api/mobile/v1/payments?page=${d}&page_size=20`;r!=="all"&&(i+=`&status=${r}`);const[s,v]=await Promise.all([y(i),d===1?y("/api/mobile/v1/payments/summary"):Promise.resolve(null)]);if(!s.ok){if(s.error.status===401)return b();a.innerHTML=h(s.error.message);return}if(n=s.data.payments||[],l=s.data.pagination?.total||0,v?.ok){const t=v.data;e.querySelector("#pay-summary").innerHTML=`
          <div style="padding:var(--sp-lg);display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--sp-sm)">
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold);color:var(--success)">${L(t.today?.total_collected||"0")}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Today</div>
            </div>
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold);color:var(--status-pending)">${t.pending?.count||0}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Pending</div>
            </div>
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold)">${f(t.today?.payment_count||0)}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Count</div>
            </div>
          </div>`}if(n.length===0){a.innerHTML=x({icon:"payments",title:"No payments",text:r!=="all"?`No ${r} payments found`:"Record your first payment"});return}a.innerHTML=`<div class="scroll-content">
        <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-sm);color:var(--muted)">${f(l)} payment${l!==1?"s":""}</div>
        <div class="card" style="margin:0 var(--sp-lg)">${n.map(t=>$(t)).join("")}</div>
      </div>`,a.querySelectorAll("[data-payment-id]").forEach(t=>{t.addEventListener("click",()=>o.push("payment-detail",{paymentId:t.dataset.paymentId}))})}await c()}};export{k as default};
