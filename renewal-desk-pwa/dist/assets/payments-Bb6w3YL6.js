import{a as k,u as S,i as H,b as P,n as b,g as T,v as z,s as M,w as R,o as C,k as L,x as A,B as I,f as _}from"./index-Ca8zdeLr.js";const B={async mount(a){let r=[],i=1,n=0,c="all",f=!1,y="";a.innerHTML=`
      ${k({title:"Payments",showBack:!0,actions:[{icon:"add",label:"Record"}]})}
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
      <div class="scroll-view" id="payments-list">${S()}</div>
      <button class="fab" id="fab-pay">${H("add",24,"white")}</button>`,P(a,{actions:[{onClick:()=>b.push("record-payment")}]}),a.querySelector("#fab-pay").addEventListener("click",()=>b.push("record-payment"));let u;a.querySelector("#pay-search").addEventListener("input",s=>{clearTimeout(u),u=setTimeout(()=>{y=s.target.value,i=1,l()},400)}),a.querySelector("#pay-filters").addEventListener("click",s=>{const t=s.target.closest(".filter-chip");t&&(a.querySelectorAll(".filter-chip").forEach(g=>g.classList.remove("active")),t.classList.add("active"),c=t.dataset.filter,i=1,r=[],l())});let $=0;async function l(s=!1,t=!1){if(s&&f||t&&(f||r.length>=n))return;const g=++$;f=!0;const o=a.querySelector("#payments-list");!s&&!t&&(o.innerHTML=S());const p=t?i+1:i;let v=`/api/mobile/v1/payments?page=${p}&page_size=20`;c!=="all"&&(v+=`&status=${c}`),y.trim()&&(v+=`&q=${encodeURIComponent(y.trim())}`);const E=s?Array.from({length:p},(e,m)=>v.replace(`page=${p}&`,`page=${m+1}&`)):[v],[d,w]=await Promise.all([Promise.all(E.map(e=>T(e))).then(e=>{const m=e.find(h=>!h.ok)||e[0];return m.ok?{ok:!0,data:{payments:e.flatMap(h=>h.data.payments||[]),pagination:e[0].data.pagination}}:m}),i===1?T("/api/mobile/v1/payments/summary"):Promise.resolve(null)]);if(g!==$)return;if(f=!1,!d.ok){if(d.error.status===401)return z();if(t){M(d.error?.message||"Could not load more payments.","error");return}s||(o.innerHTML=R(d.error.message));return}const x=d.data.payments||[];if(r=t?[...r,...x]:x,n=d.data.pagination?.total??r.length,t&&(i=p),w?.ok){const e=w.data;a.querySelector("#pay-summary").innerHTML=`
          <div style="padding:var(--sp-lg);display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--sp-sm)">
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold);color:var(--success)">${C(e.today?.total_collected||"0")}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Today</div>
            </div>
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold);color:var(--status-pending)">${e.pending?.count||0}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Pending</div>
            </div>
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold)">${L(e.today?.payment_count||0)}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Count</div>
            </div>
          </div>`}if(r.length===0){o.innerHTML=A({icon:"payments",title:"No payments",text:c!=="all"?`No ${c} payments found`:"Record your first payment"});return}const q=r.length>=n;o.innerHTML=`<div class="scroll-content">
        <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-sm);color:var(--muted)">Showing ${L(r.length)} of ${L(n)} payment${n!==1?"s":""}</div>
        <div class="card" style="margin:0 var(--sp-lg)">${r.map(e=>I(e)).join("")}</div>
        ${q?"":'<div style="padding:var(--sp-lg);text-align:center"><button class="btn btn-secondary" id="pay-more">Load more</button></div>'}
      </div>`,o.querySelectorAll("[data-payment-id]").forEach(e=>{e.addEventListener("click",()=>b.push("payment-detail",{paymentId:e.dataset.paymentId}))}),o.querySelector("#pay-more")?.addEventListener("click",()=>{l(!1,!0)})}a.querySelector("#payments-list").addEventListener("scroll",s=>{const t=s.currentTarget;f||r.length>=n||t.scrollTop+t.clientHeight>=t.scrollHeight-200&&l(!1,!0)}),await l(),_(a,()=>l(!0),3e4,()=>clearTimeout(u))}};export{B as default};
