const DEFAULT_SETTINGS = {
  base: 11000,
  travel: 300,
  hours: 182,
  pension: 6,
  creditPoints: 2.25,
  creditValue: 242,
  breakMinutes: 30,
  niCeiling: 7703,
  niLow: 0.0427,
  niHigh: 0.1217,
  tax: [[7010,.1],[10060,.14],[16150,.2],[22440,.31],[46690,.35],[60130,.47],[1e9,.5]]
};
const DEFAULT_FINANCE = { currentBalance: null, credit: null, fixed: null, extra: 0, monthlyBudget: 1500, discretionarySpent: 0 };
const K = { s:'ct.s', r:'ct.r', a:'ct.a', f:'ct.f' };
const load = (k,d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k,v) => localStorage.setItem(k, JSON.stringify(v));
const money = value => {
  const amount = Number(value) || 0;
  const hasAgorot = Math.abs(amount - Math.round(amount)) > 0.000001;
  return new Intl.NumberFormat('he-IL',{
    style:'currency',
    currency:'ILS',
    minimumFractionDigits: hasAgorot ? 2 : 0,
    maximumFractionDigits: 2
  }).format(amount);
};

function parseDecimalInput(value){
  let text = String(value ?? '')
    .trim()
    .replace(/[₪\s\u00A0]/g,'')
    .replace(/[’']/g,'');

  if(text === '') return null;

  const commaCount = (text.match(/,/g) || []).length;
  const dotCount = (text.match(/\./g) || []).length;

  if(commaCount > 0 && dotCount > 0){
    // The last separator is treated as the decimal separator.
    const decimalSeparator = text.lastIndexOf(',') > text.lastIndexOf('.') ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    text = text.split(thousandsSeparator).join('');
    text = text.replace(decimalSeparator,'.');
  }else if(commaCount > 0){
    const parts = text.split(',');
    if(commaCount === 1 && parts[1].length <= 2){
      text = `${parts[0]}.${parts[1]}`;
    }else{
      text = parts.join('');
    }
  }else if(dotCount > 0){
    const parts = text.split('.');
    if(dotCount === 1 && parts[1].length <= 2){
      // Already a decimal dot.
    }else if(dotCount === 1 && parts[1].length === 3){
      // Common thousands separator, e.g. 1.500
      text = parts.join('');
    }else if(dotCount > 1){
      const lastPart = parts.at(-1);
      if(lastPart.length <= 2){
        text = `${parts.slice(0,-1).join('')}.${lastPart}`;
      }else{
        text = parts.join('');
      }
    }
  }

  text = text.replace(/[^0-9.\-]/g,'');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

const inputNumber = value => {
  if(value === null || value === undefined || value === '') return '';
  return String(Number(value));
};
const pad = n => String(n).padStart(2,'0');
const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const timeStr = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
let settings = {...DEFAULT_SETTINGS, ...load(K.s,{})};
let finance = {...DEFAULT_FINANCE, ...load(K.f,{})};
// Migration from older versions that used a minimum checking-balance target.
if (finance.monthlyBudget == null) finance.monthlyBudget = 1500;
if (finance.discretionarySpent == null) finance.discretionarySpent = 0;
let records = load(K.r,[]);
let activeShift = load(K.a,null);

function parseDateTime(d,t){
  const [y,m,day] = d.split('-').map(Number);
  const [h,min] = t.split(':').map(Number);
  return new Date(y,m-1,day,h,min);
}
function presenceHours(row){
  const start = parseDateTime(row.date,row.in);
  let end = parseDateTime(row.date,row.out);
  if(end < start) end = new Date(end.getTime()+86400000);
  return Math.max(0,(end-start)/3600000);
}
function paidHours(row){ return Math.max(0,presenceHours(row)-Number(row.breakMinutes ?? settings.breakMinutes)/60); }
function incomeTax(income,scale){
  let previous=0,total=0;
  for(const [ceiling,rate] of settings.tax){
    const scaled=ceiling*scale;
    const slice=Math.min(income,scaled)-previous;
    if(slice>0) total += slice*rate;
    previous=scaled;
    if(income<=scaled) break;
  }
  return Math.max(0,total-settings.creditPoints*settings.creditValue*scale);
}
function nationalInsurance(income,scale){
  const ceiling=settings.niCeiling*scale;
  const low=Math.min(income,ceiling);
  const high=Math.max(0,income-ceiling);
  return low*settings.niLow+high*settings.niHigh;
}
function monthRows(){
  const now=new Date();
  return records.filter(row=>{
    const d=parseDateTime(row.date,'00:00');
    return d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth() && d<=now;
  }).sort((a,b)=>a.date.localeCompare(b.date));
}
function calculate(){
  const rows=monthRows();
  const hourly=settings.base/settings.hours;
  let regular=0,ot125=0,ot150=0,totalPaid=0,days=0;
  for(const row of rows){
    const presence=presenceHours(row), paid=paidHours(row), overtime=Math.max(0,presence-9);
    regular += Math.min(paid,8.5);
    ot125 += Math.min(2,overtime);
    ot150 += Math.max(0,overtime-2);
    totalPaid += paid;
    if(presence>0) days++;
  }
  const regularPay=Math.min(regular,settings.hours)*hourly;
  const pay125=ot125*hourly*1.25;
  const pay150=ot150*hourly*1.5;
  const travel=Math.min(settings.travel,days*(settings.travel/21.67));
  const gross=regularPay+pay125+pay150+travel;
  const progress=Math.max(Math.min(regular/settings.hours,1),0.0001);
  const net=Math.max(0,gross-incomeTax(gross,progress)-nationalInsurance(gross,progress)-(regularPay+pay125+pay150)*(settings.pension/100));
  const grossMonth=settings.base+settings.travel+pay125+pay150;
  const netMonth=Math.max(0,grossMonth-incomeTax(grossMonth,1)-nationalInsurance(grossMonth,1)-(settings.base+pay125+pay150)*(settings.pension/100));
  return {rows,regular,ot125,ot150,totalPaid,gross,net,grossMonth,netMonth};
}
function upsert(row){
  const i=records.findIndex(x=>x.date===row.date);
  if(i>=0) records[i]=row; else records.push(row);
  save(K.r,records);
}

window.addEventListener('DOMContentLoaded',()=>{
  const $ = id => document.getElementById(id);
  const el = {
    settingsBtn:$('settingsBtn'), settingsOverlay:$('settingsOverlay'), closeSettings:$('closeSettings'), settingsForm:$('settingsForm'),
    setBase:$('setBase'), setTravel:$('setTravel'), setHours:$('setHours'), setPension:$('setPension'), setCreditPoints:$('setCreditPoints'), setBreak:$('setBreak'),
    homeNetToday:$('homeNetToday'), homeNetMonth:$('homeNetMonth'), homeCredit:$('homeCredit'), homeExpectedBalance:$('homeExpectedBalance'), homeSpendable:$('homeSpendable'), homeBudgetText:$('homeBudgetText'),
    salaryRegularHours:$('salaryRegularHours'), salaryOt125:$('salaryOt125'), salaryOt150:$('salaryOt150'), salaryGrossToday:$('salaryGrossToday'), salaryNetToday:$('salaryNetToday'), salaryGrossMonth:$('salaryGrossMonth'), salaryNetMonth:$('salaryNetMonth'),
    todayDate:$('todayDate'), todayIn:$('todayIn'), todayOut:$('todayOut'), todaySummary:$('todaySummary'),
    currentBalance:$('currentBalance'), creditCurrent:$('creditCurrent'), fixedExpenses:$('fixedExpenses'), extraIncome:$('extraIncome'), monthlyBudget:$('monthlyBudget'), discretionarySpent:$('discretionarySpent'), bankExpected:$('bankExpected'), bankSpendable:$('bankSpendable'), bankGrowth:$('bankGrowth'),
    recordsList:$('recordsList'), clockInBtn:$('clockInBtn'), clockOutBtn:$('clockOutBtn'), manualForm:$('manualForm'), manualDate:$('manualDate'), manualIn:$('manualIn'), manualOut:$('manualOut'), manualBreak:$('manualBreak'), financeForm:$('financeForm')
  };

  function render(){
    const c=calculate();
    const ready=finance.currentBalance!==null && finance.credit!==null && finance.fixed!==null;
    // Extra income is treated as NET cash received.
    const expected=ready ? Number(finance.currentBalance)+c.netMonth+Number(finance.extra||0)-Number(finance.credit)-Number(finance.fixed) : 0;
    const remainingBudget=Number(finance.monthlyBudget||0)-Number(finance.discretionarySpent||0);
    const checkingGrowth=ready ? expected-Number(finance.currentBalance) : 0;
    const now=new Date(), today=dateStr(now), todayRow=c.rows.find(x=>x.date===today);

    el.homeNetToday.textContent=money(c.net);
    el.homeNetMonth.textContent=money(c.netMonth);
    el.homeCredit.textContent=finance.credit===null?'טרם הוזן':money(finance.credit);
    el.homeExpectedBalance.textContent=ready?money(expected):'טרם הוזן';
    el.homeSpendable.textContent=money(remainingBudget);
    el.homeSpendable.classList.toggle('negative-value', remainingBudget < 0);
    el.homeBudgetText.textContent=remainingBudget >= 0 ? `תקציב חודשי: ${money(finance.monthlyBudget)}` : `חריגה של ${money(Math.abs(remainingBudget))} מהתקציב`;
    el.salaryRegularHours.textContent=c.regular.toFixed(1);
    el.salaryOt125.textContent=c.ot125.toFixed(1);
    el.salaryOt150.textContent=c.ot150.toFixed(1);
    el.salaryGrossToday.textContent=money(c.gross);
    el.salaryNetToday.textContent=money(c.net);
    el.salaryGrossMonth.textContent=money(c.grossMonth);
    el.salaryNetMonth.textContent=money(c.netMonth);
    el.todayDate.textContent=now.toLocaleDateString('he-IL',{day:'numeric',month:'long',year:'numeric'});
    el.todayIn.textContent=todayRow?.in || activeShift?.in || '--:--';
    el.todayOut.textContent=todayRow?.out || '--:--';
    el.todaySummary.textContent=todayRow ? `${presenceHours(todayRow).toFixed(1)} שעות נוכחות · ${paidHours(todayRow).toFixed(1)} שעות בתשלום` : activeShift ? 'משמרת פעילה' : 'טרם דווחה משמרת היום';
    el.currentBalance.value=inputNumber(finance.currentBalance);
    el.creditCurrent.value=inputNumber(finance.credit);
    el.fixedExpenses.value=inputNumber(finance.fixed);
    el.extraIncome.value=inputNumber(finance.extra ?? 0);
    el.monthlyBudget.value=inputNumber(finance.monthlyBudget ?? 1500);
    el.discretionarySpent.value=inputNumber(finance.discretionarySpent ?? 0);
    el.bankExpected.textContent=ready?money(expected):'טרם הוזן';
    el.bankSpendable.textContent=money(remainingBudget);
    el.bankSpendable.classList.toggle('negative-value', remainingBudget < 0);
    el.bankGrowth.textContent=ready?money(checkingGrowth):'טרם הוזן';
    el.bankGrowth.classList.toggle('negative-value', ready && checkingGrowth < 0);
    el.bankGrowth.classList.toggle('positive-value', ready && checkingGrowth >= 0);

    el.recordsList.innerHTML=c.rows.length?'':'<div class="record"><small>אין דיווחים החודש</small></div>';
    [...c.rows].reverse().forEach(row=>{
      const item=document.createElement('div');
      item.className='record';
      item.innerHTML=`<div><strong>${new Date(row.date+'T12:00').toLocaleDateString('he-IL')}</strong><br><small>${row.in}–${row.out} · ${paidHours(row).toFixed(2)} שעות בתשלום</small></div><button type="button">מחק</button>`;
      item.querySelector('button').addEventListener('click',()=>{records=records.filter(x=>x.id!==row.id);save(K.r,records);render();});
      el.recordsList.appendChild(item);
    });
  }

  document.querySelectorAll('.nav-item').forEach(button=>button.addEventListener('click',()=>{
    document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
    button.classList.add('active');
    document.getElementById(button.dataset.page).classList.add('active');
  }));

  el.clockInBtn.addEventListener('click',()=>{
    if(activeShift) return alert('כבר קיימת משמרת פעילה');
    const now=new Date(); activeShift={date:dateStr(now),in:timeStr(now)}; save(K.a,activeShift); render();
  });
  el.clockOutBtn.addEventListener('click',()=>{
    if(!activeShift) return alert('לא קיימת משמרת פעילה');
    const now=new Date(); upsert({id:crypto.randomUUID(),date:activeShift.date,in:activeShift.in,out:timeStr(now),breakMinutes:settings.breakMinutes}); activeShift=null; localStorage.removeItem(K.a); render();
  });
  el.manualForm.addEventListener('submit',event=>{
    event.preventDefault(); upsert({id:crypto.randomUUID(),date:el.manualDate.value,in:el.manualIn.value,out:el.manualOut.value,breakMinutes:Number(el.manualBreak.value||30)}); render();
  });
  el.financeForm.addEventListener('submit',event=>{
    event.preventDefault();
    const currentValue=parseDecimalInput(el.currentBalance.value);
    const creditValue=parseDecimalInput(el.creditCurrent.value);
    const fixedValue=parseDecimalInput(el.fixedExpenses.value);
    const extraValue=parseDecimalInput(el.extraIncome.value);
    const budgetValue=parseDecimalInput(el.monthlyBudget.value);
    const spentValue=parseDecimalInput(el.discretionarySpent.value);

    if(currentValue===null || creditValue===null || fixedValue===null){
      alert('יש למלא יתרה נוכחית, אשראי והוצאות קבועות. אפשר להזין אגורות עם נקודה או פסיק, לדוגמה 1234.56 או 1234,56.');
      return;
    }
    if([extraValue,budgetValue,spentValue].some(value => value !== null && !Number.isFinite(value))){
      alert('אחד הסכומים שהוזנו אינו תקין.');
      return;
    }

    finance={
      currentBalance:currentValue,
      credit:creditValue,
      fixed:fixedValue,
      extra:extraValue ?? 0,
      monthlyBudget:budgetValue ?? 1500,
      discretionarySpent:spentValue ?? 0
    };
    save(K.f,finance); render();
  });

  const openSettings = () => {
    el.setBase.value=inputNumber(settings.base);
    el.setTravel.value=inputNumber(settings.travel);
    el.setHours.value=inputNumber(settings.hours);
    el.setPension.value=inputNumber(settings.pension);
    el.setCreditPoints.value=inputNumber(settings.creditPoints);
    el.setBreak.value=inputNumber(settings.breakMinutes);
    el.settingsOverlay.hidden=false;
    document.body.classList.add('modal-open');
    window.setTimeout(()=>el.setBase.focus(),0);
  };
  const closeSettingsModal = () => {
    el.settingsOverlay.hidden=true;
    document.body.classList.remove('modal-open');
  };
  el.settingsBtn.addEventListener('click', openSettings);
  el.settingsBtn.addEventListener('touchend', event => { event.preventDefault(); openSettings(); }, {passive:false});
  el.closeSettings.addEventListener('click', closeSettingsModal);
  el.settingsOverlay.addEventListener('click',event=>{ if(event.target===el.settingsOverlay) closeSettingsModal(); });
  document.addEventListener('keydown',event=>{ if(event.key==='Escape' && !el.settingsOverlay.hidden) closeSettingsModal(); });
  el.settingsForm.addEventListener('submit',event=>{
    event.preventDefault();
    const base=parseDecimalInput(el.setBase.value);
    const travel=parseDecimalInput(el.setTravel.value);
    const hours=parseDecimalInput(el.setHours.value);
    const pension=parseDecimalInput(el.setPension.value);
    const creditPoints=parseDecimalInput(el.setCreditPoints.value);
    const breakMinutes=parseDecimalInput(el.setBreak.value);
    if([base,travel,hours,pension,creditPoints,breakMinutes].some(value => value === null)){
      alert('יש למלא את כל הגדרות השכר במספרים תקינים.');
      return;
    }
    settings={...settings,base,travel,hours,pension,creditPoints,breakMinutes};
    save(K.s,settings); closeSettingsModal(); render();
  });

  el.manualDate.value=dateStr(new Date());
  render();
  if('serviceWorker' in navigator){
    navigator.serviceWorker.getRegistrations().then(regs=>Promise.all(regs.map(reg=>reg.unregister()))).finally(()=>{
      if('caches' in window) caches.keys().then(keys=>Promise.all(keys.map(key=>caches.delete(key))));
    });
  }
});
