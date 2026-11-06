import{a as q,u as x,i as k,b as H,n as h,g as S,v as P,w as z,o as M,k as b,x as R,B as A,f as C}from"./index-D2dcDZYm.js";const _={async mount(a){let r=[],s=1,n=0,o="all",c=!1,y="";a.innerHTML=`
      ${q({title:"Payments",showBack:!0,actions:[{icon:"add",label:"Record"}]})}
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
      <div class="scroll-view" id="payments-list">${x()}</div>
      <button class="fab" id="fab-pay">${k("add",24,"white")}</button>`,H(a,{actions:[{onClick:()=>h.push("record-payment")}]}),a.querySelector("#fab-pay").addEventListener("click",()=>h.push("record-payment"));let m;a.querySelector("#pay-search").addEventListener("input",i=>{clearTimeout(m),m=setTimeout(()=>{y=i.target.value,s=1,l()},400)}),a.querySelector("#pay-filters").addEventListener("click",i=>{const t=i.target.closest(".filter-chip");t&&(a.querySelectorAll(".filter-chip").forEach(u=>u.classList.remove("active")),t.classList.add("active"),o=t.dataset.filter,s=1,r=[],l())});let L=0;async function l(i=!1,t=!1){if(i&&c||t&&(c||r.length>=n))return;const u=++L;c=!0;const d=a.querySelector("#payments-list");!i&&!t&&(d.innerHTML=x());let f=`/api/mobile/v1/payments?page=${s}&page_size=20`;o!=="all"&&(f+=`&status=${o}`),y.trim()&&(f+=`&q=${encodeURIComponent(y.trim())}`);const E=i?Array.from({length:s},(e,v)=>f.replace(`page=${s}&`,`page=${v+1}&`)):[f],[p,$]=await Promise.all([Promise.all(E.map(e=>S(e))).then(e=>{const v=e.find(g=>!g.ok)||e[0];return v.ok?{ok:!0,data:{payments:e.flatMap(g=>g.data.payments||[]),pagination:e[0].data.pagination}}:v}),s===1?S("/api/mobile/v1/payments/summary"):Promise.resolve(null)]);if(u!==L)return;if(c=!1,!p.ok){if(p.error.status===401)return P();i||(d.innerHTML=z(p.error.message));return}const w=p.data.payments||[];if(r=t?[...r,...w]:w,n=p.data.pagination?.total??r.length,$?.ok){const e=$.data;a.querySelector("#pay-summary").innerHTML=`
          <div style="padding:var(--sp-lg);display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--sp-sm)">
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold);color:var(--success)">${M(e.today?.total_collected||"0")}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Today</div>
            </div>
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold);color:var(--status-pending)">${e.pending?.count||0}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Pending</div>
            </div>
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold)">${b(e.today?.payment_count||0)}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Count</div>
            </div>
          </div>`}if(r.length===0){d.innerHTML=R({icon:"payments",title:"No payments",text:o!=="all"?`No ${o} payments found`:"Record your first payment"});return}const T=r.length>=n;d.innerHTML=`<div class="scroll-content">
        <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-sm);color:var(--muted)">Showing ${b(r.length)} of ${b(n)} payment${n!==1?"s":""}</div>
        <div class="card" style="margin:0 var(--sp-lg)">${r.map(e=>A(e)).join("")}</div>
        ${T?"":'<div style="padding:var(--sp-lg);text-align:center"><button class="btn btn-secondary" id="pay-more">Load more</button></div>'}
      </div>`,d.querySelectorAll("[data-payment-id]").forEach(e=>{e.addEventListener("click",()=>h.push("payment-detail",{paymentId:e.dataset.paymentId}))}),d.querySelector("#pay-more")?.addEventListener("click",()=>{s++,l(!1,!0)})}a.querySelector("#payments-list").addEventListener("scroll",i=>{const t=i.currentTarget;c||r.length>=n||t.scrollTop+t.clientHeight>=t.scrollHeight-200&&(s++,l(!1,!0))}),await l(),C(a,()=>l(!0),3e4,()=>clearTimeout(m))}};export{_ as default};
