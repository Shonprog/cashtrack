const DEFAULT_SETTINGS = {
  base: 11000, travel: 300, hours: 182, pension: 6, creditPoints: 2.25,
  creditValue: 242, breakMinutes: 30, niCeiling: 7703, niLow: 0.0427,
  niHigh: 0.1217, tax: [[7010,.1],[10060,.14],[16150,.2],[22440,.31],[46690,.35],[60130,.47],[1e9,.5]]
};
const DEFAULT_MONTH = {
  currentBalance: null,
  creditBase: null,
  fixedBase: 0,
  extra: 0,
  monthlyBudget: 1500,
  budgetBaseSpent: 0,
  carriedBalance: false,
  balanceSource: null
};
const K = {
  s:'ct.s', r:'ct.r', a:'ct.a', legacyFinance:'ct.f',
  months:'ct.financeMonths.v1', financePrefs:'ct.financePrefs.v1',
  creditEntries:'ct.creditEntries.v1', recurring:'ct.recurring.v1'
};
const load = (key,fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key,value) => localStorage.setItem(key,JSON.stringify(value));
const makeId = () => globalThis.crypto?.randomUUID?.() || `ct-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const money = value => {
  const amount=Number(value)||0;
  const hasAgorot=Math.abs(amount-Math.round(amount))>0.000001;
  return new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',minimumFractionDigits:hasAgorot?2:0,maximumFractionDigits:2}).format(amount);
};
function parseDecimalInput(value){
  let text=String(value??'').trim().replace(/[₪\s\u00A0]/g,'').replace(/[’']/g,'');
  if(text==='') return null;
  const commas=(text.match(/,/g)||[]).length,dots=(text.match(/\./g)||[]).length;
  if(commas&&dots){const decimal=text.lastIndexOf(',')>text.lastIndexOf('.')?',':'.';const thousands=decimal===','?'.':',';text=text.split(thousands).join('').replace(decimal,'.');}
  else if(commas){const parts=text.split(',');text=commas===1&&parts[1].length<=2?`${parts[0]}.${parts[1]}`:parts.join('');}
  else if(dots){const parts=text.split('.');if(dots===1&&parts[1].length===3) text=parts.join('');else if(dots>1){const last=parts.at(-1);text=last.length<=2?`${parts.slice(0,-1).join('')}.${last}`:parts.join('');}}
  text=text.replace(/[^0-9.\-]/g,'');
  const parsed=Number(text);return Number.isFinite(parsed)?parsed:null;
}
const inputNumber = value => value===null||value===undefined||value===''?'':String(Number(value));
const escapeHTML = value => String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const pad = n => String(n).padStart(2,'0');
const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const timeStr = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const monthKeyFromDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
const currentMonthKey = () => monthKeyFromDate(new Date());
function monthKeyOffset(monthKey,delta){
  const [year,month]=monthKey.split('-').map(Number);
  return monthKeyFromDate(new Date(year,month-1+delta,1));
}
function monthLabel(monthKey){
  const [year,month]=monthKey.split('-').map(Number);
  return new Date(year,month-1,1).toLocaleDateString('he-IL',{month:'long',year:'numeric'});
}
function daysInMonth(monthKey){
  const [year,month]=monthKey.split('-').map(Number);
  return new Date(year,month,0).getDate();
}
function defaultDateForMonth(monthKey){
  return monthKey===currentMonthKey()?dateStr(new Date()):`${monthKey}-01`;
}
function isValidMonthKey(value){return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value||''));}

let settings={...DEFAULT_SETTINGS,...load(K.s,{})};
let records=load(K.r,[]);
let activeShift=load(K.a,null);
let creditEntries=load(K.creditEntries,[]);
let recurringPayments=load(K.recurring,[]);
let financePrefs={monthlyBudget:1500,...load(K.financePrefs,{})};
let financeMonths=load(K.months,{});

function normalizeMonthData(raw={}){
  return {
    ...DEFAULT_MONTH,
    ...raw,
    currentBalance: raw.currentBalance===undefined?null:raw.currentBalance,
    creditBase: raw.creditBase===undefined?null:raw.creditBase,
    fixedBase: Number(raw.fixedBase??0),
    extra: Number(raw.extra??0),
    monthlyBudget: Number(raw.monthlyBudget??financePrefs.monthlyBudget??1500),
    budgetBaseSpent: Number(raw.budgetBaseSpent??0),
    carriedBalance: Boolean(raw.carriedBalance),
    balanceSource: raw.balanceSource ?? (raw.carriedBalance ? 'legacy-carry' : null)
  };
}
function migrateLegacyFinance(){
  if(Object.keys(financeMonths).length) return;
  const legacy=load(K.legacyFinance,null);
  if(!legacy) return;
  const month=currentMonthKey();
  const migrated={
    currentBalance: legacy.currentBalance??null,
    creditBase: legacy.creditBase??legacy.credit??null,
    fixedBase: legacy.fixedBase??legacy.fixed??0,
    extra: legacy.extra??0,
    monthlyBudget: legacy.monthlyBudget??1500,
    budgetBaseSpent: legacy.budgetBaseSpent??legacy.discretionarySpent??0,
    carriedBalance:false,
    createdAt:new Date().toISOString(),
    migratedFrom:'v10'
  };
  financeMonths[month]=normalizeMonthData(migrated);
  financePrefs.monthlyBudget=financeMonths[month].monthlyBudget;
  save(K.months,financeMonths);save(K.financePrefs,financePrefs);
}
migrateLegacyFinance();

function latestMonthBefore(monthKey){
  return Object.keys(financeMonths).filter(isValidMonthKey).filter(key=>key<monthKey).sort().at(-1)||null;
}
const roundMoney = value => Math.round((Number(value)+Number.EPSILON)*100)/100;

function expectedClosingBalance(monthKey){
  if(!monthKey||!financeMonths[monthKey]) return null;
  const finance=normalizeMonthData(financeMonths[monthKey]);
  if(finance.currentBalance===null||finance.creditBase===null) return null;
  const salary=calculateSalary(monthKey);
  const totals=financeTotals(monthKey);
  return roundMoney(
    Number(finance.currentBalance)
    + salary.netMonth
    + Number(finance.extra||0)
    - totals.totalCredit
    - totals.totalFixed
  );
}

function ensureMonthBucket(monthKey){
  if(financeMonths[monthKey]){
    const existing=normalizeMonthData(financeMonths[monthKey]);

    // A balance that was carried automatically remains an estimate.
    // Recalculate it from the previous month's expected closing balance
    // until the user confirms/edits the current month's balance manually.
    if(existing.carriedBalance){
      const previousKey=
        (isValidMonthKey(existing.carriedFrom)&&financeMonths[existing.carriedFrom])
          ? existing.carriedFrom
          : latestMonthBefore(monthKey);
      const forecast=previousKey?expectedClosingBalance(previousKey):null;
      if(forecast!==null){
        existing.currentBalance=forecast;
        existing.balanceSource='forecast';
        existing.carriedFrom=previousKey;
        existing.forecastUpdatedAt=new Date().toISOString();
      }
    }

    financeMonths[monthKey]=existing;
    save(K.months,financeMonths);
    return financeMonths[monthKey];
  }

  const previousKey=latestMonthBefore(monthKey);
  const previous=previousKey?normalizeMonthData(financeMonths[previousKey]):null;
  const forecast=previousKey?expectedClosingBalance(previousKey):null;
  const fallbackBalance=previous?.currentBalance??null;
  const openingBalance=forecast!==null?forecast:fallbackBalance;
  const hasOpeningBalance=openingBalance!==null&&openingBalance!==undefined;

  financeMonths[monthKey]=normalizeMonthData({
    currentBalance:openingBalance,
    creditBase:null,
    fixedBase:0,
    extra:0,
    monthlyBudget:previous?.monthlyBudget??financePrefs.monthlyBudget??1500,
    budgetBaseSpent:0,
    carriedBalance:hasOpeningBalance,
    balanceSource:forecast!==null?'forecast':(hasOpeningBalance?'previous-balance':null),
    createdAt:new Date().toISOString(),
    carriedFrom:previousKey
  });
  save(K.months,financeMonths);
  return financeMonths[monthKey];
}
ensureMonthBucket(currentMonthKey());
let selectedMonthKey=currentMonthKey();
const selectedFinance = () => ensureMonthBucket(selectedMonthKey);

function parseDateTime(date,time){const[y,m,d]=date.split('-').map(Number);const[h,min]=time.split(':').map(Number);return new Date(y,m-1,d,h,min);}
function presenceHours(row){const start=parseDateTime(row.date,row.in);let end=parseDateTime(row.date,row.out);if(end<start)end=new Date(end.getTime()+86400000);return Math.max(0,(end-start)/3600000);}
function paidHours(row){return Math.max(0,presenceHours(row)-Number(row.breakMinutes??settings.breakMinutes)/60);}
function incomeTax(income,scale){let previous=0,total=0;for(const[ceiling,rate]of settings.tax){const scaled=ceiling*scale,slice=Math.min(income,scaled)-previous;if(slice>0)total+=slice*rate;previous=scaled;if(income<=scaled)break;}return Math.max(0,total-settings.creditPoints*settings.creditValue*scale);}
function nationalInsurance(income,scale){const ceiling=settings.niCeiling*scale,low=Math.min(income,ceiling),high=Math.max(0,income-ceiling);return low*settings.niLow+high*settings.niHigh;}
function monthRows(monthKey=selectedMonthKey){
  const today=dateStr(new Date());
  return records.filter(row=>String(row.date||'').slice(0,7)===monthKey&&(monthKey!==currentMonthKey()||row.date<=today)).sort((a,b)=>a.date.localeCompare(b.date));
}
function calculateSalary(monthKey=selectedMonthKey){
  const rows=monthRows(monthKey),hourly=settings.base/settings.hours;let regular=0,ot125=0,ot150=0,totalPaid=0,days=0;
  for(const row of rows){const presence=presenceHours(row),paid=paidHours(row),overtime=Math.max(0,presence-9);regular+=Math.min(paid,8.5);ot125+=Math.min(2,overtime);ot150+=Math.max(0,overtime-2);totalPaid+=paid;if(presence>0)days++;}
  const regularPay=Math.min(regular,settings.hours)*hourly,pay125=ot125*hourly*1.25,pay150=ot150*hourly*1.5,travel=Math.min(settings.travel,days*(settings.travel/21.67));
  const gross=regularPay+pay125+pay150+travel,progress=Math.max(Math.min(regular/settings.hours,1),0.0001);
  const net=Math.max(0,gross-incomeTax(gross,progress)-nationalInsurance(gross,progress)-(regularPay+pay125+pay150)*(settings.pension/100));
  const grossMonth=settings.base+settings.travel+pay125+pay150;
  const netMonth=Math.max(0,grossMonth-incomeTax(grossMonth,1)-nationalInsurance(grossMonth,1)-(settings.base+pay125+pay150)*(settings.pension/100));
  return{rows,regular,ot125,ot150,totalPaid,gross,net,grossMonth,netMonth};
}
function upsert(row){const index=records.findIndex(item=>item.date===row.date);if(index>=0)records[index]={...row,id:records[index].id||row.id};else records.push(row);save(K.r,records);}
function creditEntriesForMonth(monthKey=selectedMonthKey){return creditEntries.filter(entry=>String(entry.date||'').slice(0,7)===monthKey).sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.createdAt||'').localeCompare(a.createdAt||''));}
function recurringApplies(item,monthKey=selectedMonthKey){
  const start=isValidMonthKey(item.startMonth)?item.startMonth:'0000-01';
  const end=isValidMonthKey(item.endMonth)?item.endMonth:null;
  if(item.active===false&&!end) return false;
  return start<=monthKey&&(!end||monthKey<=end);
}
function recurringForMonth(monthKey=selectedMonthKey){return recurringPayments.filter(item=>recurringApplies(item,monthKey));}
function financeTotals(monthKey=selectedMonthKey){
  const finance=ensureMonthBucket(monthKey);
  const entries=creditEntriesForMonth(monthKey);
  const addedCredit=entries.reduce((sum,item)=>sum+Number(item.amount||0),0);
  const totalCredit=Number(finance.creditBase||0)+addedCredit;
  const recurringItems=recurringForMonth(monthKey);
  const recurringTotal=recurringItems.reduce((sum,item)=>sum+Number(item.amount||0),0);
  const totalFixed=Number(finance.fixedBase||0)+recurringTotal;
  const budgetEntries=entries.filter(item=>item.countsBudget!==false).reduce((sum,item)=>sum+Number(item.amount||0),0);
  const budgetSpent=Number(finance.budgetBaseSpent||0)+budgetEntries;
  const remainingBudget=Number(finance.monthlyBudget||0)-budgetSpent;
  return{entries,addedCredit,totalCredit,recurringItems,recurringTotal,totalFixed,budgetSpent,remainingBudget};
}

window.addEventListener('DOMContentLoaded',()=>{
  const $=id=>document.getElementById(id);
  const el={
    settingsBtn:$('settingsBtn'),settingsOverlay:$('settingsOverlay'),closeSettings:$('closeSettings'),settingsForm:$('settingsForm'),setBase:$('setBase'),setTravel:$('setTravel'),setHours:$('setHours'),setPension:$('setPension'),setCreditPoints:$('setCreditPoints'),setBreak:$('setBreak'),
    prevMonthBtn:$('prevMonthBtn'),nextMonthBtn:$('nextMonthBtn'),goCurrentMonthBtn:$('goCurrentMonthBtn'),monthLabel:$('monthLabel'),monthHint:$('monthHint'),
    homeNetToday:$('homeNetToday'),homeNetMonth:$('homeNetMonth'),homeCredit:$('homeCredit'),homeExpectedBalance:$('homeExpectedBalance'),homeSpendable:$('homeSpendable'),homeBudgetText:$('homeBudgetText'),
    salaryRegularHours:$('salaryRegularHours'),salaryOt125:$('salaryOt125'),salaryOt150:$('salaryOt150'),salaryGrossToday:$('salaryGrossToday'),salaryNetToday:$('salaryNetToday'),salaryGrossMonth:$('salaryGrossMonth'),salaryNetMonth:$('salaryNetMonth'),todayDate:$('todayDate'),todayIn:$('todayIn'),todayOut:$('todayOut'),todaySummary:$('todaySummary'),clockInBtn:$('clockInBtn'),clockOutBtn:$('clockOutBtn'),
    recordsList:$('recordsList'),manualForm:$('manualForm'),manualDate:$('manualDate'),manualIn:$('manualIn'),manualOut:$('manualOut'),manualBreak:$('manualBreak'),
    financeForm:$('financeForm'),currentBalance:$('currentBalance'),creditBase:$('creditBase'),fixedBase:$('fixedBase'),extraIncome:$('extraIncome'),monthlyBudget:$('monthlyBudget'),budgetBaseSpent:$('budgetBaseSpent'),monthFinanceNote:$('monthFinanceNote'),
    creditExpenseForm:$('creditExpenseForm'),creditDescription:$('creditDescription'),creditAmount:$('creditAmount'),creditDate:$('creditDate'),creditCountsBudget:$('creditCountsBudget'),creditExpensesList:$('creditExpensesList'),creditTotalBadge:$('creditTotalBadge'),
    recurringForm:$('recurringForm'),recurringName:$('recurringName'),recurringAmount:$('recurringAmount'),recurringDay:$('recurringDay'),recurringType:$('recurringType'),recurringList:$('recurringList'),recurringTotalBadge:$('recurringTotalBadge'),
    bankCreditTotal:$('bankCreditTotal'),bankFixedTotal:$('bankFixedTotal'),bankExpected:$('bankExpected'),bankSpendable:$('bankSpendable'),bankGrowth:$('bankGrowth')
  };

  function setSelectedMonth(monthKey){
    selectedMonthKey=monthKey;
    ensureMonthBucket(monthKey);
    el.manualDate.value=defaultDateForMonth(monthKey);
    el.creditDate.value=defaultDateForMonth(monthKey);
    render();
  }
  function renderMonthSwitcher(){
    const current=currentMonthKey(),finance=selectedFinance(),isCurrent=selectedMonthKey===current;
    el.monthLabel.textContent=monthLabel(selectedMonthKey);
    if(isCurrent&&finance.carriedBalance&&finance.balanceSource==='forecast'){el.monthHint.textContent='חודש חדש · יתרת פתיחה משוערת חושבה אוטומטית';}
    else if(isCurrent&&finance.carriedBalance){el.monthHint.textContent='חודש חדש · יתרת פתיחה הועברה אוטומטית';}
    else if(isCurrent){el.monthHint.textContent=`החודש הנוכחי · ${daysInMonth(selectedMonthKey)} ימים`;}
    else{el.monthHint.textContent='חודש שמור · לחיצה תחזיר לחודש הנוכחי';}
    el.nextMonthBtn.disabled=isCurrent;
    el.goCurrentMonthBtn.classList.toggle('past-month',!isCurrent);
    el.goCurrentMonthBtn.title=isCurrent?'החודש הנוכחי':'חזרה לחודש הנוכחי';
  }
  function renderCreditEntries(items){
    el.creditExpensesList.innerHTML=items.length?'':'<div class="empty-ledger">אין הוצאות אשראי שנוספו בחודש הזה</div>';
    for(const item of items){
      const row=document.createElement('div');row.className='ledger-row';
      const budgetLabel=item.countsBudget!==false?'<span class="mini-tag">בתקציב</span>':'<span class="mini-tag neutral">לא בתקציב</span>';
      row.innerHTML=`<div class="ledger-main"><strong>${escapeHTML(item.description||'הוצאה')}</strong><small>${new Date(item.date+'T12:00').toLocaleDateString('he-IL')} ${budgetLabel}</small></div><div class="ledger-amount">${money(item.amount)}</div><button class="delete-btn" type="button" aria-label="מחיקת הוצאה">✕</button>`;
      row.querySelector('.delete-btn').addEventListener('click',()=>{if(confirm(`למחוק את ההוצאה "${item.description}"?`)){creditEntries=creditEntries.filter(x=>x.id!==item.id);save(K.creditEntries,creditEntries);render();}});
      el.creditExpensesList.appendChild(row);
    }
  }
  function renderRecurring(items){
    const typeLabels={standing:'הוראת קבע',fixed:'תשלום קבוע',other:'אחר'};
    el.recurringList.innerHTML=items.length?'':'<div class="empty-ledger">אין תשלומים קבועים שחלים בחודש הזה</div>';
    for(const item of items){
      const row=document.createElement('div');row.className='ledger-row';
      const day=item.day?` · יום ${item.day} בחודש`:'';
      row.innerHTML=`<div class="ledger-main"><strong>${escapeHTML(item.name)}</strong><small>${typeLabels[item.type]||'תשלום קבוע'}${day}</small></div><div class="ledger-amount">${money(item.amount)}</div><button class="delete-btn" type="button" aria-label="הפסקת תשלום">✕</button>`;
      row.querySelector('.delete-btn').addEventListener('click',()=>{
        const start=isValidMonthKey(item.startMonth)?item.startMonth:'0000-01';
        const label=monthLabel(selectedMonthKey);
        if(!confirm(`להפסיק את התשלום "${item.name}" החל מ${label}? החודשים הקודמים יישמרו.`)) return;
        if(start>=selectedMonthKey){recurringPayments=recurringPayments.filter(x=>x.id!==item.id);}
        else{item.endMonth=monthKeyOffset(selectedMonthKey,-1);}
        save(K.recurring,recurringPayments);render();
      });
      el.recurringList.appendChild(row);
    }
  }
  function render(){
    const finance=selectedFinance(),salary=calculateSalary(),totals=financeTotals();
    const ready=finance.currentBalance!==null&&finance.creditBase!==null;
    const expected=ready?Number(finance.currentBalance)+salary.netMonth+Number(finance.extra||0)-totals.totalCredit-totals.totalFixed:0;
    const growth=ready?expected-Number(finance.currentBalance):0;
    const now=new Date(),today=dateStr(now),todayRow=salary.rows.find(row=>row.date===today),isCurrent=selectedMonthKey===currentMonthKey();

    renderMonthSwitcher();
    el.homeNetToday.textContent=money(salary.net);el.homeNetMonth.textContent=money(salary.netMonth);el.homeCredit.textContent=finance.creditBase===null?'טרם הוזן':money(totals.totalCredit);el.homeExpectedBalance.textContent=ready?money(expected):'טרם הוזן';
    el.homeSpendable.textContent=money(totals.remainingBudget);el.homeSpendable.classList.toggle('negative-value',totals.remainingBudget<0);el.homeBudgetText.textContent=totals.remainingBudget>=0?`נוצל ${money(totals.budgetSpent)} מתוך ${money(finance.monthlyBudget)}`:`חריגה של ${money(Math.abs(totals.remainingBudget))} מהתקציב`;
    el.salaryRegularHours.textContent=salary.regular.toFixed(1);el.salaryOt125.textContent=salary.ot125.toFixed(1);el.salaryOt150.textContent=salary.ot150.toFixed(1);el.salaryGrossToday.textContent=money(salary.gross);el.salaryNetToday.textContent=money(salary.net);el.salaryGrossMonth.textContent=money(salary.grossMonth);el.salaryNetMonth.textContent=money(salary.netMonth);

    el.clockInBtn.disabled=!isCurrent;el.clockOutBtn.disabled=!isCurrent;
    if(isCurrent){
      el.todayDate.textContent=now.toLocaleDateString('he-IL',{day:'numeric',month:'long',year:'numeric'});el.todayIn.textContent=todayRow?.in||activeShift?.in||'--:--';el.todayOut.textContent=todayRow?.out||'--:--';el.todaySummary.textContent=todayRow?`${presenceHours(todayRow).toFixed(1)} שעות נוכחות · ${paidHours(todayRow).toFixed(1)} שעות בתשלום`:activeShift?'משמרת פעילה':'טרם דווחה משמרת היום';
    }else{
      el.todayDate.textContent=monthLabel(selectedMonthKey);el.todayIn.textContent='--:--';el.todayOut.textContent='--:--';el.todaySummary.textContent='מצב היסטוריה: ניתן להוסיף או לתקן ימים ידנית';
    }

    el.currentBalance.value=inputNumber(finance.currentBalance);el.creditBase.value=inputNumber(finance.creditBase);el.fixedBase.value=inputNumber(finance.fixedBase??0);el.extraIncome.value=inputNumber(finance.extra??0);el.monthlyBudget.value=inputNumber(finance.monthlyBudget??1500);el.budgetBaseSpent.value=inputNumber(finance.budgetBaseSpent??0);
    if(finance.carriedBalance&&finance.balanceSource==='forecast'){
      const sourceLabel=finance.carriedFrom?monthLabel(finance.carriedFrom):'החודש הקודם';
      el.monthFinanceNote.textContent=`יתרת הפתיחה המשוערת חושבה לפי היתרה הצפויה בסוף ${sourceLabel}. לאחר בדיקה בבנק אפשר לעדכן אותה ליתרה האמיתית.`;
    }else if(finance.carriedBalance){
      el.monthFinanceNote.textContent='יתרת הפתיחה הועברה מהחודש הקודם כי לא היו מספיק נתונים לחישוב תחזית מלאה. מומלץ לעדכן אותה לפי הבנק.';
    }else{
      el.monthFinanceNote.textContent='הנתונים נשמרים בנפרד עבור החודש הנבחר. במעבר לחודש חדש האשראי, ההכנסה הנוספת והניצול מתאפסים.';
    }
    el.creditTotalBadge.textContent=money(totals.totalCredit);el.recurringTotalBadge.textContent=money(totals.recurringTotal);el.bankCreditTotal.textContent=finance.creditBase===null?'טרם הוזן':money(totals.totalCredit);el.bankFixedTotal.textContent=money(totals.totalFixed);el.bankExpected.textContent=ready?money(expected):'טרם הוזן';el.bankSpendable.textContent=money(totals.remainingBudget);el.bankSpendable.classList.toggle('negative-value',totals.remainingBudget<0);el.bankGrowth.textContent=ready?money(growth):'טרם הוזן';el.bankGrowth.classList.toggle('negative-value',ready&&growth<0);el.bankGrowth.classList.toggle('positive-value',ready&&growth>=0);
    renderCreditEntries(totals.entries);renderRecurring(totals.recurringItems);

    el.recordsList.innerHTML=salary.rows.length?'':'<div class="record"><small>אין דיווחים בחודש הזה</small></div>';
    [...salary.rows].reverse().forEach(row=>{const item=document.createElement('div');item.className='record';item.innerHTML=`<div><strong>${new Date(row.date+'T12:00').toLocaleDateString('he-IL')}</strong><br><small>${row.in}–${row.out} · ${paidHours(row).toFixed(2)} שעות בתשלום</small></div><button type="button">מחק</button>`;item.querySelector('button').addEventListener('click',()=>{records=records.filter(x=>x.id!==row.id);save(K.r,records);render();});el.recordsList.appendChild(item);});
  }

  document.querySelectorAll('.nav-item').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));button.classList.add('active');document.getElementById(button.dataset.page).classList.add('active');}));
  el.prevMonthBtn.addEventListener('click',()=>setSelectedMonth(monthKeyOffset(selectedMonthKey,-1)));
  el.nextMonthBtn.addEventListener('click',()=>{if(selectedMonthKey<currentMonthKey())setSelectedMonth(monthKeyOffset(selectedMonthKey,1));});
  el.goCurrentMonthBtn.addEventListener('click',()=>{if(selectedMonthKey!==currentMonthKey())setSelectedMonth(currentMonthKey());});

  el.clockInBtn.addEventListener('click',()=>{if(selectedMonthKey!==currentMonthKey())return;if(activeShift)return alert('כבר קיימת משמרת פעילה');const now=new Date();activeShift={date:dateStr(now),in:timeStr(now)};save(K.a,activeShift);render();});
  el.clockOutBtn.addEventListener('click',()=>{if(selectedMonthKey!==currentMonthKey())return;if(!activeShift)return alert('לא קיימת משמרת פעילה');const now=new Date();upsert({id:makeId(),date:activeShift.date,in:activeShift.in,out:timeStr(now),breakMinutes:settings.breakMinutes});activeShift=null;localStorage.removeItem(K.a);render();});
  el.manualForm.addEventListener('submit',event=>{event.preventDefault();if(String(el.manualDate.value).slice(0,7)!==selectedMonthKey){alert(`התאריך צריך להיות בתוך ${monthLabel(selectedMonthKey)}.`);return;}upsert({id:makeId(),date:el.manualDate.value,in:el.manualIn.value,out:el.manualOut.value,breakMinutes:Number(el.manualBreak.value||30)});render();});

  el.financeForm.addEventListener('submit',event=>{
    event.preventDefault();
    const current=parseDecimalInput(el.currentBalance.value),creditBase=parseDecimalInput(el.creditBase.value),fixedBase=parseDecimalInput(el.fixedBase.value),extra=parseDecimalInput(el.extraIncome.value),budget=parseDecimalInput(el.monthlyBudget.value),budgetBaseSpent=parseDecimalInput(el.budgetBaseSpent.value);
    if(current===null||creditBase===null){alert('יש למלא יתרה נוכחית וחיוב אשראי קיים. אפשר להזין 0 אם אין חיוב.');return;}
    const values=[current,creditBase,fixedBase??0,extra??0,budget??1500,budgetBaseSpent??0];if(values.some(value=>value<0)){alert('אין להזין סכומים שליליים.');return;}
    financeMonths[selectedMonthKey]=normalizeMonthData({...selectedFinance(),currentBalance:current,creditBase,fixedBase:fixedBase??0,extra:extra??0,monthlyBudget:budget??1500,budgetBaseSpent:budgetBaseSpent??0,carriedBalance:false,balanceSource:'manual',updatedAt:new Date().toISOString()});
    if(selectedMonthKey===currentMonthKey()){financePrefs.monthlyBudget=financeMonths[selectedMonthKey].monthlyBudget;save(K.financePrefs,financePrefs);}
    save(K.months,financeMonths);render();
  });
  el.creditExpenseForm.addEventListener('submit',event=>{
    event.preventDefault();const description=el.creditDescription.value.trim(),amount=parseDecimalInput(el.creditAmount.value),date=el.creditDate.value;
    if(!description||amount===null||amount<=0||!date){alert('יש למלא תיאור, סכום חיובי ותאריך.');return;}if(String(date).slice(0,7)!==selectedMonthKey){alert(`התאריך צריך להיות בתוך ${monthLabel(selectedMonthKey)}.`);return;}
    creditEntries.push({id:makeId(),description,amount,date,countsBudget:el.creditCountsBudget.checked,createdAt:new Date().toISOString()});save(K.creditEntries,creditEntries);el.creditDescription.value='';el.creditAmount.value='';el.creditDate.value=defaultDateForMonth(selectedMonthKey);el.creditCountsBudget.checked=true;render();
  });
  el.recurringForm.addEventListener('submit',event=>{
    event.preventDefault();const name=el.recurringName.value.trim(),amount=parseDecimalInput(el.recurringAmount.value),day=el.recurringDay.value?Number(el.recurringDay.value):null;
    if(!name||amount===null||amount<=0){alert('יש למלא שם וסכום חודשי חיובי.');return;}if(day!==null&&(day<1||day>31)){alert('יום החיוב צריך להיות בין 1 ל־31. בחודש קצר החיוב יוצג ביום האחרון של החודש.');return;}
    recurringPayments.push({id:makeId(),name,amount,day,type:el.recurringType.value,startMonth:selectedMonthKey,active:true,createdAt:new Date().toISOString()});save(K.recurring,recurringPayments);el.recurringName.value='';el.recurringAmount.value='';el.recurringDay.value='';el.recurringType.value='standing';render();
  });

  const openSettings=()=>{el.setBase.value=inputNumber(settings.base);el.setTravel.value=inputNumber(settings.travel);el.setHours.value=inputNumber(settings.hours);el.setPension.value=inputNumber(settings.pension);el.setCreditPoints.value=inputNumber(settings.creditPoints);el.setBreak.value=inputNumber(settings.breakMinutes);el.settingsOverlay.hidden=false;document.body.classList.add('modal-open');setTimeout(()=>el.setBase.focus(),0);};
  const closeSettingsModal=()=>{el.settingsOverlay.hidden=true;document.body.classList.remove('modal-open');};
  el.settingsBtn.addEventListener('click',openSettings);el.closeSettings.addEventListener('click',closeSettingsModal);el.settingsOverlay.addEventListener('click',event=>{if(event.target===el.settingsOverlay)closeSettingsModal();});document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!el.settingsOverlay.hidden)closeSettingsModal();});
  el.settingsForm.addEventListener('submit',event=>{event.preventDefault();const base=parseDecimalInput(el.setBase.value),travel=parseDecimalInput(el.setTravel.value),hours=parseDecimalInput(el.setHours.value),pension=parseDecimalInput(el.setPension.value),creditPoints=parseDecimalInput(el.setCreditPoints.value),breakMinutes=parseDecimalInput(el.setBreak.value);if([base,travel,hours,pension,creditPoints,breakMinutes].some(value=>value===null)){alert('יש למלא את כל הגדרות השכר במספרים תקינים.');return;}settings={...settings,base,travel,hours,pension,creditPoints,breakMinutes};save(K.s,settings);closeSettingsModal();render();});

  let observedCalendarMonth=currentMonthKey();
  function syncCalendarMonth(){
    const latest=currentMonthKey();
    if(latest===observedCalendarMonth) return;
    const wasViewingLiveMonth=selectedMonthKey===observedCalendarMonth;
    observedCalendarMonth=latest;
    ensureMonthBucket(latest);
    if(wasViewingLiveMonth) setSelectedMonth(latest);
    else render();
  }

  el.manualDate.value=defaultDateForMonth(selectedMonthKey);el.creditDate.value=defaultDateForMonth(selectedMonthKey);render();
  window.setInterval(syncCalendarMonth,60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncCalendarMonth();});
  window.addEventListener('focus',syncCalendarMonth);

  if('serviceWorker'in navigator){navigator.serviceWorker.getRegistrations().then(regs=>Promise.all(regs.map(reg=>reg.unregister()))).finally(()=>{'caches'in window&&caches.keys().then(keys=>Promise.all(keys.map(key=>caches.delete(key))));});}
});
